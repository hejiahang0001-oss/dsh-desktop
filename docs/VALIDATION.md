# Validation evidence

This page records the locally verified V0.5.0 engineering evidence without making the README front page carry the full verification ledger.

## Automated and runtime checks

- 97 Supervisor, workspace, loopback, session, credential, Agent/tool/Plan, Git review, code-checkpoint, file, media-preview, terminal, application-preview, command-palette, release-version, workbench, compact-layout, UI, and localization tests pass locally.
- Preview tests exercise managed HTML/assets, traversal and secret blocking, workspace-change cleanup, external loopback monitoring, file-type rejection, URL normalization, and iframe/control source boundaries.
- The Windows x64 unpacked and installed applications start the real Harness service and receive HTTP 200 from a random IPv4 loopback address.
- The Windows uninstall record reports DSH Desktop 0.5.0; the installed Harness runtime returned HTTP 200 with title `DeepSeek Harness`.
- In the unpacked desktop application, `Ctrl+Shift+P` opened the command palette; filtering for file search and pressing Enter focused the real left-panel search control, while Escape closed the palette.
- At a real 1024×720 desktop window, 100% scaling showed complete Files, Terminal, and Git Review panels; 140% scaling activated the narrow overlay layout and compact terminal without clipping panel actions. Layout reset restored 100% and default dimensions, and Tab focus was visibly outlined in the review list.
- In the unpacked real Harness UI, focusing the prompt composer created an automatic `refs/dsh/checkpoints/items/*` ref. The commit contained the current uncommitted V0.5.0 files; the actual Git index SHA-256 and bounded status SHA-256 were identical before and after creation.
- Repeating the action produced the visible text `代码未变化，沿用最近检查点。` and retained one item ref.
- A packaged JPEG-content file named `.png` rendered with the detected-format notice, and a valid one-page PDF rendered with accessible page text.
- Normal 1208×794 and maximized 2560×1392 desktop windows displayed the file panel, application preview, and terminal without clipping.
- `index.html` and its workspace-relative assets rendered inside the packaged application preview on a software-managed random loopback port.
- Selecting **Stop** changed the visible state to stopped and an independent HTTP request confirmed that the managed port was no longer reachable.
- Desktop UI automation did not type commands into a terminal. The existing native PTY integration tests continue to verify command, environment, recovery, resize, and process-tree stop paths.

## Release integrity

| Item | V0.5.0 value |
| --- | --- |
| Installer | `DSH-Desktop-Setup-0.5.0.exe` |
| Size | `162,570,692` bytes |
| SHA-256 | `6705D2DC73A2EBE546D99CC7B996F5E52091A90457E13B00F4224BDE848A53DC` |
| Files in unpacked build | `29,368` |
| Files in installed application | `29,369` |
| Packaged `app.asar` SHA-256 | `4263F41ED3ADA22F188995F94AB3DDB7AE2D4F6F7089B6B506C8067509657ED5` |
| PTY host SHA-256 | `E53CCA015B9DBBD8F8702725AE03AD292617196497E27C2EE131C683748C351E` |

The installed and unpacked `app.asar` files have the same SHA-256. The installed archive contains `checkpoint-manager.cjs`, the checkpoint renderer/CSS, existing preview and command assets, and the version 5 workbench store. The installed closure contains no reparse points and the filtered terminal runtime contains no PDB files.

The published GitHub asset reports the same `162,570,692` byte size and SHA-256 digest as the local installer. The versioned release and `latest` download both resolve to V0.5.0, and the main-branch CI run completed successfully.

## Automatic code-checkpoint architecture and safety

- Checkpoints use a temporary `GIT_INDEX_FILE`, then `git add -A`, `write-tree`, and `commit-tree`. The application updates only private `refs/dsh/checkpoints/items/*` and `refs/dsh/checkpoints/latest`; it does not switch branches or move HEAD.
- The pre-existing real index tree is recorded in the checkpoint message for V0.5.1 recovery. Tests compare the actual `.git/index` bytes and complete porcelain status before and after creation.
- Worktree tree plus index tree drive deduplication. Repeated focus or manual creation with unchanged state reuses the latest checkpoint.
- Credential-like components and extensions are excluded through Git pathspecs. Tests confirm an untracked `.env` is absent from the checkpoint commit while ordinary tracked edits and new code files are present.
- The first restore-capable series accepts only a workspace equal to the Git repository root. A nested workspace reports an unavailable status instead of snapshotting outside the selected scope.
- Prompt focus/input starts creation early. A recognized Harness send button or Enter action waits for an in-flight checkpoint before replaying; the renderer cannot provide arbitrary Git arguments.
- V0.5.0 has no restore IPC or UI. The only mutations are new Git objects/private refs and no repository file deletion.

## Layout recovery and compact-window boundaries

- Interface zoom is clamped to 80%–140%, rounded to ten-percent steps, applied through the BrowserWindow web contents, and persisted in workbench schema v5.
- `Ctrl+0` resets only interface scaling; `Ctrl+Alt+0` resets panel visibility, dimensions, and scale together. Both are also available from the View menu and fixed command allowlist.
- A layout reset cleanly stops an owned application preview before hiding it. It does not stop the terminal process tree, modify repository files, or touch the Git index.
- At 760 CSS pixels or less in height, the effective terminal height is limited to 210 pixels without overwriting the user's saved height for larger windows.
- Zooming to 140% reduces the CSS viewport enough to activate existing narrow-window overlay breakpoints. Validation therefore covers both physical window size and maximum supported scale.

## Global command-palette boundaries

- The palette contains eleven fixed application actions and never evaluates the search text.
- Commands reuse existing workbench state setters and focus hooks; no new renderer shell, file, IPC, or arbitrary JavaScript surface is exposed.
- Keyboard navigation supports Up, Down, Enter, and Escape. Closing without an action restores the previous focus; a failed action also restores that focus.
- The dialog exposes ARIA dialog/listbox/option semantics, active selection, visible focus, compact-window layout, forced colors, and reduced-motion handling.

## Application-preview architecture and safety

- The Electron main process owns one preview manager; the Harness renderer only requests bounded actions and receives bounded state through the preload bridge.
- Workspace HTML uses a random IPv4 loopback port. The server root remains the active workspace so absolute and relative same-project resources resolve without exposing parent directories.
- Managed requests accept only GET and HEAD. Traversal, links/junctions, credential-like names, files outside the workspace, and files above 32 MiB are rejected.
- Existing development servers must use HTTP or HTTPS on `127.0.0.1`, `localhost`, or `::1`; credentials, remote hosts, and the Harness origin are rejected.
- External services are marked as not owned. DSH Desktop probes and monitors them but never kills the external port or process.
- Managed ports stop when the user selects Stop, closes the panel, switches workspace, or exits DSH Desktop.
- The preview iframe uses sandboxing and a distinct loopback origin. Frame navigation is restricted to the currently connected preview origin, not every loopback service. The renderer remains sandboxed with context isolation and no Node integration; IPC validates the Harness main-frame origin, so preview subframes cannot invoke desktop APIs.
- V0.4.6 adds dedicated PNG/JPEG/WebP/GIF/PDF preview. Device presets, developer tools, SVG media Quick Look, Office preview, and remote URL preview are not included.

## Dedicated media-preview boundaries

- Media requests reuse the trusted Harness main-frame IPC gate and the same workspace containment, credential-name, and link/junction checks as text preview.
- Images are limited to 24 MiB and PDFs to 40 MiB. Content signatures are validated before bytes cross the preload bridge.
- A supported image whose filename has another supported image extension is rendered using the detected MIME type and labelled as such. Image/PDF cross-type disguises remain blocked.
- Object URLs are revoked when the preview closes or another file opens. Media is not uploaded or written back to disk.
- Images expose fit and bounded zoom controls. PDFs use Chromium's local PDF renderer with page, fit, and bounded zoom controls.

## Persistence and credential checks

- V0.5.0 installed directly over V0.4.8; the installer exited with code 0 and the Windows uninstall record reports `DSH Desktop 0.5.0`.
- Thirteen persisted sessions remained discoverable after the upgrade.
- Credential, desktop-state, v5 workbench-state, Harness settings, and the aggregate of all thirteen session hashes remained unchanged across the overwrite; validation did not read, print, or copy credential plaintext.
- The pre-upgrade snapshot is `backups/pre-v0.5.0-20260824-035352`; it contains the previous installer, thirteen sessions, storages, settings, and desktop/workbench state in 21 files.
- The snapshot intentionally contains no `.credentials.yaml` file.
- The real repository checkpoint ref remained present across the installer overwrite.
- A first lightweight snapshot attempt revealed that `harness/profiles` embeds another `node_modules` closure. That stopped partial snapshot was sent to the Windows Recycle Bin; future per-version snapshots exclude profiles while the complete V0.4.6 last-known-good snapshot remains retained.

## Existing terminal, file, and Git boundaries

- The application still provides one persistent PowerShell PTY, not terminal tabs, split panes, shell snapshots, or automatic checkpoints.
- File requests remain restricted to the trusted random-loopback Harness origin and expose only bounded list, read, and search operations.
- The read-only text viewer continues to reject links, junctions, credential-like names, private keys, binary data, unsupported encodings, and files over 512 KiB.
- Git review retains native confirmation, bounded Diff reads, path validation, staged recovery, linked-file isolation, and pre-existing-change protection.

## Evidence boundary

These statements describe the locally verified V0.5.0 build. The earlier rc.8 Workspace Write crash was not re-tested with a paid file-writing model task, so this build does not claim rc.2 fixes it. Automatic checkpoints, layout scaling, the command palette, media preview, and application preview do not relax the existing renderer, credential, navigation, or workspace boundaries. V0.5.0 does not claim rewind because no restore action exists yet. This evidence does not imply DeepSeek endorsement, production stability of Harness `0.1.1-rc.2`, or universal Windows reputation acceptance of the unsigned installer.
