# Validation evidence

This page records versioned local engineering evidence without making the README front page carry the full verification ledger. Earlier extension-health, durable-state, context, permission, checkpoint, proxy, clipboard, preview, terminal, and workbench evidence remains below because later versions preserve those surfaces.

## V0.5.21 Excel XLSX evidence (published)

- The pinned source Harness starts on a random IPv4 loopback origin and `skill.list` returns bundled `excel-xlsx` with `modelInvocable: true`.
- A real credential-backed isolated Harness session accepted Workspace Write, entered running state, invoked `/excel-xlsx`, created a 5,970-byte editable workbook and its JSON specification, completed, and passed independent strict inspection: 3 sheets, 69 cells, 10 formulas, 3 filters, 3 frozen panes, and zero formula errors, risky formulas, external links, connections, query tables, or macros. The temporary credential copy was removed.
- Microsoft Excel opens the maintained acceptance workbook and the real Agent workbook without repair. The edited workbook recalculates totals to 2,940, reports zero reconciliation difference and light-green `OK`, while filters, frozen panes, styles, dates, currency, and percentages render correctly. The CSV workbook preserves `001` and formula-like text without evaluating it.
- The first actual Excel opening revealed invalid worksheet element order (`mergeCells` before `autoFilter`); the generator now follows SpreadsheetML schema order and a regression test enforces it. A second visual pass found differential-fill background color ambiguity; matched foreground/background RGB values now render the intended status color.
- The fixed engine applies workspace containment, link/junction refusal, transactional output, rollback-backed explicit overwrite, bounds for specifications/CSV/XLSX/sheets/rows/columns/cells/formulas, duplicate-update rejection, stale formula-cache invalidation, and full-recalculation flags.
- Strict policy rejects external workbook references, URL/UNC/DDE-like formulas, network/data functions, formula errors, shared/array/data-table formula structures, macros, external links, connection parts, and query tables. CSV formula-like content remains text.
- The focused Excel/UI/Supervisor/Word-preservation/governance suite passes 38/38, the complete source suite passes 233/233, the production dependency audit reports no known vulnerability, and `git diff --check` passes. Source, packaged, and installed Harness discovery all find model-invocable `excel-xlsx`; both ten-part runtime smoke matrices pass.
- The unpacked tree contains 29,791 files and 692,728,208 bytes. The installed tree contains all unpacked files at equal length plus only the normal uninstaller; both have zero reparse points and matching `app.asar` SHA-256 `FE739C0B080C0286D96BCC7E51BEAD0C2E420EB1102A1B478E0E6B73424CBBC8`.
- The final installer is 184,026,194 bytes with SHA-256 `16A67381E798A01A1B107BA00861D78021B50250012B71CE6A545FAA0EB673A0`; its 188,874-byte blockmap hashes to `8249192B195150243670609B991FEC586720D8CB772529F86C6BB0007D1B471A`, and the checksum manifest hashes to `43069A1450A5A936F12B21DE9266FE0D5FF46D837489183DB05796D1844D4DFA`. Differential reuse from V0.5.20 is 182,967,366 bytes (99.4246%), leaving 1,058,828 bytes. The installer remains unsigned and automatic update remains disabled.
- Silent overwrite exits with code 0 and Windows registers V0.5.21. Backup `backups/pre-v0.5.21-20260826-020523` contains 27 credential-free semantic files and all three V0.5.20 release assets with exact expected hashes and zero reparse points. The semantic manifest stays exactly `D4DC1C46139CE2237846FFE28AA40D4F13E915CF11CD8AB7E6EA73F30C61F35D` before overwrite, after overwrite, and after installed smoke.
- Implementation PR [#34](https://github.com/hejiahang0001-oss/dsh-desktop/pull/34) passes all three jobs in run [32882802354](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32882802354) and merges as `bd75fcb6a0e2038761a257bc3d696b372eba6607`. Main CI run [32882923123](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32882923123) passes all three jobs.
- [V0.5.21](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.21) is non-draft, marked Pre-release, and targets the exact implementation merge. GitHub reports all three assets with exact local sizes and SHA-256 digests; a clean download matches 3/3 assets and 2/2 manifest entries, the public installer returns HTTP 200 with content length 184,026,194, and GitHub formal Latest remains V0.5.4.

## V0.5.20 Word DOCX evidence (published)

- The official pinned Harness source runtime starts on a random IPv4 loopback origin and `skill.list` returns the bundled `word-docx` entry with `modelInvocable: true`.
- A real credential-backed isolated Harness session accepted `/permission workspace-write`, entered the running state, invoked `/word-docx`, created `real-harness-word-spec.json` plus an editable 4,992-byte DOCX, completed, and passed an independent tool inspection. The temporary credential copy was removed and no credential value appears in the report.
- The final edited acceptance DOCX is 67,167 bytes with 12 OOXML entries, 27 paragraphs, one table, one embedded PNG, and one exact replacement. Microsoft Word opens it without repair or compatibility mode; the three-page view confirms Chinese text, image aspect ratio, table layout, header/footer, numbering, and `WORD_EDIT_VERIFIED`.
- ZIP CRC, offsets, compression methods, entry bounds, 24 MiB per-entry and 96 MiB total declared uncompressed bounds are enforced before decompression. Workspace containment, links/junctions, PNG/JPEG signatures and dimensions, image count/bytes, atomic write, rollback copy, and duplicate replacement behavior are covered.
- The focused Word/Supervisor/governance suite passes 32/32, the complete source suite passes 216/216, and the production dependency audit reports no known vulnerability.
- The unpacked tree contains 29,789 files and 692,676,394 bytes. The installed tree contains all unpacked files at equal length plus only the normal uninstaller; both have zero reparse points and matching `app.asar` SHA-256 `1DA27490F2D7491F0F9B0E0438E30051479A2C87CB711D9D45F957ADB128BE3E`. Both ten-part smoke matrices and source/packaged/installed Harness `word-docx` discovery pass.
- The final installer is 184,012,614 bytes with SHA-256 `0815951648E4376CE7B4AFF6630A44946CFF6984CC9E2C85A0EA85B387C561FC`; its 188,877-byte blockmap hashes to `9176D8C43513C8B638856190752C094381A08F1AA471936C6490205AA9911128`, and the checksum manifest hashes to `CF14548ABC3B5A4F61FEB1F915B1DAA95E32082F9B23096316DE10AA3F0C8FAE`. V0.5.19 to V0.5.20 reuses 182,988,030 bytes (99.4432%), leaving 1,024,584 differential bytes. The installer remains unsigned and automatic update remains disabled.
- Silent overwrite exits 0 and registers V0.5.20. Backup `backups/pre-v0.5.20-20260826-000034` contains 27 credential-free semantic files and the V0.5.19 release assets with no hash mismatch or reparse point. The semantic manifest SHA-256 remains exactly `D4DC1C46139CE2237846FFE28AA40D4F13E915CF11CD8AB7E6EA73F30C61F35D` before overwrite, after overwrite, and after the installed smoke matrix.
- Implementation PR [#32](https://github.com/hejiahang0001-oss/dsh-desktop/pull/32) passed all three jobs in run [32872710785](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32872710785) and merged as `1917277853d73e7b5b7be886735b83ab541867af`. Main CI run [32872841947](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32872841947) passed the same three jobs.
- [V0.5.20](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.20) is non-draft, marked Pre-release, and targets the exact merge commit. All three remote asset sizes and GitHub digests match local evidence; the public installer returns HTTP 200, and a clean download reproduces all three SHA-256 values with 2/2 checksum-manifest entries. GitHub formal Latest remains V0.5.4.

## V0.5.19 extension-center evidence (published)

- The local extension center exposes four fixed surfaces: Skills, Plugins, Hooks, and MCP. Each reports bounded source, scope, permission, version, active/disabled/failed counts, and a plain-language boundary; no Skill prose, plugin configuration, Hook script, MCP secret, hidden prompt, or session content enters the renderer.
- Live state uses the pinned Harness Typert Remote endpoint `/api/pluginInventory/list` with envelope method `pluginInventory/list` and payload `{ args: {} }`. The caller accepts only a random IPv4 loopback origin, ordinary-object arguments, fixed endpoint segments, bounded timeouts, matching RPC ids, and bounded/sanitized inventory entries.
- A real pinned Harness smoke passes with 165 total entries, 136 active, zero failed, seven Skill-related entries and four active Skill entries. The fixed closure independently verifies `@deepseek-ai/dsh-skill`, `@deepseek-ai/dsh-mcp-client`, and `@deepseek-ai/dsh-host-plugin-inventory` at `0.1.1-rc.2`.
- MCP has zero live entries in the observed default runtime. The UI therefore reports the client package as ready without claiming that a concrete server is configured. The pinned upstream exposes no independent Hooks inventory or lifecycle API, so DSH reports that boundary and never promotes plugin/install-script text into an invented Hooks state.
- Existing controlled install, upgrade, uninstall, toggle, crash recovery, and last-known-good rollback remain below the same window. The new live inventory is read-only and never replaces those verified Profile transactions.
- Focused extension-center, fixed-closure, and UI tests pass 10/10. The complete source suite passes 201/201 after the release-facing documentation gate was advanced to V0.5.19; the production dependency audit reports no known vulnerability.
- Both unpacked and installed ten-part matrices pass desktop, real Harness, IPC, PDF, context sources, extension center, worktrees, Tasks/Subagents, Side Chat, and a real credential-isolated PTY. The final unpacked package contains 29,787 files and 692,626,330 bytes; the installed tree contains every unpacked file with equal length plus only the normal uninstaller. Both trees have zero reparse points and matching `app.asar` SHA-256 `B2F16F7D80676446A834CECA6DD2B96F1183C82AE6070930FF6928F21DE60F03`.
- The final installer is 183,999,047 bytes with SHA-256 `2913E2FC1C9DC7BDE5D2D3014F428272D3506D5440687D4AEC8AB93C7FADE6A6`; its 189,055-byte blockmap hashes to `C6B627EFE5E63899E5E05B61DF32AA808495E0EDDAD6839689D3D185EE51DC9F`. V0.5.18 to V0.5.19 reuses 183,054,366 bytes (99.4866%), leaving 944,681 differential bytes. The installer remains unsigned and automatic update remains disabled.
- Silent overwrite exits 0 and registers V0.5.19. Backup `backups/pre-v0.5.19-final-20260825-213155` contains 27 credential-free semantic files and all three V0.5.18 release assets with zero copy mismatch or reparse point. The semantic manifest SHA-256 remains exactly `D4DC1C46139CE2237846FFE28AA40D4F13E915CF11CD8AB7E6EA73F30C61F35D` before overwrite, after overwrite, and after the installed smoke matrix.
- Final unpacked and installed extension-center captures are 1419×1025 and visibly preserve four cards, explicit Hooks/MCP boundaries, fixed runtime closure, and the lower controlled lifecycle surface.
- Implementation PR [#30](https://github.com/hejiahang0001-oss/dsh-desktop/pull/30) passed all three jobs in run [32857098053](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32857098053) and merged as `53df6dc3765c36c56e480369723d9531053ffbcc`. Main CI run [32857243413](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32857243413) passed the same three jobs.
- [V0.5.19](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.19) is non-draft, marked Pre-release, and targets the exact merge commit. All three remote asset sizes and GitHub digests match local evidence; the public installer returns HTTP 200 with the exact content length, and a clean download reproduces all three SHA-256 values with 2/2 checksum-manifest entries. GitHub formal Latest remains V0.5.4.

## V0.5.18 Side Chat evidence (published)

- Side Chat uses only official Harness Workspace and `session.list/create/fork/prompt/rename/history` seams. Nonblank ordinary sessions preserve parent lineage; blank sources create another ordinary member in the same Workspace. Running, pending, queued, subagent, missing, or wrong-directory sources fail closed.
- DSH submits `/permission workspace-write` and waits for the durable permission projection. A real rc.2 Harness smoke exposed that an accepted slash-command receipt can arrive before its projection; the controller now treats only the projection as final confirmation. The main session's full durable projection, cwd, lineage, and running state are fingerprinted before and after creation.
- The second BrowserWindow uses a random non-persistent Electron partition, has no DSH IPC bridge or Node integration, and denies popups, webviews, downloads, redirects, and external main/subframe navigation. Its exact Harness main frame alone may request sanitized clipboard writes. Closing clears the partition but intentionally retains the official Harness session record.
- Every Electron release-smoke target redirects `userData` before app readiness. The first candidate smoke revealed one Chromium `electron.media.device_id_salt` rotation in the real Preferences file; after isolation and final rebuild, the real 27-file profile remains byte-identical across the complete unpacked and installed smoke matrices.
- Focused Side Chat tests pass 6/6, the complete source suite passes 196/196, and the production audit reports no known vulnerability. The final unpacked and installed ten-part matrices cover desktop, real Harness, IPC, PDF, context sources, extension health, worktrees, Tasks/Subagents, Side Chat, and a real credential-isolated PTY.
- The final unpacked tree contains 29,787 files and 692,604,565 bytes. The installed tree contains all unpacked files with equal lengths plus only the normal uninstaller; neither tree has a reparse point. Packaged and installed `app.asar` SHA-256 both equal `6BAB9C0A346AEBCAD50259F697481895FF73D001E06C4E8B5E1CF1BBE773AF3D`.
- The final installer is 183,995,185 bytes with SHA-256 `605DF28C7149D8AF535CACA9BDD6817C2163BE51270686E255B53EBB0876F33D`; its 188,939-byte blockmap hashes to `989D0A696A26264BF9EEF93573F492DDFFAF3C1E317FB702D963A03C62012EA6`, and the checksum manifest hashes to `0ACAB1E7B5B9E41DCDEA70955B832FDD54D1C6FF1FCABBC16AD23915D2212D2A`.
- Differential reuse from V0.5.17 is 183,106,241 bytes (99.5169%), leaving 888,944 bytes. The installer is unsigned and automatic update remains disabled.
- Silent overwrite exits 0 and registers V0.5.18. Snapshot `backups/pre-v0.5.18-final-20260825-201721` contains 27 credential-free semantic files plus V0.5.17 release assets with zero copy mismatch or reparse point. The semantic manifest SHA-256 is exactly `D4DC1C46139CE2237846FFE28AA40D4F13E915CF11CD8AB7E6EA73F30C61F35D` before overwrite, after overwrite, and after installed smoke.
- Implementation PR [#28](https://github.com/hejiahang0001-oss/dsh-desktop/pull/28) passed quality, production-security, and package/semantic-data jobs and merged as `aca28b52719ee221912a6d90075c6c87733cf67b`. Main CI run [32848268778](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32848268778) passed the same three jobs.
- [V0.5.18](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.18) is non-draft, marked Pre-release, and targets the exact implementation merge. Its three remote asset sizes and GitHub digests match local evidence; the public installer returns HTTP 200, and clean re-download hashes match all three local SHA-256 values with 2/2 checksum-manifest entries. GitHub formal Latest remains V0.5.4.

## V0.5.17 tasks and subagents evidence (local release gates complete)

- The local-only Tasks/Subagents window reads the official `session.list` and bounded `subagent.list` catalogs; ordinary forks never enter the tree. It renders at most 32 entries across five levels and treats diagnostic rows as disabled.
- Opening a child persists the exact catalog-derived parent/child/mode address before Harness reloads. Follow-up and interrupt actions accept only opaque 24-hex renderer ids, re-list the exact parent, and reject stale, mismatched, one-shot, or unavailable-parent requests. Human follow-up content is one 1–8000-character text block.
- A successful `subagent.prompt` is described only as FIFO inbox acceptance. A successful `subagent.interrupt` is described only as an admitted interrupt request; the UI states that the child may remain visibly running and queued follow-ups remain parked. Native interrupt confirmation defaults to Cancel, and the controller revalidates that the child is still running after confirmation.
- Background jobs are a read-only projection of the official Web job popover backed by `jobsBySession`; DSH does not create a parallel registry or invent a human kill seam. Job labels are bounded and redact credential assignment, bearer, and `sk-*` shapes before reaching the local renderer.
- Persisted session `cwd` is compared with the active DSH workspace to label current-worktree, other-directory, and unrecorded children. Two running sessions on one directory produce a visible sharing warning but no automatic migration.
- The source suite passes 190/190 and the focused task/UI suite passes 7/7. Production dependency audit reports no known vulnerabilities. A review-added race test proves that an already-ended child cannot receive a stale interrupt request.
- The final unpacked tree contains 29,787 files and 692,578,430 bytes. Desktop, Harness, IPC, PDF, context sources, extension health, worktrees, Tasks/Subagents, and the real PTY pass in both unpacked and installed form. The final 1539×1085 unpacked and installed task screenshots visibly contain the prompt editor and Send action.
- `DSH-Desktop-Setup-0.5.17.exe` is 183,991,125 bytes with SHA-256 `F9A6478C2A99CC99644F21A5A704EE493500FDF0B81BC6F2FB54C6DA30EB22CD`. Its 188,963-byte blockmap has SHA-256 `3BF702905D416C251AA6C4DA697C23D9DEB61049B293D8E5F330CB7D556C95BA`; the checksum manifest has SHA-256 `615D276422BF9A6A84E4BBB69F230B7BE850614C09F5D83CF8BD1F49BDB0D23F`.
- V0.5.16 to V0.5.17 reuses 182,962,134 of 183,991,125 bytes (99.4407%) with an estimated 1,028,991-byte differential. The installer is unsigned, signature verification and channel separation are not ready, and automatic update remains disabled.
- Silent overwrite exits with code 0 and registers `DSH Desktop 0.5.17`. The installed tree contains every unpacked file with equal length and only adds the normal uninstaller; it has zero reparse points. Packaged and installed `app.asar` SHA-256 both equal `BC7413B26F890B8045BA0916F00EE10BE00AB55D347D9F204DC41395A6935614`.
- The pre-overwrite snapshot `backups/pre-v0.5.17-20260825-175915` retains the V0.5.16 installer, blockmap, and checksum manifest. All 27 semantic files, including 14 sessions and two Profile files, match exactly before overwrite, after overwrite, and after installed smoke; no credential-named file or reparse point was copied.
- [PR #26](https://github.com/hejiahang0001-oss/dsh-desktop/pull/26) and its CI run 32837455967 pass all three jobs. Merge commit `23e955aeae79ce89b8579e1b9e2475b245827d6d` passes all three jobs again in [main-branch CI run 32837559866](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32837559866).
- The published [v0.5.17 release](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.17) is a non-draft Pre-release targeting the merge commit. GitHub reports the installer, blockmap, and checksum manifest with exact local sizes and SHA-256 digests; the public installer returns HTTP 200 and content length 183,991,125. V0.5.4 remains GitHub's formal Latest release.

## V0.5.16 worktree evidence

- The local worktree renderer exposes only fixed refresh/create/activate/reveal/remove methods and opaque 24-hex identifiers. It contains no branch, path, command, or Git-argument input; its BrowserWindow remains local-only, sandboxed, context-isolated, and navigation-blocked.
- Creation always generates a `dsh/worktree-*` branch and a direct child of `%APPDATA%/DSH Desktop/worktrees/<repository-hash>`. The manager validates real directories, rejects links/junctions and subdirectory workspace roots, caps total and managed counts, and disables activation/removal for unsafe or unavailable paths.
- External Git worktrees remain read-only. A path or branch that merely resembles a generated DSH worktree is still external unless an atomic ownership record matches its repository, path, and branch. Only a recorded, healthy, non-current, unlocked worktree can be removed. A dirty worktree receives or reuses an exact private Git recovery checkpoint before removal; the complete branch/head/status/path fingerprint is then rechecked and any change aborts the operation. The branch and head remain after directory removal.
- Git runs through `execFile` without a shell, with bounded output and timeout. The child environment removes `DEEPSEEK*` and Git directory, worktree, index, object, configuration, SSH, and numbered config overrides; creation also fixes `core.hooksPath=NUL`.
- The final source suite passes 183/183, the focused worktree/UI suite passes 9/9, and the production audit reports no known vulnerability. The unpacked tree has 29,787 files and 692,524,327 bytes; all eight unpacked and installed smoke classes pass.
- The real worktree smoke creates a dirty DSH-owned worktree, renders two cards with the expected fixed actions and no Key marker, creates or verifies a private checkpoint, safely removes the directory, retains the branch, and leaves only the main worktree. A two-frame paint barrier fixed an initially stale loading-state screenshot; the final 1539×1055 image was visually inspected.
- Silent overwrite exits 0 and registers `DSH Desktop 0.5.16`. The installed tree contains every unpacked file plus only the normal uninstaller, has zero size mismatches and zero reparse points, and shares `app.asar` SHA-256 `9ED240A572ECABEF5A65DF56AD81F22AFD2C0BD3D3D9A2B3BB1583A6356B64EB`.
- The 27-file semantic manifest is byte-identical before overwrite and after installed smoke: fourteen sessions, two Profile files, and manifest SHA-256 `DC196E825AB811D95A477CCF09911ED3F6F2B67A298F49E5A2DD55DF34B5F949`. Backup `pre-v0.5.16-20260825-134010` contains the three V0.5.15 release assets with zero copy mismatch, credential-named file, or reparse point.
- The final installer is 183,982,493 bytes with SHA-256 `FF87D8D55892899EAF12CFF9C2DC0720663BCAF627412491E075E9B5F0C590F8`; its 188,923-byte blockmap hashes to `6FF72CA24ADCE1F556DF3DE9464548142BC7EF52F83CAD17CD1763A0D6312176`. Differential reuse from V0.5.15 is 182,912,276 bytes (99.4183%), leaving 1,070,217 bytes. The PE remains unsigned, so automatic update stays disabled. PR #24 and main-branch CI run 32820893222 pass; the non-draft V0.5.16 Pre-release targets `4266f248340d8378ad29b4bd4efb2176eef6c5e9`. All three downloaded assets exactly match local size and SHA-256, and the public installer returns HTTP 200 with content length 183,982,493.

## V0.5.15 plugin-lifecycle evidence

- Only `@nonamelego/dsh-catppuccin` remains available, with separately fixed `0.3.0` and `0.3.1` integrity values. Renderer input is limited to opaque Profile/catalog ids and the `install`, `upgrade`, `uninstall`, or `rollback` enum; native confirmation defaults to Cancel.
- The lifecycle journal atomically advances through prepared, running, applied, and committed phases. It stores bounded byte snapshots and hashes for only `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`; a committed operation writes one current/restore last-known-good pair.
- Startup recovery accepts the atomic backup if the primary journal is invalid. It automatically restores only a byte-exact applied state or a running manifest whose non-plugin fields equal the previous manifest. A simulated unrelated field edit produces `conflict`, preserves that field, and blocks further Profile mutations.
- Lifecycle state rejects unreviewed versions, undeclared package residue, missing packages, malformed dependency/bundle structures, invalid snapshot encodings, package resolution outside Profile `node_modules`, and absent-version states marked enabled.
- Semantic overwrite snapshots include the bounded Profile pnpm files and desktop lifecycle/toggle records but never descend into Profile `node_modules`. Credential files, LevelDB logs, and other transient data remain excluded.
- The final version-number source suite passes 174/174 and the production dependency audit reports no known vulnerability. Unit scenarios cover install/uninstall/rollback, disabled `0.3.0` upgrade and exact restoration, applied crash recovery, conflicting edits, corrupt-primary backup recovery, running-phase uninstall recovery, and exclusive journal ownership across two lifecycle managers.
- Real isolated rehearsals against unpacked and installed V0.5.15 resources complete reviewed `0.3.0`→`0.3.1` upgrade, simulated-crash startup recovery, upgrade rollback, uninstall, uninstall rollback, and inverse rollback. All 22 child-command observations prove the software Key absent and bundled pnpm first. The rehearsal exposed and fixed the valid Harness behavior that removes the complete `dependencies` property when the last plugin is removed.
- The unpacked tree contains 29,785 files and 692,356,703 bytes. Seven unpacked and seven installed smoke classes pass; the installed tree contains every one of the 29,787 unpacked raw files plus only `Uninstall DSH Desktop.exe`, has zero reparse points, and shares packaged `app.asar` SHA-256 `A5F58150E4FA1602A2DA10DEBA64BEAB807CC07A1DDD7ADFD4F3CC067A994DF9`.
- The final installer is 183,973,500 bytes with SHA-256 `BFBC4FEB21512AA24D67ABB553DF9B67FE1BB68575D7A8C089586B96CAB00BDA`; the 188,904-byte blockmap has SHA-256 `237DA59196A96E8919E249F25DB7191BB252003F16E390E1A969676F804F968D`. V0.5.14→V0.5.15 differential reuse is 183,045,581 bytes (99.4956%), with 927,919 differential bytes.
- Windows Authenticode and structural PE checks report unsigned; Publisher, trusted chain, signature verification, and separated-feed evidence remain absent, so automatic update stays fail-closed.
- Silent overwrite exits 0 and registers V0.5.15. The semantic manifest is identical before overwrite, after overwrite, and after installed smoke: 27 files, fourteen sessions, two Profile files, and canonical aggregate `5770CFD30539FDDAAB931FB715EE114570385F984A0E73E5706E89BF3BFAF30D`. Backup `pre-v0.5.15-20260825-122152` preserves those files and the V0.5.14 release assets with no credential-named file or reparse point.
- [PR #22](https://github.com/hejiahang0001-oss/dsh-desktop/pull/22) and [main CI run 32809740429](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32809740429) pass all three Windows jobs. [v0.5.15](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.15) is a non-draft Pre-release targeting `b938107b4865a054b71f087630b5172a45485ee7`; all three remote assets match local sizes and SHA-256 values, and the public installer endpoint returns HTTP 200 with `Content-Length: 183973500`. Stable V0.5.4 remains GitHub's formal Latest release.
- After exact backup hash checks, the local V0.5.14 installer, blockmap, and checksum manifest were moved to the Windows Recycle Bin. They remain recoverable from there or `backups/pre-v0.5.15-20260825-122152`; local `dist` keeps only Stable V0.5.4 and product Latest V0.5.15 release assets.

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
