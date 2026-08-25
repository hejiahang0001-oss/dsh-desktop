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

- The focused Office-center and three Office-preservation suite passes 13/13. The complete source suite passes 251/251, the production dependency audit reports no known vulnerability, and the unpacked real-window smoke renders three Office cards, three integration nodes, and three enabled fixed actions without clipping or overlap. Final package, overwrite-install, semantic-data, real Office, complete runtime, CI, and remote three-asset gates must pass before the V0.6.0 Pre-release is published.

## Current limits

- The center is an invocation and readiness surface, not an Office editor. Microsoft Office or a compatible editor remains authoritative for final editing and rendering.
- Automatic update remains disabled because the Windows installer is unsigned and the signature, publisher, trust-chain, and Stable/Pre-release feed-separation gates are not complete.

Candidate installer: `DSH-Desktop-Setup-0.6.0.exe`. Stable remains V0.5.4 unless the maintainer explicitly promotes a tested Latest build.
