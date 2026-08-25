---
name: excel-xlsx
description: Create, import, edit, inspect, and reconcile editable Excel XLSX workbooks inside the active workspace.
user-invocable: true
disable-model-invocation: false
metadata:
  version: 0.5.21
---

# Excel XLSX

Use this Skill when the user asks for an editable Excel workbook, an XLSX generated from CSV, explicit cell changes, or formula/reconciliation validation.

The desktop supplies trusted absolute paths in `DSH_DESKTOP_NODE` and `DSH_DESKTOP_XLSX_TOOL`. Run only that fixed tool with the active workspace in `DSH_CWD`. Do not install packages, call an online Office service, start another Agent loop, or pass the software-managed API Key to the workbook process.

## Create a workbook

Write a JSON specification inside the workspace, then run:

```text
"$DSH_DESKTOP_NODE" "$DSH_DESKTOP_XLSX_TOOL" create --workspace "$DSH_CWD" --spec workbook-spec.json --output report.xlsx
```

The specification uses this shape:

```json
{
  "title": "Monthly control workbook",
  "sheets": [
    {
      "name": "Summary",
      "showGridLines": false,
      "freeze": { "rows": 3, "columns": 1 },
      "columns": [24, 16, 16, 16],
      "mergedCells": ["A1:D1"],
      "autoFilter": "A3:D8",
      "rows": [
        [{ "value": "Monthly control workbook", "style": "title" }],
        [{ "value": "Editable inputs and formula-driven outputs", "style": "subtitle" }],
        [
          { "value": "Item", "style": "header" },
          { "value": "Plan", "style": "header" },
          { "value": "Actual", "style": "header" },
          { "value": "Variance", "style": "header" }
        ],
        ["Revenue", { "value": 1000, "style": "currency" }, { "value": 950, "style": "currency" }, { "formula": "C4-B4", "style": "currency" }]
      ]
    }
  ],
  "reconciliations": [
    { "label": "Revenue check", "left": "'Summary'!$C$4", "right": "'Summary'!$B$4", "tolerance": 100 }
  ]
}
```

Available styles are `normal`, `title`, `subtitle`, `header`, `text`, `integer`, `decimal`, `percent`, `currency`, `date`, `formula`, `total`, `check-ok`, and `check-mismatch`. Use typed numbers/booleans rather than formatted strings. Use `{ "date": "2026-08-26" }` for dates. Formulas omit the leading `=` and must use quoted cross-sheet references such as `'Data'!A1`.

## Import CSV

CSV content remains text by default, including cells beginning with `=`, `+`, `-`, or `@`. Use `--infer-numbers` only when numeric inference is appropriate and identifiers with leading zeroes are not at risk.

```text
"$DSH_DESKTOP_NODE" "$DSH_DESKTOP_XLSX_TOOL" import-csv --workspace "$DSH_CWD" --input data.csv --output data.xlsx --sheet-name Data --infer-numbers
```

Use `--no-header` when the first CSV row is ordinary data.

## Edit cells

Write an update specification and create a new output file:

```json
{
  "updates": [
    { "sheet": "Summary", "cell": "C4", "value": 980 },
    { "sheet": "Summary", "cell": "D4", "formula": "C4-B4" }
  ]
}
```

```text
"$DSH_DESKTOP_NODE" "$DSH_DESKTOP_XLSX_TOOL" set-cells --workspace "$DSH_CWD" --input report.xlsx --spec updates.json --output report-edited.xlsx
```

An update preserves the existing cell style unless an explicit numeric `styleIndex` is supplied. Duplicate target cells fail closed. Use `{ "clear": true }` to remove a cell.

## Inspect and validate

```text
"$DSH_DESKTOP_NODE" "$DSH_DESKTOP_XLSX_TOOL" inspect --workspace "$DSH_CWD" --input report.xlsx --strict
```

Inspection reports sheet, cell, formula, formula-error, unsupported-formula-structure, filter, frozen-pane, external-link, macro, and risky-formula counts. `--strict` fails if formula errors, shared/array/data-table formula structures, macros, external links, or risky formulas are present. A newly generated workbook requests full calculation when opened in Excel; final values still require a spreadsheet application to recalculate.

## Safety and limits

- Every spec, CSV, input, output, and rollback file stays inside the active workspace; links, junctions, traversal, remote paths, and remote URLs are rejected.
- Creation supports at most 32 sheets, 10,000 rows per sheet, 256 columns, and 100,000 populated cells in total.
- Formula cells are explicit. External workbook references, URL/network functions, DDE-like syntax, and executable formula functions are rejected.
- Existing outputs are never overwritten by default. Use `--overwrite` only after explicit user confirmation; the tool creates a same-directory `.dsh-backup-*` file first.
- Cell updates intentionally refuse workbooks containing shared, array, or data-table formula structures; use Excel for those grouped formula models.
- Do not claim arbitrary Excel DOM editing, VBA/macros, pivot tables, Power Query, external data connections, legacy `.xls`, password-protected workbooks, or full offline formula calculation.
