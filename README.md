# GitHub

一个面向多 AI 客户端的分层任务中转站设计：由 Codex 负责规划、派工与验收，
DeepSeek Harness 及后续客户端作为受控执行端。

> 当前阶段：本地 MVP。已提供可见的任务中转站、分层权限、A2A 调度和审计记录；外部模型适配器尚未接通。

## 目标

- 使用 A2A 作为跨客户端通信协议，支持多轮会话、长期任务和结果产物。
- 保持明确的上下级关系，而不是让所有客户端默认拥有相同控制权。
- 使用 DeepSeek Harness 官方 ACP 作为首个执行端适配接口。
- 将 MCP 保留为每个客户端连接工具和数据源的接口。
- 更换客户端时只新增或替换适配器，不改动主控核心。

## 推荐架构

```text
用户（最高权限）
        |
        v
Codex 主控端
规划 / 派工 / 追加指令 / 验收 / 终止
        |
        v
A2A 分层调度中转站
身份 / 权限 / 任务状态 / 审计记录
        |
        +-- DeepSeek Harness 执行端（ACP 适配）
        +-- 未来客户端（A2A / ACP / 专用适配器）
        +-- 独立审查端（可选）
```

## 协议分工

| 协议 | 用途 |
| --- | --- |
| A2A | 客户端之间发现能力、分配任务、延续对话和传递产物 |
| ACP | 主控程序驱动 DeepSeek Harness 等编码代理的会话和任务 |
| MCP | 单个代理调用 GitHub、文件系统、浏览器和其他工具 |

## 上下级规则

- 用户始终拥有最高权限。
- 只有主控端可以创建、分配、暂停、取消和验收任务。
- 执行端只能报告进度、提交结果、提出问题和申请一次性权限。
- 执行端不能修改自己的角色，也不能反向控制主控端。
- 所有控制动作都必须记录发起者、目标、权限依据和时间。
- A2A 的开放通信能力不等于开放控制权；权限由中转站单独校验。

## 仓库内容

- [`docs/architecture.zh-CN.md`](docs/architecture.zh-CN.md)：完整架构与实施路线。
- [`protocol/task-envelope.schema.json`](protocol/task-envelope.schema.json)：分层任务元数据草案。

## 本地运行

需要 Node.js 22.19 或更高版本。

```powershell
npm install
$env:CONTROLLER_TOKEN = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
npm run build
npm test
npm run smoke
npm start
```

服务默认只监听 `http://127.0.0.1:4310`。主要入口：

- `GET /`：可视化多模型任务室，包含主控/执行双 Agent 配置、模型能力驱动的推理档位、双方对话与消息轨迹。
- `GET /health`：无需凭据的存活检查。
- `GET /.well-known/agent-card.json`：A2A Agent Card。
- `POST /a2a`：需要主控 Bearer Token 的 A2A JSON-RPC 接口。
- `GET /api/agents`：需要主控 Bearer Token 的角色与执行端清单。

当前执行端为 `proof-worker`，用于验证协议和权限闭环。DeepSeek Harness ACP
适配器是下一阶段实现；在它完成前，不应把本地证明执行器描述为真实模型执行。
界面中的“主控下发”只保存待确认任务并写入过程记录，不会调用 DeepSeek 或其他外部模型。
执行消息可展开查看模型配置、权限、工具记录和执行端主动返回的推理摘要；系统不读取或伪造模型的隐藏思维链。

## 实施路线

1. 用现有 DeepSeek 执行桥验证 Codex 派工、DeepSeek 执行、Codex 验收闭环。
2. 建立 A2A 调度核心、身份登记、任务状态和本地审计日志。
3. 编写 DeepSeek ACP 适配器，并保持现有 Relay 作为兼容通道。
4. 加入第二种客户端，验证更换执行端时主控核心无需修改。
5. 完成认证、权限票据、超时、恢复和跨机器部署。

## 参考项目

- [Agent2Agent Protocol](https://github.com/a2aproject/A2A)
- [A2A MCP Server](https://github.com/a2anet/a2a-mcp)
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [Harness Relay MCP](https://github.com/tonytanglab/deepseek-harness-relay-mcp)
