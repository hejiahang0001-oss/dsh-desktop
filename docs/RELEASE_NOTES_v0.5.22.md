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
- The focused PowerPoint/UI/Supervisor/governance/release suite passes 41/41. The complete source suite passes 247/247, the production dependency audit reports no known vulnerability, and `git diff --check` passes. Package governance, packaged/installed runtime matrices, overwrite installation, semantic-data preservation, CI, and remote three-asset verification must still pass before the Pre-release is published.

## Current limits

- V0.5.22 does not implement arbitrary PowerPoint DOM or raw-template editing, animations, SmartArt, equations, media embedding, macros, OLE/ActiveX, legacy `.ppt`, password-protected files, or pixel-identical rendering across every Office version.
- Exact replacement does not guess across multiple mixed-format text runs. Microsoft PowerPoint remains authoritative for final editing and rendering.
- The Windows installer remains unsigned and automatic update remains disabled until the existing signing and trust gates are satisfied.

Candidate installer: `DSH-Desktop-Setup-0.5.22.exe`. Stable remains V0.5.4 unless the maintainer explicitly promotes a tested Latest build.
