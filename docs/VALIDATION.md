# Validation evidence

This page preserves the detailed V0.4.2 engineering evidence without making the README front page carry the full verification ledger.

## Automated and runtime checks

- 70 Supervisor, workspace mapping, loopback safety, session catalog, credential precedence, Agent/tool/Plan state, Git review, terminal, workbench layout, file-service, and file-UI tests pass.
- File-service tests cover relative-path containment, parent traversal, absolute paths, lazy sorted listing, secret/binary/large-file blocking, linked-directory isolation, bounded search, and generated-root skipping.
- The terminal suite still includes real Windows PowerShell execution without the managed API Key and process-tree termination before a long command completes.
- Syntax validation passed for all changed Electron CommonJS modules and injected workbench scripts; `git diff --check` also passed.
- The Windows x64 unpacked and installed applications start the real Harness service and receive HTTP 200 from a random IPv4 loopback address.
- Final runtime smoke checks report DSH Desktop version 0.4.2, `zh-CN`, Windows safe storage, and successful Workspace synchronization.
- The installer contains 29,278 files; the embedded Harness closure contains 29,201 files and no reparse points.
- The NSIS medium passes a 7-Zip structure test with `Everything is Ok`.
- The installed application reports version 0.4.2 and its packaged `app.asar` exactly matches the unpacked build.

## Release integrity

| Item | V0.4.2 value |
| --- | --- |
| Installer | `DSH-Desktop-Setup-0.4.2.exe` |
| Size | `158,454,677` bytes |
| SHA-256 | `90375B47B566619DDBB119A99839DFB28798B7EA52F460ECE0EEF83349EAFC53` |
| Files in installer archive | `29,278` |
| Packaged `app.asar` SHA-256 | `CBCD2A07483D340FC7907FC0B9468FC10753A3EA1901E0F8925FD4A8D7076AE3` |

The installed `app.asar` and unpacked build have the same SHA-256. The installed directory contains 29,279 files including the installed uninstaller.

## Persistence and credential checks

- V0.4.2 installed directly over V0.4.1; the installer exited with code 0 and the Windows uninstall record reports `DSH Desktop 0.4.2`.
- Ten zstd persisted sessions are discoverable after the real-repository visual run and upgrade.
- The software-managed Key remains configured, retains software-first precedence, and ignores a competing environment value.
- Validation did not print, copy, or pass the plaintext credential to the file panel or integrated terminal.
- The pre-upgrade snapshot is `backups/pre-v0.4.2-20260822-143830`; it contains 32,234 files and 919,802,566 bytes.
- The snapshot contains no `.credentials.yaml` file and no reparse point.
- The V0.4.1 workbench state migrated to schema version 3 without resetting review-panel or terminal state; file-panel visibility and width were added with safe defaults.

## Workspace-file safety checks

- Renderer file requests are accepted only from the trusted random IPv4 loopback Harness origin and expose only list, read, and search operations.
- Every path must be a bounded workspace-relative path with no empty, dot, parent, absolute, control-character, or lexical escape segments.
- Native resolution checks both lexical containment and real-path containment. Every traversed segment is inspected and links or directory junctions are never followed.
- Directory listing is lazy and capped at 500 entries per request. `.git` and `node_modules` directories are omitted from the panel.
- Filename search is capped at 80 results, 2,000 directories, 20,000 entries, 16 levels, and 1.5 seconds; it skips links and the same generated roots.
- Text read is capped at 512 KiB and supports UTF-8 and UTF-16 LE. Binary extensions, NUL-bearing content, unsupported encodings, special files, and oversize files return safe unavailable states.
- `.env*`, credential/secret names, common private-key names, `.npmrc`, `.pypirc`, `.netrc`, and `.pem/.key/.pfx/.p12` content are not previewed.
- Renderer content is inserted with `textContent`; no `innerHTML`, `eval`, write, rename, or delete surface exists in the file-panel script.

## Workbench visual checks

- A real repository displays the lazy left file tree, central official Harness UI, optional right Git review panel, and full-width bottom terminal without establishing another Agent or session source of truth.
- Filename search completed within the bounded request and now displays relative paths, so same-name files are distinguishable.
- Safe text opened in a read-only Quick Look surface with path, language, encoding, line count, and byte size. `Esc` closed the preview and restored file-row focus.
- Clicking **View file** for `assets/workbench-files.css` in the real Diff cleared search, expanded `assets`, selected the exact file, scrolled it into view, and opened its read-only content.
- The left panel exposes its complementary region, search input, semantic tree, tree items, vertical separator, refresh, and close controls through Windows accessibility.
- File-panel width is clamped to 220–380 pixels; visibility and width persist in workbench schema v3. `Ctrl+Alt+E` toggles the panel and `Ctrl+Alt+F` focuses search.
- Reduced-motion and forced-colors rules are present. The complete compact/maximized/high-contrast visual matrix remains pending.

## Existing terminal and Git-review boundaries

- The integrated terminal remains a controlled one-command PowerShell runner with native confirmation, fixed executable, `shell: false`, 4,096-character input, 200,000-character execution output, five-minute timeout, and full process-tree stop.
- The software-managed `DEEPSEEK_API_KEY` remains absent from terminal child processes.
- Git review retains path validation, native confirmation gates, bounded Diff reads, linked-file isolation, staged recovery baseline, and pre-existing-change protection.
- The new file viewer is read-only and does not accept, reject, stage, restore, edit, or save files.

## Evidence boundary

These statements describe the locally verified V0.4.2 build. File viewing is a bounded read-only text surface, not an editor or application preview. The terminal is a controlled single-command runner, not a persistent interactive PTY. Interactive prompts, terminal tabs, shell-session state, rich ANSI rendering, command palette, automatic checkpoints, and session rewind are not included. UI automation did not enter a terminal command because Windows automation policy prohibits terminal command entry; the real runner, environment isolation, output path, and process-tree stop were verified through native integration tests. This evidence does not imply that DeepSeek endorses DSH Desktop, that Harness rc.8 is production-stable, or that the unsigned installer will pass every Windows reputation check.
