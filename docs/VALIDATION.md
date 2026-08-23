# Validation evidence

This page preserves the detailed V0.4.3 engineering evidence without making the README front page carry the full verification ledger.

## Automated and runtime checks

- 74 Supervisor, workspace mapping, loopback safety, session catalog, credential precedence, Agent/tool/Plan state, Git review, terminal, workbench layout, file-service, file-UI, and Harness-localization tests pass.
- File-service tests cover relative-path containment, parent traversal, absolute paths, lazy sorted listing, secret/binary/large-file blocking, linked-directory isolation, bounded search, and generated-root skipping.
- The terminal suite still includes real Windows PowerShell execution without the managed API Key and process-tree termination before a long command completes.
- Syntax validation passed for all changed Electron CommonJS modules and injected workbench scripts; `git diff --check` also passed.
- The Windows x64 unpacked and installed applications start the real Harness service and receive HTTP 200 from a random IPv4 loopback address.
- Final runtime smoke checks report DSH Desktop version 0.4.3, `zh-CN`, Windows safe storage, official Harness `0.1.1-rc.2`, and successful Workspace synchronization.
- The installer contains 29,311 files; the installed application contains 29,312 files, including 29,233 Harness files and no reparse points.
- The NSIS medium passes a 7-Zip structure test with `Everything is Ok`.
- The installed application reports version 0.4.3 and its packaged `app.asar` exactly matches the unpacked build.

## Release integrity

| Item | V0.4.3 value |
| --- | --- |
| Installer | `DSH-Desktop-Setup-0.4.3.exe` |
| Size | `158,566,564` bytes |
| SHA-256 | `039460E59FBCDE18F70C724926E473AC74FE02CFE06EEA5C47CAD3E77D5B181E` |
| Files in installer archive | `29,311` |
| Packaged `app.asar` SHA-256 | `C37A4B871DC3D8CD999AECF632982E222F350A972E6F25A1943FFD5A0E38C70A` |
| Desktop patch SHA-256 | `4C3E3ED042A45635055BBDD0A41432212495F686404EE878DB985B7AEBCE3A68` |

The installed `app.asar` and unpacked build have the same SHA-256. The installed directory contains 29,279 files including the installed uninstaller.

## Persistence and credential checks

- V0.4.3 installed directly over the existing desktop runtime; the installer exited with code 0 and the Windows uninstall record reports `DSH Desktop 0.4.3`.
- Twelve zstd persisted sessions remained discoverable after the upgrade; the real-model verification created a thirteenth session.
- The software-managed Key remains configured, retains software-first precedence, and ignores a competing environment value.
- Validation did not print, copy, or pass the plaintext credential to the file panel or integrated terminal.
- The pre-upgrade snapshot is `backups/pre-v0.4.3-rc2-20260823-171542`; it contains 32,560 files and 779,888,842 bytes.
- The snapshot contains no `.credentials.yaml` file and no reparse point.
- The V0.4.1 workbench state migrated to schema version 3 without resetting review-panel or terminal state; file-panel visibility and width were added with safe defaults.

## Harness, plugin, and real-model checks

- The npm registry, CLI `--version`, deployed dependency closure, unpacked application, and installed application all report official `@deepseek-ai/dsh@0.1.1-rc.2`.
- `--dump-default-config` succeeds with 135 official Web-profile plugin rows; the DSH Desktop prompt overlay composes exactly one `system-prompt` row and retains its full language policy.
- The packaged `@deepseek-ai` scope contains 197 packages, including 188 `dsh` / `dsh-*` packages. The added `dsh-authorization` package is present.
- The upstream source tree contains 234 package manifests. ACP/SDK, E2B, Claude Code/Codex subagent bridges, experimental team packages, and community plugins are not silently activated by the desktop build.
- With the software-managed Key, the installed application completed a real `DeepSeek-V4-Flash High` Chinese turn in two seconds and returned the requested Chinese result. The test created no file or terminal operation and did not expose the credential.
- See `HARNESS_PLUGIN_INVENTORY.md` for the difference between source packages, shipped dependency packages, active plugin rows, and community plugins.

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

These statements describe the locally verified V0.4.3 build. File viewing is a bounded read-only text surface, not an editor or application preview. The terminal is a controlled single-command runner, not a persistent interactive PTY. Interactive prompts, terminal tabs, shell-session state, rich ANSI rendering, command palette, automatic checkpoints, and session rewind are not included. UI automation did not enter a terminal command because Windows automation policy prohibits terminal command entry; the real runner, environment isolation, output path, and process-tree stop were verified through native integration tests. The earlier rc.8 Workspace Write crash was not re-tested with a file-writing model task, so this build does not claim rc.2 fixes it. This evidence does not imply that DeepSeek endorses DSH Desktop, that Harness `0.1.1-rc.2` is production-stable, or that the unsigned installer will pass every Windows reputation check.
