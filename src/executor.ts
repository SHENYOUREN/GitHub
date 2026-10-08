import { randomUUID } from 'node:crypto';
import {
  AgentEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from '@a2a-js/sdk/server';
import {
  Role,
  TaskState,
  type Artifact,
  type Message,
  type Task,
} from '@a2a-js/sdk';
import { parseControllerTask, PolicyError } from './policy.js';
import {
  HIERARCHY_METADATA_KEY,
  type AuditSink,
  type TaskEnvelope,
  type WorkerAdapter,
} from './types.js';

function textFromMessage(message: Message): string {
  const values = message.parts
    .filter((part) => part.content?.$case === 'text')
    .map((part) => (part.content?.$case === 'text' ? part.content.value : ''));
  return values.join('\n').trim();
}

function agentMessage(taskId: string, contextId: string, text: string): Message {
  return {
    role: Role.ROLE_AGENT,
    messageId: randomUUID(),
    parts: [
      {
        content: { $case: 'text', value: text },
        filename: '',
        mediaType: 'text/plain',
        metadata: undefined,
      },
    ],
    taskId,
    contextId,
    extensions: [],
    metadata: {},
    referenceTaskIds: [],
  };
}

export class HierarchicalExecutor implements AgentExecutor {
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly worker: WorkerAdapter,
    private readonly audit: AuditSink,
  ) {}

  cancelTask = async (taskId: string): Promise<void> => {
    this.running.get(taskId)?.abort();
    await this.audit.write({
      timestamp: new Date().toISOString(),
      event: 'task.cancel.requested',
      taskId,
    });
  };

  async execute(context: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const taskId = context.taskId;
    const contextId = context.contextId;
    const userMessage = context.userMessage;
    const task: Task = context.task ?? {
      id: taskId,
      contextId,
      status: {
        state: TaskState.TASK_STATE_SUBMITTED,
        timestamp: new Date().toISOString(),
        message: undefined,
      },
      artifacts: [],
      history: [userMessage],
      metadata: userMessage.metadata,
    };
    eventBus.publish(AgentEvent.task(task));

    const controller = new AbortController();
    this.running.set(taskId, controller);

    try {
      const envelopeValue = userMessage.metadata?.[HIERARCHY_METADATA_KEY];
      if (!envelopeValue) {
        throw new PolicyError(`Missing metadata: ${HIERARCHY_METADATA_KEY}`);
      }

      const envelope: TaskEnvelope = parseControllerTask(envelopeValue);
      if (envelope.assignedTo.id !== this.worker.id) {
        throw new PolicyError('Task is assigned to a different worker.');
      }

      const messageObjective = textFromMessage(userMessage);
      if (messageObjective && messageObjective !== envelope.objective) {
        throw new PolicyError('Message objective does not match the signed task envelope.');
      }

      await this.audit.write({
        timestamp: new Date().toISOString(),
        event: 'task.accepted',
        taskId,
        actorId: envelope.issuedBy.id,
        targetId: envelope.assignedTo.id,
        detail: { controllerTaskId: envelope.taskId },
      });

      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_WORKING,
            timestamp: new Date().toISOString(),
            message: agentMessage(taskId, contextId, `Delegating to ${this.worker.id}.`),
          },
          metadata: {},
        }),
      );

      const result = await this.worker.run({
        taskId,
        contextId,
        objective: envelope.objective,
        envelope,
        signal: controller.signal,
      });

      const artifact: Artifact = {
        artifactId: randomUUID(),
        name: 'worker-result',
        description: `Result returned by ${this.worker.id}.`,
        parts: [
          {
            content: { $case: 'text', value: result.text },
            filename: '',
            mediaType: 'text/plain',
            metadata: undefined,
          },
        ],
        metadata: result.metadata,
        extensions: [],
      };
      eventBus.publish(
        AgentEvent.artifactUpdate({
          taskId,
          contextId,
          artifact,
          append: false,
          lastChunk: true,
          metadata: undefined,
        }),
      );
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_COMPLETED,
            timestamp: new Date().toISOString(),
            message: undefined,
          },
          metadata: undefined,
        }),
      );

      await this.audit.write({
        timestamp: new Date().toISOString(),
        event: 'task.completed',
        taskId,
        targetId: this.worker.id,
      });
    } catch (error) {
      const cancelled = controller.signal.aborted;
      const message = error instanceof Error ? error.message : String(error);
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: cancelled
              ? TaskState.TASK_STATE_CANCELED
              : TaskState.TASK_STATE_FAILED,
            timestamp: new Date().toISOString(),
            message: agentMessage(taskId, contextId, message),
          },
          metadata: {
            failureKind: error instanceof PolicyError ? 'policy' : 'worker',
          },
        }),
      );
      await this.audit.write({
        timestamp: new Date().toISOString(),
        event: cancelled ? 'task.cancelled' : 'task.failed',
        taskId,
        detail: { message },
      });
    } finally {
      this.running.delete(taskId);
    }
  }
}
