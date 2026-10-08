# Windows 10 兼容性检查说明

目标环境：**Windows 10 x64 + Node.js 22.19+**。

## 已发现并修复的 Win10 交接问题

1. **PowerShell 5.1 Token 生成不兼容**  
   旧文档使用 `[Convert]::ToHexString(...)`。Windows 10 自带的 Windows PowerShell 5.1 通常运行在 .NET Framework 上，没有这个较新的 API。现在统一由 Node `crypto.randomBytes()` 生成 token。

2. **测试脚本不再依赖 shell 展开 `*.test.js` / `*.test.ts`**  
   Windows `cmd.exe` 与 Bash 对通配符参数的处理不同。现在 `scripts/run-tests.mjs` 先枚举测试文件，再把明确的文件列表交给 Node Test Runner。

3. **双击批处理的当前工作目录问题**  
   三个 Win10 批处理都先执行 `cd /d "%~dp0"`，保证 `public/`、`data/`、`node_modules/` 等相对路径始终以项目根目录为基准，即使从资源管理器双击也不会跑到错误目录。

4. **Controller Token 可稳定跨重启**  
   `win10-start.bat` 调用 `scripts/win10-token.mjs`。首次启动生成 `data/controller-token.txt`，以后复用同一 token。`data/` 已被 `.gitignore` 排除。

5. **Windows 文件系统兼容检查**  
   `scripts/windows-compat-check.mjs` 检查 Windows 非法/保留文件名、POSIX-only npm 命令、shell 通配符依赖，并实际执行 Unicode 路径下的“写临时文件 → rename → 读取”持久化模式。

6. **Win10 专用入口**  
   - `win10-install.bat`：安装依赖。
   - `win10-verify.bat`：运行 `npm run verify:win10`。
   - `win10-start.bat`：生成/读取 token 后启动服务。

## Win10 上的推荐流程

第一次：

```text
win10-install.bat
win10-verify.bat
win10-start.bat
```

以后正常启动通常只需要：

```text
win10-start.bat
```

停止服务：在 `win10-start.bat` 打开的服务窗口中按 `Ctrl+C`。当前版本故意不提供“按端口强杀进程”的脚本，避免误杀占用同一端口的其他程序。

## 运行时会额外检查的项目

当 `npm run verify:win10` 真正在 Windows 上运行时，还会：

- 强制检查 Node.js 版本不低于 22.19；
- 检查 `4310` 端口是否已被其他进程占用（占用时给警告）；
- 检查已保存的工作区路径是否存在（不存在只警告，不破坏配置）。

## 本轮验证边界

本次代码审计和修改是在 Linux 容器内完成，因此不能伪称已经在真正的 Windows 10 内核和 Windows PowerShell 5.1 上执行过程序。已经完成的是：

- Win10 静态兼容审计；
- Windows 文件命名规则检查；
- 去除 PowerShell 5.1 已知不兼容 API；
- 去除 shell glob 依赖；
- 加入 Win10 专用启动/安装/验证入口；
- 使用 Node 的跨平台文件 API验证 Unicode 路径和持久化写入模式；
- 原有 TypeScript / 单测 / smoke 验证。

最终真实 DSH 接入仍应以哥哥的 Windows 10 机器为准，因为 DSH 客户端的进程启动、路径和事件接口本身属于下一阶段，当前项目尚未调用它。
