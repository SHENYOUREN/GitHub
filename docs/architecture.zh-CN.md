# ChatGPT × DeepSeek 三界面任务室架构

## 1. 目标

这个项目不是另做一个聊天客户端，而是给 ChatGPT 客户端增加一个可观察、可配置的执行端系统。

最终使用体验固定为三个界面：

```text
┌──────────────────────────┐
│ ① ChatGPT 主界面         │
│ 用户 ↔ ChatGPT           │
│ 规划、派工、追问、验收    │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ 本地 A2A 中转站           │
│ 配置 / 会话 / 时间线 / 桥 │
└───────┬──────────┬───────┘
        │          │
        │          └──────────────────────┐
        ▼                                 ▼
┌──────────────────────┐       ┌──────────────────────┐
│ ② 多模型任务室       │       │ ③ 执行 Agent 窗口   │
│ 配置 + 双方对话总览  │       │ 思考/工具/状态/结果  │
│ 开关 + 执行状态      │       │ 用户可直接插话       │
└──────────────────────┘       └──────────┬───────────┘
                                          │
                                          ▼
                                  DeepSeek Harness
```

## 2. 三个界面各自负责什么

### ① ChatGPT 主界面

这是用户日常使用的主界面，也是唯一的“主控聊天界面”。

负责：

- 理解用户任务。
- 决定是否派给 DeepSeek。
- 给 DeepSeek 发任务和后续追问。
- 阅读 DeepSeek 的返回结果。
- 根据用户要求继续、返工或停止。

中转站不复制 ChatGPT 的聊天 UI。

### ② 多模型任务室

这是控制和监控窗口，不负责代替 ChatGPT 聊天。

负责：

- 任务室总开关。
- 执行 Agent 唤醒开关。
- Provider / Model / 推理档位 / 角色 / 权限 / 工作区配置。
- 显示 ChatGPT 当前是否连接、当前模型、会话和最后心跳。
- 显示 ChatGPT ↔ DeepSeek 的“对话级”消息。
- 显示任务历史、执行中 / 暂停 / 等待回复 / 完成等状态。
- 当 DeepSeek 提问时高亮“正在等待用户回复”。
- 一键打开第三个执行 Agent 独立窗口。

这里故意不铺开每一次读文件和命令，避免总览界面变成日志墙。

### ③ 执行 Agent 独立窗口

这是最接近“DeepSeek 智能体团队工作窗口”的界面。

负责详细展示：

- `reasoning`：DSH 实际提供的思考/推理流。
- `tool`：读文件、搜索、命令、写文件等工具操作。
- `status`：执行中、等待、暂停、失败等状态。
- `result`：阶段结果和最终结果。
- `message` / `question`：DeepSeek 主动对 ChatGPT 或用户说的话。
- 可按任务筛选执行轨迹。
- 提供暂停 / 继续 / 中止控制；真实 DSH 接入后由适配器消费对应控制事件。

用户可以在这个窗口直接给 DeepSeek 插话。例如：

> 先别查整个项目，只看网页端。

这条消息不会只存在第三窗口，而是写入同一条共享时间线。因此 ChatGPT 客户端也能读取到，避免出现 ChatGPT 还以为 DeepSeek 在做旧任务的上下文分叉。

## 3. 共享时间线

三个界面的关键不是互相复制消息，而是共用一个 `TimelineStore`。当前时间线会持久化到 `data/timeline.json`，任务状态会持久化到 `data/tasks.json`，执行端默认配置会持久化到 `data/execution-config.json`。任务室/执行端开关和在线状态不会跨重启伪造恢复。

每条事件至少包含：

- `id`
- `timestamp`
- `actor`
- `kind`
- `title`
- `detail`
- `state`
- `metadata`

当前 `kind`：

```text
message
reasoning
tool
result
status
question
permission_request
```

网页通过 `GET /ui-api/events` 的 SSE 实时接收新增事件。

## 4. 关于“DeepSeek 思考过程”

网页本身有能力显示完整的流式思考记录，真正的限制来自执行端是否把这些内容提供出来。

如果 DSH 适配器收到：

```text
reasoning: 先检查 package.json
reasoning: Node 版本可能不匹配
 tool: read_file package.json
```

适配器就按顺序写入 `/worker-api/events`，第三窗口按时间线展示。

如果执行端没有提供某段内部推理，中转站不能从模型内部强行提取，也不会伪造。界面上只把执行端真实返回的内容标为“思考”。

## 5. ChatGPT 客户端接口

ChatGPT 客户端以后只需要做三件事。

### 5.1 注册当前会话

```http
POST /client-api/session
Authorization: Bearer <token>
Content-Type: application/json

{
  "clientName": "ChatGPT",
  "model": "当前会话模型",
  "conversationId": "...",
  "state": "idle"
}
```

然后定期：

```http
POST /client-api/heartbeat
```

### 5.2 创建正式任务

```http
POST /client-api/tasks
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "检查网页端",
  "objective": "只检查网页端，不要修改服务端。"
}
```

保存返回的 `task.id`，后续事件都带 `metadata.taskId`。创建任务时要求任务室与执行端已经开启，否则返回 `409 worker_not_awake`。

正式任务会把当时的 Provider / Model / 推理档位 / 角色 / 权限 / 工作区固化成任务级快照，后续网页改配置不会改变旧任务。

### 5.3 写入主控消息

```http
POST /client-api/events

{
  "kind": "message",
  "title": "ChatGPT → DeepSeek",
  "detail": "检查这个项目的网页端。",
  "metadata": { "taskId": "..." }
}
```

### 5.4 读取 DeepSeek 和用户插话

```http
GET /client-api/timeline?after=<lastEventId>
```

这样 ChatGPT 能读到 DeepSeek 返回，也能读到用户在第三窗口直接说的新要求。

## 6. DeepSeek Harness 适配器接口

DSH 客户端接入时不需要知道网页 DOM，也不需要控制浏览器。

它只需要：

1. `POST /worker-api/session` 注册 DSH 会话与当前模型，并定期 `POST /worker-api/heartbeat`。
2. `GET /worker-api/timeline?after=<lastEventId>` 读取新的任务、用户插话以及暂停 / 继续 / 中止控制。
3. 收到任务后用 `GET /worker-api/tasks/:taskId` 读取该任务的稳定配置快照。`GET /worker-api/config` 只代表当前默认配置/下一条任务配置。
4. 调 DSH 自己的会话接口开始工作。
5. 将 DSH 返回的过程事件发到 `POST /worker-api/events`。

工具事件建议带结构化元数据：

```json
{
  "kind": "tool",
  "title": "读取文件",
  "detail": "读取 src/app.ts",
  "metadata": {
    "toolName": "read_file",
    "path": "src/app.ts",
    "taskId": "..."
  }
}
```

推理事件：

```json
{
  "kind": "reasoning",
  "title": "DeepSeek · 思考",
  "detail": "先确认页面和服务端是否共用同一份状态。",
  "metadata": { "taskId": "..." }
}
```

结果事件：

```json
{
  "kind": "result",
  "title": "检查完成",
  "detail": "发现 3 个问题……",
  "state": "success",
  "metadata": { "taskId": "..." }
}
```

## 6.1 状态与控制约束

- `completed / failed / cancelled` 是终态，迟到 Worker 事件不能把任务重新改回运行。
- Worker 在 `waiting-user` 后吐出的迟到 reasoning/tool 不会清掉等待状态；ChatGPT 主控的新 message 可以视为回答并恢复为运行。
- `paused` 必须显式 resume，普通进度事件不能自动恢复。
- `waiting-user` 本身已经是等待，不再允许额外 pause；应直接回答或 cancel。
- 关闭任务室或休眠执行端时，当前运行中的演示任务和正式任务都会进入暂停。真实 DSH 接入后，适配器需要消费相同的控制事件并真正暂停执行端。
- 请求携带不存在的 `taskId` 时返回 `404 task_not_found`。

## 6.2 reasoning 流的事件粒度

当前时间线适合步骤级事件。真实 DSH 如果给出 token 级 reasoning 流，适配器应按短句或约 100–300ms 合并后再写入，避免产生大量 JSON 写盘和 UI 事件。

## 7. 当前落地状态

已经完成：

- 第二界面 `/`。
- 第三界面 `/agent`。
- 执行配置服务端共享状态并持久化。
- ChatGPT 会话状态接口。
- ChatGPT / Worker 双向事件写入接口。
- 用户直接插话接口。
- SSE 实时流。
- 时间线增量读取与 JSON 持久化。
- 任务历史、等待用户回复状态与任务级筛选。
- 正式任务级配置快照（含角色与权限），避免全局配置变化污染旧任务。
- 关闭状态阻止正式派发，未知 taskId 拒绝写入。
- 任务终态/等待态保护，迟到事件不会错误复活或清除等待。
- 重启中断任务显式标记失败，避免假运行状态。
- 假 DeepSeek 演示模式，可完整模拟思考 → 工具 → 提问 → 用户回复 → 结果。
- 暂停 / 继续 / 中止控制壳。
- DeepSeek Worker 会话注册、心跳、断开状态接口。
- 本地 proof-worker A2A 原有闭环。

尚未完成：

- ChatGPT 客户端实际调用 `/client-api/*`。
- DeepSeek Harness 真实适配器。
- DSH reasoning/tool 事件的真实字段映射。
- 暂停 / 继续 / 中止与真实 DSH 运行会话的控制映射。
- 更完整的任务恢复（例如重启后恢复正在运行的真实 DSH 会话）。
- 权限与一次性授权票据的最终版本。

## 8. 接下来的开发顺序

1. **先跑演示模式**：确认三个界面的操作体验，不调用真实模型。
2. **ChatGPT 客户端接线**：让第一界面注册、创建任务、写入消息并读取时间线。
3. **DSH 事件探测**：确认 DeepSeek Harness 实际会返回哪些 reasoning / tool / status 字段。
4. **DSH Adapter**：把真实事件映射到 `reasoning/tool/status/result/message`，并注册 Worker 心跳。
5. **控制映射**：让 DSH 真正消费人工插话和 `pause/resume/cancel` 控制事件。
6. **真实会话恢复**：当前重启会把运行/暂停/等待中的任务标记失败；接入 DSH 后再实现真正恢复。
7. **最后再完善权限层**：包括一次性授权票据。
