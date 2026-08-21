# Validation evidence

This page preserves the detailed V0.3.8 engineering evidence without making the README front page carry the full verification ledger.

## Automated and runtime checks

- 50 Supervisor, workspace mapping, loopback safety, session catalog, credential precedence, Agent/tool/Plan/Diff state, and isolated temporary-Git tests pass.
- The Windows x64 unpacked and installed applications start the real Harness service and receive HTTP 200 from a random loopback address.
- The installer contains 29,201 Harness files and no reparse points, avoiding NSIS expansion of pnpm links.
- The NSIS medium passes a 7-Zip structure test with `Everything is Ok`.
- The installed application reports version 0.3.8, Harness ready, and the target Workspace synchronized.
- The installed window and native menus were visually checked: Plan was available, and the software Key reported configured with software-first precedence.

## Release integrity

| Item | V0.3.8 value |
| --- | --- |
| Installer | `DSH-Desktop-Setup-0.3.8.exe` |
| Size | `158,435,283` bytes |
| SHA-256 | `4F1124B398AD5EB4CA617618E8F992776B94CFFA9FD54BE1BED5000D03F8022C` |
| Files in unpacked medium | `29,278` |
| Packaged `app.asar` SHA-256 | `572FB792EAD949BAE49D3753E5C9D3CE57963DFD00107D1DD2337D7C6417AD36` |

The installed `app.asar` and the unpacked build have the same SHA-256.

## Persistence and credential checks

- V0.3.8 was installed over V0.3.7 and the Windows uninstall record reports `DSH Desktop 0.3.8`.
- Nine zstd persisted sessions remained discoverable after the upgrade.
- The software-managed Key remained configured, retained software-first precedence, and ignored a competing environment value.
- Validation did not print, copy, or include plaintext credential values in the backup.
- The usable pre-upgrade snapshot is `backups/pre-v0.3.8-20260822-015639`; it contains 31,507 files, no credential file, and no reparse point.

## Real Plan and multi-file review checks

- `DeepSeek-V4-Flash High` entered the official rc.8 Plan mode for a three-file task.
- Harness presented its official `exit_plan_mode` execution card; execution started only after “确认执行” was approved.
- The model changed `alpha.txt` and `beta.txt` from 1 to 2 and created `gamma.txt` with 2.
- DSH Desktop listed all three changes with pending/protected/accepted counts and enabled guarded batch actions.
- Batch accept placed all three files in the Git index.
- A second real model turn changed all three values from 2 to 3. Batch reject restored the worktree to the staged value 2 while preserving the existing staged changes.
- The real task used Read/Edit/Write file tools for the target changes; no unrelated file was changed.

## Evidence boundary

These statements describe the locally verified V0.3.8 build. The multi-file review is currently a native menu hierarchy rather than a persistent Diff panel. This evidence does not imply that DeepSeek endorses DSH Desktop, that Harness rc.8 is production-stable, or that the unsigned installer will pass every Windows reputation check.
