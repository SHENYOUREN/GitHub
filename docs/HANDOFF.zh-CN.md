# ChatGPT × DeepSeek 三界面任务室 — 客户端接手文档

> 给下一位接手开发的 ChatGPT / Codex 客户端或 DSH 适配器开发者。目标是不用重新研究整个仓库，就能直接继续真实接线。

## 1. 一句话定位

这个项目不是另做一个聊天软件。

- **ChatGPT 主界面**：真正的主控，用户平时在这里聊天、派工、验收。
- **任务室 `/`**：控制台，配置 DeepSeek、开关执行端、看双方对话和任务历史。
- **执行 Agent `/agent`**：详细工作窗口，看 DeepSeek 的思考、工具、状态、结果；用户也可以直接插话。

三个界面共享同一条本地时间线。用户在 `/agent` 里直接说的话，ChatGPT 以后也能读取。

## 2. 当前已经完成

### 网页端

- `/` 多模型任务室。
- `/agent` 独立执行 Agent 窗口。
- 执行端 Provider / Model / 推理档位 / 角色 / 权限 / 工作区可在任务室关闭时提前配置。
- ChatGPT 连接状态、模型、会话、心跳展示。
- ChatGPT ↔ DeepSeek 对话总览。
- 执行窗口按 `思考 / 工具 / 状态 / 结果 / 提问 / 对话` 分轨显示。
- 执行窗口可按任务筛选。
- 用户可在执行窗口直接给 DeepSeek 插话。
- 如果没有手动选任务、但存在正在等待用户回复的任务，输入框会自动把回复绑定到最近的等待任务。
- DeepSeek 提问时，两个网页都会出现“正在等待你的回复”提示。
- 任务历史卡片已加入任务室。

### 后端

- SSE 实时事件流 `/ui-api/events`。
- 执行默认配置 `/ui-api/execution-config`，持久化到 `data/execution-config.json`。
- 共享任务历史 `/ui-api/tasks`，持久化到 `data/tasks.json`。
- 时间线持久化到 `data/timeline.json`。
- ChatGPT 会话桥 `/client-api/*`。
- DeepSeek / DSH 事件桥 `/worker-api/*`，包含会话注册、心跳和断开状态。
- 正式任务会把 Provider / Model / 推理档位 / 角色 / 权限 / 工作区做**任务级快照**；后续修改全局配置不会改变旧任务。
- Worker 可以通过 `GET /worker-api/tasks/:taskId` 读取该任务的稳定快照。
- 任务室或执行端未开启时，`POST /client-api/tasks` 与 `POST /client-api/events` 返回 `409 worker_not_awake`。
- 请求携带不存在的 `taskId` 时返回 `404 task_not_found`，不再悄悄生成孤立事件。
- 迟到的 Worker 事件不会把 `completed / failed / cancelled` 任务重新变回运行中；Worker 的迟到进度也不会把 `waiting-user` 意外清掉。
- 暂停 / 继续 / 中止控制壳已完成；真实 DSH 以后消费共享时间线里的控制事件。
- “等待用户回复”本身就是等待状态，因此不能再二次暂停；应直接回答问题或中止任务。
- 关闭任务室/休眠执行端时，正在运行的演示任务和正式任务都会自动暂停。
- 中转站重启时，之前处于 `running / paused / waiting-user` 的任务会标记为 `failed`，并写一条恢复失败记录；当前版本不假装能恢复真实 DSH 会话。
- 本地演示执行器：不调用任何模型，也能跑完整流程，并支持暂停 / 继续 / 中止。

## 3. 启动与交接自检

要求 Node.js 22.19+。目标环境为 Windows 10 时，优先按以下顺序执行根目录脚本：

- `win10-install.bat`
- `win10-verify.bat`
- `win10-start.bat`

它们会固定从项目根目录运行，避免双击批处理时工作目录漂移；Controller Token 由 Node 生成并保存在 `data/controller-token.txt`。不要改回 `Convert.ToHexString`：Windows 10 自带 Windows PowerShell 5.1 通常没有该方法。

手工 PowerShell 启动方式：

```powershell
npm ci
$env:CONTROLLER_TOKEN = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm run verify:win10
npm start
```

`verify:win10` 先执行 Win10 专项静态/运行时检查，再调用 `verify:handoff`。`verify:handoff` 会：

1. 检查 `public/app.js`、`public/agent.js` 语法。
2. 检查前端 `$()` 选择器对应的 HTML ID、重复 ID、Lucide 图标资源和必需交接文件。
3. 编译 TypeScript。
4. 跑单元测试。
5. 跑 smoke 端到端测试。

非 Win10 的临时审计环境低于 Node 22.19 时，可以用 `npm run verify:compat` 做代码兼容验证；正式 Win10 运行环境仍要求满足 `engines.node`。

本地文档可直接访问：

- `GET /docs`
- `GET /handoff`

不依赖 GitHub `main` 是否已经同步到最新版本。

## 4. ChatGPT 客户端怎么接

### 4.1 注册当前 ChatGPT 会话

```http
POST /client-api/session
Authorization: Bearer <CONTROLLER_TOKEN>
Content-Type: application/json

{
  "clientName": "ChatGPT",
  "model": "GPT-5.6 Sol",
  "conversationId": "当前会话唯一 ID",
  "state": "idle"
}
```

之后定期调用：

```http
POST /client-api/heartbeat
Authorization: Bearer <CONTROLLER_TOKEN>
```

### 4.2 创建正式任务

正式客户端不要使用旧的 `/ui-api/drafts`。调用：

```http
POST /client-api/tasks
Authorization: Bearer <CONTROLLER_TOKEN>
Content-Type: application/json

{
  "title": "检查网页端",
  "objective": "只检查网页端，不要修改服务端。"
}
```

前提：**任务室和执行端都已开启**。否则返回：

```json
{ "error": "worker_not_awake" }
```

返回的 `task.id` 必须保存。任务对象已经包含创建当时的：

- `providerId`
- `modelId`
- `reasoningEffort`
- `role`
- `permission`
- `workspaceRoot`

这些字段是任务快照，不随网页之后的配置变化而改变。

### 4.3 ChatGPT 发后续消息

```http
POST /client-api/events
Authorization: Bearer <CONTROLLER_TOKEN>
Content-Type: application/json

{
  "kind": "message",
  "title": "ChatGPT → DeepSeek",
  "detail": "继续检查执行 Agent 窗口。",
  "metadata": {
    "taskId": "上一步返回的 task.id"
  }
}
```

如果 `taskId` 不存在，返回 `404 task_not_found`。

### 4.4 ChatGPT 读取 DeepSeek 和用户插话

```http
GET /client-api/timeline?after=<lastEventId>
Authorization: Bearer <CONTROLLER_TOKEN>
```

重点消费：

- `actor = deepseek-worker`
- `actor = human-owner`
- `kind = question`
- `kind = permission_request`
- `kind = result`

用户在第三窗口直接插话时，事件类型是 `human.intervention`，并尽可能带当前 `taskId`。

## 5. DeepSeek Harness 怎么接

真实 DSH Adapter 主要做五件事：

1. `POST /worker-api/session` 注册当前 DSH 会话，并定期 `POST /worker-api/heartbeat`。
2. `GET /worker-api/timeline?after=<lastEventId>` 读取任务、用户插话和任务控制。
3. 收到一个新的 `taskId` 后，调用 `GET /worker-api/tasks/:taskId` 读取该任务的稳定配置快照。
4. 调 DSH 自己的会话接口开始工作。
5. `POST /worker-api/events` 把 DSH 的真实过程写回来。

`GET /worker-api/config` 仍然存在，但它代表的是**当前默认配置 / 下一条任务要用的配置**。已经创建的任务不要重新读全局配置决定权限，应使用 `GET /worker-api/tasks/:taskId` 的任务级快照。

### 5.1 推荐事件映射

思考/推理流：

```json
{
  "kind": "reasoning",
  "detail": "先检查 package.json。",
  "metadata": { "taskId": "..." }
}
```

工具调用：

```json
{
  "kind": "tool",
  "detail": "读取 src/app.ts",
  "metadata": {
    "taskId": "...",
    "toolName": "read_file",
    "path": "src/app.ts"
  }
}
```

需要用户回答：

```json
{
  "kind": "question",
  "detail": "优先检查 A 还是 B？",
  "state": "waiting",
  "metadata": { "taskId": "..." }
}
```

最终结果：

```json
{
  "kind": "result",
  "detail": "检查完成……",
  "state": "success",
  "metadata": { "taskId": "..." }
}
```

### 5.2 任务状态保护

中转站会做基本防护：

- `reasoning / tool / worker message`：正常运行任务可进入 `running`。
- `question / permission_request`：进入 `waiting-user`。
- Worker 在 `waiting-user` 之后又吐出迟到的 reasoning/tool，不会自动清掉等待状态。
- ChatGPT 对同一任务发出新的 message，可视为主控回复并让 `waiting-user → running`。
- `result(success)` → `completed`。
- `result(error)` 或 `status(error)` → `failed`。
- `completed / failed / cancelled` 是终态，迟到事件不会复活任务。
- `paused` 不会被普通进度事件自动恢复，必须显式 `resume`。

### 5.3 reasoning 流不要按 token 落事件

当前时间线是本地 JSON 持久化，适合“步骤级事件”，不适合每个 token 一条事件。

真实接 DSH 时建议把 reasoning 流按短句或约 100–300ms 合并成小块再写 `/worker-api/events`。这样网页仍然有流式观感，也不会造成大量 JSON 写盘和事件膨胀。

## 6. 用户直接插话

`POST /ui-api/interventions` 会把消息写入共享时间线。

- 任务室/执行端关闭时返回 `409 worker_not_awake`。
- 如果显式带了不存在的 `taskId`，返回 `404 task_not_found`。
- 演示任务在 `waiting-user` 时收到回答会自动继续。
- 真实任务在 `waiting-user` 时收到回答会先更新为 `running`，真实 DSH 适配器需要消费这条消息并继续会话。

## 7. 重启行为

当前版本**没有真实 DSH 会话恢复**。

因此中转站启动时会把旧的：

- `running`
- `paused`
- `waiting-user`

标记为 `failed`，并写入 `task.recovery.interrupted` 事件。

`queued` 任务保留，因为它们还没有被确认执行；后续 DSH Adapter 接手时可决定是否继续消费。

执行默认配置会从 `data/execution-config.json` 恢复；任务室开关、ChatGPT/Worker 在线状态不会跨重启伪造恢复，会安全地回到关闭/离线。

## 8. 最重要的待确认点：DSH 到底能给出什么

接真实 DeepSeek 前，先做一次只读探测：

- 是否能流式拿到 reasoning / thinking 文本？
- 是否能拿到工具调用开始和结束？
- 是否能拿到命令、文件路径、工具结果？
- 是否有“等待用户输入”事件？
- 是否有稳定的 session / task 标识？
- 用户直接插话能否注入当前运行会话？
- pause / resume / cancel 在 DSH 里分别对应什么真实动作？

**不要先写一大堆适配代码再猜字段。先采样真实 DSH 事件，再做映射。**

## 9. 思考过程原则

第三窗口可以显示 DSH 真正提供出来的 reasoning / thinking 内容。

如果 DSH 没有提供某段模型内部隐藏思维，中转站不要自行伪造。当前演示模式的模拟思考都带 `metadata.demo = true`，真实 Worker 事件则带 `metadata.contentSource = worker-provided`。

## 10. 关键文件

- `public/index.html` / `public/app.js`：任务室。
- `public/agent.html` / `public/agent.js`：执行 Agent 独立窗口。
- `src/app.ts`：所有网页、ChatGPT、Worker API。
- `src/task-store.ts`：任务历史、任务配置快照、状态保护与重启中断处理。
- `src/timeline.ts`：共享事件时间线、持久化、SSE 数据源。
- `src/demo-runner.ts`：假 DeepSeek 演示流程。
- `src/controller-session.ts`：ChatGPT 客户端连接状态。
- `src/execution-config.ts`：执行端默认配置与持久化。
- `src/control-state.ts`：任务室 / 执行 Agent 开关。
- `src/worker-session.ts`：DeepSeek / DSH 会话注册、心跳、断开状态。
- `docs/architecture.zh-CN.md`：整体架构。
- `docs/SELF-CHECK.zh-CN.md`：本轮交接前完整自检记录。

## 11. 当前验证结果

交接前版本已验证：

- TypeScript 编译通过。
- 浏览器 JS 语法检查通过。
- 15 个单元测试通过。
- smoke 端到端测试通过。
- 关闭状态正式派发会被拒绝。
- 执行配置跨重启恢复。
- 任务级 Provider/Model/推理/角色/权限/工作区快照稳定。
- `waiting-user` 不会被迟到 Worker 进度清掉。
- 已取消任务不会被迟到结果复活。
- 演示任务验证 `running → paused → running → waiting-user → completed`。
- 等待用户回复的演示任务不能二次暂停。
- 任务室关闭时运行中的演示任务和正式任务都会自动暂停。
- 中转站重启时活动任务会明确标记失败，不会假装继续运行。
- 演示全过程 `externalModelCalled = false`。

完整复验命令：

```text
npm run verify:handoff
```

## 12. 接手后的推荐顺序

1. 启动项目，跑一次演示任务，确认三个界面体验。
2. 接 ChatGPT `/client-api/session`、`/client-api/tasks`、`/client-api/timeline`。
3. 对 DSH 做只读事件探测。
4. 写 DSH Adapter：收到任务后先取 `/worker-api/tasks/:taskId` 的任务级配置，再开始真实会话。
5. 把真实事件映射进 `/worker-api/events`。
6. 把 `pause / resume / cancel` 与真实 DSH 会话控制对应起来。
7. 做真实会话断线重连 / 恢复。
8. 最后再完善一次性授权票据和更严格权限层。

## 13. 当前故意没有做的东西

这些不是“漏修”，而是明确留给真实客户端接入阶段：

- ChatGPT 客户端实际调用 `/client-api/*`。
- DeepSeek Harness 真实适配器。
- DSH reasoning/tool/status 的真实字段映射。
- pause/resume/cancel 对真实 DSH 会话的控制映射。
- 真正的运行中会话断线恢复。
- 一次性授权票据与最终权限模型。

不要把这些未接线项误判成当前网页/中转站故障。

## 2026-10-08：DeepSeek 执行目录与只读设置同步

- 新建 DSH 握手会话时，中转站会以 `D:\GPT工作室\执行端文件夹\deepseek执行端` 作为实际进程工作目录（cwd），并在目录不存在时创建它。
- 旧默认值 `D:\GPT工作室` 与 `D:\AI工作区` 会在读取旧中转站配置时迁移到新的执行端专用目录；用户之后手动填写的其他目录不会被强制覆盖。
- 任务室新增“同步执行端设置”按钮。该操作只读读取 DSH 当前的 Provider、模型和推理档位，并把快照写入中转站自己的 `execution-config`。
- 同步接口是 `POST /ui-api/sync-dsh-settings`，响应中的 `changedDsh` 固定为 `false`；实现不得写入 DSH profile/session 文件。
- 中转站保存的同步快照位于 `executionConfig.dshSynced`，用于 UI 展示和后续客户端接手。DSH 仍然是其自身设置的唯一真源。
