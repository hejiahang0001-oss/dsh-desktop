# DSH Desktop V0.5.6

V0.5.6 is the validated product Latest build that moves the desktop runtime back into Electron's supported-major window. Stable remains V0.5.4 and DeepSeek Harness remains pinned to `0.1.1-rc.2`.

## Runtime upgrade

- Pin Electron `43.4.1`, Chromium `150.0.7871.224`, and Electron's embedded Node.js `24.18.1`.
- Verify the official Windows x64 Electron archive against SHA-256 `c2ef9a5f65472c34d14bd3e67b7d14e66b0c01f124aba45263d6a4232160e13a` before packaging.
- Download to a `.partial` file, retry bounded transport failures, validate both SHA-256 and the required executable, and replace the final archive only after validation.
- Keep the external Node.js `24.19.0` Harness and PTY runtime unchanged so the Electron upgrade does not also change Agent or shell behavior.

## Compatibility scope

- Re-run main-window, sandboxed Preload, frame-bound IPC, clipboard permission, image/PDF preview, xterm/PTy, proxy, Harness loopback, Workspace synchronization, packaging, and overwrite-install checks.
- Preserve V0.5.5 terminal isolation: the Harness renderer still receives only the fixed action that opens the local terminal window.
- Do not relax peer-dependency, sender-validation, navigation, or credential boundaries to make the upgrade pass.

## PDF compatibility gate

- Enable Chromium's built-in PDF plugin only in the existing sandboxed main window while keeping Context Isolation, no Node Integration, web security, and navigation restrictions.
- Generate and render a real PDF in the packaged application, capture the complete Windows window surface, and reject a non-empty-but-blank viewer through a dark-viewer visual threshold.
- The final 1000×754 screenshot contains the PDF toolbar, page thumbnail, and document text. Its visual signal is `0.3363` against a minimum threshold of `0.08`.
- The real packaged Harness returned no Content Security Policy header that would block the injected local PDF preview.

## Validation

- All 119 automated tests pass, and the production dependency audit reports no known vulnerabilities.
- The final installer is `DSH-Desktop-Setup-0.5.6.exe`, 183,271,349 bytes, SHA-256 `9DD8855634955F12996F2DF6A57CF42F2A3D9B32AF3782A2536299D0C1F7C893`; its blockmap SHA-256 is `F6EF674F26ADFB6AC5FEF34B3C61E661DD7D0EA993DA6BA3565D7228843B1331`.
- Unpacked and installed desktop, real Harness, IPC security, and PDF smoke checks all exit with code 0 on Electron `43.4.1`.
- The real Harness returned loopback HTTP 200, title `DeepSeek Harness`, synchronized the temporary Workspace, and created a session.
- The installed application contains every one of the 29,370 unpacked files plus only the normal uninstaller. It has zero reparse points and zero terminal PDB files.
- Installed and unpacked `app.asar` SHA-256 is `374C7050C8CBB1B085E66C36636D22AA73B66FC048A68C0BE68EE610CDE21DEC`.
- Overwrite installation preserves the managed credential reference, fourteen session files, desktop/workbench/network state, Preferences, and Harness settings byte-for-byte by digest.
- The rollback snapshot `backups/pre-v0.5.6-20260824-224757` contains the V0.5.5 installer and non-secret state with zero credential copies.

## Release boundary

- The original two public-release blocking security findings are now both fixed. Remaining Important findings stay scheduled for V0.5.7 and V0.5.8.
- V0.5.4 remains GitHub Stable and the GitHub `Latest release`. V0.5.6 is published as a non-draft product Latest Pre-release after passing branch and main-branch Windows CI.
