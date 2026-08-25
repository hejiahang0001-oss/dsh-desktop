# DSH Desktop V0.5.16

V0.5.16 adds a bounded local Git worktree lifecycle for isolated coding tasks. Stable remains V0.5.4; DeepSeek Harness remains pinned to `0.1.1-rc.2`, Electron to `43.4.1`, Node.js to `24.19.0`, and bundled pnpm to `11.19.0`.

## Isolated worktrees

- A local-only Worktrees window lists branch, commit, path, owner, dirty state, and availability for every bounded Git worktree in the current repository.
- Creation accepts no user branch, path, command, or Git argument. It generates a `dsh/worktree-*` branch and a direct child of the software-managed per-repository directory.
- External worktrees can be inspected and activated but remain read-only. Only a healthy, non-current worktree with a valid atomic DSH ownership record can be reclaimed; a lookalike path or branch without that record stays external.
- Reclaiming a dirty worktree first writes or reuses an exact private Git checkpoint, rechecks the complete state fingerprint, atomically marks ownership as removing, removes only the worktree directory, and retains the branch and head. A failed Git removal restores owned state only while the directory still exists; ambiguous states remain read-only.
- Create, activate, and reclaim use native confirmation with Cancel selected by default. Switching restarts Harness against the chosen workspace without deleting either worktree.

## Security boundaries

- The worktree renderer receives seven narrow IPC capabilities and submits only a fixed action plus an opaque identifier. It has no Node integration and cannot navigate away from its local page.
- Path validation requires exact real directories and rejects symbolic links, junctions, unavailable paths, subdirectory workspace roots, and targets outside the fixed managed root. Atomic ownership state is backed up with semantic user data and fails closed to read-only when missing or invalid.
- Git commands use `execFile` without a shell, bounded output, a fixed timeout, and an environment stripped of the software DeepSeek Key plus Git execution/configuration overrides.

## Validation status

- The final source suite passes 183/183, the focused worktree/UI suite passes 9/9, and the production dependency audit reports no known vulnerability. Regression cases include link rejection, total-count limits, lookalike external worktrees, durable ownership, state-change refusal, failed-remove ownership recovery, and exact checkpoint reuse.
- The unpacked tree contains 29,787 files and 692,524,327 bytes. Eight unpacked and eight installed smoke classes pass: desktop, Harness, IPC security, PDF, context sources, extension health, worktrees, and the real PTY. The worktree smoke creates a dirty owned worktree, renders two cards, proves the Key hidden, writes a recovery checkpoint, reclaims the directory, retains the branch, and leaves one main worktree.
- The real worktree screenshot was inspected after a two-frame paint barrier; Chinese labels, ownership and dirty badges, paths, and fixed switch/reveal/reclaim actions are visible. An earlier loading-state capture exposed and fixed this visual-smoke timing gap.
- The installed tree contains every one of the 29,787 unpacked files plus only `Uninstall DSH Desktop.exe`, with no missing/size-mismatched file and zero reparse points. Packaged and installed `app.asar` both hash to `9ED240A572ECABEF5A65DF56AD81F22AFD2C0BD3D3D9A2B3BB1583A6356B64EB`.
- Silent overwrite exits 0 and registers `DSH Desktop 0.5.16`. All 27 semantic files, fourteen sessions, and two Profile files remain byte-identical before overwrite and after installed smoke; the manifest SHA-256 is `DC196E825AB811D95A477CCF09911ED3F6F2B67A298F49E5A2DD55DF34B5F949`. Rollback point `backups/pre-v0.5.16-20260825-134010` contains the V0.5.15 release assets, zero hash mismatches, zero credential-named files, and zero reparse points.
- The installer is 183,982,493 bytes with SHA-256 `FF87D8D55892899EAF12CFF9C2DC0720663BCAF627412491E075E9B5F0C590F8`; its 188,923-byte blockmap hashes to `6FF72CA24ADCE1F556DF3DE9464548142BC7EF52F83CAD17CD1763A0D6312176`. V0.5.15→V0.5.16 reuses 182,912,276 bytes (99.4183%), leaving 1,070,217 differential bytes.
- The installer remains unsigned and automatic update remains fail-closed. CI, GitHub Pre-release creation, and remote three-asset verification remain pending; `DSH-Desktop-Setup-0.5.16.exe` is a local release candidate until those final remote gates pass.

## Deferred to V0.5.17

- Tasks/Subagents visibility and controlled messaging remain V0.5.17 work. V0.5.16 provides the isolated workspace primitive but does not invent a parallel Agent loop.
