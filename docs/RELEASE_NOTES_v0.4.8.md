# DSH Desktop V0.4.8

V0.4.8 adds persisted interface scaling, one-step layout recovery, and compact-height adaptations to the existing DeepSeek Harness workbench.

## Added

- Scale the complete Harness and desktop workbench from 80% to 140% with `Ctrl+-` and `Ctrl+=`; reset to 100% with `Ctrl+0`.
- Restore default file, preview, terminal, and Git review visibility and dimensions together with `Ctrl+Alt+0`.
- Run the same zoom and reset actions from the View menu or `Ctrl+Shift+P` command palette.
- Persist the selected interface scale in the version 5 workbench state outside the installation directory.

## Compact and accessible states

- At 760 CSS pixels or less in height, the terminal receives a bounded 210-pixel effective height while keeping its stored user height unchanged for larger windows.
- File, preview, terminal, and review headers use tighter verified spacing at compact heights.
- The existing overlay breakpoints, keyboard focus rings, forced colors, reduced motion, and command-palette ARIA structure remain active under interface scaling.

## Boundaries

- Resetting layout closes an active application preview cleanly but does not stop a running terminal, change files, alter the Git index, or touch Harness sessions and credentials.
- This version does not add automatic code checkpoints or rewind; those remain V0.5.0 and V0.5.1.

## Verified

- 93 automated checks pass.
- The unpacked application was exercised at 1024×720 at both 100% and 140% scaling; layout reset and visible keyboard focus were verified in the real desktop UI.
- V0.4.8 directly upgraded V0.4.7 while preserving thirteen sessions and the hashes of credentials, desktop state, v5 workbench state, and Harness settings.
- The installed runtime returned HTTP 200 from a random IPv4 loopback origin with title `DeepSeek Harness`.

## Download

- Installer: `DSH-Desktop-Setup-0.4.8.exe`
- Latest release: <https://github.com/hejiahang0001-oss/dsh-desktop/releases/latest>
