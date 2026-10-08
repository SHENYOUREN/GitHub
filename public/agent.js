const state = {
  events: [], control: { roomEnabled: false, workerAwake: false }, controller: { connected: false }, workerSession: { connected: false }, config: null,
  providers: [], filter: localStorage.getItem('agent-window-filter') || 'all', eventSource: null, tasks: [],
  selectedTaskId: new URLSearchParams(location.search).get('task') || localStorage.getItem('agent-window-task') || '',
};
const $ = (selector) => document.querySelector(selector);
const elements = {
  controllerService: $('#controller-service-state'), workerService: $('#worker-service-state'), runtimeProvider: $('#runtime-provider'),
  runtimeModel: $('#runtime-model'), runtimeEffort: $('#runtime-effort'), runtimeWorkspace: $('#runtime-workspace'), runtimeState: $('#runtime-state'),
  stream: $('#agent-event-stream'), workerNotice: $('#worker-disabled-notice'), streamState: $('#stream-state'), filter: $('#agent-filter'),
  form: $('#direct-form'), message: $('#direct-message'), send: $('#direct-send'), note: $('#direct-note'),
  dialog: $('#event-dialog'), dialogTitle: $('#event-title'), dialogDetail: $('#event-detail'),
  taskSelect: $('#runtime-task-select'), waitingBanner: $('#agent-waiting-banner'), waitingText: $('#agent-waiting-text'),
  directHeadingTitle: $('#direct-heading-title'), directHeadingNote: $('#direct-heading-note'),
  pauseTask: $('#pause-task'), resumeTask: $('#resume-task'), cancelTask: $('#cancel-task'),
};
const effortLabels = { off: '关闭', minimal: '最小', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大' };
const kindLabels = { message: '对话', reasoning: '思考', tool: '工具', status: '状态', result: '结果', question: '提问', permission_request: '权限申请' };
const kindIcons = { message: 'message-square.svg', reasoning: 'bot.svg', tool: 'folder-check.svg', status: 'refresh-cw.svg', result: 'shield-check.svg', question: 'messages-square.svg', permission_request: 'shield-check.svg' };

function providerForConfig() { return state.providers.find((provider) => provider.id === state.config?.providerId); }
function modelForConfig() { return providerForConfig()?.models?.find((model) => model.id === state.config?.modelId); }
function updateRuntime() {
  const provider = providerForConfig(); const model = modelForConfig();
  elements.runtimeProvider.textContent = provider?.name || state.config?.providerId || '未选择';
  elements.runtimeModel.textContent = model?.name || state.config?.modelId || '等待执行端发现';
  elements.runtimeEffort.textContent = effortLabels[state.config?.reasoningEffort] || state.config?.reasoningEffort || '由执行端决定';
  elements.runtimeWorkspace.textContent = state.config?.workspaceRoot || '未设置';
  const task = selectedTask();
  const runtimeLabel = !state.control.roomEnabled ? '任务室关闭'
    : !state.control.workerAwake ? '休眠'
    : task?.source === 'demo' && ['running', 'paused', 'waiting-user'].includes(task.status) ? `演示 · ${taskStatusLabels[task.status] || task.status}`
    : state.workerSession.connected ? ({ busy: '执行中', waiting: '等待中', paused: '已暂停', idle: '已连接' }[state.workerSession.state] || '已连接')
    : '已唤醒 · 待 DSH';
  elements.runtimeState.textContent = runtimeLabel;

  elements.controllerService.classList.toggle('online', state.controller.connected);
  elements.controllerService.querySelector('span:last-child').textContent = state.controller.connected ? 'ChatGPT 已连接' : 'ChatGPT 未连接';
  const workerConnected = state.control.workerAwake && (state.workerSession.connected || task?.source === 'demo');
  elements.workerService.classList.toggle('online', workerConnected);
  elements.workerService.querySelector('span:last-child').textContent = !state.control.workerAwake ? '执行离线' : state.workerSession.connected ? 'DeepSeek 已连接' : task?.source === 'demo' ? '演示执行' : '已唤醒 · 待连接';
  elements.workerNotice.hidden = state.control.workerAwake;
  elements.send.disabled = !(state.control.roomEnabled && state.control.workerAwake);
  updateTaskControls();
}

function eventChannel(event) {
  return event.metadata?.channel ?? (event.actor === 'human-owner' ? 'human' : event.actor === 'chatgpt-controller' ? 'controller' : event.actor === 'orchestrator' ? 'system' : 'worker');
}
function isAgentVisible(event) {
  const visibility = event.metadata?.visibility;
  if (visibility === 'room') return eventChannel(event) === 'controller';
  if (eventChannel(event) === 'system') return event.kind === 'status';
  return true;
}
function matchesFilter(event) {
  if (state.selectedTaskId && event.metadata?.taskId !== state.selectedTaskId) return false;
  if (state.filter === 'all') return true;
  if (state.filter === 'message') return event.kind === 'message';
  if (state.filter === 'question') return event.kind === 'question' || event.kind === 'permission_request';
  return event.kind === state.filter;
}
function formatTime(value) { return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function actorName(event) {
  const channel = eventChannel(event);
  if (channel === 'controller') return 'ChatGPT';
  if (channel === 'human') return '用户';
  if (channel === 'system') return '中转站';
  return 'DeepSeek';
}

function eventCard(event) {
  const kind = event.kind || 'status'; const channel = eventChannel(event);
  const card = document.createElement('button'); card.type = 'button'; card.className = `agent-event kind-${kind} channel-${channel}`;
  const rail = document.createElement('span'); rail.className = 'event-rail';
  const icon = document.createElement('span'); icon.className = 'event-icon';
  const iconImg = document.createElement('img'); iconImg.src = `/assets/icons/${kindIcons[kind] || 'bot.svg'}`; iconImg.alt = ''; icon.append(iconImg);
  const content = document.createElement('span'); content.className = 'event-content';
  const head = document.createElement('span'); head.className = 'event-head';
  const who = document.createElement('strong'); who.textContent = actorName(event);
  const badge = document.createElement('span'); badge.className = `event-kind kind-${kind}`; badge.textContent = kindLabels[kind] || kind;
  const time = document.createElement('time'); time.textContent = formatTime(event.timestamp); head.append(who, badge, time);
  const title = document.createElement('span'); title.className = 'event-title'; title.textContent = event.title;
  const detail = document.createElement('span'); detail.className = 'event-text'; detail.textContent = event.detail || '';
  content.append(head, title);
  if (event.metadata?.taskId) { const taskRef = document.createElement('span'); taskRef.className = 'event-task-ref'; taskRef.textContent = `任务 ${String(event.metadata.taskId).slice(0, 8)}`; content.append(taskRef); }
  if (event.detail) content.append(detail);

  if (kind === 'tool' && event.metadata) {
    const toolLine = document.createElement('span'); toolLine.className = 'event-meta-line';
    const bits = [event.metadata.toolName, event.metadata.command, event.metadata.path].filter(Boolean);
    if (bits.length) { toolLine.textContent = bits.join(' · '); content.append(toolLine); }
  }
  if (kind === 'reasoning' && event.metadata?.contentSource === 'worker-provided') {
    const source = document.createElement('span'); source.className = 'event-source-note'; source.textContent = '执行端实际提供'; content.append(source);
  }
  card.append(rail, icon, content); card.addEventListener('click', () => openEvent(event)); return card;
}
function renderEvents() {
  const events = state.events.filter(isAgentVisible).filter(matchesFilter);
  elements.stream.replaceChildren();
  if (!events.length) {
    const empty = document.createElement('div'); empty.className = 'conversation-empty';
    empty.innerHTML = '<strong>暂无执行记录</strong><span>DeepSeek 适配器接入后，思考、工具、状态和结果会按时间顺序出现在这里。</span>';
    elements.stream.append(empty); return;
  }
  events.forEach((event) => elements.stream.append(eventCard(event)));
  elements.stream.scrollTop = elements.stream.scrollHeight;
}

function detailRow(label, value) {
  const row = document.createElement('div'); row.className = 'detail-row';
  const key = document.createElement('span'); key.textContent = label;
  const val = document.createElement('strong'); val.textContent = value || '未提供'; row.append(key, val); return row;
}
function openEvent(event) {
  elements.dialogTitle.textContent = event.title; elements.dialogDetail.replaceChildren();
  const status = document.createElement('div'); status.className = `detail-status ${event.state}`; status.textContent = kindLabels[event.kind] || event.kind || '记录';
  const body = document.createElement('section'); body.className = 'detail-section'; body.innerHTML = '<h3>内容</h3>';
  const p = document.createElement('p'); p.textContent = event.detail || event.title; body.append(p);
  const info = document.createElement('section'); info.className = 'detail-section'; info.innerHTML = '<h3>来源与轨迹</h3>';
  info.append(detailRow('来源', actorName(event)), detailRow('事件类型', event.type), detailRow('内容类别', kindLabels[event.kind] || event.kind), detailRow('时间', new Date(event.timestamp).toLocaleString('zh-CN')), detailRow('工具', event.metadata?.toolName), detailRow('文件/路径', event.metadata?.path), detailRow('命令', event.metadata?.command));
  elements.dialogDetail.append(status, body, info); elements.dialog.showModal();
}

const taskStatusLabels = { queued: '排队', running: '执行中', paused: '已暂停', 'waiting-user': '等你回复', completed: '完成', failed: '失败', cancelled: '已中止' };
function selectedTask() { return state.tasks.find((task) => task.id === state.selectedTaskId) || null; }
function currentWaitingTask() {
  const task = selectedTask();
  if (task?.status === 'waiting-user') return task;
  return !state.selectedTaskId ? state.tasks.find((item) => item.status === 'waiting-user') || null : null;
}
function directTargetTaskId() { return state.selectedTaskId || currentWaitingTask()?.id || ''; }
function updateTaskControls() {
  const task = selectedTask();
  const active = Boolean(task);
  elements.pauseTask.disabled = !active || task?.status !== 'running';
  elements.resumeTask.disabled = !active || task?.status !== 'paused';
  elements.cancelTask.disabled = !active || ['completed', 'failed', 'cancelled'].includes(task?.status);
}
function renderTaskSelector() {
  const previous = state.selectedTaskId;
  elements.taskSelect.replaceChildren(new Option('全部任务', ''));
  state.tasks.forEach((task) => {
    const label = `${taskStatusLabels[task.status] || task.status} · ${task.title}`;
    elements.taskSelect.add(new Option(label, task.id));
  });
  if ([...elements.taskSelect.options].some((option) => option.value === previous)) elements.taskSelect.value = previous;
  else { state.selectedTaskId = ''; elements.taskSelect.value = ''; }
  updateWaitingUi(); updateTaskControls();
}
function updateWaitingUi() {
  const waiting = currentWaitingTask();
  elements.waitingBanner.hidden = !waiting;
  if (waiting) elements.waitingText.textContent = `${waiting.title}：${waiting.waitingReason || '正在等待回复。'}`;
  if (waiting) {
    elements.directHeadingTitle.textContent = '回复 DeepSeek 的提问';
    elements.directHeadingNote.textContent = state.selectedTaskId
      ? '这条回复会绑定到当前任务，并同步写入 ChatGPT 可读取的共享时间线。'
      : `当前未筛选任务；这条回复会自动绑定到最近等待中的任务“${waiting.title}”。`;
    elements.message.placeholder = '直接回答当前问题……';
  } else {
    elements.directHeadingTitle.textContent = '直接对执行 Agent 说';
    elements.directHeadingNote.textContent = '必要时人工插话；消息会进入共享时间线，ChatGPT 主控也能同步读取。';
    elements.message.placeholder = '例如：先别检查整个项目，只看网页端。';
  }
}
async function loadTasks() {
  const data = await fetch('/ui-api/tasks').then((r) => r.json());
  state.tasks = data.tasks ?? [];
  renderTaskSelector();
}

async function loadAll() {
  const [catalog, config, control, controller, workerSession, timeline, tasks] = await Promise.all([
    fetch('/ui-api/catalog').then((r) => r.json()), fetch('/ui-api/execution-config').then((r) => r.json()),
    fetch('/ui-api/control-state').then((r) => r.json()), fetch('/ui-api/controller-session').then((r) => r.json()),
    fetch('/ui-api/worker-session').then((r) => r.json()), fetch('/ui-api/timeline').then((r) => r.json()), fetch('/ui-api/tasks').then((r) => r.json()),
  ]);
  state.providers = catalog.providers; state.config = config; state.control = control; state.controller = controller; state.workerSession = workerSession; state.events = timeline.events; state.tasks = tasks.tasks ?? [];
  renderTaskSelector(); updateRuntime(); renderEvents();
}
async function refreshRuntime() {
  const [config, control, controller, workerSession, tasks] = await Promise.all([
    fetch('/ui-api/execution-config').then((r) => r.json()), fetch('/ui-api/control-state').then((r) => r.json()), fetch('/ui-api/controller-session').then((r) => r.json()), fetch('/ui-api/worker-session').then((r) => r.json()), fetch('/ui-api/tasks').then((r) => r.json()),
  ]);
  state.config = config; state.control = control; state.controller = controller; state.workerSession = workerSession; state.tasks = tasks.tasks ?? []; renderTaskSelector(); updateRuntime(); renderEvents();
}
function connectEventStream() {
  state.eventSource?.close(); const stream = new EventSource('/ui-api/events'); state.eventSource = stream;
  stream.addEventListener('open', () => { elements.streamState.textContent = '实时流已连接'; elements.streamState.classList.add('online'); });
  stream.addEventListener('error', () => { elements.streamState.textContent = '实时流重连中'; elements.streamState.classList.remove('online'); });
  stream.addEventListener('snapshot', (message) => { state.events = JSON.parse(message.data).events ?? []; renderEvents(); });
  stream.addEventListener('timeline', (message) => { state.events.push(JSON.parse(message.data)); renderEvents(); refreshRuntime(); });
}

async function controlTask(action) {
  const task = selectedTask();
  if (!task) return;
  const response = await fetch(`/ui-api/tasks/${encodeURIComponent(task.id)}/control`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
  const data = await response.json();
  elements.note.textContent = response.ok ? ({ pause: '已请求暂停当前任务。', resume: '已请求继续当前任务。', cancel: '已请求中止当前任务。' }[action] || '任务控制已发送。') : `任务控制失败：${data.error}`;
  await refreshRuntime();
}

await loadAll(); connectEventStream(); setInterval(refreshRuntime, 5000);
const active = elements.filter.querySelector(`[data-filter="${state.filter}"]`) || elements.filter.querySelector('[data-filter="all"]');
elements.filter.querySelectorAll('[data-filter]').forEach((chip) => chip.classList.toggle('active', chip === active));
state.filter = active.dataset.filter;

elements.pauseTask.addEventListener('click', () => controlTask('pause'));
elements.resumeTask.addEventListener('click', () => controlTask('resume'));
elements.cancelTask.addEventListener('click', () => controlTask('cancel'));
elements.taskSelect.addEventListener('change', () => {
  state.selectedTaskId = elements.taskSelect.value;
  localStorage.setItem('agent-window-task', state.selectedTaskId);
  const url = new URL(location.href);
  if (state.selectedTaskId) url.searchParams.set('task', state.selectedTaskId); else url.searchParams.delete('task');
  history.replaceState(null, '', url);
  updateWaitingUi(); renderEvents();
});
elements.filter.addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]'); if (!button) return;
  state.filter = button.dataset.filter; localStorage.setItem('agent-window-filter', state.filter);
  elements.filter.querySelectorAll('[data-filter]').forEach((chip) => chip.classList.toggle('active', chip === button)); renderEvents();
});
elements.form.addEventListener('submit', async (event) => {
  event.preventDefault(); const message = elements.message.value.trim(); if (!message) return;
  elements.send.disabled = true;
  const response = await fetch('/ui-api/interventions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, taskId: directTargetTaskId() || null }) });
  const data = await response.json();
  if (!response.ok) { elements.note.textContent = `没有发送：${data.error}`; updateRuntime(); return; }
  elements.message.value = ''; elements.note.textContent = data.demoResumed ? '演示任务已收到回复并继续运行。' : '已写入共享时间线；执行端与 ChatGPT 主控都可通过中转站读取。'; await refreshRuntime();
});
$('#refresh').addEventListener('click', loadAll); $('#back-room').addEventListener('click', () => { if (window.opener && !window.opener.closed) window.opener.focus(); else window.location.href = '/'; });
$('#close-event').addEventListener('click', () => elements.dialog.close()); window.addEventListener('beforeunload', () => state.eventSource?.close());
