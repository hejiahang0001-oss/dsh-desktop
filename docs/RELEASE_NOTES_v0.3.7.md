# DSH Desktop V0.3.7

DSH Desktop V0.3.7 completes the first real repository-to-review loop for the Windows desktop host around DeepSeek Harness.

## Highlights

- Open a local Git repository from the native **Project** menu or with `Ctrl+O`.
- Synchronize the selected folder to the matching Harness Workspace and resume or create the correct session.
- Inspect Agent, tool-call, test, and produced-change state from native Windows menus.
- Accept the latest produced file into Git staging or reject it with protection for edits that existed before the Agent turn.
- Keep repositories, sessions, settings, and the software-managed Key available across in-place upgrades.
- Run with pinned Node.js `v24.19.0`, Electron `35.7.5`, and `@deepseek-ai/dsh@0.1.0-rc.8`.

## Download

Download `DSH-Desktop-Setup-0.3.7.exe` from the assets attached to this release.

```text
SHA-256: 005C4F7FA224E71E1BDC284053F0BF6C998A424792F1F89BD7F0EBE9F77892E6
Size:    158,432,047 bytes
```

## Important limits

- This is an unofficial community project and is not affiliated with or endorsed by DeepSeek.
- DeepSeek Harness is still a developer preview; this release pins rc.8 instead of tracking `latest`.
- The installer is not code-signed, so Windows SmartScreen may show a warning.
- Harness rc.8 may exit PowerShell Workspace Write with `0xC0000005` in restricted mode. The desktop reports this failure and does not enable Full Access automatically.
- The review loop currently targets the latest single-file change; multi-file batch review, checkpoints, and session rewind remain future work.

## 中文摘要

V0.3.7 首次打通“选择本地仓库 → 同步 Harness Workspace → 复用/创建会话 → Agent 修改 → 接受并暂存或拒绝变更”的真实闭环。安装包内置固定 Node 与 Harness，目标电脑不需要预装 Node。

当前安装包尚未代码签名；DeepSeek Harness 仍为 developer preview。本项目是独立社区项目，不代表 DeepSeek 官方。

Detailed validation evidence is available in [`docs/VALIDATION.md`](VALIDATION.md).
