# DSH Desktop V1.1.0

Independent background tasks and local scheduling. Promoted to **Stable / GitHub Latest release** with explicit maintainer approval on 2026-08-31. The previously tested binaries, release tag and SHA-256 values are unchanged; V1.0.5 is retained as the previous version.

## 中文快速开始

1. 打开有提交记录的 Git 项目，在底部点“任务”，进入“独立后台任务”。
2. 展开“新建任务”，填写任务名称和具体要求，选择手动、一次性、每天或固定间隔，设置每日次数上限。
3. 在原生确认框核对目录、时间与付费模型用量。每个任务有独立工作树，每次运行建立新会话；不会自动合并回原项目。
4. 遇到“待确认”或“需核对”，打开对应会话处理。结果不明时不会自动重复提交，完成状态也不等于产物质量已经验收。
5. 有启用计划时，关闭主窗口可留在托盘运行；完全退出后不执行。普通 Excel/Word/PDF 拖入不需要 Git，独立后台工作树需要 Git。

本版源码 403 项回归通过，最终安装版后台真实模型检查 22 项通过，并复查文档输入、审查、工作台、草稿、交接、插话和终端。2026-08-31 按维护者明确指令晋升为 **Stable**，替代 V0.5.4；沿用同一组已验证安装包，不重新打包或移动标签。仅保留 V1.1.0 和上一版 V1.0.5 的发布与安装产物。短时连续验收不是 24 小时老化；安装器仍未签名，自动安装没有放开。

## Downloads / 下载

- [Windows 安装版 / Setup](https://github.com/hejiahang0001-oss/dsh-desktop/releases/download/v1.1.0/DSH-Desktop-Setup-1.1.0.exe)
- [Windows 便携版 / Portable](https://github.com/hejiahang0001-oss/dsh-desktop/releases/download/v1.1.0/DSH-Desktop-Portable-1.1.0.exe)
- [SHA-256 校验清单](https://github.com/hejiahang0001-oss/dsh-desktop/releases/download/v1.1.0/SHA256SUMS-v1.1.0.txt)
- [上一版本 V1.0.5](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v1.0.5)（回退前备份数据；previous build, not a second Stable）

## Features and boundaries

- Open **Tasks and Subagents → Independent Background Tasks**. Create a named task with an explicit prompt, a manual/one-shot/daily/interval schedule, and a daily run cap. Code-review and read-only PR-status prompt examples are included; PR queries still require available tools/network/authentication.
- Each task owns a separate managed Git worktree, created from the current committed HEAD. Source uncommitted files and the software-managed Key are not copied. All files tracked in that commit follow normal Git checkout, including committed dependencies or mistakenly committed secrets; worktree isolation is not content sanitization. Keep credentials out of the repository. Repeated runs reuse that task's directory but create a new ordinary Harness conversation and request identity. Nothing is automatically fetched, rebased, pushed or merged.
- Native confirmation authorizes the prompt, exact local-time schedule and paid model use. Every new task session is explicitly pinned to Workspace Write + Ask and verified before admission. Background mode never auto-approves requests.
- Up to 12 task configurations, two simultaneous background runs, 300 current run records, and a configurable per-task daily cap of 1–96. Intervals are 15–1440 minutes. Same-task overlap and known live activity in the task directory block new work.
- Durable request records precede submission. Unknown receipts, failed state reconciliation, changed worktree identities and damaged primary state pause the affected schedules instead of replaying potentially completed work. Running, waiting-for-approval, completed, failed, stopping and review-needed states are distinct. Completion means the exact Harness turn ended, not that output quality was independently verified.
- Completion/failure/approval notifications open the corresponding conversation. Closing the main window retains active work or enabled plans in the tray. Full exit asks for confirmation and stops scheduling; there is no Windows service and nothing runs while the app is fully closed. Missed times coalesce to one run, not a backlog of every missed interval.
- Finished history can be archived without resetting daily caps. Releasing a paused task archives its configuration and keeps its conversation, branch and directory. Managed task worktrees cannot be reclaimed until released. Backups include task plans/history and drafts, but not worktree code or attachment originals.
- Preserves V1.0.2–V1.0.5 document intake, encrypted software-first Key storage, review comments, native docks, bounded confirmed terminal reads, draft continuity, queue/steer/stop feedback and protected session/worktree handoff.

## Acceptance and boundaries

Source, real-model, native UI, packaging, overwrite-install and anonymous download evidence is recorded in `PROGRESS.md` as each gate completes. Earlier failed probes are retained and are not counted as successful runs. Short continuous real runs are not a 24-hour or multi-day soak.

This is local single-user scheduling, not remote Codex dispatch, a cloud scheduler, a VM, or an automatic PR-merging service. Do not concurrently edit a task directory while it runs. Git is required for independent worktrees, but not for ordinary document intake. The installer remains unsigned and automatic installation remains blocked.

Known display limitations in these unchanged binaries: the no-update dialog still mentions the former V0.5.4 Stable baseline, and Windows EXE properties inherit Electron's runtime version. The application and installer registration report V1.1.0; GitHub's release metadata determines the current Stable. These labels will be corrected in a later tested iteration, not by silently replacing this release's files.

已知显示问题：本次保留的原包中，“已是当前产品 Latest”提示仍有旧 V0.5.4 Stable 文案；Windows EXE 文件属性仍显示 Electron 运行时版本。应用内及安装记录为 V1.1.0，实际 Stable 以 GitHub 发布状态为准。后续小版修正文案，不静默替换本版文件。
