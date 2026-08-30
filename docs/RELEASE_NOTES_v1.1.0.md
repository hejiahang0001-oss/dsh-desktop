# DSH Desktop V1.1.0

Independent background tasks and local scheduling. Product Latest / GitHub Pre-release; Stable V0.5.4 is unchanged.

- Open **Tasks and Subagents → Independent Background Tasks**. Create a named task with an explicit prompt, a manual/one-shot/daily/interval schedule, and a daily run cap. Code-review and read-only PR-status prompt examples are included; PR queries still require available tools/network/authentication.
- Each task owns a separate managed Git worktree, created from the current committed HEAD. Uncommitted source files, dependencies and credential files are not copied. Repeated runs reuse that task's directory but create a new ordinary Harness conversation and request identity. Nothing is automatically fetched, rebased, pushed or merged.
- Native confirmation authorizes the prompt, exact local-time schedule and paid model use. Every new task session is explicitly pinned to Workspace Write + Ask and verified before admission. Background mode never auto-approves requests.
- Up to 12 task configurations, two simultaneous background runs, 300 current run records, and a configurable per-task daily cap of 1–96. Intervals are 15–1440 minutes. Same-task overlap and known live activity in the task directory block new work.
- Durable request records precede submission. Unknown receipts, failed state reconciliation, changed worktree identities and damaged primary state pause the affected schedules instead of replaying potentially completed work. Running, waiting-for-approval, completed, failed, stopping and review-needed states are distinct. Completion means the exact Harness turn ended, not that output quality was independently verified.
- Completion/failure/approval notifications open the corresponding conversation. Closing the main window retains active work or enabled plans in the tray. Full exit asks for confirmation and stops scheduling; there is no Windows service and nothing runs while the app is fully closed. Missed times coalesce to one run, not a backlog of every missed interval.
- Finished history can be archived without resetting daily caps. Releasing a paused task archives its configuration and keeps its conversation, branch and directory. Managed task worktrees cannot be reclaimed until released. Backups include task plans/history and drafts, but not worktree code or attachment originals.
- Preserves V1.0.2–V1.0.5 document intake, encrypted software-first Key storage, review comments, native docks, bounded confirmed terminal reads, draft continuity, queue/steer/stop feedback and protected session/worktree handoff.

## Acceptance and boundaries

Source, real-model, native UI, packaging, overwrite-install and anonymous download evidence is recorded in `PROGRESS.md` as each gate completes. Earlier failed probes are retained and are not counted as successful runs. Short continuous real runs are not a 24-hour or multi-day soak.

This is local single-user scheduling, not remote Codex dispatch, a cloud scheduler, a VM, or an automatic PR-merging service. Do not concurrently edit a task directory while it runs. Git is required for independent worktrees, but not for ordinary document intake. The installer remains unsigned and automatic installation remains blocked.
