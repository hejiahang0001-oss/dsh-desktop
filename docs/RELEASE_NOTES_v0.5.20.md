# DSH Desktop V0.5.20

V0.5.20 adds the first built-in Office delivery capability: editable Word DOCX creation and controlled text replacement through the official DeepSeek Harness Skill path. Stable remains V0.5.4; Harness remains pinned to `0.1.1-rc.2`, Electron to `43.4.1`, Node.js to `24.19.0`, and bundled pnpm to `11.19.0`.

## Word DOCX capability

- The bundled, user-invocable `/word-docx` Skill is discovered by official Harness `skill.list` and is available to the existing Agent loop; DSH Desktop does not create a second Agent implementation.
- The native Tools menu and fixed command palette insert `/word-docx` into the official composer. No arbitrary renderer command, package, script, or path execution surface is added.
- The fixed offline Node tool creates editable OOXML DOCX files with title/subtitle, headings 1–3, paragraphs, bullets, numbered lists, tables, PNG/JPEG images, page breaks, headers, and footers.
- Exact single-node text replacement is all-or-nothing. Duplicate find rules and cross-format-run guessing are rejected. Existing outputs require explicit overwrite and receive a same-directory `.dsh-backup-*` rollback copy.

## Workspace and document safety

- Specs, source images, input DOCX files, and outputs must remain inside the selected workspace. Traversal, symbolic links/junctions, invalid extensions, disguised images, and remote image URLs are rejected.
- ZIP input is capped by file size, entry count, per-entry size, and total declared uncompressed size before decompression. CRC, offsets, methods, required OOXML entries, and output structure are checked.
- PNG/JPEG inputs are signature- and dimension-checked, limited to 24 images, 12 MiB per image, and 32 MiB total. Image relationships and content types are generated inside the document package.
- Harness receives desktop-owned absolute paths for the bundled Skill, DOCX tool, and fixed Node runtime. Inherited or proxy-supplied overrides of those child variables are removed. The software-managed DeepSeek Key is used only by Harness and is not passed to the document tool.

## Validation status

- Official source Harness discovery returns `word-docx` with `modelInvocable: true`.
- A real credential-backed Harness turn entered the running state, invoked `/word-docx`, created a specification and editable DOCX, completed, and passed independent structural inspection without exposing the Key.
- Microsoft Word opened both generated acceptance documents without repair or compatibility mode. Chinese text, headings, bullets, numbering, table, header/footer, exact replacement, and a real embedded PNG rendered correctly across three pages.
- The focused Word, supervisor, and package-governance suite passes 32/32; the complete source suite passes 216/216; the production audit reports no known vulnerability.
- Both unpacked and installed ten-part smoke matrices pass, including real pinned Harness, context, extension center, worktrees, Tasks/Subagents, Side Chat, a real credential-isolated PTY, and installed `word-docx` discovery. Silent overwrite exits 0, all 29,789 unpacked files match the installed tree, and the 27-file semantic profile is byte-identical before and after installation and smoke testing.
- The 184,012,614-byte installer hashes to `0815951648E4376CE7B4AFF6630A44946CFF6984CC9E2C85A0EA85B387C561FC`; the 188,877-byte blockmap hashes to `9176D8C43513C8B638856190752C094381A08F1AA471936C6490205AA9911128`.
- Implementation PR [#32](https://github.com/hejiahang0001-oss/dsh-desktop/pull/32) and main-branch CI both pass all three jobs. The non-draft [V0.5.20 Pre-release](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.20) targets the exact merge commit; remote sizes and digests match, the public installer returns HTTP 200, and a clean download reproduces all three asset hashes with 2/2 manifest entries. Stable remains V0.5.4.

## Current limits

- Text replacement is exact within one Word text node. V0.5.20 does not guess across mixed-format runs, perform arbitrary Word DOM editing, convert legacy `.doc`, or call an online Office service.
- Images support PNG and JPEG only. Charts, tracked changes, comments, equations, advanced templates, and native Word content controls are not included yet.
- The installer remains unsigned, so automatic update remains disabled.
