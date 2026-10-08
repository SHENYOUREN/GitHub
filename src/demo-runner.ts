import type { ExecutionConfigStore } from './execution-config.js';
import type { TaskRecord, TaskStore } from './task-store.js';
import type { TimelineStore } from './timeline.js';

interface DemoContext {
  taskId: string;
  cancelled: boolean;
  paused: boolean;
  timers: NodeJS.Timeout[];
  pending: Array<() => void>;
}

function delay(context: DemoContext, ms: number, callback: () => void) {
  const timer = setTimeout(() => {
    context.timers = context.timers.filter((item) => item !== timer);
    if (context.cancelled) return;
    if (context.paused) {
      context.pending.push(callback);
      return;
    }
    callback();
  }, ms);
  context.timers.push(timer);
}

export class DemoRunner {
  private readonly contexts = new Map<string, DemoContext>();

  constructor(
    private readonly timeline: TimelineStore,
    private readonly tasks: TaskStore,
    private readonly config: ExecutionConfigStore,
  ) {}

  start(objective: string): TaskRecord {
    const selected = this.config.get();
    const task = this.tasks.create({
      objective,
      title: `演示：${objective.slice(0, 64)}`,
      source: 'demo',
      status: 'running',
      providerId: selected.providerId,
      modelId: selected.modelId,
      reasoningEffort: selected.reasoningEffort,
      role: selected.role,
      permission: selected.permission,
      workspaceRoot: selected.workspaceRoot,
    });
    const context: DemoContext = { taskId: task.id, cancelled: false, paused: false, timers: [], pending: [] };
    this.contexts.set(task.id, context);

    this.timeline.add({
      type: 'demo.task.created', kind: 'message', actor: 'chatgpt-controller', title: 'ChatGPT → DeepSeek（演示）',
      detail: objective, state: 'info', metadata: { taskId: task.id, channel: 'controller', visibility: 'both', demo: true },
    });
    this.timeline.add({
      type: 'demo.worker.started', kind: 'status', actor: 'deepseek-worker', title: 'DeepSeek · 状态',
      detail: '已收到任务，开始检查。', state: 'info', metadata: { taskId: task.id, channel: 'worker', visibility: 'both', demo: true },
    });

    delay(context, 350, () => this.timeline.add({
      type: 'demo.worker.reasoning.1', kind: 'reasoning', actor: 'deepseek-worker', title: 'DeepSeek · 思考',
      detail: '先确认项目入口和页面结构，再决定从哪些文件开始检查。', state: 'info',
      metadata: { taskId: task.id, channel: 'worker', visibility: 'agent', demo: true, contentSource: 'demo-simulated' },
    }));
    delay(context, 850, () => this.timeline.add({
      type: 'demo.worker.tool.1', kind: 'tool', actor: 'deepseek-worker', title: 'DeepSeek · 工具',
      detail: '读取项目清单与网页入口。', state: 'info',
      metadata: { taskId: task.id, channel: 'worker', visibility: 'agent', demo: true, toolName: 'read_file', path: 'package.json · public/index.html' },
    }));
    delay(context, 1350, () => this.timeline.add({
      type: 'demo.worker.reasoning.2', kind: 'reasoning', actor: 'deepseek-worker', title: 'DeepSeek · 思考',
      detail: '页面结构已经确认。接下来需要确定：是优先检查执行窗口，还是先检查任务室总览。', state: 'info',
      metadata: { taskId: task.id, channel: 'worker', visibility: 'agent', demo: true, contentSource: 'demo-simulated' },
    }));
    delay(context, 1900, () => {
      this.tasks.update(task.id, { status: 'waiting-user', waitingReason: '等待用户选择优先检查范围', lastSummary: '已完成入口与页面结构确认。' });
      this.timeline.add({
        type: 'demo.worker.question', kind: 'question', actor: 'deepseek-worker', title: 'DeepSeek · 提问',
        detail: '我已经确认页面结构。你希望我先检查“执行 Agent 窗口”，还是先检查“任务室总览”？', state: 'waiting',
        metadata: { taskId: task.id, channel: 'worker', visibility: 'both', demo: true },
      });
    });

    return task;
  }

  respond(taskId: string, message: string): boolean {
    const task = this.tasks.get(taskId);
    const context = this.contexts.get(taskId);
    if (!task || task.source !== 'demo' || task.status !== 'waiting-user' || !context || context.cancelled) return false;

    this.tasks.update(taskId, { status: 'running', waitingReason: null, lastSummary: `用户回复：${message.slice(0, 160)}` });
    this.timeline.add({
      type: 'demo.worker.resume', kind: 'status', actor: 'deepseek-worker', title: 'DeepSeek · 状态',
      detail: '收到你的回复，继续执行演示任务。', state: 'info',
      metadata: { taskId, channel: 'worker', visibility: 'both', demo: true },
    });
    delay(context, 300, () => this.timeline.add({
      type: 'demo.worker.reasoning.3', kind: 'reasoning', actor: 'deepseek-worker', title: 'DeepSeek · 思考',
      detail: `按用户刚才的要求继续：${message}`, state: 'info',
      metadata: { taskId, channel: 'worker', visibility: 'agent', demo: true, contentSource: 'demo-simulated' },
    }));
    delay(context, 800, () => this.timeline.add({
      type: 'demo.worker.tool.2', kind: 'tool', actor: 'deepseek-worker', title: 'DeepSeek · 工具',
      detail: '继续读取对应页面脚本与样式。', state: 'info',
      metadata: { taskId, channel: 'worker', visibility: 'agent', demo: true, toolName: 'read_file', path: 'public/agent.js · public/styles.css' },
    }));
    delay(context, 1350, () => {
      this.tasks.update(taskId, { status: 'completed', waitingReason: null, lastSummary: '演示流程完成：思考、工具、提问、用户插话和结果均已跑通。' });
      this.timeline.add({
        type: 'demo.worker.result', kind: 'result', actor: 'deepseek-worker', title: 'DeepSeek · 结果',
        detail: '演示完成：三界面共享时间线、执行过程分轨、等待用户回复与人工插话流程均已跑通。真实 DSH 接入后，只需要把这些模拟事件替换为实际事件。',
        state: 'success', metadata: { taskId, channel: 'worker', visibility: 'both', demo: true },
      });
      this.contexts.delete(taskId);
    });
    return true;
  }

  pause(taskId: string): boolean {
    const context = this.contexts.get(taskId);
    const task = this.tasks.get(taskId);
    if (!context || !task || context.cancelled || task.status !== 'running') return false;
    context.paused = true;
    this.tasks.update(taskId, { status: 'paused', waitingReason: null, lastSummary: '演示任务已暂停。' });
    this.timeline.add({
      type: 'demo.worker.paused', kind: 'status', actor: 'deepseek-worker', title: 'DeepSeek · 状态', detail: '演示任务已暂停。', state: 'waiting',
      metadata: { taskId, channel: 'worker', visibility: 'both', demo: true },
    });
    return true;
  }

  resume(taskId: string): boolean {
    const context = this.contexts.get(taskId);
    const task = this.tasks.get(taskId);
    if (!context || !task || context.cancelled || task.status !== 'paused') return false;
    context.paused = false;
    this.tasks.update(taskId, { status: 'running', waitingReason: null, lastSummary: '演示任务已继续。' });
    this.timeline.add({
      type: 'demo.worker.continued', kind: 'status', actor: 'deepseek-worker', title: 'DeepSeek · 状态', detail: '演示任务继续运行。', state: 'info',
      metadata: { taskId, channel: 'worker', visibility: 'both', demo: true },
    });
    const pending = context.pending.splice(0);
    pending.forEach((callback, index) => delay(context, 120 * (index + 1), callback));
    return true;
  }


  cancel(taskId: string): boolean {
    const context = this.contexts.get(taskId);
    const task = this.tasks.get(taskId);
    if (!task || ['completed', 'failed', 'cancelled'].includes(task.status)) return false;
    if (context) {
      context.cancelled = true;
      for (const timer of context.timers) clearTimeout(timer);
      context.pending = [];
      this.contexts.delete(taskId);
    }
    this.tasks.update(taskId, { status: 'cancelled', waitingReason: null, lastSummary: '任务已由用户中止。' });
    this.timeline.add({
      type: task.source === 'demo' ? 'demo.worker.cancelled' : 'task.control.cancel', kind: 'status', actor: 'human-owner', title: '任务已中止',
      detail: '用户请求中止当前任务。', state: 'error', metadata: { taskId, channel: 'human', visibility: 'both', demo: task.source === 'demo' },
    });
    return true;
  }
}
