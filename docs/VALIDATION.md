# Validation evidence

This page records the locally verified V0.5.3 engineering evidence without making the README front page carry the full verification ledger. The V0.5.2 checkpoint evidence remains below because V0.5.3 preserves that recovery surface.

## Automated and runtime checks

- 108 Supervisor, workspace, loopback, session, credential, Agent/tool/Plan, Git review, code-checkpoint/history/recovery, file, media-preview, terminal, application-preview, command-palette, network/proxy, clipboard-policy, release-version, workbench, compact-layout, UI, and localization tests pass locally.
- The bundled Node.js 24 runtime reached an otherwise unresolvable test target only through a local HTTP CONNECT proxy, proving that the software-selected Harness proxy environment affects real `fetch` traffic rather than only persisting fields.
- The proxy URL parser accepts direct, Windows system, and credential-free HTTP(S) origins; it rejects credentials, SOCKS, paths, queries, fragments, and oversized input. Loopback bypass and inherited proxy isolation are covered by tests.
- Preview tests exercise managed HTML/assets, traversal and secret blocking, workspace-change cleanup, external loopback monitoring, file-type rejection, URL normalization, and iframe/control source boundaries.
- The Windows x64 unpacked and installed applications start the real Harness service and receive HTTP 200 from a random IPv4 loopback address.
- The Windows uninstall record reports DSH Desktop 0.5.3; the installed Harness runtime returned HTTP 200 with title `DeepSeek Harness`.
- At 1024×720, the Model menu exposed the current network mode and the complete proxy dialog without clipped controls. Its direct test reached `https://api.deepseek.com` and returned HTTP 401, which is treated as network reachability because the test intentionally sends no API Key.
- The same proxy dialog remained centered and complete in a maximized 2560×1392 window, with direct, Windows system, custom, scope, test, cancel, save/restart, status, and close controls present in the accessibility tree.
- In an existing persisted Harness conversation, clicking the upstream copy button produced the visible `已复制` feedback. Validation did not read or print the resulting clipboard content.
- In the unpacked desktop application, `Ctrl+Shift+P` opened the command palette; filtering for file search and pressing Enter focused the real left-panel search control, while Escape closed the palette.
- At a real 1024×720 desktop window, 100% scaling showed complete Files, Terminal, and Git Review panels; 140% scaling activated the narrow overlay layout and compact terminal without clipping panel actions. Layout reset restored 100% and default dimensions, and Tab focus was visibly outlined in the review list.
- In the unpacked real Harness UI, focusing the prompt composer created an automatic `refs/dsh/checkpoints/items/*` ref. The commit contained the current uncommitted V0.5.0 files; the actual Git index SHA-256 and bounded status SHA-256 were identical before and after creation.
- Repeating the action produced the visible text `代码未变化，沿用最近检查点。` and retained one item ref.
- In the V0.5.1 packaged 1024×720 desktop, `Ctrl+Alt+R` opened the native restore summary with Cancel focused. Pressing Enter cancelled it; the complete Git status and real index SHA-256 stayed identical.
- In the V0.5.2 packaged 1024×720 desktop, `Ctrl+Alt+H` displayed three verified checkpoints without clipping. Down selected an older point, Enter opened the Windows-native selected-restore summary with Cancel focused, and Escape cancelled without restoring or creating a safety point.
- The same checkpoint dialog remained bounded and readable in a maximized 2560×1392 window. Escape closed it and returned to the existing workbench instead of reloading the Harness page.
- A packaged JPEG-content file named `.png` rendered with the detected-format notice, and a valid one-page PDF rendered with accessible page text.
- Normal 1208×794 and maximized 2560×1392 desktop windows displayed the file panel, application preview, and terminal without clipping.
- `index.html` and its workspace-relative assets rendered inside the packaged application preview on a software-managed random loopback port.
- Selecting **Stop** changed the visible state to stopped and an independent HTTP request confirmed that the managed port was no longer reachable.
- Desktop UI automation did not type commands into a terminal. The existing native PTY integration tests continue to verify command, environment, recovery, resize, and process-tree stop paths.

## V0.5.3 release integrity

| Item | V0.5.3 value |
| --- | --- |
| Installer | `DSH-Desktop-Setup-0.5.3.exe` |
| Size | `162,581,004` bytes |
| SHA-256 | `CFBCF77CD0AC028704FD42BEA3992C49067D31149D3B2C51B8998E00A01FD2A3` |
| Files in unpacked build | `29,368` |
| Files in installed application | `29,369` |
| Packaged `app.asar` SHA-256 | `76D12AEACFAF70C47A140F76DCB15A77AAF022922E4ACA4BA538D414C86AB89C` |
| Reparse points | `0` |
| Terminal PDB files | `0` |

The installed and unpacked `app.asar` files have the same SHA-256. The archive contains the new network UI, proxy policy, clipboard policy, preload bridge, and command-palette entry. The final installed and unpacked closure remains link-free.

## Network and clipboard boundaries

- `network-state.json` is non-secret user data outside the installation directory. Proxy credentials are never accepted or stored in this release.
- The Electron page session and Harness Node child receive the same effective HTTP(S) proxy. System mode is resolved for the DeepSeek endpoint, then pinned with loopback bypass so the random local Harness origin cannot be sent through an external proxy.
- Inherited `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, and `NODE_USE_ENV_PROXY` values are removed case-insensitively before the software-selected environment is applied. The integrated PTY environment is unchanged.
- Connectivity tests use a disposable in-memory Electron partition, a fixed DeepSeek API URL, a HEAD request, and a ten-second timeout. They do not read the software Key or response content.
- Saving is blocked while the Agent is running or waiting. A successful save restarts Harness so browser and Node routes cannot disagree.
- Both Electron permission-check and permission-request handlers allow only `clipboard-sanitized-write` from the current Harness main WebContents, exact random Harness origin, and main frame. Clipboard read, subframe, other-origin, other-WebContents, and unrelated permissions stay denied.

## V0.5.2 release integrity

| Item | V0.5.2 value |
| --- | --- |
| Installer | `DSH-Desktop-Setup-0.5.2.exe` |
| Size | `162,576,040` bytes |
| SHA-256 | `03D98C21CADD6AEF324A5B9DBAB67086A34EDFE469EEF5F358064C300205B913` |
| Files in unpacked build | `29,368` |
| Files in installed application | `29,369` |
| Packaged `app.asar` SHA-256 | `C5EEEE459A875F1D13C6EF74F33749A9B2AE606104341EC06FDD894B4E515681` |
| PTY host SHA-256 | `E53CCA015B9DBBD8F8702725AE03AD292617196497E27C2EE131C683748C351E` |

The installed and unpacked `app.asar` files have the same SHA-256. The installed archive contains the checkpoint creation/recovery manager, renderer/CSS, existing preview and command assets, and the version 5 workbench store. The installed closure contains no reparse points and the filtered terminal runtime contains no PDB files.

The published GitHub installer reports the same `162,576,040` byte size and SHA-256 digest as the local final build. The versioned release and `latest` download resolve to V0.5.2, the direct installer URL returns HTTP 200, and the version commit CI run completed successfully with no annotations or Node 20 action-runtime warning.

## Automatic code-checkpoint and recovery architecture

- Checkpoints use a temporary `GIT_INDEX_FILE`, then `git add -A`, `write-tree`, and `commit-tree`. The application updates only private `refs/dsh/checkpoints/items/*` and `refs/dsh/checkpoints/latest`; it does not switch branches or move HEAD.
- The pre-existing real index tree is recorded in the checkpoint message. Recovery restores non-sensitive index entries while preserving the current sensitive-path working tree and index entries.
- Worktree tree plus index tree drive deduplication. Repeated focus or manual creation with unchanged state reuses the latest checkpoint.
- Credential-like components and extensions are excluded through Git pathspecs. Tests confirm an untracked `.env` is absent from the checkpoint commit while ordinary tracked edits and new code files are present.
- The first restore-capable series accepts only a workspace equal to the Git repository root. A nested workspace reports an unavailable status instead of snapshotting outside the selected scope.
- Prompt focus/input starts creation early. A recognized Harness send button or Enter action waits for an in-flight checkpoint before replaying; the renderer cannot provide arbitrary Git arguments.
- Restore preflight builds a temporary current Git tree, compares it with the target tree, and counts only real non-sensitive changes. Identical untracked files already present in the checkpoint are neither reported nor recycled.
- Recovery is blocked while the terminal or Agent is active, defaults the native confirmation to Cancel, creates a safety checkpoint first, moves changed new files to the Windows Recycle Bin, and does not move the branch or HEAD.
- Applying more than 500 paths fails closed. A failed target apply automatically restores the safety point and reports whether rollback succeeded; tests cover both rollback and the 501-path boundary.
- V0.5.2 enumerates only strict private item-ref IDs, scans at most 25 refs, and returns at most the latest 12 verified entries. A ref whose ID, commit trailer, tree, or index-tree metadata does not bind correctly is ignored.
- History captures the current filtered worktree once, then computes bounded impact summaries for each target. The renderer receives checkpoint IDs and counts, not commits, trees, refs, Git arguments, or affected paths.
- Selected recovery re-resolves the private ref and requires the commit to match its preflight value before applying, closing the ref-replacement race without allowing arbitrary commit input.

## Layout recovery and compact-window boundaries

- Interface zoom is clamped to 80%–140%, rounded to ten-percent steps, applied through the BrowserWindow web contents, and persisted in workbench schema v5.
- `Ctrl+0` resets only interface scaling; `Ctrl+Alt+0` resets panel visibility, dimensions, and scale together. Both are also available from the View menu and fixed command allowlist.
- A layout reset cleanly stops an owned application preview before hiding it. It does not stop the terminal process tree, modify repository files, or touch the Git index.
- At 760 CSS pixels or less in height, the effective terminal height is limited to 210 pixels without overwriting the user's saved height for larger windows.
- Zooming to 140% reduces the CSS viewport enough to activate existing narrow-window overlay breakpoints. Validation therefore covers both physical window size and maximum supported scale.

## Global command-palette boundaries

- The palette contains nineteen fixed application actions, including the network-settings entry, and never evaluates the search text.
- Commands reuse existing workbench state setters and focus hooks; no new renderer shell, file, IPC, or arbitrary JavaScript surface is exposed.
- Keyboard navigation supports Up, Down, Enter, and Escape. Closing without an action restores the previous focus; a failed action also restores that focus.
- The dialog exposes ARIA dialog/listbox/option semantics, active selection, visible focus, compact-window layout, forced colors, and reduced-motion handling.

## Application-preview architecture and safety

- The Electron main process owns one preview manager; the Harness renderer only requests bounded actions and receives bounded state through the preload bridge.
- Workspace HTML uses a random IPv4 loopback port. The server root remains the active workspace so absolute and relative same-project resources resolve without exposing parent directories.
- Managed requests accept only GET and HEAD. Traversal, links/junctions, credential-like names, files outside the workspace, and files above 32 MiB are rejected.
- Existing development servers must use HTTP or HTTPS on `127.0.0.1`, `localhost`, or `::1`; credentials, remote hosts, and the Harness origin are rejected.
- External services are marked as not owned. DSH Desktop probes and monitors them but never kills the external port or process.
- Managed ports stop when the user selects Stop, closes the panel, switches workspace, or exits DSH Desktop.
- The preview iframe uses sandboxing and a distinct loopback origin. Frame navigation is restricted to the currently connected preview origin, not every loopback service. The renderer remains sandboxed with context isolation and no Node integration; IPC validates the Harness main-frame origin, so preview subframes cannot invoke desktop APIs.
- V0.4.6 adds dedicated PNG/JPEG/WebP/GIF/PDF preview. Device presets, developer tools, SVG media Quick Look, Office preview, and remote URL preview are not included.

## Dedicated media-preview boundaries

- Media requests reuse the trusted Harness main-frame IPC gate and the same workspace containment, credential-name, and link/junction checks as text preview.
- Images are limited to 24 MiB and PDFs to 40 MiB. Content signatures are validated before bytes cross the preload bridge.
- A supported image whose filename has another supported image extension is rendered using the detected MIME type and labelled as such. Image/PDF cross-type disguises remain blocked.
- Object URLs are revoked when the preview closes or another file opens. Media is not uploaded or written back to disk.
- Images expose fit and bounded zoom controls. PDFs use Chromium's local PDF renderer with page, fit, and bounded zoom controls.

## Persistence and credential checks

- V0.5.3 installed directly over V0.5.2; the installer exited with code 0 and the Windows uninstall record reports `DSH Desktop 0.5.3`.
- Thirteen persisted sessions remained discoverable after the upgrade.
- Credential, desktop-state, v5 workbench-state, network-state, Preferences, Harness settings, and the aggregate of all thirteen session hashes remained unchanged across the overwrite; validation did not read, print, or copy credential plaintext.
- The pre-upgrade snapshot is `backups/pre-v0.5.3-20260824-095123`; it contains the V0.5.2 installer, thirteen sessions, storages, settings, desktop/workbench/network state, and Preferences in 22 files.
- The snapshot intentionally contains no `.credentials.yaml` file.
- All four real repository checkpoint item refs remained present across the installer overwrite.
- A first lightweight snapshot attempt revealed that `harness/profiles` embeds another `node_modules` closure. That stopped partial snapshot was sent to the Windows Recycle Bin; future per-version snapshots exclude profiles while the complete V0.4.6 last-known-good snapshot remains retained.

## Existing terminal, file, and Git boundaries

- The application still provides one persistent PowerShell PTY, not terminal tabs, split panes, or shell snapshots. Automatic code checkpoints remain separate from terminal state and Harness conversation history.
- File requests remain restricted to the trusted random-loopback Harness origin and expose only bounded list, read, and search operations.
- The read-only text viewer continues to reject links, junctions, credential-like names, private keys, binary data, unsupported encodings, and files over 512 KiB.
- Git review retains native confirmation, bounded Diff reads, path validation, staged recovery, linked-file isolation, and pre-existing-change protection.

## Evidence boundary

These statements describe the locally verified V0.5.3 build. The earlier rc.8 Workspace Write crash was not re-tested with a paid file-writing model task, so this build does not claim rc.2 fixes it. Proxy configuration and clipboard-write permission do not relax the existing credential, navigation, IPC, workspace, or terminal boundaries. V0.5.3 still restores code and the Git index only; it does not rewind, delete, branch, or synchronize Harness conversations. This evidence does not imply DeepSeek endorsement, production stability of Harness `0.1.1-rc.2`, authenticated-proxy/SOCKS support, or universal Windows reputation acceptance of the unsigned installer.
