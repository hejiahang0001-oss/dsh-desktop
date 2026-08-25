# DSH Desktop V0.5.22

V0.5.22 adds editable PowerPoint presentation delivery through the official DeepSeek Harness Skill path. Stable remains V0.5.4; Harness remains pinned to `0.1.1-rc.2`, Electron to `43.4.1`, Node.js to `24.19.0`, and bundled pnpm to `11.19.0`.

## PowerPoint PPTX capability

- Adds the bundled, user- and model-invocable `/powerpoint-pptx` Skill plus a fixed offline Node.js PPTX tool. Tools and the command palette only place the official Skill command into the Harness composer; DSH Desktop does not create a second Agent loop.
- Creates editable 13.333 × 7.5 widescreen presentations with native text boxes, rectangles, rounded rectangles, ellipses, chevrons, tables, and column, bar, line, or pie charts backed by embedded editable Excel workbooks.
- Embeds bounded workspace PNG/JPEG images while preserving aspect ratio. Every presentation contains a real slide master, Title and Content layouts, a theme, slide numbers, and a speaker-note part for every slide.
- Performs exact all-or-nothing replacement inside complete slide or speaker-note text runs and creates a sibling rollback copy before an explicitly approved overwrite.
- Strict inspection reports slides, shapes, text runs, tables, charts, images, notes, masters, layouts, embedded workbooks, external relationships and links, macros, OLE, and ActiveX.

## Safety and rollback

- Specifications, images, inputs, outputs, temporary files, and backups stay inside the active workspace. Traversal, symbolic links/junctions, oversized specifications or PPTX files, invalid image signatures, excessive slides/elements/text/images/charts, and out-of-range chart values fail closed.
- External relationship modes and absolute relationship targets, macros, external links, OLE objects, and ActiveX fail strict validation. The fixed presentation process receives no software-managed API Key.
- Existing output is never overwritten implicitly. Explicit overwrite first creates a sibling `.dsh-backup-*` copy, writes and independently reopens a temporary PPTX, and only then replaces the target.

## Verification status

- Source `skill.list` discovers `powerpoint-pptx` with `modelInvocable: true`.
- A real credential-backed isolated Harness Agent created a 20,601-byte, three-slide editable PPTX and its JSON specification. Independent strict inspection confirms one table, one native chart, one embedded workbook, three notes, one master, two layouts, and zero external relationship, macro, OLE, or ActiveX content.
- Microsoft PowerPoint 16 opens the maintained acceptance presentation and the real Agent output and remains responsive. PPT Master package validation passes with no relationship problem; strict per-slide conversion reports zero diagnostics, and visual review passes 4/4 maintained pages plus 3/3 Agent pages without cropping or overlap.
- The focused PowerPoint/UI/Supervisor/governance/release suite passes 41/41. The complete source suite passes 247/247, the production dependency audit reports no known vulnerability, and `git diff --check` passes. Both unpacked and installed runtime matrices pass, all three bundled Office Skills are discoverable, and the installed tree matches all 29,793 unpacked files at equal length plus only the normal uninstaller.
- Silent overwrite registers V0.5.22 and preserves all 27 semantic state/session/Profile files byte-for-byte. Package governance passes with zero reparse points and 99.4266% blockmap reuse from V0.5.21.
- The 184,041,512-byte installer has SHA-256 `D682772B9AC1AE2E18127848C031B960B6A6877159A4A1C6C8A8E6B6B5B886A1`; the 188,964-byte blockmap has SHA-256 `9D2EE4C628AC7BC4735FAB5DBC568B4A7B8FF7F51D4D5C6EE37020A945B87491`.
- GitHub publishes the release as a non-draft Pre-release targeting merge `d227731f5b6824e2df1a69da0b9018c58410781b`. A clean download matches all three local assets, the checksum manifest verifies both payload entries, and the public installer returns HTTP 200 with the exact content length. GitHub formal Latest remains V0.5.4.

## Current limits

- V0.5.22 does not implement arbitrary PowerPoint DOM or raw-template editing, animations, SmartArt, equations, media embedding, macros, OLE/ActiveX, legacy `.ppt`, password-protected files, or pixel-identical rendering across every Office version.
- Exact replacement does not guess across multiple mixed-format text runs. Microsoft PowerPoint remains authoritative for final editing and rendering.
- The Windows installer remains unsigned and automatic update remains disabled until the existing signing and trust gates are satisfied.

Installer: `DSH-Desktop-Setup-0.5.22.exe`. This release advances only the Pre-release channel; Stable remains V0.5.4 unless the maintainer explicitly promotes a tested Latest build.
