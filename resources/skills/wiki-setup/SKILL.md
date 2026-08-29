---
name: wiki-setup
description: Select or initialize the user-authorized DSH Desktop Markdown Wiki vault.
user-invocable: true
disable-model-invocation: false
metadata:
  version: 0.6.4
---

# Wiki setup

Use this Skill when the user wants to connect or initialize a Wiki.

Open **Tools → Wiki 中心**. The native directory picker is the only supported way to choose the vault. Initialization requires a native confirmation whose default action is cancel.

Initialization creates only missing category directories and core files: `index.md`, `log.md`, `hot.md`, `.manifest.json`, and minimal `.obsidian` settings. Existing files are preserved byte-for-byte. Git, QMD, Python, Obsidian plugins, personal history, and credentials are not required or copied.

Do not choose a directory on the user's behalf through shell commands. Do not replace an existing `index.md`, `log.md`, `hot.md`, manifest, or Obsidian configuration.

After selection, the fixed tool may be used only for a read-only status check:

```powershell
& $env:DSH_DESKTOP_NODE $env:DSH_DESKTOP_WIKI_TOOL status --config $env:DSH_DESKTOP_WIKI_CONFIG
```
