---
name: wiki-update
description: Incrementally distill the active DSH Desktop project into the configured local Markdown Wiki with provenance, merge checks, confirmation, and rollback.
user-invocable: true
disable-model-invocation: false
metadata:
  version: 0.6.4
---

# Wiki project update

Use this Skill when the user wants to synchronize knowledge from the active DSH project into the configured Wiki.

## Fixed boundary

- The active source is exactly `$env:DSH_CWD`; do not accept another source path from chat.
- Use only `$env:DSH_DESKTOP_NODE`, `$env:DSH_DESKTOP_WIKI_TOOL`, and `$env:DSH_DESKTOP_WIKI_CONFIG` for Wiki operations.
- The fixed tool excludes common credentials, dependency trees, generated output, binary files, large files, and temporary `.dsh-wiki-*` specifications.
- Git improves change evidence when available, but is optional. Never install Git or initialize a repository for this workflow.
- If the configured Wiki is outside the active workspace and Harness blocks the write, stop and ask the user to acknowledge Full Access through the official permission control. Never switch to `danger-full-access` on the user's behalf and never bypass the permission failure.
- Do not copy raw credentials, hidden prompts, full histories, or generated dependency files into the Wiki.

## Workflow

1. Preview the bounded source inventory:

```powershell
& $env:DSH_DESKTOP_NODE $env:DSH_DESKTOP_WIKI_TOOL project-preview --config $env:DSH_DESKTOP_WIKI_CONFIG --workspace $env:DSH_CWD
```

If `unchanged` is true, report that the project inventory matches the last successful sync and stop. Do not manufacture an update.

2. Read only the changed and directly relevant project files. Distill durable architecture, behavior, decisions, runbooks, and constraints. Mark inference in body text with `^[inferred]` and unresolved uncertainty with `^[ambiguous]`.

3. For every existing target returned by the preview, read the current Wiki page before editing it:

```powershell
& $env:DSH_DESKTOP_NODE $env:DSH_DESKTOP_WIKI_TOOL project-page --config $env:DSH_DESKTOP_WIKI_CONFIG --workspace $env:DSH_CWD --path '<PAGE_PATH>'
```

Merge new evidence into the current page. Do not replace reviewed or verified conclusions merely because wording changed.

4. Create a small `.dsh-wiki-update-<unique>.json` specification inside the active workspace. Each page must use the project overview path or a path under that project's `concepts`, `skills`, or `references` directory. Include:

```json
{
  "previewToken": "token from project-preview",
  "pages": [{
    "path": "projects/<project-id>/<project-id>.md",
    "expectedSha256": null,
    "title": "Project title",
    "summary": "What this page preserves.",
    "content": "# Project title\n\nSource-grounded knowledge.",
    "sources": ["README.md"],
    "provenance": { "extracted": 0.8, "inferred": 0.1, "ambiguous": 0.1 }
  }]
}
```

Use the SHA-256 returned by `project-page` instead of `null` when updating an existing page. Every source must be an exact path returned by `project-preview`.

5. Validate without writing:

```powershell
& $env:DSH_DESKTOP_NODE $env:DSH_DESKTOP_WIKI_TOOL project-validate --config $env:DSH_DESKTOP_WIKI_CONFIG --workspace $env:DSH_CWD --spec '<SPEC_PATH>'
```

Show the user the page paths, create/update counts, source files, inference/ambiguity, and sensitive findings. Save only after explicit confirmation:

```powershell
& $env:DSH_DESKTOP_NODE $env:DSH_DESKTOP_WIKI_TOOL project-save --config $env:DSH_DESKTOP_WIKI_CONFIG --workspace $env:DSH_CWD --spec '<SPEC_PATH>' --confirm-project-sync
```

If validation reports sensitive content, ask a second explicit question and add `--confirm-sensitive` only after that confirmation.

After save, cancellation, or a failed validation, remove only the exact `.dsh-wiki-update-<unique>.json` file created by this run. Never use a wildcard and never remove another run's specification.

The save rechecks the project fingerprint and all existing page hashes, writes atomically, updates `.manifest.json`, `index.md`, `log.md`, and `hot.md`, and preserves a recovery copy under `_archives/dsh-project-sync`. On a stale preview, reread and re-merge; never bypass the check.
