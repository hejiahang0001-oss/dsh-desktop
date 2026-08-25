# DSH Desktop V0.6.0

V0.6.0 closes the first integrated parallel-work, extension, and editable Office delivery milestone. Stable remains V0.5.4; the release keeps official DeepSeek Harness `0.1.1-rc.2`, Electron `43.4.1`, Node.js `24.19.0`, and bundled pnpm `11.19.0` pinned.

## Unified Office delivery center

- Adds a local-only Office delivery center that reports the packaged readiness of Word, Excel, and PowerPoint in one window. Each card lists editable output, supported structures, and explicit unsupported content.
- Fixed buttons invoke only the existing `/word-docx`, `/excel-xlsx`, or `/powerpoint-pptx` command in the authoritative Harness composer. The center does not accept arbitrary commands, file paths, package names, or executable input and does not create another Agent loop.
- Shows the V0.6 integration chain for isolated worktrees, Harness-native Tasks/Subagents, and the extension/pnpm center so parallel work, extensions, and file delivery remain visibly bound to the same workspace.

## Preserved delivery capabilities

- Word creates and exactly edits bounded editable DOCX files with headings, lists, tables, workspace PNG/JPEG images, headers, footers, and rollback copies.
- Excel creates, imports, edits, reconciles, and strictly inspects bounded editable XLSX files with typed cells, formulas, styles, filters, frozen panes, and CSV input.
- PowerPoint creates and exactly edits bounded editable PPTX files with native text, shapes, tables, charts backed by embedded Excel data, images, masters, layouts, slide numbers, and notes.
- All three tools remain workspace-contained, transactional, link/junction resistant, credential-isolated, and fail closed on unsupported active or external content.

## Verification status

- The focused Office-center and three Office-preservation suite passes 13/13. The complete source suite passes 251/251, the production dependency audit reports no known vulnerability, and the unpacked real-window smoke renders three Office cards, three integration nodes, and three enabled fixed actions without clipping or overlap.
- Unpacked and installed ten-part GUI matrices plus terminal smokes pass. Source, unpacked, and installed Harness discovery finds all three Office Skills as model-invocable. Microsoft Word, Excel, and PowerPoint 16 each start the maintained acceptance file in an isolated process and remain responsive.
- Silent overwrite registers V0.6.0 and preserves all 27 credential-free semantic files byte-for-byte. The installed tree contains every unpacked file at equal length plus only the normal uninstaller; both trees have zero reparse points and matching `app.asar` SHA-256 `53F51881A682B043CD4193360217D761CE5F079D4B53FB10A64D64EF10BC2D3A`.
- Implementation PR [#38](https://github.com/hejiahang0001-oss/dsh-desktop/pull/38), release-evidence PR [#39](https://github.com/hejiahang0001-oss/dsh-desktop/pull/39), and their main follow-up CI runs all pass three jobs.
- The non-draft [V0.6.0 Pre-release](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.6.0) targets exact merge `80e9be76476f312b2baf427221c0c9174e5a18a0`. GitHub reports 3/3 asset sizes and digests equal to local evidence; a public clean download returns HTTP 200 and matches all three SHA-256 values, while the downloaded checksum manifest passes 2/2 entries. GitHub formal Latest remains V0.5.4.

## Current limits

- The center is an invocation and readiness surface, not an Office editor. Microsoft Office or a compatible editor remains authoritative for final editing and rendering.
- Automatic update remains disabled because the Windows installer is unsigned and the signature, publisher, trust-chain, and Stable/Pre-release feed-separation gates are not complete.

Final installer: `DSH-Desktop-Setup-0.6.0.exe` — 184,045,391 bytes, SHA-256 `863A10686ABBB317E2AD564CB4F1E9E07848ED930721626459945D7062F0BEAF`. Its 188,843-byte blockmap hashes to `6177FEF8701C0F14BD038B3ED210A641D5C805D99DE27C5C1F1CB76A2C28EB4C`; the checksum manifest hashes to `5528CC5FCB0F623822E7422F48633B63E60DC892B7348A63CCF2F09FAAE1F252`. Stable remains V0.5.4 unless the maintainer explicitly promotes a tested Latest build.
