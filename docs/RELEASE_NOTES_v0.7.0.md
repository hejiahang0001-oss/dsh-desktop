# DSH Desktop V0.7.0

V0.7.0 starts the controlled-pilot phase with redacted support diagnostics and verified local backups that exclude DSH credential files and proxy settings. V0.5.4 remains Stable.

## Added

- Help-menu and command-palette actions export a bounded JSON diagnostic report, create a DSH data backup, and validate an existing backup.
- Diagnostic reports include only product/runtime versions, status/count summaries, and privacy flags. API keys, proxy values, complete workspace paths, session content, and log content are not included.
- Backups copy only bounded session data, workspace/Wiki settings, supported plugin-profile manifests, and semantic Local Storage files. DSH credential files, proxy settings, caches, logs, dependencies, runtimes, and transient LevelDB logs are excluded.
- Backup creation requires native confirmation, refuses active Agent/terminal/Side Chat work, briefly stops Harness, flushes desktop storage, copies into a new versioned directory, verifies every file by size and SHA-256, and restarts Harness.
- Backup validation accepts only the fixed semantic path allowlist and rejects missing, modified, oversized, linked, credential-like, traversal, alternate-stream, reserved-name, case-colliding, or unlisted entries. It never executes content from the selected backup.
- Concurrent backup requests are serialized, Agent state is checked twice, and application shutdown waits for an active backup to settle before stopping the restarted runtime.

## Current limits

- V0.7.0 creates and validates backups; guided restore is scheduled separately so recovery can be implemented as a restart-time transaction rather than overwriting live application data.
- Session content is backed up byte-for-byte and is not redacted; a backup may contain sensitive text previously entered by the user and should be stored accordingly.
- The report intentionally does not attach raw logs. Users may still open the existing local runtime log and decide separately whether to share excerpts.
- The installer remains unsigned and automatic update remains disabled. V0.5.4 remains the formal GitHub Latest/Stable release.

## Local validation before publication

- The full source suite passes 293/293, the focused support/IPC/release suite passes 9/9, and the production audit reports no known vulnerability.
- Final unpacked and installed twelve-part GUI matrices, fixed terminal, Wiki basic, and installed real DeepSeek history-ingest acceptance pass. The environment-only GPU screenshot failure passes unchanged with software rendering.
- Silent overwrite registers V0.7.0. All 28 semantic user-data files remain byte-identical, and installed/unpacked app.asar hashes match.
- The final installer is 184,095,531 bytes with SHA-256 `EC39183251FD08E7BCE58076332A018F3CE2D7BED2B851D97ACF9323A4D2EE69`; the blockmap SHA-256 is `4882850E78906564738D263A50164437D8F49102BB8FD1ADD5A2C3510B71083C`; the checksum manifest passes 2/2.
- Exact evidence is recorded in `docs/VALIDATION.md`. PR/CI and public-release gates remain pending until publication.
