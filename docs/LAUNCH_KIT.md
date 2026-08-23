# Launch kit

Use these messages only after the latest GitHub Release has an installer asset and the README download link has been verified.

## Show HN title

```text
Show HN: DSH Desktop – A Windows desktop host for DeepSeek Harness
```

## Short English introduction

```text
I built DSH Desktop, an unofficial Windows desktop host around DeepSeek Harness.

It keeps Harness as the actual agent and Web UI, then adds native repository selection, persistent session entry points, Agent/tool status, official Plan entry, a resizable Git Diff panel, a lazy read-only workspace file browser, one persistent interactive PowerShell PTY, and an integrated application preview bound to the same workspace. Diff can reveal the exact file in the tree; text preview, localhost application preview, filename search, terminal input/output, recovery, and process actions all have explicit bounds. The installer bundles pinned Node.js, Harness, xterm, and PTY runtimes, so users do not need Node or pnpm preinstalled.

V0.4.5 follows official DeepSeek Harness 0.1.1-rc.2 and adds application preview for workspace HTML or an existing loopback development server. Software-managed random ports are released on Stop, panel close, workspace change, or exit; external localhost services are monitored but never killed. It remains an unsigned developer-preview build. Community plugins stay opt-in rather than receiving silent filesystem, shell, network, or credential access. I would especially value feedback on Windows compatibility, HTML framework compatibility, preview loading, terminal interaction, file-tree navigation, and Diff readability.
```

## 中文标题

```text
我把 DeepSeek Harness 做成了一个可安装的 Windows 桌面端
```

## 中文短介绍

```text
DSH Desktop 是一个围绕官方 DeepSeek Harness 构建的非官方 Windows 桌面宿主。它不重新实现 Agent，而是补齐本地仓库选择、会话入口、Agent/工具状态、Plan 入口、Git Diff 审查和工作区文件查看。

V0.4.5 继续使用官方 DeepSeek Harness 0.1.1-rc.2，并增加同工作区应用预览。HTML 可从只读文件预览直接打开，也可连接已经运行的 `127.0.0.1`、`localhost` 或 `::1` 开发服务器。

软件自己启动的随机回环端口会在停止、关闭面板、切换仓库或退出时释放；外部本机服务只监控、不结束。左侧懒加载文件树、受限文件名搜索、只读文本预览、右侧 Diff 定位和底部持久 PTY 继续保留。凭据、链接、越界路径和过大文件不会被应用预览读取；软件 Key 不进入 PTY 宿主或 PowerShell 环境。

当前仍是未签名的 developer preview；图片/PDF 专用预览、设备尺寸预设和远程 URL 尚未提供。欢迎反馈 Windows 兼容性、HTML 框架兼容性、预览加载、文件导航、Diff 可读性和终端交互。
```

## Demo sequence

Keep the screen recording between 20 and 35 seconds:

1. Open a repository with `Ctrl+O`.
2. Start or resume a Harness session.
3. Enter **Plan mode** and ask for a small change across three files.
4. Approve execution in the official Harness confirmation card.
5. Keep the right review panel visible and show one file's real Diff.
6. Click **View file** and show the left tree expand to the exact read-only file preview.
7. Select an HTML file, click **Application preview**, and show the integrated rendered page plus its software-managed loopback-port status.
8. Stop the preview and show the explicit stopped state, then batch accept the safe changes and show the staged state.
9. Open the bottom terminal with `Ctrl+Alt+T`, start the PTY after the native warning, run two harmless commands in the same shell, and stop it from the toolbar. Never enter a secret-bearing command.
10. End on the GitHub release download page.
