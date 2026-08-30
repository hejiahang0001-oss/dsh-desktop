# DSH Desktop V0.9.0

V0.9.0 adds native background supervision, privacy-safe task notifications, manual product-Latest checks, and a portable Windows build. V0.5.4 remains Stable.

## Added

- A native tray shows a fixed Agent state and provides bounded actions to open DSH Desktop, locate a pending approval, stop the current generation, manually check for a product Latest, or explicitly quit.
- Closing the main window while an Agent is running or waiting hides it to the tray. Explicit quit still waits for protected operations and stops owned runtimes in the existing shutdown order.
- Fixed notifications cover waiting for approval, completion, failure, stop, and Harness disconnection. They contain no conversation text, command text, repository path, or remote markup.
- Manual update checking reads only the fixed public GitHub Releases API with response, count, timeout, version, and URL limits. A user can open the validated release page, skip one exact version, or cancel that skip.
- The skip preference is atomically persisted and included in semantic-data snapshots and verified backups.
- The Windows build now produces both the assisted per-user installer and a distinct user-level portable executable.

## Safety boundaries

- Update checking never downloads, installs, or executes release content. Automatic update remains disabled while signing trust, the expected publisher, and separate Stable/Pre-release feeds are unavailable.
- Tray labels and notifications are fixed local strings. They never carry raw Agent output or workspace data.
- V0.5.4 remains the formal GitHub Latest/Stable release; V0.9.0 is published only on the product Latest/Pre-release channel.

## Validation

- Focused tray, notification, update, backup, and semantic-state checks pass; the complete source suite passes 310/310 and the production dependency audit reports no known vulnerability.
- A live public GitHub check identifies the existing V0.8.0 Pre-release without downloading it.
- Real Electron desktop, Harness, and native-tray smoke checks pass 3/3, and Windows reports native notification support.
- The unpacked and installed applications pass all 14 GUI smoke classes, packaged terminal isolation, and no-Git Chinese/space-path Wiki basics. A real installed DeepSeek history-ingest run completes preview, validation, separate confirmation, save, redaction, and temporary-source cleanup.
- The portable executable independently passes desktop, real Harness HTTP/workspace synchronization, and native tray/notification checks. Its first launch on the validation host takes roughly four minutes because it extracts the complete runtime; the installer remains the recommended download.
- Silent overwrite registers V0.9.0. All 28 pre-existing semantic files remain byte-identical before overwrite, after overwrite, and after installed regression. A separate isolated startup verifies the new bounded `update-state.json` migration.
- The 184,115,025-byte installer hashes to `37A7308C1FFBA9F893178403CE113CA08AC34B1A943496501638D9A3CE502D4D`; the 188,978-byte blockmap hashes to `D5300126D5993332CCACF290ADB63C0E7F179D3262FCFE899BA9C0B90EA69535`; the 183,423,525-byte portable executable hashes to `7C9026C312F2F0FCE67498FF5B9FAB81950CEBFE53AA004F1FDB836029DA0649`.
- Release governance reports `packageReady: true`, zero reparse points, complete pinned pnpm/Office/Wiki payloads, and 99.4939% V0.8.0-to-V0.9.0 differential reuse. Signing and automatic update remain intentionally unavailable.
- The public release is non-draft, marked Pre-release, and targets exact merge `04f0277808a849a1f79ec1e215cde6ec83bcbcf2`. GitHub digests and clean unauthenticated downloads reproduce all four asset hashes and all three checksum entries. V0.5.4 remains formal GitHub Latest/Stable.
