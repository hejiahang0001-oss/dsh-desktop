# DSH Desktop V0.6.5

V0.6.5 adds selected DSH conversation-history ingestion to the local Wiki while keeping V0.5.4 as Stable. DeepSeek Harness remains pinned to `0.1.1-rc.2`, Electron to `43.4.1`, Node.js to `24.19.0`, and bundled pnpm to `11.19.0`.

## Added

- The native Wiki center lists up to 32 ordinary, nonblank sessions from the active workspace and lets the user select up to eight completed sessions per import.
- A sixth bundled Wiki capability, `/wiki-history-ingest dsh`, previews, reads, validates, and incrementally saves selected history through the fixed offline Wiki tool.
- The Wiki manifest tracks opaque source fingerprints and page mappings so repeated imports do not duplicate knowledge and changed sessions can be merged into existing tracked pages.

## Safety and integrity

- Renderer-visible selection ids are random opaque values. Raw Harness session ids, source tokens, history file paths, and message text never cross the narrow Wiki-center IPC surface.
- The desktop reads the pinned Harness `session.list` and paginated `session.history` interfaces. Subagents, running/blank/other-workspace sessions, system/developer instructions, tools, thinking, images, and non-text blocks are excluded.
- Private-key blocks, DeepSeek-style API keys, bearer tokens, and credential assignments are redacted before the Agent can read the short-lived source. Historical content is treated as untrusted source data rather than instructions.
- The source is stored only in the desktop user-data directory, expires after 30 minutes, is invalidated when sessions are reloaded or the workspace changes, and is cleared after save.
- Validation and save remain separate user turns. Source redactions or remaining page findings require a second explicit sensitive-content confirmation.
- Existing tracked pages require fresh SHA-256 values; untracked human pages are never overwritten. Writes are serialized, archived, verified, and rolled back on failure.

## Current limits

- V0.6.5 ingests only explicitly selected DSH sessions from the active workspace. It does not crawl all local history, copy raw conversations, ingest subagent transcripts, fetch the web, install QMD, or control Obsidian UI.
- Stable remains V0.5.4. V0.6.5 becomes product Latest only after source, package, overwrite-install, installed-runtime, real-model, data-retention, CI, and public-asset gates pass.

## Validation

- Core and integration tests cover opaque/stale selection, numeric and ISO timestamps, pagination, content filtering, redaction, size bounds, expiry, deduplication, sensitive confirmation, stale-page rejection, artificial-page protection, concurrent writers, rollback, Windows unsafe paths, narrow IPC, packaged-skill governance, and fixed runtime propagation.
- The full source suite passes 289/289 and the production dependency audit reports no known vulnerability. Source, unpacked, and installed Wiki/Harness checks discover all five user-facing Wiki Skills as model-invocable.
- Live DeepSeek two-turn acceptance runs in source, packaged, and final installed modes complete fixed preview/session-read/validation, make no Wiki write before confirmation, then use both history and sensitive confirmations to save one tracked page. The test secret is redacted before Agent access and the short-lived source is removed after save.
- Unpacked and installed eleven-part GUI matrices, the installed fixed-terminal smoke, and data-retention checks pass. All 28 credential-free semantic files, including 15 sessions, remain byte-identical before overwrite, after overwrite, and after installed regression.
- The 184,089,462-byte installer hashes to `5B89D3B43F15E46D2EA38B6FBFDDDBE99FE7D66EA90B29BAEBB74E82D806382E`. Exact package, overwrite-install, and local-runtime evidence is recorded in `docs/VALIDATION.md`; remote CI and public-download evidence is added after publication.
