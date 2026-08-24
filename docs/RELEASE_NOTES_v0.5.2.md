# DSH Desktop V0.5.2

V0.5.2 adds a bounded local checkpoint history and selected recovery while keeping official DeepSeek Harness `0.1.1-rc.2` pinned.

## Added

- Open **Code checkpoints** with `Ctrl+Alt+H`, the View menu, or the fixed command palette.
- Inspect the latest twelve local checkpoints with source, local time, latest-point marker, affected code-path count, Git-index impact, Recycle Bin count, and sensitive-path preservation count.
- Select an older checkpoint and continue through the same Windows-native, default-Cancel confirmation used for latest recovery.
- Show explicit loading, empty, invalid, oversized, unchanged, cancelled, and failed states without blocking the Harness conversation.

## Recovery safety

- The renderer receives bounded display metadata and a strict checkpoint ID only. Commit hashes, trees, refs, paths, and arbitrary Git arguments do not cross the preload boundary.
- Private item refs must match the timestamp/random ID format and the checkpoint commit trailers. Invalid or externally forged refs are ignored and counted.
- History generation captures the current non-sensitive worktree once, then compares each target against that one snapshot. No target can exceed the existing 500-path recovery boundary.
- Selected recovery re-resolves the private ref and verifies that its commit still matches the preflight before creating the safety point.
- Recovery remains single-instance, blocked while the Agent, terminal, or checkpoint creation is active, and preserves sensitive worktree/index entries, the branch, and HEAD.

## CI maintenance

- Upgrade the official GitHub Actions from `actions/checkout@v4` and `actions/setup-node@v4` to their current `@v7` major releases while retaining Node.js 24 Windows tests.

## Boundary

- V0.5.2 shows at most the latest twelve local code checkpoints. It does not accept commit hashes, edit/delete refs, restore Harness conversation messages, or synchronize checkpoints to GitHub.
- Code/conversation association and choosing between code-only rewind and conversation branching remain V0.5.3 work.

## Verified locally

- 100 automated tests pass.
- The real 1024×720 and maximized Windows desktop dialogs pass visual and keyboard checks; selected recovery opens the Windows-native confirmation with Cancel focused.
- V0.5.2 installed directly over V0.5.1 with exit code 0. Thirteen sessions, the software-managed Key, desktop/workbench state, Harness settings, and three local checkpoint refs retained identical hashes.
- The installed Harness runtime returned HTTP 200 with title `DeepSeek Harness`.
- Installer size: `162,576,040` bytes.
- Installer SHA-256: `03D98C21CADD6AEF324A5B9DBAB67086A34EDFE469EEF5F358064C300205B913`.

## Download

- Installer: `DSH-Desktop-Setup-0.5.2.exe`
- Latest release: <https://github.com/hejiahang0001-oss/dsh-desktop/releases/latest>
