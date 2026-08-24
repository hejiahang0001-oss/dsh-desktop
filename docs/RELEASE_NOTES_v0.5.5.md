# DSH Desktop V0.5.5

V0.5.5 is a Latest security slice. Stable remains V0.5.4.

## Secure terminal boundary

- The persistent PowerShell PTY now renders in a packaged `file://` terminal window with its own sandboxed Preload.
- The DeepSeek Harness renderer receives only a fixed action to open or focus that window. It no longer receives terminal start, write, resize, stop, state, or output methods.
- Main-process terminal input is accepted only from the exact terminal window main frame and the frame owner captured for the active PTY session.
- Terminal output is sent only to the terminal window. Closing or losing the terminal renderer stops the PTY instead of leaving an ownerless shell.
- The existing explicit start confirmation, bounded input and dimensions, OSC 52 filtering, process-tree stop, Git review pause, and API-key environment isolation remain in force.

## IPC authorization

- Desktop IPC now requires the expected `webContents`, its exact main frame, and an allowed current URL.
- Previously unguarded workspace, diagnostics, Harness restart/state, and log handlers now fail closed for untrusted senders.
- A shared policy module and regression matrix cover main-frame, child-frame, navigation, and terminal-owner boundaries.

## Product and release boundaries

- DeepSeek Harness remains pinned to `0.1.1-rc.2`; this release does not perform the planned Electron major upgrade.
- Stable V0.5.4, its tag, installer, download link, and user-data path are unchanged.
- V0.5.5 is installed locally as the product Latest candidate. Its GitHub Release/Pre-release is intentionally withheld until V0.5.6 moves Electron into the supported-major window.

## Verified build

- `118/118` automated tests pass and the production dependency audit reports no known vulnerability.
- Unpacked and installed desktop, Harness, and IPC security smoke checks all exit with code 0.
- The final installer is `DSH-Desktop-Setup-0.5.5.exe`, `162,583,825` bytes, SHA-256 `A22184C1A0435EAD94502B4991F38B895299D4781C57F4C44F34360296F668AA`.
- Installed and unpacked `app.asar` files share SHA-256 `71BE2CE32EE1029E4AFF6FC1148F8D3D66BC647890DDDE085A047A26E818A90D`.
- Direct overwrite preserved fourteen session files, the managed credential reference, and desktop/workbench/network/Harness state digests. The rollback snapshot contains zero credential files.

## Remaining security work

- Electron 35 remains outside the supported latest-three-major window and is the next blocking runtime upgrade.
- Proxy changes still need an independent native confirmation surface.
- The managed API Key still relies on the Harness credential file and Windows user-directory ACLs; DPAPI/Credential Manager integration is not complete.
- The Windows installer remains unsigned, and Electron Fuses/ASAR integrity are not yet enabled.
