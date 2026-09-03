# DSH Desktop V1.1.7

V1.1.7 is a local Latest candidate focused on predictable Windows startup, safe exit and truthful product identity. It retains the fixed DeepSeek Harness `0.1.2-rc.1` runtime from V1.1.6 and does not change the Stable channel.

## Changes

- Enforce one formal desktop instance. A repeated launch restores and focuses the existing window, while explicitly isolated validation profiles remain independent.
- Add a durable lifecycle journal that distinguishes starting, running, quitting, failed shutdown and clean exit without storing workspace paths, session content or credentials.
- Close auxiliary windows first, block new mutations after shutdown begins, wait for in-flight Harness, preview, document, review, Wiki, worktree, plugin, checkpoint and delivery operations, then stop the terminal, managed preview and Harness process trees.
- Keep shutdown fail-closed. If a tracked operation or owned resource cannot settle, the desktop reopens instead of reporting a clean exit; an abnormal previous run is explained cautiously on the next launch.
- Require an explicit second confirmation before a full exit interrupts a running or approval-waiting foreground Agent. Already-written files are not described as automatically rolled back.
- Add desktop-parent watchdogs and Windows process-tree cleanup for Harness and the PTY host, including broken output pipes, concurrent stop requests and startup/stop races.
- Keep managed preview ownership after a close timeout so a later shutdown can retry instead of losing track of the loopback server.
- Write DSH Desktop identity and V1.1.7 into Windows executable resources. Product, Harness and Electron/Node versions remain distinct in diagnostics.
- Bind package acceptance to the complete `app.asar` source-file set, every declared `extraResources` target tree and the strictly validated build-generated update metadata and elevation helper. Harness, terminal, bundled Node, Office, Wiki, pnpm, desktop plugins and legal payloads remain content-bound.
- Add two packaged lifecycle checks: repeated-launch focus/single-instance behavior and a normal safe-exit path with real Harness, PTY and managed-preview resources.

## Validation status

The final source suite passes 469/469. Package evidence matches 130/130 application files and 24,358/24,358 resources, with fingerprint `17066a48e1ec762d55bf10b0c7c6fbc22d4f6141e79f19da4316a5af7ae61297`. Packaged repeated-launch focus passes. A separate safe-exit run starts real Harness, PowerShell PTY and managed preview resources, then exits with Windows Job `activeProcesses=0`, no owned-process or port residue, clean primary/backup lifecycle journals and an unchanged before/after package fingerprint.

Setup is 188,644,117 bytes with SHA-256 `6A605453561FD4A66A1DD809783E2A6826CF36E34F2A3E83894494DF58371074`; Portable is 187,951,593 bytes with SHA-256 `D9FF042E2480ACF229DAF347C280D9434A6DBEA705ADDEA11DF3DE1D6BE0B5B2`; the blockmap is 195,076 bytes with SHA-256 `152BD66C59518CAB6BDEBA03480517E9168A96BE82E949A5861401C0592918EC`. The three-entry checksum manifest passes 3/3. Release governance reports `packageReady=true` and zero reparse points.

This candidate remains unsigned. PE structure, VersionInfo and package-tree hashes establish this candidate's identity and content consistency; they are not Authenticode Publisher trust or an independent certification of the Electron distribution supply chain.

## Release policy

- V1.1.0 Stable is unchanged.
- Public V1.1.1 remains the current Pre-release until a newer candidate is explicitly published.
- V1.1.7 is not installed and is not a GitHub release. Overwrite installation and publication require their normal explicit gates.
- The installer remains unsigned, so automatic installation remains disabled.

See the [execution evidence](../PROGRESS.md), [validation record](VALIDATION.md) and [iteration plan](../DSH_DESKTOP_ITERATION_PLAN.md).
