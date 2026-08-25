# DSH Desktop V0.5.19

V0.5.19 replaces the former extension-health view with a unified Skills, Plugins, Hooks, and MCP extension center. Stable remains V0.5.4; DeepSeek Harness remains pinned to `0.1.1-rc.2`, Electron to `43.4.1`, Node.js to `24.19.0`, and bundled pnpm to `11.19.0`.

## Unified extension center

- One local window now exposes four fixed capability cards with source, scope, permission, version, activity, disabled, failure, and boundary information.
- Live facts come from the official Harness `pluginInventory/list` projection. DSH does not maintain a second loader state or infer enabled packages from installation alone.
- The real pinned runtime reports 165 inventory entries, 136 active entries, zero failed entries, seven Skill-related entries, and four active Skill-related entries.
- The fixed runtime independently verifies the official Skill, MCP client, and plugin-inventory packages at `0.1.1-rc.2`.

## Explicit upstream boundaries

- An installed MCP client is not presented as a configured MCP service. The observed default runtime has zero live MCP entries and is labelled ready rather than broken.
- The pinned Harness does not expose an independent Hooks inventory or lifecycle interface. DSH states that limitation and does not treat ordinary plugins, installation scripts, or scanned text as Hooks.
- When the official live inventory is temporarily unavailable, the center reports that fact and retains only verified fixed-package and Profile metadata. It does not invent activity.

## Security and lifecycle

- The renderer receives bounded metadata only. It cannot read Skill prose, plugin configuration, Hook scripts, MCP keys, hidden prompts, or session content.
- The official Remote caller accepts only the current random IPv4 loopback origin, fixed endpoint segments, plain-object arguments, matching RPC responses, and bounded timeouts. Inventory names, phases, counts, and issue lists are sanitized and capped.
- Existing reviewed plugin install, upgrade, uninstall, enable/disable, crash recovery, and last-known-good rollback remain available in the same window. No arbitrary package, registry, version, path, pnpm argument, or command input is added.

## Validation status

- Focused extension-center, fixed-closure, and local-UI tests pass 10/10.
- A real pinned-Harness source smoke passes and records the official inventory counts and capability-package evidence in `artifacts/v0.5.19-source-harness-final.json`.
- The complete source suite passes 201/201 and the production dependency audit reports no known vulnerability.
- Both unpacked and installed ten-part smoke matrices pass desktop, real pinned Harness, IPC, PDF, context sources, extension center, worktrees, Tasks/Subagents, Side Chat, and a real credential-isolated PTY. The unpacked tree contains 29,787 files and 692,626,330 bytes; the installed tree contains the same files plus only the normal uninstaller, with zero missing/different-length files or reparse points.
- Packaged and installed `app.asar` SHA-256 are `B2F16F7D80676446A834CECA6DD2B96F1183C82AE6070930FF6928F21DE60F03`. Reviewed unpacked and installed extension-center captures are both 1419×1025.
- `DSH-Desktop-Setup-0.5.19.exe` is 183,999,047 bytes with SHA-256 `2913E2FC1C9DC7BDE5D2D3014F428272D3506D5440687D4AEC8AB93C7FADE6A6`. Its 189,055-byte blockmap has SHA-256 `C6B627EFE5E63899E5E05B61DF32AA808495E0EDDAD6839689D3D185EE51DC9F`; the 199-byte checksum manifest hashes to `9897A2024C79A9F212DDEDFA51E7CC734026D55F18029D920AE25776E7001253`.
- V0.5.18 to V0.5.19 reuses 183,054,366 installer bytes (99.4866%), leaving 944,681 differential bytes. The installer remains unsigned, so automatic update remains disabled.
- Silent overwrite exits with code 0 and registers V0.5.19. Backup `backups/pre-v0.5.19-final-20260825-213155` contains 27 credential-free semantic files and all three V0.5.18 release assets. The semantic manifest SHA-256 remains `D4DC1C46139CE2237846FFE28AA40D4F13E915CF11CD8AB7E6EA73F30C61F35D` before overwrite, after overwrite, and after all installed smokes.
- Implementation PR [#30](https://github.com/hejiahang0001-oss/dsh-desktop/pull/30) and main CI run [32857243413](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32857243413) pass all three Windows jobs. [V0.5.19](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.19) is a non-draft Pre-release targeting merge `53df6dc3765c36c56e480369723d9531053ffbcc`; remote asset sizes/digests match local evidence, the public installer returns HTTP 200, and a clean three-asset download matches every SHA-256 value with 2/2 checksum-manifest entries. Stable remains V0.5.4.
