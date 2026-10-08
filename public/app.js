const state = { providers: [], events: [] };
const $ = (selector) => document.querySelector(selector);
const elements = {
  form: $('#task-form'), provider: $('#provider'), model: $('#model'), efforts: $('#effort-options'),
  role: $('#role'), permission: $('#permission'), objective: $('#objective'), note: $('#provider-note'),
  conversation: $('#conversation'), service: $('#service-state'), refresh: $('#refresh'),
  workerSummary: $('#worker-summary'), workerState: $('#worker-state'), detail: $('#detail-dialog'),
  detailTitle: $('#detail-title'), detailContent: $('#detail-content'), confirmation: $('#confirmation-dialog'),
};
const effortLabels = { off: '关闭', minimal: '最小', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大' };
const roleLabels = { controller: '主控 Agent', worker: '执行 Agent', reviewer: '审查 Agent', researcher: '研究 Agent', system: '中转站' };

function fillSelect(select, values, emptyText) {
  select.replaceChildren();
  if (!values.length) {
    const option = new Option(emptyText, ''); option.disabled = true; option.selected = true;
    select.add(option); select.disabled = true; return;
  }
  select.disabled = false;
  values.forEach((value) => { const item = typeof value === 'string' ? { id: value, name: value } : value; select.add(new Option(item.name, item.id)); });
}
function selectedProvider() { return state.providers.find((item) => item.id === elements.provider.value); }
function selectedModel() { const models = selectedProvider()?.models ?? []; return models.find((item) => item.id === elements.model.value) ?? models[0]; }

function renderEfforts(efforts) {
  elements.efforts.replaceChildren();
  if (!efforts.length) { const empty = document.createElement('span'); empty.className = 'effort-empty'; empty.textContent = '模型未声明'; elements.efforts.append(empty); return; }
  efforts.forEach((effort, index) => {
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'reasoningEffort'; input.id = `effort-${effort}`; input.value = effort; input.checked = index === 0;
    const label = document.createElement('label'); label.htmlFor = input.id; label.textContent = effortLabels[effort] ?? effort;
    elements.efforts.append(input, label);
  });
}

function refreshWorkerControls() {
  const provider = selectedProvider(); const models = provider?.models ?? [];
  fillSelect(elements.model, models, '等待连接后发现');
  const model = selectedModel(); renderEfforts(model?.reasoningEfforts ?? []);
  elements.workerSummary.textContent = model ? `${provider.name} / ${model.name}` : `${provider?.name ?? '未选择'} / 未连接`;
  elements.workerState.textContent = provider?.status === 'ready' ? '待命' : '未接入';
  const notes = { ready: '执行器可用；任务进入队列后仍需明确授权。', 'bridge-only': '桥接可见但未接入主控执行接口，只建立待授权任务。', 'not-connected': '服务商尚未连接。' };
  elements.note.textContent = notes[provider?.status] ?? '服务商状态未知。';
  elements.note.classList.toggle('warning', provider?.status !== 'ready');
}

function channelFor(event) { return event.metadata?.channel ?? (event.actor === 'orchestrator' ? 'system' : 'worker'); }
function eventTime(value) { return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

function renderConversation() {
  elements.conversation.replaceChildren();
  if (!state.events.length) { const empty = document.createElement('div'); empty.className = 'conversation-empty'; empty.innerHTML = '<strong>暂无对话</strong><span>由主控端建立第一项任务</span>'; elements.conversation.append(empty); return; }
  state.events.forEach((event) => {
    const channel = channelFor(event); const message = document.createElement('button');
    message.type = 'button'; message.className = `message ${channel}`;
    const head = document.createElement('span'); head.className = 'message-head';
    const actor = document.createElement('strong'); actor.textContent = roleLabels[channel] ?? event.actor;
    const time = document.createElement('time'); time.textContent = eventTime(event.timestamp); head.append(actor, time);
    const title = document.createElement('span'); title.className = 'message-title'; title.textContent = event.title;
    message.append(head, title);
    if (event.detail) { const detail = document.createElement('span'); detail.className = 'message-text'; detail.textContent = event.detail; message.append(detail); }
    const hint = document.createElement('span'); hint.className = 'message-hint'; hint.textContent = event.state === 'waiting' ? '等待授权 · 点开查看轨迹' : '点开查看轨迹'; message.append(hint);
    message.addEventListener('click', () => openDetail(event)); elements.conversation.append(message);
  });
  elements.conversation.scrollTop = elements.conversation.scrollHeight;
}

function row(label, value) { const item = document.createElement('div'); item.className = 'detail-row'; const key = document.createElement('span'); key.textContent = label; const text = document.createElement('strong'); text.textContent = value || '未提供'; item.append(key, text); return item; }
function section(title, body, note) { const block = document.createElement('section'); block.className = 'detail-section'; const heading = document.createElement('h3'); heading.textContent = title; const text = document.createElement('p'); text.textContent = body; block.append(heading, text); if (note) { const small = document.createElement('small'); small.textContent = note; block.append(small); } return block; }
function openDetail(event) {
  const meta = event.metadata ?? {}; elements.detailTitle.textContent = event.title; elements.detailContent.replaceChildren();
  const status = document.createElement('div'); status.className = `detail-status ${event.state}`; status.textContent = event.state === 'waiting' ? '等待用户授权' : event.state === 'success' ? '已完成' : event.state === 'error' ? '失败' : '过程记录';
  const config = document.createElement('section'); config.className = 'detail-section'; const heading = document.createElement('h3'); heading.textContent = '运行配置'; config.append(heading, row('服务商', meta.providerName), row('模型', meta.modelId), row('模型档位', meta.tier), row('思考档位', effortLabels[meta.reasoningEffort] ?? meta.reasoningEffort), row('权限', meta.permission));
  elements.detailContent.append(status, section('消息正文', event.detail || event.title), config, section('思考与推理摘要', meta.reasoningSummary || '执行端尚未运行，没有可展示的推理摘要。', '只显示模型主动返回的摘要和执行轨迹，不读取或伪造隐藏思维链。'), section('工具与文件', meta.toolSummary || '无工具调用'));
  elements.detail.showModal();
}

async function loadCatalog() {
  const data = await fetch('/ui-api/catalog').then((response) => response.json()); state.providers = data.providers;
  fillSelect(elements.provider, state.providers.map((provider) => ({ id: provider.id, name: `${provider.name}${provider.status === 'ready' ? '' : ' · 未就绪'}` })), '无服务商'); refreshWorkerControls();
}
async function loadConversation() { const data = await fetch('/ui-api/timeline').then((response) => response.json()); state.events = data.events; renderConversation(); }
async function checkHealth() {
  try { const data = await fetch('/health').then((response) => response.json()); elements.service.classList.toggle('online', data.status === 'ok'); elements.service.querySelector('span:last-child').textContent = data.status === 'ok' ? '主控在线' : '状态异常'; }
  catch { elements.service.classList.remove('online'); elements.service.querySelector('span:last-child').textContent = '未连接'; }
}

elements.provider.addEventListener('change', refreshWorkerControls); elements.model.addEventListener('change', refreshWorkerControls);
elements.refresh.addEventListener('click', loadConversation); $('#close-detail').addEventListener('click', () => elements.detail.close());
$('#rework').addEventListener('click', () => { elements.objective.value = '请检查上一项执行结果，列出问题并提交返工方案。'; elements.objective.focus(); });
elements.form.addEventListener('submit', async (event) => {
  event.preventDefault(); const effort = elements.form.querySelector('input[name="reasoningEffort"]:checked'); const model = selectedModel();
  const payload = { providerId: elements.provider.value, modelId: model?.id ?? null, tier: model?.tiers?.[0] ?? null, reasoningEffort: effort?.value ?? null, role: elements.role.value, permission: elements.permission.value, objective: elements.objective.value };
  const response = await fetch('/ui-api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  if (!response.ok) return; await loadConversation(); elements.confirmation.showModal();
});

await Promise.all([loadCatalog(), loadConversation(), checkHealth()]); setInterval(loadConversation, 2500);
