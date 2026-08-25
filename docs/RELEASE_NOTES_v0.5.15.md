# DSH Desktop V0.5.15

V0.5.15 completes the first fixed-catalog plugin lifecycle. Stable remains V0.5.4; DeepSeek Harness remains pinned to `0.1.1-rc.2`, Electron to `43.4.1`, Node.js to `24.19.0`, and bundled pnpm to `11.19.0`.

## Reviewed lifecycle

- The catalog still exposes only `@nonamelego/dsh-catppuccin` for the Web Profile. `0.3.0` and `0.3.1` are the only reviewed versions, each with a fixed integrity digest.
- The local Extension Health window offers only enumerated install, upgrade, uninstall, rollback, enable, and disable actions. It has no package, version, registry, path, command, or pnpm-argument input.
- Every lifecycle action uses native default-cancel confirmation, rechecks busy and health gates, runs through bundled Node.js/pnpm with scripts disabled and the software Key removed, restarts Harness, and verifies the final version, enable state, Patch, platform, peers, and runtime health before commit.
- A committed action records one last-known-good state. Rolling back swaps the current and prior verified states, so the most recent rollback can itself be undone.

## Persistent recovery

- A bounded atomic journal records `prepared`, `running`, `applied`, and `committed` phases. It contains only fixed package/Profile identity, reviewed lifecycle states, timestamps, and byte snapshots of `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`.
- Each tracked file is limited to 8 MiB and the combined snapshot to 16 MiB. Every snapshot entry carries an exact byte count and SHA-256 digest; the primary lifecycle record is capped at 48 MiB.
- Startup recovery reads the atomic backup when the primary record is invalid. It auto-recovers only an exact applied snapshot or a running mutation whose manifest differs solely in the controlled plugin dependency/bundle fields.
- An external manifest edit, unknown version, invalid journal, missing package, or package path outside the Profile boundary blocks that Profile instead of overwriting uncertain state.
- Semantic overwrite checks now include bounded Profile manifests, locks, workspace declarations, toggle journals, lifecycle journals, and last-known-good records while excluding `node_modules`, credentials, and transient logs.

## Validation status

- The final version-number source suite passes 174/174 and the production dependency audit reports no known vulnerability. The added concurrency regression proves that a second lifecycle manager cannot remove or replace an existing transaction claim.
- Real isolated pnpm rehearsals using unpacked and installed V0.5.15 resources complete reviewed `0.3.0`→`0.3.1` upgrade, simulated-crash startup recovery, upgrade rollback, uninstall, uninstall rollback, and inverse rollback. All 22 observed child commands exclude the software Key and select bundled pnpm first.
- The real rehearsal found that removing the last dependency can remove the complete `dependencies` property. The final reader accepts an absent property as an empty dependency set, and a regression test covers the behavior.
- The unpacked tree contains 29,785 files and 692,356,703 bytes. Seven unpacked and seven installed smoke classes pass; the installed tree contains every unpacked raw file plus only the normal uninstaller, and packaged/installed `app.asar` both hash to `A5F58150E4FA1602A2DA10DEBA64BEAB807CC07A1DDD7ADFD4F3CC067A994DF9`.
- The silent overwrite registers V0.5.15 and preserves all 27 semantic files, fourteen sessions, and two Profile files byte-for-byte with aggregate `5770CFD30539FDDAAB931FB715EE114570385F984A0E73E5706E89BF3BFAF30D`. The rollback point is `backups/pre-v0.5.15-20260825-122152`.
- The installer is 183,973,500 bytes with SHA-256 `BFBC4FEB21512AA24D67ABB553DF9B67FE1BB68575D7A8C089586B96CAB00BDA`; its 188,904-byte blockmap hashes to `237DA59196A96E8919E249F25DB7191BB252003F16E390E1A969676F804F968D`. V0.5.14→V0.5.15 reuses 183,045,581 bytes (99.4956%), leaving 927,919 differential bytes.
- The installer remains unsigned and automatic update remains fail-closed. [PR #22](https://github.com/hejiahang0001-oss/dsh-desktop/pull/22) and [main CI run 32809740429](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32809740429) pass all three Windows jobs. [V0.5.15](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.15) is a non-draft Pre-release targeting `b938107b4865a054b71f087630b5172a45485ee7`; all three remote assets match local sizes and SHA-256 values, and the installer endpoint returns HTTP 200 with `Content-Length: 183973500`. V0.5.4 remains the formal Stable and GitHub Latest release.
- After exact rollback-copy hash checks, the local V0.5.14 installer, blockmap, and checksum manifest were moved to the Windows Recycle Bin. They remain recoverable from there or `backups/pre-v0.5.15-20260825-122152`; local `dist` keeps only Stable V0.5.4 and product Latest V0.5.15 release assets.

## Deferred to V0.5.16

- Git worktree creation, task ownership, branch cleanup, and recoverable worktree removal remain V0.5.16 work.
- The catalog is not a general marketplace. Every additional package or version still requires independent source, license, integrity, platform, Patch, peer, install-hook, runtime, and rollback evidence.
