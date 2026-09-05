# DSH Desktop V1.1.4

V1.1.4 is a local Latest candidate that keeps the official Harness `0.1.2-alpha.5` runtime from V1.1.3 and removes the desktop's duplicate queue/interruption implementation.

## Changes

- Use the official Harness queue, queued-message up-arrow, `Ctrl+Enter` steer and Stop paths without renderer interception.
- Remove the duplicate workflow bar, custom interrupt IPC, WebSocket queue reader and private `resume-queue` host operation.
- Keep Office document drag/drop, document-reference continuity, encrypted software-first Key, proxy settings, review/dock/Office/Wiki surfaces, isolated background schedules and protected session/worktree handoff because they are not exact official replacements.
- Replace custom-interrupt acceptance with a real-model smoke that drives the official controls and proves both steered prompts by exact marker files.
- Add a source-level ownership regression that fails if the deleted duplicate surfaces are reintroduced.

## Validation

- Source tests: 402/402 passed with no skips; production dependency audit reported no known vulnerabilities.
- Source, unpacked and installed application: base smoke 8/8, paid real-model smoke 4/4, and cross-workspace document/continuity/official-interaction smoke 3/3 passed at each delivery boundary.
- The real-model interaction smoke uses the official QueueDock up-arrow, `Ctrl+Enter` and Stop controls and proves both steered prompts with exact marker files.
- Package governance reports `packageReady=true`; the packaged ASAR does not contain the removed duplicate interaction scripts.
- The V1.1.4 overwrite install preserved the semantic state snapshot, encrypted software Key and Electron Local State. The verified pre-install backup contains 34 state/session files and excludes credential files.
- Setup: 188,637,856 bytes, SHA-256 `cbb4340f1af7a6a490caf62b74527d878ee538e10b9b6e4bcf6b766dfe2d2840`.
- Portable: 187,946,356 bytes, SHA-256 `5825c78a54ade5b67c940ef0d79d123593684aa5c555840e120d61057ab92ca9`.

## Release policy

- V1.1.0 Stable is unchanged.
- Public V1.1.1 remains the current Pre-release until a newer candidate is explicitly published.
- V1.1.4 is installed locally but is not a GitHub release and must not be promoted to Stable without a maintainer instruction.
- The installer remains unsigned, so automatic installation remains disabled.
