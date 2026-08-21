# Validation evidence

This page preserves the detailed V0.3.7 engineering evidence without making the README front page carry the full verification ledger.

## Automated and runtime checks

- 43 Supervisor, workspace mapping, loopback safety, health-check, session catalog, credential precedence, Agent/tool/Diff state, and isolated temporary-Git accept/reject tests pass.
- Development mode, the production hoisted runtime, and the Windows x64 unpacked application all start the real Harness service and receive HTTP 200 from a random loopback address.
- The installer contains 29,201 Harness files and no reparse points, avoiding NSIS expansion of pnpm links.
- The NSIS medium passes a 7-Zip structure test with `Everything is Ok`.
- The installed application and packaged smoke both report Harness ready and the target Workspace synchronized.

## Release integrity

| Item | V0.3.7 value |
| --- | --- |
| Installer | `DSH-Desktop-Setup-0.3.7.exe` |
| Size | `158,432,047` bytes |
| SHA-256 | `005C4F7FA224E71E1BDC284053F0BF6C998A424792F1F89BD7F0EBE9F77892E6` |
| Files in NSIS medium | `29,278` |
| Packaged `app.asar` SHA-256 | `B7A17CFEE05BB63270AA4A360360C65422B73EEE0B45892CE14F1A2A2C83F1D2` |

The installed `app.asar` and the unpacked build have the same SHA-256.

## Persistence and credential checks

- V0.3.7 was installed over V0.3.6 and the Windows uninstall record reports `DSH Desktop 0.3.7`.
- Eight persisted session files remained after the upgrade.
- The software-managed Key remained configured and retained software-first precedence.
- Validation did not read, display, copy, or transmit plaintext credential values.

## Real-model and review-flow checks

- `DeepSeek-V4-Flash High` completed a real 1,000-item square-output task in about 29 seconds with approximately 3.1K output tokens.
- A real long-running response exercised running state, supplemental input, queued input, interruption, and native-menu stop behavior; the application returned to idle without a misleading error.
- A restricted-mode PowerShell test reproduced the rc.8 Workspace Write exit `3221225477 (0xC0000005)`. DSH Desktop accurately displayed the failure and did not claim success.
- An isolated Full Access validation session completed real file reading, targeted editing, and a PowerShell test with exit code 0 and an independent test re-check.
- In an isolated Git repository, a real model changed `alpha=1` to `alpha=2`; DSH Desktop accepted and staged it. A second change to `alpha=3` was rejected and restored. The final worktree and index both remained at `alpha=2`.

## Evidence boundary

These statements describe the locally verified V0.3.7 build. They do not imply that DeepSeek endorses DSH Desktop, that Harness rc.8 is production-stable, or that the unsigned installer will pass every Windows reputation check.
