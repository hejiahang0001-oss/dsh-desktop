# Launch kit

Use these messages only after the latest GitHub Release has an installer asset and the README download link has been verified.

## Show HN title

```text
Show HN: DSH Desktop – A Windows desktop host for DeepSeek Harness
```

## Short English introduction

```text
I built DSH Desktop, an unofficial Windows desktop host around DeepSeek Harness.

It keeps Harness as the actual agent and Web UI, then adds native repository selection, persistent session entry points, Agent/tool status, official Plan entry, a resizable Git Diff panel, a lazy read-only workspace file browser, and one persistent interactive PowerShell PTY bound to the same workspace. Diff can reveal the exact file in the tree; text preview, filename search, terminal input/output, recovery, and process actions all have explicit bounds. The installer bundles pinned Node.js, Harness, xterm, and PTY runtimes, so users do not need Node or pnpm preinstalled.

V0.4.4 follows official DeepSeek Harness 0.1.1-rc.2, retains consistent Chinese process language, and upgrades the terminal to a persistent PTY with shell state, ANSI rendering, reload recovery, process-tree stop, and software-Key isolation. It remains an unsigned developer-preview build. Community plugins stay opt-in rather than receiving silent filesystem, shell, network, or credential access. I would especially value feedback on Windows compatibility, terminal interaction, file-tree navigation, Diff readability, and application-preview expectations.
```

## 中文标题

```text
我把 DeepSeek Harness 做成了一个可安装的 Windows 桌面端
```

## 中文短介绍

```text
DSH Desktop 是一个围绕官方 DeepSeek Harness 构建的非官方 Windows 桌面宿主。它不重新实现 Agent，而是补齐本地仓库选择、会话入口、Agent/工具状态、Plan 入口、Git Diff 审查和工作区文件查看。

V0.4.4 继续使用官方 DeepSeek Harness 0.1.1-rc.2，保留中文过程一致性，并把底部终端升级为同工作区持久交互式 PowerShell PTY。它支持连续命令、交互提示、Shell 状态、ANSI 颜色、尺寸同步、页面重载恢复和完整进程树停止。

左侧懒加载文件树、受限文件名搜索、只读文本预览和右侧 Diff 定位继续保留。凭据、私钥、链接、二进制、大文件和不支持编码不会在文件面板中读取；软件 Key 不进入 PTY 宿主或 PowerShell 环境，终端运行期间 Git 接受/拒绝会暂时禁用。

当前仍是未签名的 developer preview；文件查看不是编辑器，终端目前只有一个 PTY，尚无标签页和分屏。欢迎反馈 Windows 兼容性、文件导航、Diff 可读性、终端交互和应用预览需求。
```

## Demo sequence

Keep the screen recording between 20 and 35 seconds:

1. Open a repository with `Ctrl+O`.
2. Start or resume a Harness session.
3. Enter **Plan mode** and ask for a small change across three files.
4. Approve execution in the official Harness confirmation card.
5. Keep the right review panel visible and show one file's real Diff.
6. Click **View file** and show the left tree expand to the exact read-only file preview.
7. Close the preview with `Esc`, then batch accept the safe changes and show the staged state.
8. Open the bottom terminal with `Ctrl+Alt+T`, start the PTY after the native warning, run two harmless commands in the same shell, and stop it from the toolbar. Never enter a secret-bearing command.
9. End on the GitHub release download page.
