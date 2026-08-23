# DSH Desktop v0.4.5

V0.4.5 adds an integrated application-preview surface for workspace HTML and existing localhost development servers while continuing to use official DeepSeek Harness `0.1.1-rc.2` as the Agent and Web UI.

## What changed

- Open an HTML file from the read-only Quick Look surface in an integrated application preview.
- Serve workspace HTML and relative assets from a software-managed random `127.0.0.1` port.
- Connect to an existing HTTP/HTTPS development server on `127.0.0.1`, `localhost`, or `::1`, including port shorthand.
- Reload the preview, open it in the system browser, stop it, and see ready, offline, failed, and stopped states.
- Distinguish software-managed ports from external services; DSH Desktop never kills an external development server.
- Release owned ports on Stop, panel close, workspace change, and application exit.
- Restore preview-panel visibility after Harness reloads and application restarts.
- Use `Ctrl+Alt+P` to toggle the panel and `Ctrl+Alt+L` to focus its address input.

## Safety boundaries

- Preview navigation is limited to credential-free loopback HTTP/HTTPS addresses outside the Harness origin.
- Managed file requests reject traversal, links/junctions, credential-like paths, files outside the workspace, and files above 32 MiB.
- The iframe is sandboxed on a different loopback origin, cannot jump to another localhost service, and cannot use the Harness main-frame desktop IPC surface.
- Remote URL preview, device emulation, developer tools, and dedicated image/PDF viewing are not included.

## Validation

- 85/85 automated tests passed.
- Packaged `index.html` and its relative assets rendered in normal and maximized Windows layouts.
- A stopped managed preview port was independently confirmed unreachable.
- Unpacked and installed applications passed V0.4.5, `zh-CN`, safe-storage, random-loopback HTTP 200, title, and Workspace synchronization smoke checks.
- Direct overwrite installation preserved 13 sessions, the software Key, desktop state, and workbench layout.
- Installed and unpacked `app.asar` files match exactly and contain the preview manager and UI assets.

## Download integrity

- Installer: `DSH-Desktop-Setup-0.4.5.exe`
- Size: `162,561,775` bytes
- SHA-256: `733F68A1A3F48F65BFA73B50C8136A1AF6D1675785FF92E1030FD82D6F1B4EA7`

## Current limits

- Dedicated image/PDF preview, device presets, developer tools, and remote URLs remain future slices.
- The terminal still provides one persistent PTY; terminal tabs, split panes, shell snapshots, and automatic checkpoints are not included.
- Harness `0.1.1-rc.2` stores its managed credential in the user-data profile protected by Windows user-directory ACLs; Credential Manager/DPAPI integration is pending.
- The Windows installer is not code-signed, so SmartScreen may warn on first download.
- DSH Desktop is an unofficial community desktop host and is not endorsed by DeepSeek.
