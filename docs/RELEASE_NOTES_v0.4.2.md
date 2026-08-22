# DSH Desktop v0.4.2

V0.4.2 adds a bounded, read-only workspace file browser to the persistent Windows workbench around DeepSeek Harness.

## Highlights

- Browse the active Harness workspace from a persistent left panel with lazy directory loading.
- Search filenames within fixed directory, entry, depth, result, and time budgets; relative paths distinguish same-name results.
- Open safe UTF-8 or UTF-16 LE text in a read-only Quick Look surface with path, language, encoding, line count, and size.
- Click **View file** from the right Git Diff to clear search, expand parent directories, select the exact file, and open its content.
- Resize the file panel from 220 to 380 pixels, hide or reopen it, and retain width and visibility across Harness reloads and app restarts.
- Use `Ctrl+Alt+E` to show or hide workspace files and `Ctrl+Alt+F` to focus filename search.
- Reject traversal, absolute paths, links, directory junctions, binary content, oversize files, unsupported encodings, and common credential/private-key files.
- Keep listing, reading, and search behind a narrow trusted-origin IPC surface; the renderer has no file write, rename, or delete operation.

## Verified in this build

- 70 automated tests pass, including relative-path containment, secret/binary/large-file blocking, linked-directory isolation, bounded search, read-only UI checks, real Windows PowerShell Key isolation, and real process-tree stop.
- Real Windows UI checks confirmed the lazy file tree, bounded search, relative-path results, read-only preview, `Esc` focus restoration, three-pane layout, and Diff-to-file reveal.
- The installed and unpacked applications both report V0.4.2, `zh-CN`, Windows safe storage, a random IPv4 loopback Harness origin, HTTP 200, and successful Workspace synchronization.
- V0.4.2 directly upgraded V0.4.1 with exit code 0 while preserving software-first Key status, ten persisted zstd sessions, and workbench layout state.
- The installed `app.asar` exactly matches the unpacked build.

## Download integrity

- Installer: `DSH-Desktop-Setup-0.4.2.exe`
- Size: `158,454,677` bytes
- SHA-256: `90375B47B566619DDBB119A99839DFB28798B7EA52F460ECE0EEF83349EAFC53`
- Packaged `app.asar` SHA-256: `CBCD2A07483D340FC7907FC0B9468FC10753A3EA1901E0F8925FD4A8D7076AE3`

## Known limits

- File viewing is read-only plain text, not a code editor. Syntax highlighting, save, line-level navigation, editor tabs, and content search are not included.
- Filename search currently skips `.git`, `node_modules`, and links but does not implement complete `.gitignore` semantics.
- The integrated terminal remains a controlled single-command runner, not a persistent interactive PTY.
- HTML/local-server, image, and PDF application preview, command palette, automatic checkpoints, and session rewind are not included.
- The installer is not code-signed, so Windows SmartScreen may show a warning.
- Harness rc.8 Workspace Write may still crash PowerShell with `0xC0000005`; DSH Desktop does not silently elevate Harness permissions.
- The software-managed Key relies on the Harness user-data credential file and Windows user-directory ACLs; Credential Manager/DPAPI integration is pending.

DSH Desktop is an independent community project and is not affiliated with or endorsed by DeepSeek.
