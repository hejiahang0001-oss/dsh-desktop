# Validation evidence

This page preserves the detailed V0.4.1 engineering evidence without making the README front page carry the full verification ledger.

## Automated and runtime checks

- 63 Supervisor, workspace mapping, loopback safety, session catalog, credential precedence, Agent/tool/Plan state, Git review, bounded Diff, workbench layout, and terminal tests pass.
- The terminal suite includes two real Windows PowerShell checks: execution in an isolated workspace without the managed API Key, and process-tree termination before a long command completes.
- Syntax validation passed for every changed Electron CommonJS module and injected workbench script; `git diff --check` also passed.
- The Windows x64 unpacked and installed applications start the real Harness service and receive HTTP 200 from a random IPv4 loopback address.
- Both final runtime smoke checks reported DSH Desktop version 0.4.1, `zh-CN`, and Windows safe storage available.
- The installer contains 29,278 files; the embedded Harness closure contains 29,201 files and no reparse points.
- The NSIS medium passes a 7-Zip structure test with `Everything is Ok`.
- The installed application reports version 0.4.1 and its packaged `app.asar` exactly matches the unpacked build.

## Release integrity

| Item | V0.4.1 value |
| --- | --- |
| Installer | `DSH-Desktop-Setup-0.4.1.exe` |
| Size | `158,447,590` bytes |
| SHA-256 | `164C6DA7603A45C3D90F14AC663B0CCCCDF725CBC01B7B4F59AF755E8A14239D` |
| Files in installer archive | `29,278` |
| Packaged `app.asar` SHA-256 | `6E8AD04C2E28A5027A3AFDF18CB4A15BF324E71B52583125DB93FEEA51DD8E9F` |

The installed `app.asar` and the unpacked build have the same SHA-256. The installed directory contains 29,279 files including the installed uninstaller.

## Persistence and credential checks

- V0.4.1 was installed directly over V0.4.0; the installer exited with code 0 and the Windows uninstall record reports `DSH Desktop 0.4.1`.
- Nine zstd persisted sessions remained discoverable after the upgrade.
- The software-managed Key remained configured, retained software-first precedence, and ignored a competing environment value.
- Validation did not print, copy, or pass the plaintext credential to the integrated terminal.
- The pre-upgrade snapshot is `backups/pre-v0.4.1-20260822-133000`; it contains 31,827 files and 897,588,019 bytes.
- The snapshot contains no `.credentials.yaml` file and no reparse point.
- The V0.4.0 workbench state migrated to schema version 2 without resetting the saved review-panel visibility or width; terminal visibility and height were added with safe defaults.

## Integrated-terminal checks

- Every command is normalized to one non-empty line with a 4,096-character limit and is encoded for a fixed absolute Windows PowerShell executable with `shell: false`.
- The native confirmation dialog displays the exact workspace and command, uses `Cancel` as both the default and cancel action, and states that the software Key is excluded.
- The child process starts in the active Harness workspace. `DSH_CWD` is set, while `DEEPSEEK_API_KEY` is removed case-insensitively from the child environment.
- Output strips ANSI/OSC and unsafe control sequences, streams in bounded events, and stops after 200,000 characters. The renderer keeps a smaller bounded display buffer.
- Only one command can run at a time. A five-minute timeout and the Stop action terminate the full Windows process tree.
- Switching workspace or quitting stops an active command before the native workspace binding changes or the app exits.
- When a command settles, the Git review protection baseline is conservatively refreshed so terminal/user modifications are protected from one-click rejection.
- Terminal state remains native during a Harness reload; output produced before the reload is not replayed.

## Workbench visual checks

- The terminal occupies the full bottom width, while the right Git review panel ends above it. Harness content contracts vertically without covering either workbench panel.
- The terminal exposes its region, horizontal separator, status, log, command input, and actions through the Windows accessibility tree.
- `Ctrl+Alt+T` hid and restored the terminal. A full Harness page reload preserved the hidden state, and the same shortcut restored the reinjected panel afterward.
- The installed V0.4.1 application opened with the bottom terminal visible at 240 pixels and bound to the same DSH temporary workspace path as Harness.
- The saved review panel remained closed in the user's profile after upgrade, proving migration preserved the previous layout instead of forcing the new default.
- Normal-window layout was visually checked. The 160–420 pixel clamp, keyboard resize behavior, reduced-motion rule, forced-colors border rule, and compact-height rule are implemented; the complete compact/maximized visual matrix remains pending.

## Safety boundary

- Renderer terminal requests are accepted only from the trusted random IPv4 loopback Harness origin.
- The renderer cannot choose an executable, working directory, process environment, or shell mode; it can submit only a bounded command string to the native confirmation gate.
- The terminal does not expose the software Key, bypass Harness permissions, or replace the official Agent/tool loop.
- Existing Git review path validation, confirmation gates, bounded Diff reads, symbolic-link isolation, staged recovery baseline, and pre-existing-change protection remain in place.

## Evidence boundary

These statements describe the locally verified V0.4.1 build. The terminal is a controlled single-command PowerShell runner, not a persistent interactive PTY. Interactive prompts, terminal tabs, shell-session state, rich ANSI rendering, file tree, preview, checkpoints, and session rewind are not included. UI automation did not enter a command into the terminal because Windows automation policy prohibits automating terminal command entry; the real runner, environment isolation, output path, and process-tree stop were instead verified through native integration tests. This evidence does not imply that DeepSeek endorses DSH Desktop, that Harness rc.8 is production-stable, or that the unsigned installer will pass every Windows reputation check.
