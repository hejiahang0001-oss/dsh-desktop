---
name: wiki-capture
description: Preview and save a user-selected current-session conclusion to the configured DSH Desktop Markdown Wiki.
user-invocable: true
disable-model-invocation: false
metadata:
  version: 0.6.5
---

# Wiki capture

Use this Skill only when the user asks to preserve a conclusion from the current DSH conversation.

Prefer **Tools → Wiki 中心**. It reads recent assistant messages through the fixed Harness `session.history` interface, lets the user select and edit one conclusion, previews the destination and sensitive-content warnings, and asks for confirmation before writing.

For command-line use, create a small JSON specification inside the active workspace:

```json
{
  "title": "Decision title",
  "content": "Declarative knowledge selected by the user.",
  "sourceSessionId": "session-id-from-current-harness-session",
  "sourceSeq": 123,
  "sourceTime": 1788000000000
}
```

Preview first:

```powershell
& $env:DSH_DESKTOP_NODE $env:DSH_DESKTOP_WIKI_TOOL preview --config $env:DSH_DESKTOP_WIKI_CONFIG --workspace $env:DSH_CWD --spec 'wiki-capture.json'
```

Show the user the proposed page path, summary, and any sensitive findings. Save only after the user confirms the preview:

```powershell
& $env:DSH_DESKTOP_NODE $env:DSH_DESKTOP_WIKI_TOOL save --config $env:DSH_DESKTOP_WIKI_CONFIG --workspace $env:DSH_CWD --spec 'wiki-capture.json'
```

If the preview reports sensitive fields, ask again and add `--confirm-sensitive` only after explicit confirmation. The tool never overwrites an existing page. A successful save atomically updates the page, `index.md`, and `log.md`; a failed transaction restores the tracking files and removes the incomplete page.

The original DSH session is read-only. Do not save raw tool output, API keys, hidden prompts, credentials, or an entire conversation when the user selected only one conclusion. Use `/wiki-update` for the active project and `/wiki-history-ingest dsh` only after the user selects history in Wiki Center.
