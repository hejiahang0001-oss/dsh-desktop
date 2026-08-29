---
name: llm-wiki
description: Understand and preserve the DSH Desktop Wiki boundary: immutable raw sources, a user-selected Markdown vault, and explicit provenance.
user-invocable: false
disable-model-invocation: false
metadata:
  version: 0.6.3
---

# LLM Wiki foundation

DSH Desktop treats the Wiki as a compiled Markdown knowledge base, not as a second chat system.

## Three boundaries

1. Raw DSH conversations and source documents are read-only.
2. The user-selected Wiki directory is the only external write scope.
3. Pages distinguish extracted statements from inference and keep a source locator.

V0.6.3 provides only setup, query, and selected-conclusion capture. Project-wide synchronization, DSH history batch import, QMD, web research, and Obsidian UI control belong to later versions.

The desktop supplies trusted absolute paths in `DSH_DESKTOP_NODE`, `DSH_DESKTOP_WIKI_TOOL`, and `DSH_DESKTOP_WIKI_CONFIG`. Use only those paths. Do not read Codex or Claude vault configuration, copy a personal vault into the application, install packages, initialize Git, or pass the software-managed API Key to the Wiki tool.

The Markdown vault remains usable without Git, Python, QMD, or Obsidian.
