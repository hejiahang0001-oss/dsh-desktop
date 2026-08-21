# Launch kit

Use these messages only after the latest GitHub Release has an installer asset and the README download link has been verified.

## Show HN title

```text
Show HN: DSH Desktop – A Windows desktop host for DeepSeek Harness
```

## Short English introduction

```text
I built DSH Desktop, an unofficial Windows desktop host around DeepSeek Harness.

It keeps Harness as the actual agent and Web UI, then adds native repository selection, persistent session entry points, Agent/tool status, official Plan entry, and guarded per-file or batch review for produced Git changes. The installer bundles pinned Node.js and Harness runtimes, so users do not need Node preinstalled.

V0.3.8 is an unsigned developer-preview build. I would especially value feedback on Windows compatibility, Plan approval clarity, multi-file review safety, and which persistent Diff capability should come next.
```

## 中文标题

```text
我把 DeepSeek Harness 做成了一个可安装的 Windows 桌面端
```

## 中文短介绍

```text
DSH Desktop 是一个围绕官方 DeepSeek Harness 构建的非官方 Windows 桌面宿主。它不重新实现 Agent，而是补齐本地仓库选择、会话入口、Agent/工具状态、Plan 入口和 Git 多文件变更审查流程。

V0.3.8 已打通真实的“打开仓库—Plan—官方确认—多文件修改—逐文件或批量接受/拒绝”闭环，安装包内置固定 Node 与 Harness，目标电脑不需要预装 Node。

当前仍是未签名的 developer preview，欢迎反馈 Windows 兼容性、Plan 确认体验、多文件审查安全性，以及最希望增加的常驻 Diff 面板能力。
```

## Demo sequence

Keep the screen recording between 20 and 35 seconds:

1. Open a repository with `Ctrl+O`.
2. Start or resume a Harness session.
3. Enter **Plan mode** and ask for a small change across three files.
4. Approve execution in the official Harness confirmation card.
5. Open the native **Changes** menu and show the three-file status summary.
6. Batch accept and stage the safe changes, then show `git status`.
7. End on the GitHub release download page.
