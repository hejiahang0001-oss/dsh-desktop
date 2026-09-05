# DSH Desktop V1.1.3

V1.1.3 is the local Latest candidate that supersedes the unpublished V1.1.2 hotfix candidate. It retains the V1.1.2 cross-workspace interruption and Office-file drag fixes and upgrades the bundled DeepSeek Harness runtime from `0.1.2-alpha.2` to `0.1.2-alpha.5`.

## Changes

- Pin official Harness tag `dsh-v0.1.2-alpha.5`, commit `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`, built with its frozen lockfile and pnpm `11.7.0`.
- Adapt desktop worktree/session handoff to alpha.5 seeded-session metadata and exact inherited-history offsets.
- Use the official command plane for unattended permission changes; slash text submitted through the prompt API is no longer mistaken for a command.
- Retain current-session workspace resolution for interruption, queue continuation, drafts and Office-file drag/drop.
- Wait for two compositor frames before Office acceptance screenshots to avoid capturing an unpainted native surface.
- Refresh the third-party inventory to the actual alpha.5 package closure.

## Validation status

- Official source build and link-free runtime assembly pass: 242 DSH packages plus 9 Cordis packages, 251 total; 23,866 files, 244,440,170 bytes and zero reparse points.
- Five copied JSONL-Zstd histories remain byte-source-preserving and semantically hash-identical between alpha.2 and alpha.5.
- Source free matrix passes 8/8: Harness, document intake, Git review, native dock, continuity, IPC security, Office center and PDF.
- Source real-model acceptance passes background tasks (22 checks), workflow interruption (6 checks), worktree/session handoff (12 checks), and encrypted software-Key Office reads. An intentionally invalid `DEEPSEEK_API_KEY` in the child environment does not override the DPAPI-backed software Key.
- Cross-workspace source acceptance passes 3/3: real XLSX/DOCX/PDF drag lifecycle, draft continuity and a real-model up-arrow interruption/reply.
- Packaged acceptance passes the free 8/8 matrix, real-model 4/4 matrix, cross-workspace 3/3 matrix and isolated terminal smoke. Packaged application code and the desktop session-control resource match the tested source hashes.
- Release governance reports `packageReady=true`, Harness `0.1.2-alpha.5` at `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`, 251 runtime packages and zero reparse points. The 188,642,919-byte Setup SHA-256 is `2b1da8b3e00576c7260a0e4baa9d22852e009ffb93c958008051706fef60d8e7`; the 187,951,419-byte Portable SHA-256 is `211873da5883b78ad51e241ef426357ed018de2ee0513ceaf8fe369ad19cd311`.
- The maintainer machine was overwrite-installed from V1.1.1 to V1.1.3. The installer exited 0, registration and five core resources match the candidate, and the pre/post semantic snapshot, encrypted Key and Electron Local State hashes are unchanged. A verified 33-file pre-install backup excludes credential files.
- Installed acceptance passes the free 8/8 matrix, real-model 4/4 matrix, cross-workspace 3/3 matrix and isolated terminal smoke. One first-run background smoke stopped before model work with Electron `UnknownVizError`; its evidence is retained, while a focused rerun and a fresh complete real-model matrix passed without changing the binary or assertions.
- Final source verification passes 419/419 with zero failures or skips; the production dependency audit reports no known vulnerabilities, and all three checksum entries match the generated artifacts.

This candidate has not been published to GitHub.

## Boundaries

- V1.1.0 Stable is unchanged. Publishing V1.1.3, if approved, is a Pre-release/Latest action and does not promote Stable.
- The installer is not code-signed and automatic installation remains disabled.
- Alpha.3 removed optional SQLite Session persistence. DSH validates its default JSONL-Zstd history only; custom SQLite migration is not promised.
- Windows Workspace Write PowerShell can still exit with `0xC0000005`. DSH does not silently elevate ordinary sessions; the credential/Office acceptance uses an explicitly selected Full Access preset in an isolated generated workspace.
- The active runtime closure is not every package in the upstream monorepo and does not silently enable community plugins.

See the [alpha.5 compatibility map](HARNESS_UPSTREAM_v0.1.2-alpha.5.md) and [execution evidence](../PROGRESS.md).
