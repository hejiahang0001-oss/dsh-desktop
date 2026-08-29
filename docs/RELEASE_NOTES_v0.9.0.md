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
- V0.5.4 remains the formal GitHub Latest/Stable release; V0.9.0 is a product Latest candidate until all publication gates pass.

## Validation before publication

- Focused tray, notification, update, backup, and semantic-state checks pass 15/15; the complete source suite passes 309/309.
- A live public GitHub check identifies the existing V0.8.0 Pre-release without downloading it.
- Real Electron desktop, Harness, and native-tray smoke checks pass 3/3, and Windows reports native notification support.
- Final package, installer overwrite, portable execution, semantic-data preservation, PR/CI, release-asset, and anonymous-download gates remain required before publication.
