# Validation evidence

This page records versioned local engineering evidence without making the README front page carry the full verification ledger. Earlier extension-health, durable-state, context, permission, checkpoint, proxy, clipboard, preview, terminal, and workbench evidence remains below because later versions preserve those surfaces.

## V0.5.14 controlled-install evidence

- pnpm `11.19.0` is a packaged, release-governed resource invoked only by bundled Node.js. The governance scan requires 454 pnpm files, the exact manifest version, launcher/distribution/license/config files, safe relative wrapper targets, no reparse points, and no system-pnpm fallback.
- The renderer can submit only an opaque Profile id and fixed catalog id. It has no package/version/registry/path/command input. Windows-native confirmation defaults to Cancel, and the main process rechecks health and busy state before the transaction.
- The first and only catalog entry is `@nonamelego/dsh-catppuccin@0.3.1` with its reviewed registry integrity. Install uses the official `dsh plugin` path with exact-save and ignored scripts; verification checks the Profile manifest, installed manifest, lock integrity, package containment, Patch, Web platform, peers, and final compatibility.
- The child environment strips the software Key, inherited PATH, and inherited `NPM_CONFIG_*`, then applies only the fixed pnpm/Node/Windows paths, empty configs, fixed registry, script blocking, exact-save mode, `$DSH_HOME/.pnpm-store`, and the selected credential-free software proxy.
- The initial real rollback rehearsal exposed that `pnpm remove` does not accept the add-only `--ignore-scripts` and `--registry` CLI flags and that a hoisted package can remain until prune. The corrected path keeps those policies in environment variables, forwards no unsupported remove flags, runs a fixed prune, and restores tracked files after prune.
- A fresh isolated real transaction now installs and verifies `0.3.1`, confirms bundled pnpm `11.19.0`, credential isolation and fixed PATH, then remove/prunes the package and restores `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml` to their exact prior byte digests.
- The final unpacked tree contains 29,785 files and 692,326,513 bytes, including 454 pnpm files and 19,001,800 pnpm bytes. Seven existing unpacked smoke classes pass, and the packaged Extension Health window exposes exactly five narrow methods, one catalog card, one usable install button, one Profile, and one existing toggle without leaking fixture configuration or Patch contents.
- The complete source suite passes 167/167 and the production audit reports no known vulnerability. Review hardening strips Node/Corepack/pnpm execution overrides, fixes the Windows command interpreter, enforces TLS, preserves only the selected safe proxy variables, and blocks a rollback-uncertain Profile for the rest of the process.
- The final installer is 183,969,223 bytes with SHA-256 `A394AB263423309A9F6C022C27A11F9737D3E6B25A76AAB5912F6EB0A91DC2FB`; the 188,872-byte blockmap has SHA-256 `50405F8E31A919DFF31F9C08E542B80DF1806BAF1569C0576DFE916E420F1DCA`. The real V0.5.13→V0.5.14 differential is 5,003,659 bytes with 97.2802% reuse.
- Windows Authenticode and structural PE checks both report unsigned; trusted chain, Publisher, signature verification, and separated update-feed evidence remain absent, so automatic update stays fail-closed.
- The silent overwrite exits 0 and registers V0.5.14. The installed raw tree contains every one of the 29,787 unpacked files plus only `Uninstall DSH Desktop.exe`; both `app.asar` files hash to `051254B7703B767EEC7FAB494A96AE362460B3C25A02573D35FD686F7AD00DE4` and the installed tree has zero reparse points or terminal PDB files.
- All seven installed smoke classes and an installed-resource controlled install/rollback pass. The semantic manifest is identical across overwrite: 25 files, fourteen sessions, and canonical aggregate `0C473FC78E8801581734BDCD37B0A4F04B5750F526593DE58528497A46897233`. Backup `pre-v0.5.14-20260825-105431` contains the three V0.5.13 release files and no credential-named file or reparse point.
- [PR #20](https://github.com/hejiahang0001-oss/dsh-desktop/pull/20) and [main CI run 32803918073](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32803918073) pass all three Windows jobs. [v0.5.14](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.14) is a non-draft Pre-release targeting `e6e96ee82f6ebef33d18409e3dd53f385e93b3aa`; all three remote assets match local sizes and SHA-256 values, and the installer endpoint returns HTTP 200 with `Content-Length: 183969223`. Stable V0.5.4 remains GitHub's formal Latest release.
- After the rollback snapshot hashes were rechecked, the local V0.5.13 installer, blockmap, and checksum manifest were moved to the Windows Recycle Bin. They remain recoverable from there or `backups/pre-v0.5.14-20260825-105431`; local `dist` keeps only Stable V0.5.4 and product Latest V0.5.14 release assets.

## V0.5.11 safe-toggle and recovery evidence

- The renderer receives a toggle only for an installed Profile dependency that resolves within the fixed runtime/Profile boundary and declares `dsh.bundle`. Installation-owned base/Web layers have no toggle; the current real Web Profile declares no external dependency and therefore exposes no mutable extension action.
- A native confirmation defaults to Cancel. The main process rechecks runtime/Profile health, opaque Profile identity, package membership, bundle declaration, current state, and Agent/terminal/checkpoint idleness immediately before writing.
- The transaction changes only the ordered `dsh.profile.bundles` list. It does not spawn pnpm, execute package scripts, install/remove/update a dependency, or accept a command/specification from the renderer.
- Unit recovery rehearsals verify commit cleanup, exact rollback after a simulated runtime failure, startup recovery after an interrupted manifest replacement, conflict-safe behavior, fixed-bundle refusal, traversal rejection, and Profile-root containment.
- A non-secret journal stores only transaction id, package name, action, timestamps, and previous/next hashes. The atomic manifest writer flushes and re-reads both the candidate and last-known-good backup.
- The package-size baseline is link-free and bounded to 50,000 files. It separates `app.asar`, Harness, external Node, isolated terminal, and the Electron shell; V0.5.11 records the final real values without deleting dependencies.
- Final V0.5.11 evidence: 146/146 tests, no known production vulnerability, six unpacked and six installed smokes, 29,370 unpacked files, 29,371 installed files, matching `app.asar`, zero installed reparse points, and zero terminal PDB files.
- The overwrite preserved the exact `046A2EB027B3C6179CB80D84D481464B9416E5113DD656315C35CB7120B59CE4` aggregate digest across 25 semantic files and 14 sessions. The credential-free rollback snapshot is `backups/pre-v0.5.11-20260825-035234`.
- The final installer SHA-256 is `0248B40A294A55ABD831F2DEC8E18BC0BBB78868E25BA51CB2935FC7810DAA3B`; blockmap SHA-256 is `68974C77896D69A93D88BE12728D23A289299DDA4895939B0993CE24A750B541`; packaged/installed `app.asar` SHA-256 is `AAB77D8D41638CD5A11BBE437A29048F36A000C8CE388D7322CDE4028CE79A59`.

## V0.5.10 extension-health evidence

- The local-only extension-health window exposes exactly `getState`, `refresh`, and opaque-id `reveal` capabilities. Its exact packaged page is sandboxed, context-isolated, Node-free, navigation-blocked, and protected by expected-WebContents/main-frame IPC checks.
- The catalog mirrors fixed Harness `0.1.1-rc.2` resolution: bundle layers use installation-first/two-anchor resolution; Profile dependencies use the Profile package anchor and its pnpm-managed module tree plus Harness's maintained parent fallback.
- A bounded BFS follows only valid dependency and peer-dependency package names from the fixed DSH package. Every shared fallback entry must be a link whose real target equals the exact package target in the current installation.
- The current installed V0.5.9 runtime reports 432 expected packages, 432 healthy fallback links, zero missing links, and zero misdirected links. The Web Profile resolves `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` from the packaged runtime and declares no external dependency.
- Profile manifests are limited to 1 MiB; profile and package counts are bounded. Links resolving outside the packaged runtime or the Profile's own module tree are reported as blocked.
- The renderer never receives dependency specifications, arbitrary paths, plugin settings, `cordis.patch.yml` content, credentials, or session content. The smoke fixture contains private markers in both manifest and patch files and verifies that neither appears in rendered text.

## V0.5.9 durable-state evidence

Workspace, workbench, and network JSON now share one serialized atomic writer. Each update uses a unique same-directory temporary file, flushes and parses it before replacement, preserves only a valid previous primary as a flushed and re-read `.bak`, and cleans temporary files on both success and simulated replacement failure. Startup can recover from the valid backup without promoting a corrupt primary. Concurrent calls are committed in call order.

The semantic overwrite snapshot hashes only fixed desktop state, Harness session/catalog files, and LevelDB data files. It follows no links and excludes credential-like paths plus transient `LOG`, `LOG.old`, and `LOCK`; tests prove that credential or log rotation does not change the snapshot while a session edit does. Windows CI now has independent quality, pinned-pnpm production-audit, and package/semantic-data contract jobs. Actual Electron packaging and installed smokes remain local release gates because generated runtimes are intentionally excluded from Git.

## V0.5.8 context-transparency evidence

The context-source catalog mirrors the pinned Harness instruction discovery order from the Harness home through the active workspace and reports only bounded metadata for `AGENTS.md`, `CLAUDE.md`, and their local overlays. It marks candidates above Harness's 1 MiB per-source limit as ignored, while explicitly leaving content deduplication, total-budget omission, and truncation to Harness because those cannot be determined without reading rule prose. The isolated renderer receives no paths, file contents, write methods, hidden prompts, credentials, model input, or conversation text. Revealing a user-controlled rule requires a short-lived identifier resolved again by the main process; changing workspaces clears that map and closes the view. The UI also states the tested product boundary: durable Harness sessions are present, while external long-term memory remains MCP/plugin-managed rather than a separate database bundled by DSH Desktop.

All 128 source tests pass, including source order, 1 MiB metadata classification, workspace reset, local-window, packaged-asset, and narrow-IPC coverage. Production dependency audit reports no known vulnerabilities, and main-branch Windows CI run 32757364699 passes. Unpacked and installed desktop, real Harness, IPC-security, PDF, and context-window smokes all exit with code 0. The context smoke renders a 1359×965 screenshot, exposes only `getState`, `refresh`, and `reveal`, finds two real candidates, and confirms that their marker prose never reaches the renderer.

The final installer is `183,277,540` bytes with SHA-256 `7EFD2B18B5ABD10EAE24923303FA05EDB35C0993815EB7AE5F3E75704DDB47DC`; its blockmap SHA-256 is `3ED15A2ECF105362D7982C3CB28517D52028A70A3E1CB7841D69E865B0DEE73D`. The packaged and installed `app.asar` SHA-256 is `8666CBEF8312262934A43E1AE545DD715EEDFD9244E7DCE27B4484CE2360E7CE`. The unpacked tree contains 29,370 files and the installed tree only adds the normal uninstaller; the installed tree has zero reparse points and the dedicated terminal bundle has zero PDB files.

The installer overwrites V0.5.7 with exit code 0 and registers `DSH Desktop 0.5.8`. Fourteen session files and all 29 selected semantic user-data files retain identical pre/post-overwrite hashes. The recoverable snapshot is `backups/pre-v0.5.8-20260825-015249`; it contains 32 files and no credential-file copy. The published [v0.5.8 release](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.8) is a non-draft Pre-release; all three asset sizes and GitHub SHA-256 digests match, the installer direct download returns HTTP 200, and V0.5.4 remains GitHub's formal `Latest release`.

## V0.5.7 permission-boundary evidence

- All 125 tests pass. New coverage checks Windows-native proxy confirmation, cancel/no-change behavior, permission-center summaries, shared nested sensitive-path matching, and real temporary-Git checkpoint capture without the former `secret*` false positive.
- `pnpm audit --prod --audit-level moderate` reports no known vulnerabilities. Electron remains `43.4.1`, external Node.js remains `24.19.0`, and DeepSeek Harness remains `0.1.1-rc.2`.
- Unpacked and installed desktop, real Harness, IPC-security, and PDF smoke checks all exit with code 0. Harness returns HTTP 200, title `DeepSeek Harness`, synchronized workspace state, and a created session. The PDF visual signal remains `0.3363`.
- Real Windows UI review confirms that the native permission center exposes the current Harness permission mode and fixed desktop boundaries without adding Renderer capabilities. Proxy changes display before/after values with Cancel focused; Escape leaves persistence untouched and restores the visible choice to Direct.

## V0.5.7 installer and overwrite evidence

| Item | V0.5.7 value |
| --- | --- |
| Installer | `DSH-Desktop-Setup-0.5.7.exe` |
| Size | `183,272,852` bytes |
| SHA-256 | `CEE81340F8CFEFA22A32487454D2DE57FC1A061B976DFB648C119DB4AF537A17` |
| Blockmap SHA-256 | `27D6CDE01C7DCE1519E4E0633F4EFAA58C48FFBAC3BB1D42B1ECBD281C0AA276` |
| Files in unpacked build | `29,370` |
| Files in installed application | `29,371` (the unpacked set plus the normal uninstaller) |
| Packaged `app.asar` SHA-256 | `BC3745B0554C1E6E90BA1A5F499DE8B90E8E1A4D0C7C74E3107375F90ED31E62` |
| Reparse points | `0` |
| Terminal PDB files | `0` |

The final installer exits with code 0 and the Windows uninstall record reports `DSH Desktop 0.5.7`. Selected application, Electron, Node runtime, PTY, and Harness package hashes match between the unpacked and installed trees. The software Key reference, fourteen sessions, and seven persisted state summaries retain identical pre/post-overwrite hashes. Electron rotates LevelDB `LOG` files during a real smoke, but all five Local Storage data files retain identical hashes; validation therefore distinguishes transient database logs from persisted semantic data.

The rollback snapshot is `backups/pre-v0.5.7-20260825-002436`. It contains 33 files and fourteen session files, contains zero credential copies, and was created only after confirming zero source reparse points.

V0.5.4 remains the published Stable and GitHub `Latest release`. The published [v0.5.7 release](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.7) is not a draft and is a Pre-release. GitHub reports all three assets as uploaded with their exact local sizes and SHA-256 digests, the installer direct download returns HTTP 200, and [main-branch Windows CI run 32754200198](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32754200198) passed.

## V0.5.6 Electron supported-line evidence

- Electron is fixed at `43.4.1`; the official Windows x64 archive SHA-256 is fixed at `C2EF9A5F65472C34D14BD3E67B7D14E66B0C01F124ABA45263D6A4232160E13A`. The fetch step downloads to `.partial`, retries bounded transport failures, validates the digest and `electron.exe`, and only then replaces the final archive.
- External Node.js remains `24.19.0`, DeepSeek Harness remains `0.1.1-rc.2`, and the PTY dependency set remains fixed. The runtime upgrade therefore does not also change Agent or shell behavior.
- All 119 tests pass. `pnpm audit --prod --audit-level moderate` reports no known vulnerabilities. Static review of Electron 36–43 removals found no used removed APIs.
- Unpacked and installed desktop, real Harness, IPC security, and PDF smoke checks all exit with code 0. The desktop reports Electron `43.4.1`; Harness returns random-loopback HTTP 200, title `DeepSeek Harness`, no CSP header, and successful Workspace/session synchronization.
- The PDF smoke generates a valid PDF, renders it through the same sandboxed Chromium PDF capability used by the main window, and captures the complete Windows surface. The 1000×754 image visibly contains the viewer toolbar, page thumbnail, and document text. Its dark-viewer signal is `0.3363`, above the automatic blank-viewer rejection threshold `0.08`.
- The V0.5.5 one-versus-seven terminal capability matrix is unchanged. A fresh 1449×875 rendered terminal image remains visually complete.

## V0.5.6 installer and overwrite evidence

| Item | V0.5.6 value |
| --- | --- |
| Installer | `DSH-Desktop-Setup-0.5.6.exe` |
| Size | `183,271,349` bytes |
| SHA-256 | `9DD8855634955F12996F2DF6A57CF42F2A3D9B32AF3782A2536299D0C1F7C893` |
| Blockmap SHA-256 | `F6EF674F26ADFB6AC5FEF34B3C61E661DD7D0EA993DA6BA3565D7228843B1331` |
| Files in unpacked build | `29,370` |
| Files in installed application | `29,371` (the unpacked set plus the normal uninstaller) |
| Packaged `app.asar` SHA-256 | `374C7050C8CBB1B085E66C36636D22AA73B66FC048A68C0BE68EE610CDE21DEC` |
| Reparse points | `0` |
| Terminal PDB files | `0` |

The final installer exits with code 0 and the Windows uninstall record reports `DSH Desktop 0.5.6`. Every unpacked relative file is present after installation; selected application, Electron, and runtime file digests match. Fourteen persisted session files retain the same aggregate path/content digest; the credential reference and desktop/workbench/network state, Preferences, and Harness settings retain identical pre/post-overwrite hashes.

The rollback snapshot is `backups/pre-v0.5.6-20260824-224757`. It contains the V0.5.5 installer, fourteen session files, storages, settings, desktop/workbench/network state, Preferences, and local selection storage. It intentionally contains zero credential files and was created only after confirming zero reparse points in the copied source trees.

V0.5.4 remains the published Stable and GitHub `Latest release`. The published [v0.5.6 release](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.6) is not a draft and is a Pre-release. GitHub reports the installer as uploaded with the exact local size and SHA-256; the direct download returns HTTP 200, and [main-branch Windows CI run 32744187437](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32744187437) passed. Remaining Important findings stay scheduled for V0.5.7 and V0.5.8.

## V0.5.5 terminal and IPC isolation evidence

- All 118 local tests pass with the bundled Node.js 24 runtime. New coverage rejects child frames, different WebContents, URL-policy mismatches, and terminal commands from any frame other than the active local terminal owner.
- The DeepSeek Harness Preload exposes only `terminal.openWindow`. The packaged local terminal Preload exposes the exact bounded set `getState`, `onOutput`, `onState`, `resize`, `start`, `stop`, and `write`.
- A packaged Electron IPC smoke loaded the remote desktop Preload in the status page and the terminal Preload in the exact local `file://` page. It confirmed the one-versus-seven capability matrix, captured a 1449×875 rendered terminal image, and exited with code 0.
- The dedicated terminal window denies new windows, WebViews, redirects, and navigation away from the exact packaged page. Closing the window or losing its Renderer clears ownership and stops an active PTY.
- Previously unguarded workspace, diagnostics, and Harness handlers now require the expected main WebContents, exact main frame, and allowed URL. Preview iframes and other Renderer frames fail closed.
- The unpacked and installed V0.5.5 desktop, Harness, and IPC security smoke checks all exit with code 0. The real Harness returned loopback HTTP 200, title `DeepSeek Harness`, and successful Workspace synchronization.

## V0.5.5 installer and overwrite evidence

| Item | V0.5.5 value |
| --- | --- |
| Installer | `DSH-Desktop-Setup-0.5.5.exe` |
| Size | `162,583,825` bytes |
| SHA-256 | `A22184C1A0435EAD94502B4991F38B895299D4781C57F4C44F34360296F668AA` |
| Files in installed application | `29,369` |
| Packaged `app.asar` SHA-256 | `71BE2CE32EE1029E4AFF6FC1148F8D3D66BC647890DDDE085A047A26E818A90D` |
| Reparse points | `0` |
| Terminal PDB files | `0` |

The final installer exited with code 0 and the Windows uninstall record reports `DSH Desktop 0.5.5`. The installed and unpacked `app.asar` hashes match. Fourteen persisted session files retained the same aggregate path/content digest; the credential reference and desktop/workbench/network state, Preferences, and Harness settings retained identical pre/post-overwrite hashes.

The rollback snapshot is `backups/pre-v0.5.5-20260824-200843`. It contains the V0.5.4 installer, fourteen session files, storages, settings, desktop/workbench/network state, Preferences, and local selection storage in 31 files. It intentionally contains zero credential files.

V0.5.4 remains the published Stable and GitHub `Latest release`. V0.5.5 is installed locally as the product Latest candidate but is not published as a GitHub Release/Pre-release because Electron 35 remains outside the official supported-major window. Public Latest publication resumes only after the V0.5.6 runtime upgrade passes the same packaged and overwrite gates.

## V0.5.4 conversation-linked checkpoint evidence

- All 114 local tests pass with the bundled Node.js 24 runtime. New coverage includes completed-turn capture, same-workspace and ordinary-session enforcement, official session fork lineage, private checkpoint trailers, bounded renderer summaries, dual-action history controls, send-time session revalidation, and suppression of page-autofocus checkpoints.
- The unpacked desktop selected an existing persisted ordinary session with one completed turn, created a manual code checkpoint, and showed the `会话回合` capability alongside explicit **建立会话分支…** and **只恢复代码…** actions.
- The branch action used the checkpoint's private completed-turn boundary. Read-only official API verification found exactly one child for the source, the exact `parentSessionId`, the same repository path, non-subagent origin, and an idle child.
- HEAD, the real Git index tree, the worktree diff digest, and the cached diff digest were byte-identical before and after session branching. The source session remained present; the action created only a new Harness child.
- Session ids and turn sequence values did not appear in the renderer history objects. Old checkpoints and checkpoints created before a completed turn remained code-only and disabled the branch action.
- At 1024×720 the Files, Git Review, Terminal, checkpoint list, conversation badge, and both footer actions remained visible without clipping. The normal 1208×794 window passed the same interaction.
- A real startup revealed that Harness autofocus could invoke the old focus-based trigger before stable session selection. The final renderer begins unarmed, ignores focus-only events, and arms on pointer intent, input, Agent completion, restore, or the verified send guard. Final installed startup left all eight checkpoint refs and their aggregate digest unchanged.
- The unpacked and installed V0.5.4 desktop and Harness smoke checks pass: `zh-CN`, safe storage available, random loopback HTTP 200, title `DeepSeek Harness`, and successful Workspace synchronization.

## V0.5.4 release integrity

| Item | V0.5.4 value |
| --- | --- |
| Installer | `DSH-Desktop-Setup-0.5.4.exe` |
| Size | `162,583,718` bytes |
| SHA-256 | `C07CF56B0D809F5D84655AD8513D02FCB77684A98D31420FB99036BD2CFD41F3` |
| Blockmap SHA-256 | `CB32B22F4C0EB6C9F39FAA8C0F7320BC47D68854C91C6DFB7893A71BE2A64131` |
| Files in unpacked build | `29,368` |
| Files in installed application | `29,369` |
| Packaged `app.asar` SHA-256 | `812D385BF6F27348A1C21BD75C2002C81BE39906F65D3E4A370C0ADBE5461003` |
| Reparse points | `0` |
| Terminal PDB files | `0` |

The final installer exited with code 0 and the Windows uninstall record reports `DSH Desktop 0.5.4`. The installed and unpacked `app.asar` hashes match. Fourteen persisted sessions, the credential reference, desktop/workbench/network state, Preferences, Harness settings, and all eight checkpoint item refs retained identical pre/post-overwrite hashes.

The rollback snapshot is `backups/pre-v0.5.4-20260824-135649`. It contains the V0.5.3 installer, fourteen sessions, storages, settings, desktop/workbench/network state, and Preferences in 23 files. It intentionally contains zero credential files.

The published [v0.5.4 release](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.4) is neither a draft nor a prerelease. GitHub reports the installer as `uploaded`, `162,583,718` bytes, and `sha256:c07cf56b0d809f5d84655ad8513d02fcb77684a98d31420fb99036bd2cfd41f3`; the blockmap digest also matches the local final artifact. The `latest` installer redirect returns HTTP 200, and the main-branch Windows CI run [32697127999](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32697127999) completed successfully.

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

The published GitHub installer reports the same `162,581,004` byte size and SHA-256 digest as the local final build. The V0.5.3 release is neither a draft nor a prerelease, the `latest` installer URL returns HTTP 200 with the same content length, and the post-release main-branch Windows CI run completed successfully with 106 passes and the two bundled-PTY-only checks skipped by design. The local bundled-runtime run passed all 108 tests. CI also verifies the follow-up serialization of real-index reads after a transient Windows Git index-lock race; the follow-up hardening is scheduled for the next packaged build and does not change the published V0.5.3 proxy or clipboard scope.

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
