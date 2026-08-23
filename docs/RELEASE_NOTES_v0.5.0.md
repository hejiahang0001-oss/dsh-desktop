# DSH Desktop V0.5.0

V0.5.0 adds automatic, local Git code checkpoints before a Harness Agent turn while keeping official DeepSeek Harness `0.1.1-rc.2` pinned.

## Added

- Start a checkpoint when the verified Harness prompt composer receives focus or input; if creation is still running, a recognized send action waits for completion before it is replayed.
- Re-arm automatic creation after the Agent returns from a busy turn, so the next prompt receives a fresh baseline only when code or index state changed.
- Create a checkpoint manually with `Ctrl+Alt+B`, the View menu, or the fixed `Ctrl+Shift+P` command palette.
- Show a bounded local toast and menu status without exposing repository paths, file content, or credential values.

## Git safety

- Build the working-tree snapshot through a temporary Git index, `write-tree`, and `commit-tree`; the current branch, HEAD, working tree, and real Git index are not changed.
- Retain checkpoints under `refs/dsh/checkpoints/items/*` with a `refs/dsh/checkpoints/latest` pointer; repeated identical worktree/index state is deduplicated.
- Record the original index tree for the later restore slice.
- Exclude credential-like paths such as `.env`, `.credentials*`, private keys, package credentials, and secret files from checkpoint trees. Only the excluded count reaches the UI.
- Require the selected workspace to be the Git repository root in this first version; nested workspaces fail closed rather than snapshotting files outside the selected scope.

## Boundary

- V0.5.0 creates and reports checkpoints but does not restore them. Explicitly confirmed recovery is delivered separately in V0.5.1.

## Verified

- 97 automated checks pass, including a real temporary Git repository with tracked edits, a new file, sensitive-path exclusion, exact status/index preservation, and deduplication.
- Focusing the real packaged Harness composer created one automatic private ref containing the current uncommitted code while the repository status and real index hashes remained unchanged.
- Repeating the action through `Ctrl+Alt+B` kept the ref count at one and showed the unchanged-state toast.
- V0.5.0 directly upgraded V0.4.8 while preserving thirteen sessions, credential/state hashes, and the real project checkpoint ref; the installed Harness runtime returned HTTP 200.

## Download

- Installer: `DSH-Desktop-Setup-0.5.0.exe`
- Latest release: <https://github.com/hejiahang0001-oss/dsh-desktop/releases/latest>
