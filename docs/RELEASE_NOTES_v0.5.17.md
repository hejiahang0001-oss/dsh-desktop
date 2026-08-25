# DSH Desktop V0.5.17

V0.5.17 adds a bounded Tasks/Subagents surface over the official DeepSeek Harness task domains. Stable remains V0.5.4; DeepSeek Harness remains pinned to `0.1.1-rc.2`, Electron to `43.4.1`, Node.js to `24.19.0`, and bundled pnpm to `11.19.0`.

## Harness-native task visibility

- A local-only window shows the selected task, its root task, official subagent descendants, current-session background jobs, pending approvals, and live counts.
- The tree comes only from `subagent.list`, is bounded to 32 entries and five levels, and excludes ordinary session forks. Healthy continuable and one-shot children retain their upstream modes; corrupt, unsupported, or unavailable rows remain disabled diagnostics.
- Persisted Harness working directories are compared with the active DSH workspace. Current-worktree, other-directory, and unrecorded states are visible, and multiple running sessions sharing one directory produce a warning without moving live work.
- Background jobs remain a read-only view of the official Web `jobsBySession` mirror. DSH does not create another registry or add an unsupported human kill action.

## Controlled child actions

- Opening a child uses its exact catalog-derived parent, child, and mode address, preserving Harness subagent transport instead of activating it as an ordinary session.
- A continuable child accepts one bounded text follow-up only while its direct parent is available. The address is revalidated immediately before `subagent.prompt`; success means only that the message entered the FIFO inbox.
- A running continuable child exposes a native default-cancel interrupt confirmation. The address and running state are revalidated before `subagent.interrupt`; an already-ended child fails closed. `accepted: true` means the signal was admitted, not that the child is already quiescent. Queued follow-ups are not deleted.

## Security boundaries

- The renderer is a sandboxed, context-isolated local file with no Node integration, navigation, remote connection, transcript body, session id, path, API method, or arbitrary command surface.
- Its six-method bridge accepts only opaque 24-hex ids plus one 1–8000-character human follow-up. Every action maps the id back to a process-local address and re-lists the exact parent before mutation.
- Background labels are bounded and redact credential assignments, bearer values, and `sk-*` shapes before renderer delivery.

## Validation status

- The source suite passes 190/190 and the focused task/UI suite passes 7/7, including the post-confirmation running-state race.
- Production dependency audit reports no known vulnerabilities. The final unpacked and installed nine-part smoke matrix covers desktop metadata, Harness startup, IPC boundaries, PDF, context sources, extension health, worktrees, Tasks/Subagents, and a real PTY.
- The final unpacked and installed Electron 43 task windows render three subagents, two background jobs, one visible prompt editor and Send action, one interrupt action, working-directory sharing, and credential redaction. Both 1539×1085 screenshots were visually inspected.
- The 183,991,125-byte installer has SHA-256 `F9A6478C2A99CC99644F21A5A704EE493500FDF0B81BC6F2FB54C6DA30EB22CD`; its 188,963-byte blockmap has SHA-256 `3BF702905D416C251AA6C4DA697C23D9DEB61049B293D8E5F330CB7D556C95BA`. V0.5.16→V0.5.17 reuses 99.4407% of installer bytes.
- Overwrite installation registers V0.5.17 and preserves all 27 selected semantic files, including 14 sessions and two Profile files, before and after the installed smoke. The installed tree equals the unpacked 29,787-file tree plus the normal uninstaller, with no reparse point.
- PR #26 and the merge commit pass all three CI jobs. The non-draft GitHub Pre-release targets `23e955aeae79ce89b8579e1b9e2475b245827d6d`; all three remote assets match local sizes and SHA-256 digests, and the installer public download returns HTTP 200 with 183,991,125 bytes.
- V0.5.4 remains Stable and GitHub's formal Latest release.

## Deferred to V0.5.18

- Side Chat and multi-session side-by-side viewing remain V0.5.18 work. V0.5.17 changes task visibility and controlled child routing only; it does not introduce a second conversation runtime.
