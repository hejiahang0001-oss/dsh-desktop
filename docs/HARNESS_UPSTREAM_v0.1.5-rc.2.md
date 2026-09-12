# Harness 0.1.5-rc.2 — V1.1.12

Status: installed, publicly verified, then promoted to V1.1.12 Stable by explicit maintainer instruction on 2026-09-12. Promotion preserves the original binaries, fixed Harness and hashes; see [validation evidence](VALIDATION.md). The desktop channel does not promote the upstream RC to a stable API.

- Official tag `dsh-v0.1.5-rc.2`, commit `fb2c4b9e698e30edb738bca4cf0618587db7d203`; Node 24.19.0, build pnpm 11.7.0, user pnpm 11.19.0 and Electron 43.4.1 stay fixed.
- Release inventory: 265 DSH packages plus 9 Cordis packages, SHA-256 `a1f8b0b3f6491a9111ef0e512e9523a0fb6e138bd14aaf31926a165338348585`. Experimental Agent Teams packages are published upstream but are not enabled by the desktop overlay.
- Session writer remains V3. Added required-on-read events can still prevent an older runtime from reading newer sessions. Preserve an independent pre-upgrade profile and never roll back against the upgraded active directory.
- Use official Sidebar document preview and `present` delivery. File-name search and Git Review keep their bounded desktop context; ordinary previews delegate through public `ctx.sidebarRight` and `ctx.sessions` services, not private React state or synthetic chat messages.
- `present` records current source paths, not immutable file bytes. Keep Office validation, backup digests and rollback receipts; do not equate a visible delivery card with validated content.
- New global panels use `main` and `sidebar.panellist`. Desktop does not register the removed `conversation` root slot. Queue/Steer/Stop and new-file uploads remain official-owned.
- Upstream workspace audit reports 60 findings including development and optional dependencies (29 high, 28 moderate, 3 low). This is not the shipped vulnerability count. Eight exact same-major fixes remain necessary in the source lock; physical runtime and browser inputs must be checked before release.
- The initial full clone failed twice due to truncated HTTPS transfers. Incremental fetch from the prior official checkout succeeded; the new detached worktree is pinned to the verified tag, and the previous checkout remains unchanged.

Sources: [RC2 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2), [adjacent changes](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.5-alpha.1...dsh-v0.1.5-rc.2), [file delivery](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/packages/fs/tool-present/README.md).
