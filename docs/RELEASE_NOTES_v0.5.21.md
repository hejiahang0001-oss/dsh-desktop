# DSH Desktop V0.5.21

V0.5.21 adds editable Excel workbook delivery through the official DeepSeek Harness Skill path. Stable remains V0.5.4; Harness remains pinned to `0.1.1-rc.2`, Electron to `43.4.1`, Node.js to `24.19.0`, and bundled pnpm to `11.19.0`.

## Excel XLSX capability

- Adds the bundled, user- and model-invocable `/excel-xlsx` Skill plus a fixed offline Node.js XLSX tool. Tools and the command palette only place the official Skill command into the Harness composer; DSH Desktop does not create a second Agent loop.
- Creates editable multi-sheet XLSX workbooks with typed text, number, Boolean, date, and formula cells; named visual styles; column widths; merged cells; filters; frozen panes; hidden gridlines; and explicit reconciliation sheets.
- Imports bounded CSV data while preserving leading-zero identifiers and keeping formula-like input as text. Number inference is explicit.
- Applies bounded cell updates transactionally. Existing styles remain unless the request explicitly changes the style index; formulas lose stale cached values and the workbook requests a full recalculation.
- Strict inspection reports sheets, cells, formulas, formula errors, unsupported grouped formula structures, risky formulas, filters, frozen panes, external links, connections, query tables, and macros.

## Safety and rollback

- Input and output remain inside the active workspace. Traversal, symbolic links/junctions, oversized specifications, excessive sheets/rows/columns/cells, invalid references, duplicate updates, and unsupported cell types fail closed.
- External workbook references, URL/UNC/DDE-like formulas, network/data functions, shared/array/data-table formula structures, macros, external links, connection parts, and query tables fail strict validation.
- Existing output is never overwritten implicitly. Explicit overwrite first creates a sibling `.dsh-backup-*` rollback copy, writes a temporary file, independently reopens it, and only then replaces the target.
- The software-managed Key is not passed to the XLSX process.

## Verification status

- Source `skill.list` discovers `excel-xlsx` with `modelInvocable: true`.
- A real credential-backed isolated Harness Agent created `real-harness-excel.xlsx`: 3 sheets, 69 cells, 10 formulas, 3 filters, 3 frozen panes, no formula error, risky formula, external link, connection, query table, or macro.
- Microsoft Excel opens both the maintained acceptance workbook and the real Agent output without repair. Recalculation produces Summary and Details totals of 2,940, reconciliation difference 0, and a light-green `OK` state. CSV verification preserves `001` and displays `=SUM(A1:A2)` as text.
- The focused Excel, supervisor, Word preservation, and package-governance suite passes 38/38. The complete source suite passes 233/233, and the production dependency audit reports no known vulnerability.
- Source, packaged, and installed Harness discovery all expose `excel-xlsx` as model-invocable. Both ten-part unpacked and installed smoke matrices pass.
- The unpacked package contains 29,791 files and 692,728,208 bytes. The installed tree contains every unpacked file with equal length plus only the normal uninstaller; both have zero reparse points and matching `app.asar` SHA-256 `FE739C0B080C0286D96BCC7E51BEAD0C2E420EB1102A1B478E0E6B73424CBBC8`.
- Silent overwrite exits with code 0 and registers V0.5.21. The 27-file credential-free semantic manifest remains `D4DC1C46139CE2237846FFE28AA40D4F13E915CF11CD8AB7E6EA73F30C61F35D` before installation, after installation, and after installed smoke. Rollback point: `backups/pre-v0.5.21-20260826-020523`.
- The installer is 184,026,194 bytes with SHA-256 `16A67381E798A01A1B107BA00861D78021B50250012B71CE6A545FAA0EB673A0`; its 188,874-byte blockmap hashes to `8249192B195150243670609B991FEC586720D8CB772529F86C6BB0007D1B471A`, and the checksum manifest hashes to `43069A1450A5A936F12B21DE9266FE0D5FF46D837489183DB05796D1844D4DFA`.
- V0.5.20 to V0.5.21 reuses 182,967,366 bytes (99.4246%), leaving 1,058,828 differential bytes. CI and remote-asset verification remain publication gates.

## Current limits

- V0.5.21 does not implement arbitrary workbook DOM editing, shared/array/data-table formula editing, charts, pivot tables, Power Query, external data refresh, macros, `.xls`, password-protected workbooks, or Office Scripts.
- Formula validation is a bounded safety policy, not a complete Excel calculation engine. Microsoft Excel remains authoritative for final calculation and rendering.
- The Windows installer remains unsigned and automatic update remains disabled until the existing signing and trust gates are satisfied.

Candidate installer: `DSH-Desktop-Setup-0.5.21.exe`. Stable remains V0.5.4 unless the maintainer explicitly promotes a tested Latest build.
