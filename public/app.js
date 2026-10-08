const state = {
  providers: [],
  events: [],
  control: { roomEnabled: false, workerAwake: false },
  controller: { connected: false },
  workerSession: { connected: false },
  config: null,
  eventSource: null,
  tasks: [],
};
const $ = (selector) => document.querySelector(selector);
const elements = {
  provider: $('#provider'), model: $('#model'), efforts: $('#effort-options'), role: $('#role'), permission: $('#permission'),
  note: $('#provider-note'), workspace: $('#workspace-root'), roomToggle: $('#room-toggle'), workerToggle: $('#worker-toggle'),
  workerService: $('#worker-service-state'), controllerService: $('#controller-service-state'), workerState: $('#worker-state'),
  controllerState: $('#controller-state'), controllerClient: $('#controller-client'), controllerModel: $('#controller-model'),
  controllerConversation: $('#controller-conversation'), controllerHeartbeat: $('#controller-heartbeat'), workspaceStatus: $('#workspace-status'),
  conversation: $('#room-conversation'), roomNotice: $('#room-disabled-notice'), streamState: $('#stream-state'),
  detail: $('#detail-dialog'), detailTitle: $('#detail-title'), detailContent: $('#detail-content'),
  taskHistory: $('#task-history'), waitingBanner: $('#waiting-user-banner'), waitingText: $('#waiting-user-text'),
  demoButton: $('#run-demo'), demoHint: $('#demo-hint'), answerWaiting: $('#answer-waiting'),
};
const effortLabels = { off: '关闭', minimal: '最小', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大' };
const roleLabels = { controller: 'ChatGPT', worker: 'DeepSeek', reviewer: 'DeepSeek · 审查', researcher: 'DeepSeek · 研究', human: '用户', system: '中转站' };

function fillSelect(select, values, emptyText) {
  select.replaceChildren();
  if (!values.length) {
    const option = new Option(emptyText, ''); option.disabled = true; option.selected = true;
    select.add(option); select.disabled = true; return;
  }
  select.disabled = false;
  values.forEach((value) => {
    const item = typeof value === 'string' ? { id: value, name: value } : value;
    select.add(new Option(item.name, item.id));
  });
}
function selectedProvider() { return state.providers.find((item) => item.id === elements.provider.value); }
function selectedModel() {
  const models = selectedProvider()?.models ?? [];
  return models.find((item) => item.id === elements.model.value) ?? models[0];
}
function currentEffort() { return document.querySelector('input[name="reasoningEffort"]:checked')?.value ?? null; }

function renderEfforts(efforts, selected) {
  elements.efforts.replaceChildren();
  if (!efforts.length) {
    const empty = document.createElement('span'); empty.className = 'effort-empty'; empty.textContent = '等待执行端发现'; elements.efforts.append(empty); return;
  }
  efforts.forEach((effort, index) => {
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'reasoningEffort'; input.id = `effort-${effort}`; input.value = effort;
    input.checked = efforts.includes(selected) ? effort === selected : index === 0;
    const label = document.createElement('label'); label.htmlFor = input.id; label.textContent = effortLabels[effort] ?? effort;
    elements.efforts.append(input, label);
  });
}

function providerNote(provider) {
  if (!provider) return '尚未选择执行端。';
  if (provider.status === 'ready') return '本地测试执行器已就绪。';
  if (provider.status === 'bridge-only') return '参数可以预先配置；真实 DSH 适配器接入后会读取这份配置。';
  return '该服务商目前只是预留入口。';
}

function applyConfigToControls() {
  if (!state.config) return;
  if (state.providers.some((provider) => provider.id === state.config.providerId)) elements.provider.value = state.config.providerId;
  const provider = selectedProvider();
  fillSelect(elements.model, provider?.models ?? [], '等待执行端发现');
  if ([...elements.model.options].some((option) => option.value === state.config.modelId)) elements.model.value = state.config.modelId;
  const model = selectedModel();
  renderEfforts(model?.reasoningEfforts ?? [], state.config.reasoningEffort);
  if ([...elements.role.options].some((option) => option.value === state.config.role)) elements.role.value = state.config.role;
  if ([...elements.permission.options].some((option) => option.value === state.config.permission)) elements.permission.value = state.config.permission;
  elements.workspace.value = state.config.workspaceRoot || 'D:\\GPT工作室';
  elements.note.textContent = providerNote(provider);
  elements.note.classList.toggle('warning', provider?.status !== 'ready');
}

async function saveConfig(extra = {}) {
  const payload = {
    providerId: elements.provider.value,
    modelId: selectedModel()?.id ?? null,
    reasoningEffort: currentEffort(),
    role: elements.role.value,
    permission: elements.permission.value,
    workspaceRoot: elements.workspace.value.trim(),
    ...extra,
  };
  const response = await fetch('/ui-api/execution-config', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) { elements.note.textContent = `配置未保存：${data.error}`; return; }
  state.config = data;
}

function formatHeartbeat(value) {
  if (!value) return '—';
  const date = new Date(value);
  return `${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}
function updateControllerUi() {
  const controller = state.controller;
  elements.controllerState.textContent = controller.connected ? ({ busy: '工作中', waiting: '等待中', idle: '已连接' }[controller.state] ?? '已连接') : '未连接';
  elements.controllerService.classList.toggle('online', controller.connected);
  elements.controllerService.querySelector('span:last-child').textContent = controller.connected ? 'ChatGPT 已连接' : 'ChatGPT 未连接';
  elements.controllerClient.textContent = controller.clientName || 'ChatGPT';
  elements.controllerModel.textContent = controller.model || '等待客户端上报';
  elements.controllerConversation.textContent = controller.conversationId || '未注册';
  elements.controllerHeartbeat.textContent = formatHeartbeat(controller.lastSeenAt);
}
function updateControlUi() {
  const { roomEnabled, workerAwake } = state.control;
  elements.roomToggle.checked = roomEnabled;
  elements.workerToggle.checked = workerAwake;
  elements.workerToggle.disabled = !roomEnabled;
  const demoTask = state.tasks.find((task) => task.source === 'demo' && ['running', 'paused', 'waiting-user'].includes(task.status));
  const demoActive = Boolean(demoTask);
  const demoLabel = demoTask ? (taskStatusLabels[demoTask.status] || demoTask.status) : null;
  const workerConnected = workerAwake && (state.workerSession.connected || demoActive);
  elements.workerService.classList.toggle('online', workerConnected);
  elements.workerService.querySelector('span:last-child').textContent = !workerAwake ? '执行离线' : state.workerSession.connected ? 'DeepSeek 已连接' : demoActive ? `演示 · ${demoLabel}` : '已唤醒 · 待连接';
  elements.workerState.textContent = !workerAwake ? '休眠' : state.workerSession.connected ? ({ busy: '工作中', waiting: '等待中', paused: '已暂停', idle: '已连接' }[state.workerSession.state] || '已连接') : demoActive ? demoLabel : '待连接';
  elements.workspaceStatus.textContent = !roomEnabled ? '任务室关闭 · 执行端休眠' : !workerAwake ? '任务室开启 · 执行端休眠' : state.workerSession.connected ? '任务室开启 · DeepSeek 已连接' : demoActive ? `任务室开启 · 演示${demoLabel}` : '任务室开启 · 等待 DSH 连接';
  elements.roomNotice.hidden = roomEnabled;
}

function channelFor(event) {
  return event.metadata?.channel ?? (event.actor === 'chatgpt-controller' ? 'controller' : event.actor === 'human-owner' ? 'human' : event.actor === 'orchestrator' ? 'system' : 'worker');
}
function roomVisible(event) {
  const visibility = event.metadata?.visibility;
  if (visibility === 'agent') return false;
  if (visibility === 'room' || visibility === 'both') return true;
  return event.kind !== 'reasoning' && event.kind !== 'tool';
}
function eventTime(value) { return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function eventLabel(event) {
  if (event.kind === 'question') return '提问';
  if (event.kind === 'permission_request') return '权限申请';
  if (event.kind === 'result') return '结果';
  return null;
}
function createMessage(event) {
  const channel = channelFor(event);
  const message = document.createElement('button'); message.type = 'button'; message.className = `message ${channel}`;
  const head = document.createElement('span'); head.className = 'message-head';
  const actor = document.createElement('strong'); actor.textContent = roleLabels[channel] ?? event.actor;
  const time = document.createElement('time'); time.textContent = eventTime(event.timestamp); head.append(actor, time);
  const title = document.createElement('span'); title.className = 'message-title';
  const label = eventLabel(event); title.textContent = label ? `${label} · ${event.title}` : event.title;
  message.append(head, title);
  if (event.detail) { const detail = document.createElement('span'); detail.className = 'message-text'; detail.textContent = event.detail; message.append(detail); }
  message.addEventListener('click', () => openDetail(event));
  return message;
}
function renderConversation() {
  const events = state.events.filter(roomVisible);
  elements.conversation.replaceChildren();
  if (!events.length) {
    const empty = document.createElement('div'); empty.className = 'conversation-empty';
    empty.innerHTML = '<strong>暂无协作消息</strong><span>ChatGPT 客户端接入并派发任务后，会在这里看到双方对话。</span>';
    elements.conversation.append(empty); return;
  }
  events.forEach((event) => elements.conversation.append(createMessage(event)));
  elements.conversation.scrollTop = elements.conversation.scrollHeight;
}

function detailRow(label, value) {
  const row = document.createElement('div'); row.className = 'detail-row';
  const key = document.createElement('span'); key.textContent = label;
  const val = document.createElement('strong'); val.textContent = value || '未提供'; row.append(key, val); return row;
}
function openDetail(event) {
  elements.detailTitle.textContent = event.title; elements.detailContent.replaceChildren();
  const status = document.createElement('div'); status.className = `detail-status ${event.state}`; status.textContent = event.kind || '记录';
  const body = document.createElement('section'); body.className = 'detail-section'; body.innerHTML = '<h3>内容</h3>';
  const p = document.createElement('p'); p.textContent = event.detail || event.title; body.append(p);
  const meta = document.createElement('section'); meta.className = 'detail-section'; meta.innerHTML = '<h3>记录信息</h3>';
  meta.append(detailRow('来源', roleLabels[channelFor(event)] ?? event.actor), detailRow('类型', event.kind), detailRow('时间', new Date(event.timestamp).toLocaleString('zh-CN')), detailRow('任务', event.metadata?.taskId));
  elements.detailContent.append(status, body, meta); elements.detail.showModal();
}

const taskStatusLabels = { queued: '排队', running: '执行中', paused: '已暂停', 'waiting-user': '等你回复', completed: '完成', failed: '失败', cancelled: '已中止' };
function taskTime(value) { return new Date(value).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function renderTaskHistory() {
  elements.taskHistory.replaceChildren();
  if (!state.tasks.length) {
    const empty = document.createElement('div'); empty.className = 'task-history-empty';
    empty.innerHTML = '<strong>还没有任务</strong><span>可以先运行一条不调用真实模型的演示任务。</span>';
    elements.taskHistory.append(empty);
  } else {
    state.tasks.slice(0, 12).forEach((task) => {
      const card = document.createElement('button'); card.type = 'button'; card.className = `task-card status-${task.status}`;
      const top = document.createElement('span'); top.className = 'task-card-head';
      const status = document.createElement('strong'); status.textContent = taskStatusLabels[task.status] || task.status;
      const source = document.createElement('span'); source.textContent = task.source === 'demo' ? '演示' : task.source === 'chatgpt' ? 'ChatGPT' : '手动';
      const time = document.createElement('time'); time.textContent = taskTime(task.updatedAt); top.append(status, source, time);
      const title = document.createElement('span'); title.className = 'task-card-title'; title.textContent = task.title;
      const summary = document.createElement('span'); summary.className = 'task-card-summary'; summary.textContent = task.waitingReason || task.lastSummary || task.objective;
      card.append(top, title, summary);
      card.addEventListener('click', () => window.open(`/agent?task=${encodeURIComponent(task.id)}`, 'a2a-execution-agent', 'popup=yes,width=1120,height=850,resizable=yes,scrollbars=yes'));
      elements.taskHistory.append(card);
    });
  }
  const waiting = state.tasks.find((task) => task.status === 'waiting-user');
  elements.waitingBanner.hidden = !waiting;
  if (waiting) elements.waitingText.textContent = waiting.waitingReason || `${waiting.title} 正在等待你的回复。`;
}
async function loadTasks() {
  const data = await fetch('/ui-api/tasks').then((r) => r.json());
  state.tasks = data.tasks ?? [];
  renderTaskHistory();
}

async function loadAll() {
  const [catalog, config, control, controller, workerSession, timeline, tasks] = await Promise.all([
    fetch('/ui-api/catalog').then((r) => r.json()),
    fetch('/ui-api/execution-config').then((r) => r.json()),
    fetch('/ui-api/control-state').then((r) => r.json()),
    fetch('/ui-api/controller-session').then((r) => r.json()),
    fetch('/ui-api/worker-session').then((r) => r.json()),
    fetch('/ui-api/timeline').then((r) => r.json()),
    fetch('/ui-api/tasks').then((r) => r.json()),
  ]);
  state.providers = catalog.providers; state.config = config; state.control = control; state.controller = controller; state.workerSession = workerSession; state.events = timeline.events; state.tasks = tasks.tasks ?? [];
  fillSelect(elements.provider, state.providers.map((provider) => ({ id: provider.id, name: provider.name })), '无服务商');
  applyConfigToControls(); updateControlUi(); updateControllerUi(); renderConversation(); renderTaskHistory();
}
async function refreshRuntime() {
  const [control, controller, workerSession, tasks] = await Promise.all([
    fetch('/ui-api/control-state').then((r) => r.json()),
    fetch('/ui-api/controller-session').then((r) => r.json()),
    fetch('/ui-api/worker-session').then((r) => r.json()),
    fetch('/ui-api/tasks').then((r) => r.json()),
  ]);
  state.control = control; state.controller = controller; state.workerSession = workerSession; state.tasks = tasks.tasks ?? []; updateControlUi(); updateControllerUi(); renderTaskHistory();
}
async function updateControl(patch) {
  const response = await fetch('/ui-api/control-state', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
  const data = await response.json();
  if (!response.ok) { elements.note.textContent = `开关操作被拒绝：${data.error}`; await refreshRuntime(); return; }
  state.control = data; updateControlUi();
}
function connectEventStream() {
  state.eventSource?.close();
  const stream = new EventSource('/ui-api/events'); state.eventSource = stream;
  stream.addEventListener('open', () => { elements.streamState.textContent = '实时流已连接'; elements.streamState.classList.add('online'); });
  stream.addEventListener('error', () => { elements.streamState.textContent = '实时流重连中'; elements.streamState.classList.remove('online'); });
  stream.addEventListener('snapshot', (message) => { state.events = JSON.parse(message.data).events ?? []; renderConversation(); });
  stream.addEventListener('timeline', (message) => { const event = JSON.parse(message.data); state.events.push(event); renderConversation(); refreshRuntime(); });
}

await loadAll(); connectEventStream();
setInterval(refreshRuntime, 5000);

elements.provider.addEventListener('change', async () => {
  const provider = selectedProvider(); fillSelect(elements.model, provider?.models ?? [], '等待执行端发现'); renderEfforts(selectedModel()?.reasoningEfforts ?? [], null);
  elements.note.textContent = providerNote(provider); elements.note.classList.toggle('warning', provider?.status !== 'ready'); await saveConfig();
});
elements.model.addEventListener('change', async () => { renderEfforts(selectedModel()?.reasoningEfforts ?? [], null); await saveConfig(); });
elements.efforts.addEventListener('change', saveConfig); elements.role.addEventListener('change', saveConfig); elements.permission.addEventListener('change', saveConfig);
elements.workspace.addEventListener('change', saveConfig);
elements.roomToggle.addEventListener('change', () => updateControl({ roomEnabled: elements.roomToggle.checked }));
elements.workerToggle.addEventListener('change', () => updateControl({ workerAwake: elements.workerToggle.checked }));
$('#refresh').addEventListener('click', loadAll); $('#close-detail').addEventListener('click', () => elements.detail.close());
$('#open-agent-window').addEventListener('click', () => window.open('/agent', 'a2a-execution-agent', 'popup=yes,width=1120,height=850,resizable=yes,scrollbars=yes'));

elements.demoButton.addEventListener('click', async () => {
  elements.demoButton.disabled = true; elements.demoHint.textContent = '正在启动演示任务……';
  const response = await fetch('/ui-api/demo/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ objective: '检查三界面任务室的执行窗口和任务历史交互。' }) });
  const data = await response.json();
  if (!response.ok) {
    elements.demoHint.textContent = data.error === 'worker_not_awake' ? '先开启任务室并唤醒执行 Agent，演示任务才会运行。' : `演示没有启动：${data.error}`;
  } else {
    elements.demoHint.textContent = '演示已启动：不会调用真实 DeepSeek。约 2 秒后会停在“等待你的回复”。';
    await loadTasks();
    window.open(`/agent?task=${encodeURIComponent(data.task.id)}`, 'a2a-execution-agent', 'popup=yes,width=1120,height=850,resizable=yes,scrollbars=yes');
  }
  elements.demoButton.disabled = false;
});
elements.answerWaiting.addEventListener('click', () => {
  const waiting = state.tasks.find((task) => task.status === 'waiting-user');
  window.open(waiting ? `/agent?task=${encodeURIComponent(waiting.id)}` : '/agent', 'a2a-execution-agent', 'popup=yes,width=1120,height=850,resizable=yes,scrollbars=yes');
});

window.addEventListener('beforeunload', () => state.eventSource?.close());
