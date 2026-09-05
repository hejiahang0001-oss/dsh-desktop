---
name: wiki-update
description: Incrementally distill the active DSH Desktop project into the configured local Markdown Wiki with provenance, merge checks, confirmation, and rollback.
user-invocable: true
disable-model-invocation: false
metadata:
  version: 1.1.8
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

## Release knowledge mode

Use this mode when the user asks to preserve what a DSH Desktop version changed, or when a versioned capability is being completed. It is still the same project preview, validation, confirmation, transaction, archive, and rollback flow below; do not create a second Wiki engine or bypass the normal confirmation.

Maintain exactly these six release pages under the project path returned by `project-preview`:

- `references/releases/version-overview.md` — released, local-candidate, installed, public Pre-release, and Stable identities kept separate.
- `references/releases/capability-evolution.md` — user-visible capability changes by version, without turning plans into completed facts.
- `references/releases/harness-compatibility.md` — pinned Harness tag/version/commit, desktop ownership boundary, overlap decisions, and verified compatibility evidence.
- `references/releases/release-channels.md` — local build, installed build, GitHub Pre-release, GitHub Latest, and Stable promotion status.
- `references/releases/iteration-standards.md` — current iteration, review, packaging, confirmation, and rollback rules.
- `references/releases/validation-evidence.md` — commands or scenarios actually run, observed results, remaining unverified checks, and artifact hashes when available.

Prefix each path with `projects/<project-id>/`, using the exact project id from the preview. On the first release-knowledge sync, create all six pages in one validated transaction. If the project overview does not exist yet, include the required overview in that same transaction; it is the project entry page and does not replace or count as one of the six release pages. On later syncs, read and merge every existing target before saving. If an existing target was edited by a person, preserve the human text and reconcile it against current source evidence; never replace it with a generated summary merely to restore a preferred format.

Use only release evidence that is present in the bounded inventory, normally `package.json`, `README.md`, `PROGRESS.md`, `DSH_DESKTOP_ITERATION_PLAN.md`, `CONTRIBUTING.md`, `docs/DEVELOPMENT_PLAYBOOK.md`, `docs/VALIDATION.md`, the current version's release note, and the matching Harness upstream/overlap record. A file is not authorized merely because it is named here: it must also be returned by the current `project-preview`. Do not scan build output, installers, logs outside the inventory, GitHub, or the network from this mode. Do not infer publication, installation, Stable promotion, soak duration, second-computer validation, or test success from a plan or version number.

Before asking for confirmation, show the six target paths and a compact evidence table that distinguishes `verified now`, `recorded evidence`, `planned`, and `not verified`. Save all six or none. If any target, source, preview token, or expected SHA-256 is stale, stop and repeat preview/read/merge/validate rather than overwriting the newer page.

Set the top-level specification field `"mode": "release-knowledge"` for this workflow. The validator enforces all six release paths in one transaction, requires the project overview on first sync, rejects extra pages, and rejects evidence outside the bounded release allowlist.

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

Omit `mode` for an ordinary project knowledge sync.

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
