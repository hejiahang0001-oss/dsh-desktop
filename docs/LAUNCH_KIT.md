# Launch kit

Use these messages only after the latest GitHub Release has an installer asset and the README download link has been verified.

## Show HN title

```text
Show HN: DSH Desktop – A Windows desktop host for DeepSeek Harness
```

## Short English introduction

```text
I built DSH Desktop, an unofficial Windows desktop host around DeepSeek Harness.

It keeps Harness as the actual agent and Web UI, then adds native repository selection, persistent session entry points, Agent/tool status, official Plan entry, a resizable Git Diff panel, a lazy read-only workspace file browser, and a bottom PowerShell command panel bound to the same workspace. Diff can reveal the exact file in the tree; text preview, filename search, terminal output, and process actions all have explicit bounds. The installer bundles pinned Node.js and Harness runtimes, so users do not need Node preinstalled.

V0.4.2 is an unsigned developer-preview build. I would especially value feedback on Windows compatibility, file-tree navigation, read-only preview, Diff readability, terminal safety, and panel sizing.
```

## 中文标题

```text
我把 DeepSeek Harness 做成了一个可安装的 Windows 桌面端
```

## 中文短介绍

```text
DSH Desktop 是一个围绕官方 DeepSeek Harness 构建的非官方 Windows 桌面宿主。它不重新实现 Agent，而是补齐本地仓库选择、会话入口、Agent/工具状态、Plan 入口、Git Diff 审查和工作区文件查看。

V0.4.2 增加了左侧懒加载文件树、受限文件名搜索和只读文本预览；从右侧 Diff 点击“查看文件”会自动展开并定位准确路径。凭据、私钥、链接、二进制、大文件和不支持编码不会在面板中读取。底部同工作区 PowerShell 命令面板继续使用原生确认、有界输出、进程树停止和软件 Key 隔离。

当前仍是未签名的 developer preview；文件查看不是编辑器，终端也还是受控单命令模式。欢迎反馈 Windows 兼容性、文件导航、只读预览、Diff 可读性、终端安全性和面板尺寸。
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
8. Open the bottom terminal with `Ctrl+Alt+T`, show the same workspace path, and stop before entering any secret-bearing command.
9. End on the GitHub release download page.
