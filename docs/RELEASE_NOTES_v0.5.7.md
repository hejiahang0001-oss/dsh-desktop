# DSH Desktop V0.5.7

V0.5.7 is the permission-boundary release. It keeps Stable at V0.5.4, DeepSeek Harness pinned to `0.1.1-rc.2`, and Electron pinned to `43.4.1`.

## Permission center

- Add a Windows-native permission center under the Tools menu.
- Report the current upstream Harness permission mode and pending confirmation count without creating a second allow/deny rule system.
- Provide fixed actions that only focus a pending Harness approval or open the upstream Harness permission control.
- Show the desktop's fixed terminal, clipboard, sensitive-path, and proxy boundaries in one place; closing the dialog is always the default action.

## Trusted proxy confirmation

- Normalize and compare the current and proposed proxy settings in the main process.
- Require a Windows-native, default-cancel confirmation that shows the safe before/after route before persistence and Harness restart.
- Leave the saved setting and running Harness untouched when the user cancels; unchanged settings do not prompt or restart.
- Continue rejecting proxy credentials, paths, queries, fragments, SOCKS endpoints, and changes while the Agent is active or awaiting approval.

## Unified sensitive-path policy

- Move credential, secret, private-key, and certificate matching into one shared policy used by the workspace browser and Git checkpoints.
- Check every normalized path component case-insensitively, so nested paths such as `secrets/token.txt` and mixed-case `CrEdEnTiAlS/api.txt` stay excluded.
- Prevent the file tree and search from traversing sensitive directories while preserving ordinary names such as `secretary-notes.md`.
- Use case-insensitive, component-exact Git pathspecs so checkpoint capture and restore follow the same boundary without broad `secret*` false positives.

## Validation status

- All 125 source-level tests pass, including native proxy confirmation, shared sensitive-path matching, real temporary-Git checkpoint coverage, and the existing desktop regressions.
- `pnpm audit --prod --audit-level moderate` reports no known vulnerabilities.
- Unpacked and installed desktop, real Harness, IPC-security, and PDF smoke checks all exit with code 0. Harness returns HTTP 200, reports `DeepSeek Harness`, synchronizes the workspace, and creates a session.
- Real Windows UI review confirms that the permission center is readable and default-cancel, the proxy confirmation shows the safe before/after route with Cancel focused, and pressing Escape restores the visible choice to Direct without changing the saved setting.
- The final installer is `183,272,852` bytes with SHA-256 `CEE81340F8CFEFA22A32487454D2DE57FC1A061B976DFB648C119DB4AF537A17`; its blockmap SHA-256 is `27D6CDE01C7DCE1519E4E0633F4EFAA58C48FFBAC3BB1D42B1ECBD281C0AA276`.
- The packaged and installed `app.asar` SHA-256 is `BC3745B0554C1E6E90BA1A5F499DE8B90E8E1A4D0C7C74E3107375F90ED31E62`. All 29,370 unpacked files are present after installation; the only extra installed file is the normal uninstaller. Both trees contain zero reparse points and zero terminal PDB files.
- The final installer overwrites V0.5.6 with exit code 0 and registers `DSH Desktop 0.5.7`. The software Key reference, fourteen sessions, and seven persisted state summaries retain identical hashes. Electron's LevelDB log files rotate during the real smoke, but the five Local Storage data-file hashes remain unchanged.
- The rollback snapshot is `backups/pre-v0.5.7-20260825-002436`; it contains 33 files and fourteen sessions, contains zero credential copies, and was created only after confirming zero source reparse points.

## Release boundary

- V0.5.4 remains Stable and the GitHub `Latest release`.
- V0.5.7 advances only the product Latest/Pre-release channel; it does not promote Stable.
- The software-managed API Key storage limitation, unsigned installer, Electron Fuses/ASAR integrity, atomic state writes, and expanded CI remain explicit later-version work.
