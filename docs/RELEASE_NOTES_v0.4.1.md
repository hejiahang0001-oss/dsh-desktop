# DSH Desktop v0.4.1

V0.4.1 adds the first integrated terminal slice to the persistent Windows workbench around DeepSeek Harness.

## Highlights

- Keep a full-width PowerShell command panel below Harness and the right-side Git review panel.
- Run each command in the active Harness workspace after a native confirmation dialog whose default action is Cancel.
- Stream sanitized output with a 200,000-character execution bound and stop the full Windows process tree from the panel.
- Keep the software-managed `DEEPSEEK_API_KEY` out of the terminal child-process environment.
- Run one command at a time with a five-minute timeout; command length is limited to 4,096 single-line characters.
- Resize the terminal from 160 to 420 pixels, hide or reopen it, and retain both height and visibility across Harness reloads and application restarts.
- Use `Ctrl+Alt+T` to show or hide the terminal and `Ctrl+Alt+K` to focus its command input.
- Conservatively refresh the Git protection baseline after a terminal command settles so user-initiated changes are not presented as one-click-rejectable Agent changes.

## Verified in this build

- 63 automated tests pass, including real Windows PowerShell execution, software-Key isolation, output sanitization, bounded output, synchronous launch failure, and real process-tree stop.
- The installed and unpacked applications both report V0.4.1, `zh-CN`, Windows safe storage, a random IPv4 loopback Harness origin, HTTP 200, and successful Workspace synchronization.
- Real Windows UI checks confirmed the full-width bottom terminal, right-panel avoidance, keyboard hide/reopen, and visibility persistence after a full Harness reload.
- V0.4.1 directly upgraded V0.4.0 with exit code 0 while preserving nine persisted sessions, software-first Key status, and the saved review-panel layout.
- The installed `app.asar` exactly matches the unpacked build.

## Download integrity

- Installer: `DSH-Desktop-Setup-0.4.1.exe`
- Size: `158,447,590` bytes
- SHA-256: `164C6DA7603A45C3D90F14AC663B0CCCCDF725CBC01B7B4F59AF755E8A14239D`
- Packaged `app.asar` SHA-256: `6E8AD04C2E28A5027A3AFDF18CB4A15BF324E71B52583125DB93FEEA51DD8E9F`

## Known limits

- The integrated terminal is a controlled single-command runner, not a persistent interactive PTY. Interactive prompts, terminal tabs, shell-session state, and rich ANSI rendering are not included.
- Output that occurred before a Harness page reload is not replayed, although the native command remains stoppable and its current state is restored.
- The installer is not code-signed, so Windows SmartScreen may show a warning.
- File tree, preview, command palette, automatic checkpoints, and session rewind are not included yet.
- Harness rc.8 Workspace Write may still crash PowerShell with `0xC0000005`; the independent integrated terminal does not silently elevate Harness permissions or replace the official Agent tool loop.
- The software-managed Key currently relies on the Harness user-data credential file and Windows user-directory ACLs; Credential Manager/DPAPI integration is pending.

DSH Desktop is an independent community project and is not affiliated with or endorsed by DeepSeek.
