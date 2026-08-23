# Validation evidence

This page records the locally verified V0.4.5 engineering evidence without making the README front page carry the full verification ledger.

## Automated and runtime checks

- 85 Supervisor, workspace, loopback, session, credential, Agent/tool/Plan, Git review, file, terminal, application-preview, workbench, UI, and localization tests pass locally.
- Preview tests exercise managed HTML/assets, traversal and secret blocking, workspace-change cleanup, external loopback monitoring, file-type rejection, URL normalization, and iframe/control source boundaries.
- The Windows x64 unpacked and installed applications start the real Harness service and receive HTTP 200 from a random IPv4 loopback address.
- Final smoke checks report DSH Desktop 0.4.5, `zh-CN`, Windows safe storage, official Harness `0.1.1-rc.2`, and successful Workspace synchronization.
- Normal 1208×794 and maximized 2560×1392 desktop windows displayed the file panel, application preview, and terminal without clipping.
- `index.html` and its workspace-relative assets rendered inside the packaged application preview on a software-managed random loopback port.
- Selecting **Stop** changed the visible state to stopped and an independent HTTP request confirmed that the managed port was no longer reachable.
- Desktop UI automation did not type commands into a terminal. The existing native PTY integration tests continue to verify command, environment, recovery, resize, and process-tree stop paths.

## Release integrity

| Item | V0.4.5 value |
| --- | --- |
| Installer | `DSH-Desktop-Setup-0.4.5.exe` |
| Size | `162,561,775` bytes |
| SHA-256 | `733F68A1A3F48F65BFA73B50C8136A1AF6D1675785FF92E1030FD82D6F1B4EA7` |
| Files in unpacked build | `29,368` |
| Files in installed application | `29,369` |
| Packaged `app.asar` SHA-256 | `4F83979629DE9B407AA4B4FBB34EE56F1B842355AE357A75CEA7E4427BD5D615` |
| PTY host SHA-256 | `E53CCA015B9DBBD8F8702725AE03AD292617196497E27C2EE131C683748C351E` |

The installed and unpacked `app.asar` files have the same SHA-256. The installed archive contains `preview-manager.cjs`, `workbench-preview.js`, and `workbench-preview.css`. The installed closure contains no reparse points and the filtered terminal runtime contains no PDB files.

## Application-preview architecture and safety

- The Electron main process owns one preview manager; the Harness renderer only requests bounded actions and receives bounded state through the preload bridge.
- Workspace HTML uses a random IPv4 loopback port. The server root remains the active workspace so absolute and relative same-project resources resolve without exposing parent directories.
- Managed requests accept only GET and HEAD. Traversal, links/junctions, credential-like names, files outside the workspace, and files above 32 MiB are rejected.
- Existing development servers must use HTTP or HTTPS on `127.0.0.1`, `localhost`, or `::1`; credentials, remote hosts, and the Harness origin are rejected.
- External services are marked as not owned. DSH Desktop probes and monitors them but never kills the external port or process.
- Managed ports stop when the user selects Stop, closes the panel, switches workspace, or exits DSH Desktop.
- The preview iframe uses sandboxing and a distinct loopback origin. Frame navigation is restricted to the currently connected preview origin, not every loopback service. The renderer remains sandboxed with context isolation and no Node integration; IPC validates the Harness main-frame origin, so preview subframes cannot invoke desktop APIs.
- V0.4.5 supports workspace HTML and existing loopback development servers. Dedicated image/PDF preview, device presets, developer tools, and remote URL preview are not included.

## Persistence and credential checks

- V0.4.5 installed directly over V0.4.4; the installer exited with code 0 and the Windows uninstall record reports `DSH Desktop 0.4.5`.
- Thirteen persisted sessions remained discoverable after the upgrade.
- Credential, desktop-state, and workbench-state hashes remained unchanged across the overwrite; validation did not read, print, or copy credential plaintext.
- The pre-upgrade snapshot is `backups/pre-v0.4.5-20260824-011037`; it contains 62,379 files and 1,006,226,877 bytes.
- The snapshot intentionally contains no `.credentials.yaml` file.

## Existing terminal, file, and Git boundaries

- The application still provides one persistent PowerShell PTY, not terminal tabs, split panes, shell snapshots, or automatic checkpoints.
- File requests remain restricted to the trusted random-loopback Harness origin and expose only bounded list, read, and search operations.
- The read-only text viewer continues to reject links, junctions, credential-like names, private keys, binary data, unsupported encodings, and files over 512 KiB.
- Git review retains native confirmation, bounded Diff reads, path validation, staged recovery, linked-file isolation, and pre-existing-change protection.

## Evidence boundary

These statements describe the locally verified V0.4.5 build. The earlier rc.8 Workspace Write crash was not re-tested with a paid file-writing model task, so this build does not claim rc.2 fixes it. Application preview does not relax the existing renderer, credential, navigation, or workspace boundaries. This evidence does not imply DeepSeek endorsement, production stability of Harness `0.1.1-rc.2`, or universal Windows reputation acceptance of the unsigned installer.
