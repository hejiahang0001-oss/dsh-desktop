# DSH Desktop V0.5.18

V0.5.18 adds Side Chat as a second, isolated official DeepSeek Harness session surface. Stable remains V0.5.4; DeepSeek Harness remains pinned to `0.1.1-rc.2`, Electron to `43.4.1`, Node.js to `24.19.0`, and bundled pnpm to `11.19.0`.

## Harness-native Side Chat

- `Ctrl+Shift+S`, the Agent menu, or the fixed command palette opens one Side Chat window from the selected completed ordinary session.
- A nonblank source uses official `session.fork`; a blank source creates a fresh session in the same official Workspace. DSH does not add another Agent loop, transcript store, or message protocol.
- The controller refuses a running session, pending approval, queued message, selected subagent, missing session, or working-directory mismatch before it creates the side session.
- The side session is renamed through `session.rename`, retains its official parent lineage when forked, and remains in Harness history after the window closes for auditability.

## Isolation and permission boundary

- The side window uses a unique non-persistent Electron partition. Its Harness `localStorage`, cookies, cache, and session selection are separate from the main window and are cleared when the window closes.
- The main session id, working directory, Plan projection, permission projection, running state, pending state, and queue state are checked before and after side-session creation. A race fails closed.
- DSH submits the official `/permission workspace-write` command and waits for the durable Harness permission projection. The command receipt may be asynchronous; only the projection is treated as final confirmation.
- The side renderer receives no DSH IPC bridge, Node integration, webview, popup, download, or external navigation. Only sanitized clipboard writes from its exact Harness main frame can be requested.
- The banner states the effective `Workspace Write / Ask` boundary and recommends an isolated worktree for code changes. On sufficiently wide displays, the windows tile side by side and the original main-window layout is restored on close.

## Validation status

- The focused controller and UI suite passes 6/6 and the complete source suite passes 196/196. A real pinned-Harness smoke creates an independent fresh Side Chat, applies `workspace-write`, and confirms the official durable projection.
- A real Electron 43 smoke proves different main/side selections in separate partitions, no desktop API in the side renderer, hidden duplicate Harness navigation, and a visible fixed permission banner.
- Every release-smoke invocation now redirects Electron `userData` to a target-specific isolated directory before app readiness. This prevents Chromium's transient media-device salt and cache metadata from touching the maintainer's real profile during validation.
- The final source suite passes 196/196 and the production dependency audit reports no known vulnerability. The final unpacked and installed ten-part smoke matrix covers desktop metadata, real pinned Harness, IPC, PDF, context sources, extension health, worktrees, Tasks/Subagents, Side Chat, and a real PTY.
- The final unpacked tree contains 29,787 files and 692,604,565 bytes. The installed tree contains every unpacked file with equal length and adds only the normal uninstaller; both trees have zero reparse points. Packaged and installed `app.asar` SHA-256 are `6BAB9C0A346AEBCAD50259F697481895FF73D001E06C4E8B5E1CF1BBE773AF3D`.
- `DSH-Desktop-Setup-0.5.18.exe` is 183,995,185 bytes with SHA-256 `605DF28C7149D8AF535CACA9BDD6817C2163BE51270686E255B53EBB0876F33D`. Its 188,939-byte blockmap has SHA-256 `989D0A696A26264BF9EEF93573F492DDFFAF3C1E317FB702D963A03C62012EA6`; the 199-byte checksum manifest has SHA-256 `0ACAB1E7B5B9E41DCDEA70955B832FDD54D1C6FF1FCABBC16AD23915D2212D2A`.
- V0.5.17 to V0.5.18 reuses 183,106,241 of 183,995,185 installer bytes (99.5169%), leaving an estimated 888,944-byte differential. The installer remains unsigned, so automatic update remains disabled.
- Silent overwrite exits with code 0 and registers V0.5.18. The final rollback snapshot `backups/pre-v0.5.18-final-20260825-201721` copies 27 credential-free semantic files with zero hash mismatch or reparse point and retains the V0.5.17 release assets. Its manifest SHA-256 remains exactly `D4DC1C46139CE2237846FFE28AA40D4F13E915CF11CD8AB7E6EA73F30C61F35D` before overwrite, after overwrite, and after installed smoke.
- Implementation PR [#28](https://github.com/hejiahang0001-oss/dsh-desktop/pull/28) passed all three CI jobs and merged as `aca28b52719ee221912a6d90075c6c87733cf67b`. Main CI run [32848268778](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32848268778) also passed all three jobs.
- [V0.5.18](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.18) is a non-draft GitHub Pre-release targeting that exact merge commit. All three remote sizes and GitHub digests match local evidence; the public installer returns HTTP 200, and a clean re-download of every asset reproduces all three SHA-256 values and passes both checksum-manifest entries. Stable remains V0.5.4 and the formal GitHub Latest release.

## Deferred to V0.5.19

- The unified Skills, Plugins, Hooks, and MCP extension center remains V0.5.19 work. V0.5.18 adds a second official session surface only; it does not silently enable extensions or share a writable browser profile with the main session.
