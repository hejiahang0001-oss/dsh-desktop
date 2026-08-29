# DSH Desktop V0.6.4

V0.6.4 adds bounded active-project knowledge synchronization to the native Wiki center while keeping V0.5.4 as Stable. DeepSeek Harness remains pinned to `0.1.1-rc.2`, Electron to `43.4.1`, Node.js to `24.19.0`, and bundled pnpm to `11.19.0`.

## Added

- A fifth bundled Wiki Skill, `/wiki-update`, incrementally distills architecture, decisions, constraints, and reusable project knowledge from the active workspace.
- The Wiki center can preview the current project's added, modified, and removed source-file counts, then return to the current Harness conversation with `/wiki-update` loaded.
- Git HEAD and ancestry are recorded when Git is available. A bounded content inventory provides the same user workflow in ordinary no-Git directories.

## Safety and integrity

- Source scanning excludes common credential files, secrets, dependency trees, build output, binary files, oversized files, and temporary `.dsh-wiki-*` specifications. File bytes, directory depth, directory entries, total entries, files, and aggregate content are independently bounded.
- The source workspace is desktop-owned and fixed to the active project. The Agent cannot redirect project sync to an arbitrary chat-supplied directory.
- Existing Wiki pages require an exact SHA-256 from a fresh read; untracked human pages are never overwritten.
- Every page records source paths and extracted/inferred/ambiguous provenance. Existing reviewed, verified, or disputed lifecycle state is preserved.
- Save requires explicit confirmation, repeats source and page checks, rejects Windows alternate-stream/reserved paths, serializes concurrent writers with a recoverable cross-process lock, updates the manifest/index/log/hot cache atomically, and keeps a recovery copy under `_archives/dsh-project-sync`. Failed writes roll back.
- A Wiki outside the active workspace remains subject to the official Harness permission control. The Agent never enables Full Access itself; the user must acknowledge it in the native permission UI if a write is blocked.

## Current limits

- V0.6.4 synchronizes only the active project's bounded text/code inventory. It does not batch-import DSH history, crawl the web, install QMD, or control Obsidian UI.
- Stable remains V0.5.4. V0.6.4 has passed every local source, package, overwrite-install, installed-runtime, real-model, and data-retention gate; it remains a product Latest candidate until CI and public-asset verification finish.

## Validation

- The complete source suite passes 279/279 and the production dependency audit reports no known vulnerability.
- Source, unpacked, and installed Harness runs discover all four user-facing Wiki Skills. Real DeepSeek project sync passes in source and installed modes with preview/validation separated from confirmed save, no `.env` access, no broad installation-path search, and the fixed desktop runtime used by the second tool call at the latest.
- The final installer is 184,077,501 bytes with SHA-256 `1BFC8BDF230D7B1A26910E7A5B717D59C2373DCC50409E15FEB119B49F0DFEC8`. Its 189,098-byte blockmap hashes to `895283BBC78DE3E5DF4E6DE060E92DB92131B6D06D4450C50ED9A3143653B4D2`; the two-entry checksum manifest hashes to `153DED656E1C4199B65849CAC00B2767DA75B31CD9EABECC98956D7667D9D963`.
- Release governance reports `packageReady: true`, zero reparse points, complete fixed Node/pnpm/Office/Wiki payloads, and 99.4482% reusable bytes versus V0.6.3. Signing and automatic updates remain intentionally unavailable.
- Silent overwrite exits 0 and Windows registers V0.6.4. The installed eleven-part GUI matrix, packaged terminal, Wiki basics, and real-model project sync pass. Installed and unpacked `app.asar` both hash to `4B427E8CFFB74804653BA519AE7BE4CB85FB5C448FECA3061383BE7EA8BA4924`.
- All 28 credential-free semantic files, including 15 sessions, remain byte-identical before install, after install, and after the full installed regression matrix.
- A final 2026-08-30 registry check confirms npm `latest` and `next` both remain `@deepseek-ai/dsh@0.1.1-rc.2`. The GitHub-only `dsh-v0.1.2-alpha.1` tag is tracked as a separate pre-V0.7 compatibility candidate rather than silently replacing the npm-distributed runtime.
