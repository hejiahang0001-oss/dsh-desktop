# Launch kit

Use these messages only after the latest GitHub Release has an installer asset and the README download link has been verified.

## Show HN title

```text
Show HN: DSH Desktop – A Windows desktop host for DeepSeek Harness
```

## Short English introduction

```text
I built DSH Desktop, an unofficial Windows desktop host around DeepSeek Harness.

It keeps Harness as the actual agent and Web UI, then adds native repository selection, persistent session entry points, Agent/tool status, official Plan entry, a persistent resizable Git Diff panel, and a bottom PowerShell command panel bound to the same workspace. Every terminal command uses a native confirmation gate, bounded output, process-tree stop, and an environment that excludes the software-managed DeepSeek Key. The installer bundles pinned Node.js and Harness runtimes, so users do not need Node preinstalled.

V0.4.1 is an unsigned developer-preview build. I would especially value feedback on Windows compatibility, Diff readability, terminal safety, panel sizing, and the file-tree workflow that should come next.
```

## 中文标题

```text
我把 DeepSeek Harness 做成了一个可安装的 Windows 桌面端
```

## 中文短介绍

```text
DSH Desktop 是一个围绕官方 DeepSeek Harness 构建的非官方 Windows 桌面宿主。它不重新实现 Agent，而是补齐本地仓库选择、会话入口、Agent/工具状态、Plan 入口和常驻 Git Diff 审查面板。

V0.4.1 在常驻多文件审查面板下增加了同工作区 PowerShell 命令面板：每条命令先原生确认，输出有界，可停止整个进程树，且软件保存的 DeepSeek Key 不进入命令环境。终端高度和开关状态会保留。安装包内置固定 Node 与 Harness，目标电脑不需要预装 Node。

当前仍是未签名的 developer preview；终端还是受控单命令模式，不是持久交互式 PTY。欢迎反馈 Windows 兼容性、Diff 可读性、终端安全性、面板尺寸和下一步文件树能力。
```

## Demo sequence

Keep the screen recording between 20 and 35 seconds:

1. Open a repository with `Ctrl+O`.
2. Start or resume a Harness session.
3. Enter **Plan mode** and ask for a small change across three files.
4. Approve execution in the official Harness confirmation card.
5. Keep the right review panel visible and show each file's real Diff.
6. Batch accept the safe changes and show that the panel switches to staged state.
7. Open the bottom terminal with `Ctrl+Alt+T`, show the same workspace path, and stop before entering any secret-bearing command.
8. End on the GitHub release download page.
