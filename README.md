# DSH Desktop

<p align="center">
  <img src="docs/assets/social-preview.png" alt="DSH Desktop — DeepSeek Harness on Windows" width="100%">
</p>

<p align="center">
  <strong>An unofficial Windows desktop host for DeepSeek Harness.</strong><br>
  Open local repositories, keep sessions, control the running agent, and review changes without rebuilding the official agent loop.
</p>

<p align="center">
  <a href="https://github.com/hejiahang0001-oss/dsh-desktop/releases/latest/download/DSH-Desktop-Setup-0.4.0.exe"><strong>Download for Windows</strong></a>
  · <a href="#quick-start">Quick start</a>
  · <a href="#中文说明">中文说明</a>
  · <a href="DSH_DESKTOP_ITERATION_PLAN.md">Roadmap</a>
</p>

<p align="center">
  <a href="https://github.com/hejiahang0001-oss/dsh-desktop/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/hejiahang0001-oss/dsh-desktop?display_name=tag&sort=semver"></a>
  <a href="https://github.com/hejiahang0001-oss/dsh-desktop/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/hejiahang0001-oss/dsh-desktop/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/github/license/hejiahang0001-oss/dsh-desktop"></a>
  <img alt="Windows x64" src="https://img.shields.io/badge/platform-Windows%20x64-0078D4">
</p>

> [!IMPORTANT]
> DSH Desktop is an independent community project. It is not affiliated with, endorsed by, or maintained by DeepSeek. DeepSeek Harness remains a developer preview; this release pins `@deepseek-ai/dsh@0.1.0-rc.8`.

## Why DSH Desktop

DeepSeek Harness already provides the agent and Web UI. DSH Desktop adds the Windows product shell around it:

- **Native workspace flow** — open a local Git repository with `Ctrl+O`, remember recent repositories, and bind the matching Harness workspace and session.
- **Persistent sessions** — create, search, resume, rename, archive, and branch sessions while keeping Harness as the source of truth.
- **Agent visibility and control** — see whether the agent is idle, running, waiting for approval, or unavailable; stop or redirect a running turn from native menus.
- **Persistent Git review panel** — keep a bounded real Diff beside Harness, resize or hide the panel, and accept or reject one file or a safe batch while protecting pre-existing edits.
- **Packaged runtime** — the installer includes pinned Node.js and Harness runtimes; users do not need to install Node.js first.
- **Constrained desktop shell** — loopback-only service, random port, renderer sandbox, context isolation, no Node integration, and restricted navigation.

<p align="center">
  <img src="docs/assets/app-screenshot.png" alt="DSH Desktop running DeepSeek Harness on Windows" width="100%">
</p>

## Quick start

1. Download [`DSH-Desktop-Setup-0.4.0.exe`](https://github.com/hejiahang0001-oss/dsh-desktop/releases/latest/download/DSH-Desktop-Setup-0.4.0.exe).
2. Install and launch DSH Desktop. The current installer is not code-signed, so Windows SmartScreen may show a warning.
3. Open **Project → Open code repository…** or press `Ctrl+O`.
4. Open **Model** to configure your DeepSeek API key, then start a Harness session.

The application stores profiles, sessions, settings, logs, and repository state under `%APPDATA%\DSH Desktop`; upgrades do not remove this data.

## Current release

**V0.4.0** begins the persistent desktop workbench while preserving the official Harness workflow:

```text
Open repository → run or approve the agent in Harness
→ inspect bounded real Git Diff in the persistent right panel
→ accept/stage or reject one file or a safe batch
```

The release has 56 automated tests plus packaged-runtime, unpacked-app, installed-app, persistence, reload, protected-baseline, real Diff, and staged accept evidence. See [validation details](docs/VALIDATION.md) and the [V0.4.0 release notes](docs/RELEASE_NOTES_v0.4.0.md).

## Security and current limits

- The Windows installer is not code-signed yet.
- Harness credentials are currently stored by Harness rc.8 in `.credentials.yaml` under the user data directory and rely on Windows user-directory ACLs; Credential Manager/DPAPI integration is not complete.
- A known rc.8 Workspace Write compatibility issue may cause PowerShell to exit with `0xC0000005` in restricted mode. DSH Desktop reports the failure and never switches to Full Access automatically.
- V0.4.0 provides the first persistent workbench slice: a right-side Git Diff panel. File tree, integrated terminal, checkpoints, and session rewind are not included yet.

Read [SECURITY.md](SECURITY.md) before reporting a vulnerability. Architecture and product boundaries are documented in [the iteration plan](DSH_DESKTOP_ITERATION_PLAN.md).

## Development

Requirements: Windows x64, Node.js `v24.19.0`, and pnpm.

```powershell
pnpm install --prod=false
pnpm electron:fetch
pnpm runtime:fetch
pnpm runtime:deploy
pnpm test
pnpm start
```

Build the unpacked application or NSIS installer with:

```powershell
pnpm pack:win
pnpm dist:win
```

`electron:fetch` and `runtime:fetch` accept only pinned official archives with pinned SHA-256 values. `runtime:deploy` builds a fixed, link-free production closure from the lockfile.

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), an issue labelled `good first issue`, or a question in GitHub Discussions.

## 中文说明

DSH Desktop 是一个面向 Windows 的 **DeepSeek Harness 非官方社区桌面宿主**。它不重新实现 Agent，而是在官方 Harness Web UI 外增加 Windows 原生项目、会话、模型、Agent、工具和变更菜单。

V0.4.0 已打通以下真实流程：

- 选择本地代码仓库并同步到同路径 Harness Workspace；
- 复用或创建该工作区的会话；
- 从桌面菜单进入官方 Plan 模式，定位 Harness 的执行确认，并在批准后执行；
- 查看 Agent、工具调用和测试状态；
- 在常驻右侧面板查看真实 Git Diff，逐文件或批量接受并加入 Git 暂存区，或安全拒绝修改；
- 调整、关闭和恢复审查面板，布局宽度在页面重载和应用重启后保留；
- 在覆盖升级后保留工作区、会话和软件 Key 状态。

首次使用请从 [GitHub Releases](https://github.com/hejiahang0001-oss/dsh-desktop/releases) 下载 Windows 安装包。当前版本尚未代码签名，SmartScreen 可能提示风险；DeepSeek Harness 仍处于 developer preview。

## License

DSH Desktop is licensed under the [MIT License](LICENSE). DeepSeek Harness, Electron, Node.js, and other third-party components remain subject to their own licenses and notices.
