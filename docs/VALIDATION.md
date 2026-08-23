# Validation evidence

This page records the locally verified V0.4.4 engineering evidence without making the README front page carry the full verification ledger.

## Automated and runtime checks

- 78 Supervisor, workspace, loopback, session, credential, Agent/tool/Plan, Git review, file, terminal, workbench, UI, and localization tests pass locally. GitHub CI runs 76 repository-only checks and skips the two live ConPTY checks when the bundled development runtime is intentionally absent from checkout.
- The terminal tests exercise a real Windows PTY across multiple commands, resize messages, renderer recovery, software-Key isolation, launch failure, and full process-tree termination.
- The packaged helper was executed with the bundled Node runtime against the filtered packaged `node-pty` resources; the installed helper passed the same test.
- The Windows x64 unpacked and installed applications start the real Harness service and receive HTTP 200 from a random IPv4 loopback address.
- Final smoke checks report DSH Desktop 0.4.4, `zh-CN`, Windows safe storage, official Harness `0.1.1-rc.2`, and successful Workspace synchronization.
- Normal and maximized desktop windows display the persistent terminal without horizontal clipping; the accessibility tree exposes the terminal region, screen-reader rows, input, state, workspace path, and controls.
- UI automation did not type a terminal command because the Windows automation policy prohibits terminal command entry. Real native integration tests verified the command, environment, recovery, resize, and stop paths.

## Release integrity

| Item | V0.4.4 value |
| --- | --- |
| Installer | `DSH-Desktop-Setup-0.4.4.exe` |
| Size | `162,555,535` bytes |
| SHA-256 | `348E26C211C19344FE59F0FF425F932306F4781953F3EDC11A91F8F4F706FFDC` |
| Files in unpacked build | `29,368` |
| Files in installed application | `29,369` |
| Packaged `app.asar` SHA-256 | `28C43536BC0C58EA73E10302D42349FB11ACC25237F535B98B5B682E7C9A4757` |
| PTY host SHA-256 | `E53CCA015B9DBBD8F8702725AE03AD292617196497E27C2EE131C683748C351E` |

The installed and unpacked `app.asar` files have the same SHA-256. The installed closure contains no reparse points and the filtered terminal runtime contains no PDB files.

## Persistent PTY architecture and safety

- The Electron main process owns one PTY runner; the Harness Renderer only receives bounded state/output and sends bounded input/resize/stop messages through the preload bridge.
- An isolated helper runs under the bundled Node v24.19.0 runtime and loads pinned `node-pty 1.2.0-beta.15` from unpacked installation resources, not from `app.asar`.
- `@xterm/xterm 6.0.0` and `@xterm/addon-fit 0.11.0` provide ANSI rendering, accessible terminal input, and fitting to the resizable workbench panel.
- Starting the PTY requires explicit native confirmation. Input is limited before it reaches the helper; helper protocol and recovery buffers are also bounded.
- The software-managed `DEEPSEEK_API_KEY` is removed from both the helper and PowerShell environment. PTY bootstrap variables are removed before PowerShell starts, while the non-secret `DSH_CWD` workspace marker remains available. Tests observe `False` for Key presence without reading or outputting the credential.
- OSC 52 clipboard-write sequences are stripped before terminal data enters the Renderer while ordinary ANSI control sequences remain available to xterm.
- Stop uses Windows process-tree termination and was verified against a live long-running descendant process.
- While the PTY is active, one-file and batch Git accept/reject actions are disabled. On stop, DSH Desktop captures a fresh user-change baseline before review actions become available again.
- The main-process recovery buffer retains the newest 200,000 characters. Harness page reload restores terminal state and recent output without restarting the shell.

## Persistence and credential checks

- V0.4.4 installed directly over the existing desktop runtime; the installer exited with code 0 and the Windows uninstall record reports `DSH Desktop 0.4.4`.
- Thirteen persisted sessions remained discoverable before and after the upgrade.
- Credential, desktop-state, and workbench-state hashes remained unchanged across the overwrite; validation did not print or copy credential plaintext.
- The pre-upgrade snapshot is `backups/pre-v0.4.4-20260824-001402`; it contains 32,917 files and 802,333,250 bytes.
- The snapshot intentionally contains no `.credentials.yaml` file.

## Existing file and Git boundaries

- File requests remain restricted to the trusted random-loopback Harness origin and expose only bounded list, read, and search operations.
- Every file path must remain inside the active workspace; links, junctions, credential-like names, private keys, binary data, unsupported encodings, and files over 512 KiB are not previewed.
- The viewer remains read-only and inserts content with `textContent`; it cannot edit, save, accept, reject, stage, restore, rename, or delete files.
- Git review retains native confirmation, bounded Diff reads, path validation, staged recovery, linked-file isolation, and pre-existing-change protection.

## Evidence boundary

These statements describe the locally verified V0.4.4 build. It provides one persistent PowerShell PTY, not terminal tabs, split panes, shell snapshots, or automatic checkpoints. The file viewer is not a code editor, and application preview, command palette, checkpoint/rewind, code signing, and automatic update remain future slices. The earlier rc.8 Workspace Write crash was not re-tested with a paid file-writing model task, so this build does not claim rc.2 fixes it. This evidence does not imply DeepSeek endorsement, production stability of Harness `0.1.1-rc.2`, or universal Windows reputation acceptance of the unsigned installer.
