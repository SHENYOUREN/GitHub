# ChatGPT × DeepSeek 多模型任务室

这是一个给 **ChatGPT 客户端** 配套的本地 A2A 中转站。ChatGPT 负责主控与派工，
DeepSeek Harness 负责执行，网页只负责配置、观察和必要时人工插话。

> 当前阶段：三界面骨架、任务历史、演示执行、持久化与客户端/Worker 接口已经落地；DeepSeek Harness 真实适配器尚未接通，因此现在不会自动调用 DeepSeek。

## 三个界面

```text
① ChatGPT 主界面
   用户 ↔ ChatGPT
   规划 / 派工 / 追问 / 验收
          |
          v
② 多模型任务室  http://127.0.0.1:4310/
   执行端配置 / 开关 / ChatGPT ↔ DeepSeek 对话总览
          |
          v
③ 执行 Agent 窗口  http://127.0.0.1:4310/agent
   DeepSeek 思考输出 / 状态 / 工具 / 结果 / 用户直接插话
```

三个界面共用同一个本地中转站和同一条时间线。用户在执行 Agent 窗口直接插话后，
该消息也会进入共享记录，ChatGPT 客户端接入后能够同步读取，不会形成两个互相不知道的上下文。

## 当前已经实现

- 任务室和执行 Agent 使用两个独立网页窗口。
- 执行端 Provider、Model、推理档位、角色、权限、工作区可在任务室关闭、执行端休眠时提前配置。
- 执行配置持久化到 `data/execution-config.json`；重启中转站后会恢复。
- 正式 ChatGPT 任务会把 Provider / Model / 推理档位 / 角色 / 权限 / 工作区**快照绑定到任务本身**，后续修改全局配置不会改变旧任务。
- 任务室或执行端未开启时，正式任务和 ChatGPT 派发消息返回 `409 worker_not_awake`，不会偷偷进入队列。
- ChatGPT 客户端有独立的会话注册、心跳和事件上报接口。
- 执行端有独立的事件上报接口，可提交 `reasoning`、`tool`、`status`、`result`、`message`、`question`、`permission_request`。
- 网页使用 SSE 实时接收时间线。
- 执行 Agent 窗口按“思考 / 工具 / 状态 / 结果 / 提问 / 对话”分开展示，并可按任务筛选。
- 用户可以在执行 Agent 窗口直接写消息；没有手动选任务时，如果存在正在等待回复的任务，会自动把回复绑定到最近的等待任务。
- 中转站不会伪造模型没有返回的隐藏思维。网页只显示执行端实际提供的思考/推理内容。
- 任务历史持久化到 `data/tasks.json`，时间线持久化到 `data/timeline.json`。
- 内置“演示任务”可以在完全不调用 DeepSeek 的情况下跑通思考、工具、提问、用户回复和结果流程。
- DeepSeek 提问时，任务室与执行窗口都会显示“等待用户回复”。
- 执行窗口已经有暂停 / 继续 / 中止按钮；“等待用户回复”本身已经是等待状态，因此不会再允许二次暂停。
- 任务室关闭或执行端休眠时，正在运行的演示任务和正式任务都会自动暂停，不会继续在后台偷偷跑。
- 已完成 / 已失败 / 已中止任务不会被迟到的 Worker 事件重新改回“运行中”。
- 中转站重启时，旧的 `running / paused / waiting-user` 任务会明确标记为 `failed`，避免假装还在运行；当前版本尚不自动恢复真实 DSH 会话。
- DeepSeek / DSH 有独立的会话注册、心跳与断开状态接口，网页能区分“已唤醒”和“真正已连接”。
- 仍保留 `proof-worker` 用于本地协议和测试闭环。

## 本地运行

需要 Node.js **22.19 或更高版本**。目标机器是 Windows 10 时，优先使用项目根目录的三个脚本：

1. 双击 `win10-install.bat`：安装依赖。
2. 双击 `win10-verify.bat`：执行 Win10 兼容检查 + 完整交接自检。
3. 双击 `win10-start.bat`：启动本地中转站。

`win10-start.bat` 会使用 Node 生成并保存稳定的本地 Controller Token 到 `data/controller-token.txt`，不依赖 Windows PowerShell 5.1 缺失的 `.NET Convert.ToHexString`。该文件已被 `data/` 的 `.gitignore` 规则排除，不应提交到 GitHub。

如果需要手工从 PowerShell 启动，可使用：

```powershell
npm ci
$env:CONTROLLER_TOKEN = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm run verify:win10
npm start
```

`verify:win10` 会先做 Windows 文件名、脚本、PowerShell 兼容性与文件持久化模式检查，再运行 `verify:handoff`。`verify:handoff` 会检查浏览器 JavaScript 语法、DOM 选择器/ID、一致性图标资源和必需交接文件，然后编译 TypeScript、运行单元测试和 smoke 端到端测试。

默认监听 `http://127.0.0.1:4310`，当前 MVP 只允许绑定本机回环地址。Win10 专项检查说明见 `docs/WIN10-CHECK.zh-CN.md`。

## 网页接口

- `GET /`：多模型任务室（总控制台）。
- `GET /agent`：独立执行 Agent 工作窗口。
- `GET /docs`：本地架构文档，不依赖 GitHub 在线版本。
- `GET /handoff`：本地交接文档。
- `GET /ui-api/catalog`：执行端服务商和模型能力。
- `GET/PATCH /ui-api/execution-config`：当前执行端默认配置。
- `GET/PATCH /ui-api/control-state`：任务室与执行端开关。
- `GET /ui-api/controller-session`：ChatGPT 主控连接状态。
- `GET /ui-api/worker-session`：DeepSeek / DSH 连接状态。
- `GET /ui-api/timeline`：共享时间线。
- `GET /ui-api/events`：SSE 实时事件流。
- `GET /ui-api/tasks`：任务历史。
- `GET /ui-api/tasks/:taskId/events`：某个任务及其可用执行轨迹。
- `POST /ui-api/demo/start`：启动本地假 DeepSeek 演示任务（不调用外部模型）。
- `POST /ui-api/interventions`：用户从执行 Agent 窗口直接插话或回复等待中的问题。
- `POST /ui-api/tasks/:taskId/control`：暂停 / 继续 / 中止任务。

## ChatGPT 客户端接入接口

以下接口使用 `Authorization: Bearer <CONTROLLER_TOKEN>`：

- `GET/POST/DELETE /client-api/session`：读取、注册、断开 ChatGPT 会话。
- `POST /client-api/heartbeat`：维持“ChatGPT 已连接”状态。
- `POST /client-api/tasks`：创建正式任务并返回 `taskId`；任务室和执行端必须已开启。
- `POST /client-api/events`：把 ChatGPT 给 DeepSeek 的消息/状态写入共享时间线；任务室和执行端必须已开启。
- `GET /client-api/timeline?after=<eventId>`：读取新增事件，包括用户在第三窗口直接插入的消息。

## DeepSeek / DSH 适配器接入接口

第一版真实适配器只需要把 DSH 的可见事件翻译成以下接口即可：

- `GET/POST/DELETE /worker-api/session`、`POST /worker-api/heartbeat`：DSH 注册、保活、断开。
- `GET /worker-api/config`：读取**下一条任务的默认配置**。
- `GET /worker-api/tasks/:taskId`：读取已经创建任务的稳定配置快照；真实执行应优先使用这里的任务级配置。
- `GET /worker-api/timeline?after=<eventId>`：读取 ChatGPT 任务、用户插话和任务控制。
- `POST /worker-api/events`：上报 DeepSeek 的 `reasoning`、`tool`、`status`、`result`、`message`、`question` 等事件。

如果请求里带了不存在的 `taskId`，中转站会返回 `404 task_not_found`，避免默默生成无法追踪的孤立事件。

例如 DSH 如果返回了一段真实 reasoning 流，适配器可以发送：

```json
{
  "kind": "reasoning",
  "title": "DeepSeek · 思考",
  "detail": "先检查 package.json 和启动脚本。",
  "metadata": { "taskId": "..." }
}
```

网页第三窗口会把它显示为“思考”。如果 DSH 没有返回 reasoning，中转站不会自行编造。

> 真正接流式 reasoning 时，不要把每个 token 都单独写成一个时间线事件。建议按短句或 100–300ms 小批次合并后再提交，避免不必要的事件和磁盘写入膨胀。

## 目录

- `public/index.html` / `public/app.js`：第二界面，多模型任务室。
- `public/agent.html` / `public/agent.js`：第三界面，独立执行 Agent 工作窗口。
- `src/controller-session.ts`：ChatGPT 客户端连接状态。
- `src/execution-config.ts`：执行端默认配置与持久化。
- `src/timeline.ts`：共享时间线、持久化与 SSE 订阅源。
- `src/task-store.ts`：任务历史、任务级配置快照与状态保护。
- `src/demo-runner.ts`：不调用真实模型的 DeepSeek 演示流程。
- `src/app.ts`：网页、ChatGPT 客户端、Worker 适配器的 HTTP 接口。
- `docs/architecture.zh-CN.md`：三界面架构和后续 DSH 接入说明。
- `docs/HANDOFF.zh-CN.md`：给 ChatGPT / Codex / DSH 适配器接手开发的详细交接文档。
- `docs/SELF-CHECK.zh-CN.md`：交接前完整自检结果。

## 下一步

1. 在 ChatGPT 客户端侧接入 `/client-api/*`，让第一界面真正注册、派工并读取反馈。
2. 对 DeepSeek Harness 做只读事件探测，先确认真实事件字段。
3. 编写 DSH Adapter，把 DSH 的消息、reasoning、工具调用和结果写入 `/worker-api/events`。
4. 让适配器消费共享时间线中的 ChatGPT 任务、用户插话和 `pause/resume/cancel` 控制事件。
5. 做真实 DSH 会话断线重连 / 恢复。
6. 最后再完善一次性授权票据和更严格的权限层。

### DeepSeek 执行端工作目录与设置同步

DeepSeek 新建握手会话默认从 `D:\GPT工作室\执行端文件夹\deepseek执行端` 启动，而不是继承任务室仓库目录。任务室中的“同步执行端设置”只读取 DSH 当前 Provider / 模型 / 推理档位并更新中转站快照，不会修改 DSH 端设置。
