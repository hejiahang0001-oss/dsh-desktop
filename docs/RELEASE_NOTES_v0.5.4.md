# DSH Desktop V0.5.4

V0.5.4 links new code checkpoints to completed DeepSeek Harness turns while keeping official Harness `0.1.1-rc.2` pinned.

## Added

- Capture the currently selected ordinary Harness session and latest completed-turn boundary when creating a code checkpoint.
- Show whether each of the latest twelve checkpoints is conversation-linked and whether it can create a session branch.
- Offer two explicit actions: **Restore code only** and **Create session branch**.
- Create child sessions through the official `session.fork(sessionId, atSeq)` API, verify their source lineage and workspace, then switch the Harness page to the new child.

## Safety boundaries

- Session ids and turn sequence values remain in private Git checkpoint metadata and never enter the renderer summary.
- Creating a session branch does not restore code, change the Git index, move HEAD, or modify the source conversation.
- Code restore remains a separate native-confirmed action with a safety checkpoint and Recycle Bin handling.
- Old checkpoints, subagent sessions, mismatched workspaces, running sessions, blank sessions without a completed turn, invalid refs, and unverified fork responses fail closed for conversation branching.
- Conversation-link capture is fail-soft: a temporary Harness API failure never blocks the code checkpoint or the user's prompt.

## Boundary

- V0.5.4 creates a child conversation from a completed turn; it does not rewrite or truncate a source session in place.
- Checkpoint deletion, remote synchronization, cross-repository branching, and arbitrary session or sequence input are not included.

## Validation

- 114/114 bundled-runtime tests pass.
- A real persisted completed turn produced one verified same-workspace ordinary child session through the official fork API. HEAD, worktree, real Git index, and the source conversation remained unchanged.
- The final installed application no longer creates a checkpoint from Harness page autofocus; eight existing checkpoint refs remained byte-identical through startup.
- Unpacked and installed desktop/Harness smoke checks pass with V0.5.4, `zh-CN`, safe storage, random-loopback HTTP 200, title `DeepSeek Harness`, and Workspace synchronization.
- V0.5.4 installed directly over V0.5.3 with exit code 0. Fourteen sessions, the software-managed Key, desktop/workbench/network state, Harness settings, and eight checkpoint refs retained identical hashes.
- The installer is 162,583,718 bytes with SHA-256 `C07CF56B0D809F5D84655AD8513D02FCB77684A98D31420FB99036BD2CFD41F3`.

## Download

- Installer: `DSH-Desktop-Setup-0.5.4.exe`
- Latest release: <https://github.com/hejiahang0001-oss/dsh-desktop/releases/latest>
