# DSH Desktop V0.8.0

V0.8.0 adds a native Git delivery center for local repository status, staged-only commits, and public GitHub pull-request visibility. V0.5.4 remains Stable.

## Added

- A sandboxed, context-isolated Git delivery window shows the active repository, branch, HEAD, upstream, ahead/behind counts, staged, unstaged, untracked, conflict counts, and the latest eight commits.
- Local commit creation accepts a bounded single-line message and includes only content already present in the Git index. The window never runs `git add`, never pushes, and never accepts arbitrary Git arguments.
- Native confirmation defaults to cancel. The application re-reads the complete repository status fingerprint after confirmation and rejects a changed index or working state.
- Commit creation is unavailable while the Agent, pending/queued prompts, secure terminal, Side Chat, checkpoints, worktree operations, or verified backup are active.
- Supported GitHub origins can display up to five current-branch pull requests and bounded check/status results through the public API. Remote text is rendered with `textContent`; only cached opaque link identifiers can open validated GitHub pages.
- Missing Git, non-Git workspaces, private repositories requiring authentication, and unavailable GitHub status remain isolated to the delivery window. Chat, Office, Excel, and Wiki continue to work.

## Current limits

- V0.8.0 creates local commits only. Staging remains an explicit action in the existing change-review flow, and pushing stays outside the delivery center.
- GitHub status is unauthenticated and public-only. Private repository support would require a separately designed credential and permission boundary.
- The installer remains unsigned and automatic update remains disabled. V0.5.4 remains the formal GitHub Latest/Stable release.

## Validation before publication

- Four real temporary-repository tests cover staged-only commits, changed-state rejection, unsafe-message rejection, optional GitHub remote parsing, bounded checks, and opaque-link enforcement.
- Seven window, IPC, and command-palette tests pass. A real Electron render shows all six status cards and eight recent commits, with the commit button disabled when nothing is staged.
- The complete source suite passes 299/299, the production dependency audit reports no known vulnerabilities, and a live public GitHub status read succeeds. Package, overwrite-install, installed-app, data-preservation, PR/CI, release-asset, and anonymous-download gates remain required before publication.
