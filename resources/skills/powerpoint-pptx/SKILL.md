---
name: powerpoint-pptx
description: Create, edit, inspect, and validate editable PowerPoint PPTX presentations inside the active workspace.
user-invocable: true
disable-model-invocation: false
metadata:
  version: 0.5.22
---

# PowerPoint PPTX

Use this Skill when the user asks for a new editable PowerPoint presentation, a controlled exact-text update to an existing PPTX, or a structural presentation inspection.

The desktop supplies trusted absolute paths in `DSH_DESKTOP_NODE` and `DSH_DESKTOP_PPTX_TOOL`. Run only that fixed tool with the active workspace in `DSH_CWD`. Do not install packages, call an online Office service, start another Agent loop, or pass the software-managed API Key to the presentation process.

## Create a presentation

Write a JSON specification inside the workspace, then run:

```text
"$DSH_DESKTOP_NODE" "$DSH_DESKTOP_PPTX_TOOL" create --workspace "$DSH_CWD" --spec presentation-spec.json --output presentation.pptx
```

The specification uses this shape:

```json
{
  "title": "Quarterly review",
  "author": "Team",
  "theme": {
    "name": "Executive Blue",
    "accent": "176B87",
    "dark": "17324D",
    "light": "F7FAFC",
    "font": "Aptos",
    "eastAsiaFont": "Microsoft YaHei"
  },
  "slides": [
    {
      "layout": "title",
      "title": "Quarterly review",
      "subtitle": "Editable DSH Desktop presentation",
      "notes": "Open with the purpose and the period covered.",
      "elements": []
    },
    {
      "layout": "content",
      "title": "Revenue by region",
      "notes": "Explain that the chart data remains editable.",
      "elements": [
        {
          "kind": "chart",
          "type": "column",
          "x": 0.8,
          "y": 1.5,
          "w": 7.4,
          "h": 4.8,
          "categories": ["North", "South"],
          "series": [
            { "name": "Plan", "values": [120, 110] },
            { "name": "Actual", "values": [118, 116] }
          ]
        },
        {
          "kind": "text",
          "x": 8.7,
          "y": 1.8,
          "w": 3.7,
          "h": 2.2,
          "text": "South exceeded plan.\nNorth remained close to target.",
          "fontSize": 22,
          "color": "17324D"
        }
      ]
    }
  ]
}
```

Supported element kinds are `text`, `shape`, `table`, `chart`, and `image`. Coordinates use inches on a fixed 13.333 × 7.5 widescreen canvas. Shapes support `rect`, `roundRect`, `ellipse`, and `chevron`. Charts support editable `column`, `bar`, `line`, and `pie` types with an embedded editable Excel workbook. Images must be real workspace PNG or JPEG files. Each slide chooses the real `title` or `content` layout and may include speaker notes.

## Replace exact text

Write a replacement specification:

```json
{
  "replacements": [
    { "find": "Quarterly review", "replace": "Annual review" }
  ]
}
```

Then create a new PPTX:

```text
"$DSH_DESKTOP_NODE" "$DSH_DESKTOP_PPTX_TOOL" replace-text --workspace "$DSH_CWD" --input presentation.pptx --spec replacements.json --output presentation-edited.pptx
```

Replacement applies only to complete individual slide or speaker-note text runs. Every requested `find` value must match at least once or the operation fails without output.

## Inspect and validate

```text
"$DSH_DESKTOP_NODE" "$DSH_DESKTOP_PPTX_TOOL" inspect --workspace "$DSH_CWD" --input presentation.pptx --strict
```

Inspection reports slides, editable shapes/text runs/tables/charts, images, notes, masters, layouts, embedded workbooks, external relationships, macros, OLE objects, and ActiveX parts. `--strict` fails if external relationships, macros, OLE/ActiveX, missing master/layout/notes structure, or unsupported active content is present.

## Safety and limits

- Every spec, image, input, output, and rollback file stays inside the active workspace; links, junctions, traversal, and remote paths are rejected.
- Creation supports at most 40 slides, 80 elements per slide, 1,000 elements total, 20 images/32 MiB image data, 20 charts, 30 categories per chart, and 6 series per chart.
- Existing outputs are never overwritten by default. Use `--overwrite` only after explicit user confirmation; the tool creates a same-directory `.dsh-backup-*` file first.
- Do not claim arbitrary PowerPoint DOM editing, raw-template filling, animation editing, video/audio embedding, SmartArt, equations, macros, OLE/ActiveX, legacy `.ppt`, password-protected files, or pixel-identical rendering across every Office version.
