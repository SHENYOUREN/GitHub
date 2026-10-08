# ChatGPT × DeepSeek 三界面任务室：交接前自检记录

日期：2026-10-08

## 1. 自检目标

本轮不增加业务功能，目标是把项目交给下一位 ChatGPT/Codex 客户端或开发 Agent 前，尽量消除会导致“接手后先维修”的问题。

检查范围：

- TypeScript 编译与单元测试。
- smoke 端到端闭环。
- 任务室 `/`、执行 Agent `/agent`、本地文档 `/docs`、交接文档 `/handoff`。
- ChatGPT 客户端桥 `/client-api/*`。
- DeepSeek / DSH 执行端桥 `/worker-api/*`。
- SSE 实时时间线 `/ui-api/events`。
- 执行配置、任务历史、时间线持久化。
- 任务暂停 / 继续 / 中止 / 等待用户回复状态转换。
- 任务室关闭、执行端休眠、中转站重启等异常路径。
- 前端 JavaScript 语法、HTML ID/选择器一致性、图标资源存在性。
- README / 架构文档 / 交接文档与当前代码的一致性。

本轮没有调用真实 DeepSeek，也没有调用任何外部模型。

## 2. 自检中发现并已修复的问题

### 2.1 关闭状态仍能写入正式任务

原问题：`POST /client-api/tasks` 与主控事件接口可以在任务室/执行端关闭时写入任务，与“关闭即不允许派发”的设计冲突。

修复：正式任务与 ChatGPT 派发事件现在会检查任务室和执行端状态；未开启时返回 `409 worker_not_awake`。

### 2.2 `waiting-user` 被二次暂停后丢失等待状态

原问题：演示任务已经等待用户回答时，若再执行 pause/resume，可能丢掉 `waiting-user`，导致用户回答无法继续演示。

修复：`waiting-user` 本身视为等待状态，不允许再次 pause。用户应直接回答或 cancel。

### 2.3 关闭任务室后后台仍继续执行

原问题：运行中的演示任务可能在任务室关闭后继续触发定时步骤；正式任务也没有统一进入暂停状态。

修复：任务室关闭会连带执行端休眠。所有当前 `running` 任务都会进入 `paused`；演示执行器的计时流程也真正暂停。重新开启后不会自动擅自继续，必须显式 resume。

### 2.4 执行端配置重启丢失

原问题：Provider / Model / 推理档位 / 角色 / 权限 / 工作区只保存在内存。

修复：持久化到 `data/execution-config.json`，采用临时文件 + rename 的原子写入。文件损坏时回退到安全默认值。

### 2.5 旧任务会被新的全局配置污染

原问题：任务记录没有完整保存角色与读写权限。为下一条任务修改全局配置后，旧任务可能读取到新权限。

修复：创建正式任务时，把 Provider / Model / 推理档位 / 角色 / 权限 / 工作区完整快照绑定到任务。DSH 应通过 `GET /worker-api/tasks/:taskId` 读取任务级稳定配置，而不是执行时重新读取全局配置。

### 2.6 不存在的 taskId 会产生孤立事件

原问题：用户干预或 Worker/ChatGPT 事件携带不存在的 `taskId` 时，可能仍被写进时间线。

修复：相关接口现在返回 `404 task_not_found`，不再制造孤立记录。

### 2.7 迟到 Worker 事件可以复活终态任务

原问题：已经 `completed / failed / cancelled` 的任务，有机会被迟到的 reasoning/result 再改回运行状态；`waiting-user` 也可能被迟到的普通进度清掉。

修复：状态机增加保护：

- `completed / failed / cancelled` 为终态，不允许被普通 Worker 事件复活。
- `waiting-user` 不会被 Worker 的迟到 reasoning/tool 清掉。
- `paused` 不会因为普通进度事件自动恢复。
- ChatGPT/用户给出新的回答后才可从 `waiting-user` 恢复。

### 2.8 中转站重启后出现“假运行”

原问题：持久化任务在中转站重启后仍可能显示为 running/paused/waiting-user，但真实运行上下文早已消失。

修复：启动时把旧的 `running / paused / waiting-user` 明确标为 `failed`，并写入 `task.recovery.interrupted`。当前版本不假装已经实现真实 DSH 会话恢复。

### 2.9 `/docs` 依赖 GitHub main，可能看到旧版本

原问题：本地代码已经更新时，`/docs` 仍跳转 GitHub main，交接者可能读到旧架构。

修复：`/docs` 和 `/handoff` 均直接提供当前项目内的本地文档。

### 2.10 执行窗口无显式任务选择时，回复可能无法绑定

原问题：存在等待用户回答的任务时，执行窗口虽然显示等待提示，但若用户没有手动选中任务，直接回复可能没有 `taskId`。

修复：无显式选择时自动绑定最近的 `waiting-user` 任务；页面同时提示当前回复目标。

### 2.11 前端静态错误缺少自动检查

原问题：交接时如果 HTML 改了 ID、JS 选择器没同步，只有打开页面后才会发现。

修复：新增 `scripts/static-check.mjs`，`npm run verify:handoff` 会自动检查：

- `public/app.js`、`public/agent.js` JavaScript 语法。
- `$()` 使用的 ID 是否存在于对应 HTML。
- HTML 是否有重复 ID。
- 页面引用的 Lucide 图标是否真实存在。
- README、架构文档、交接文档等必需文件是否存在。

## 3. 自动验证结果

最终复验命令：

```text
npm run verify:handoff
```

结果：

- 静态交接检查：通过。
- TypeScript 编译：通过。
- 单元测试：15 / 15 通过。
- smoke 端到端：通过。
- 正式任务在双开关关闭时派发：正确返回 409。
- ChatGPT 主控事件在关闭状态写入：正确返回 409。
- 执行配置保存：通过。
- 任务级配置快照：通过，修改全局配置后旧任务不变。
- 未知 Worker `taskId`：正确返回 404。
- Worker 提问：任务进入 `waiting-user`。
- 迟到 reasoning：不会清除 `waiting-user`。
- ChatGPT 回答：可恢复 waiting 任务。
- 已取消任务 + 迟到 result：任务保持 cancelled。
- 演示任务：`running → paused → running → waiting-user → completed`。
- `waiting-user` 二次 pause：正确拒绝。
- 关闭任务室：运行中的演示任务自动暂停。
- 关闭任务室：运行中的正式任务自动暂停。
- A2A 无凭据：401。
- proof-worker 协议闭环：完成并产生 artifact。
- 演示流程：`externalModelCalled = false`。

## 4. 实际 HTTP / SSE 自检

使用真实启动后的本地服务测试：

| 项目 | 结果 |
| --- | --- |
| `GET /` | 200 |
| `GET /agent` | 200 |
| `GET /docs` | 200 |
| `GET /handoff` | 200 |
| `GET /health` | 200 |
| Worker 任务快照无 Token | 401 |
| Worker 查询不存在任务（有 Token） | 404 |
| SSE 初始快照 | 收到 `event: snapshot` |
| SSE 新事件 | 收到 `event: timeline` |

## 5. 重启恢复专项验证

做过一次真实“启动 → 创建运行中任务 → 杀掉服务 → 再启动”的恢复测试：

- 执行端配置成功跨重启恢复。
- 任务室开关安全恢复为关闭、执行端恢复为休眠，不伪造在线状态。
- 中断的运行任务被标记为 `failed`。
- 时间线写入 `task.recovery.interrupted`。

这符合当前阶段的设计：**宁可明确告诉用户任务中断，也不假装恢复了一个已经不存在的 DSH 执行会话。**

## 6. 前端浏览器验证边界

本环境尝试使用 Playwright + Chromium 做真实点击自动化时，浏览器访问 `127.0.0.1` 被运行环境的管理员策略拦截（`ERR_BLOCKED_BY_ADMINISTRATOR`）。这不是项目返回的错误，因此本轮无法在此沙盒完成真正的浏览器点击回归。

已经用以下手段替代覆盖：

- 两份浏览器 JS 的真实语法检查。
- JS 选择器 ↔ HTML ID 自动一致性检查。
- 重复 ID 检查。
- 图标文件存在性检查。
- 页面 HTTP 200 检查。
- SSE 实际连接检查。
- API / 状态机 / 演示流程端到端测试。

**交接到目标 Windows 电脑后，仍建议做一次人工浏览器点击巡检**：打开 `/` 和 `/agent`，确认布局、折叠、按钮、弹窗和字体视觉效果。若只是功能正确性，本轮自动检查已经覆盖主要路径。

## 7. 当前明确没有实现的内容

这些不是遗留 bug，而是刻意留给下一阶段的真实客户端接入：

1. ChatGPT 客户端真正注册会话并自动上报任务/消息。
2. DeepSeek Harness / DSH 真实适配器。
3. DSH 实际 reasoning/tool/status/result 字段映射。
4. 将共享时间线里的 pause/resume/cancel 真正转发给 DSH 进程。
5. DSH 断线后真正的会话恢复 / 断点续跑。
6. 最终的逐任务人工授权机制（用户已明确要求当前阶段先不做）。

## 8. 交接者的第一步

不要先重构网页。先执行：

```powershell
npm ci
$env:CONTROLLER_TOKEN = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm run verify:handoff
npm start
```

然后阅读：

1. `README.md`
2. `docs/HANDOFF.zh-CN.md`
3. `docs/architecture.zh-CN.md`
4. 本文件

确认基线全绿后，再从 **ChatGPT 客户端接线 → DSH 事件探测与映射** 开始。

## Windows 10 专项复查（2026-10-08）

在最终交接包上又做了一次 Win10 定向审计，发现并修正两项可能导致“在 Linux 验证正常、到 Win10 交接失败”的问题：

- Windows PowerShell 5.1 不保证提供 `Convert.ToHexString`，启动说明已改为由 Node `crypto` 生成 token。
- npm 测试脚本不再依赖 Bash/Unix shell 展开 `*.test.*`，改为 Node 脚本显式枚举测试文件。

另外新增 `win10-install.bat`、`win10-verify.bat`、`win10-start.bat`、`scripts/windows-compat-check.mjs` 与 `docs/WIN10-CHECK.zh-CN.md`。本轮审计宿主仍为 Linux，因此没有伪称完成真实 Win10 内核执行；Win10 动态检查会在哥哥机器运行 `win10-verify.bat` 时自动执行。
