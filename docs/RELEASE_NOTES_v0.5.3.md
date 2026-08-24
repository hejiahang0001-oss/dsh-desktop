# DSH Desktop V0.5.3

V0.5.3 fixes proxy configuration and copy reliability reported from a second Windows environment while keeping official DeepSeek Harness `0.1.1-rc.2` pinned.

## Added

- Open **Network and proxy** with `Ctrl+,`, the Model menu, or the fixed command palette.
- Choose direct access, the current Windows system proxy, or a custom credential-free HTTP(S) proxy.
- Test connectivity to the DeepSeek API before saving. Saving restarts Harness so its Node runtime and the Electron page use the same effective route.
- Show the configured network mode in the native Model menu and persist it outside the installation directory.

## Fixed

- Allow the trusted Harness main frame to perform sanitized clipboard writes required by its conversation copy buttons.
- Add native Edit menu roles for Undo, Redo, Cut, Copy, Paste, and Select All.

## Safety boundaries

- Proxy settings affect Harness external traffic only. Loopback addresses and the integrated PowerShell terminal stay outside the proxy route.
- Inherited proxy environment variables are removed from the Harness child process; only the software-selected effective HTTP(S) proxy is applied.
- Proxy URLs containing credentials, SOCKS endpoints, paths, queries, or fragments are rejected in this version.
- Clipboard reads, subframe writes, unrelated WebContents, non-Harness origins, and every other permission remain denied.
- Network changes are blocked while the Agent is running or waiting for approval.

## Boundary

- Authenticated proxies, SOCKS, PAC diagnostics, and per-domain routing UI are not included.
- The planned checkpoint-to-conversation association moves to V0.5.4; this compatibility fix takes precedence because it blocks use on another machine.

## Verified locally

- 108 automated tests pass, including a bundled Node fetch that succeeds only through a local HTTP CONNECT proxy.
- The real 1024×720 and maximized Windows desktop dialogs pass visual and accessibility-tree checks. A direct connectivity test reached DeepSeek API with HTTP 401 without transmitting the software Key.
- A copy button in an existing persisted Harness conversation changed to the visible `已复制` state; validation did not read or print clipboard content.
- V0.5.3 installed directly over V0.5.2 with exit code 0. Thirteen sessions, the software-managed Key, desktop/workbench/network state, Harness settings, and four local checkpoint refs retained identical hashes.
- The installed Harness runtime returned HTTP 200 with title `DeepSeek Harness`.
- Installer size: `162,581,004` bytes.
- Installer SHA-256: `CFBCF77CD0AC028704FD42BEA3992C49067D31149D3B2C51B8998E00A01FD2A3`.
- The published GitHub asset has the same size and digest, and the `latest` installer URL returns HTTP 200.

## Download

- Installer: `DSH-Desktop-Setup-0.5.3.exe`
- Latest release: <https://github.com/hejiahang0001-oss/dsh-desktop/releases/latest>
