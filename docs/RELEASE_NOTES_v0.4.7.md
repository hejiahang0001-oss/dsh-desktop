# DSH Desktop V0.4.7

V0.4.7 adds one keyboard-first command surface across the existing DeepSeek Harness workbench while keeping official Harness `0.1.1-rc.2` pinned.

## Added

- Open the command palette from anywhere with `Ctrl+Shift+P` or **View → Open command palette…**.
- Search a fixed allowlist of eleven existing actions: focus chat, create a Harness session, toggle or focus Files, Application Preview, Terminal, and Git Review, or reload Harness.
- Navigate with Up/Down, run with Enter, close with Escape, and restore the previous focus when closing without an action.
- Screen-reader dialog, listbox, option, active-selection, forced-color, compact-window, and reduced-motion states.

## Hardened

- The palette never evaluates a typed command and does not expose shell, filesystem, IPC, or arbitrary JavaScript execution.
- A failed action returns focus to the previously active control.
- Release-facing version checks now read `package.json` centrally instead of repeating an exact version inside unrelated tests.

## Validation boundary

- Automated regression, unpacked/installed runtime smoke, overwrite preservation, and installer integrity evidence are recorded in `docs/VALIDATION.md` and `PROGRESS.md`.
- This version does not yet add layout reset, interface zoom, automatic checkpoints, or rewind. Those remain the next verified slices.

## Download

- Installer: `DSH-Desktop-Setup-0.4.7.exe`
- Latest release: <https://github.com/hejiahang0001-oss/dsh-desktop/releases/latest>
