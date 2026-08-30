# Harness plugin inventory boundary

Snapshot date: 2026-08-30

Pinned upstream runtime: source tag `dsh-v0.1.2-alpha.1`, commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`, CLI `@deepseek-ai/dsh@0.1.2-alpha.1`

## What DSH Desktop includes

- The complete production dependency closure produced from the official frozen source lockfile for the default Web profile.
- 250 exact upstream release packages rebuilt and packed from source: 241 DSH-family packages and 9 supporting Cordis packages. Third-party transitive dependencies remain part of the fixed production closure.
- 489 dependency nodes in the launcher closure, all resolved to the exact packaged fallback after Harness startup; this is the health-manager count and is not the same as the 250 source-built release package count.
- 176 rows reported by the live official `pluginInventory.list` surface in the V1.0.0 Electron smoke: 146 active and 0 failed.
- The official inventory Skills surface reports 7 total/4 active. The actual session `skill.list` additionally discovers all eight DSH Desktop user Skills: Word, Excel, PowerPoint, `wiki-setup`, `wiki-query`, `wiki-capture`, `wiki-update`, and `wiki-history-ingest`.
- MCP reports ready at `0.1.2-alpha.1` with no configured server on the isolated validation profile. Hooks remain reported as unsupported.

These numbers describe different layers. An installed package can provide a service, browser module, schema, provider, or support code without being a separately visible or active plugin row.

## What DSH Desktop does not include or activate

- Every directory in the upstream monorepo. Alternative applications, SDK/ACP surfaces, examples, experimental packages, test support, and provider variants outside the verified DSH release family are not automatically activated merely because they exist in source.
- Optional official alternatives such as ACP/SDK runtimes, E2B integrations, Claude Code or Codex subagent bridges, and experimental team packages unless the official Web profile later composes them.
- Community plugins from GitHub topics, catalogs, discussions, or third-party repositories.
- An unrestricted plugin marketplace or arbitrary one-click installer. V0.5.15 bundles pnpm `11.19.0` behind the native manager, but exposes only the separately reviewed `@nonamelego/dsh-catppuccin` lifecycle for the Web Profile. The only accepted versions are `0.3.0` and `0.3.1`; package name, version, registry, path, lifecycle action arguments, and pnpm arguments are not free-form user inputs.

## Product rule

Upstream default-Web plugins follow the pinned Harness release only after source identity, build invariants, authentication, Remote API, Workspace/session, queue, inventory, Office/Wiki, and real-model compatibility checks. Optional official and community plugins remain opt-in until DSH Desktop can show source, version, permissions, enabled state, update status, and rollback. This avoids silently granting filesystem, shell, network, credential, or subprocess access merely because a repository uses the word “plugin”.

The native plugin manager starts in V0.5.14 with fixed-catalog fresh install. V0.5.15 adds reviewed upgrade, uninstall, enable/disable, and selectable last-known-good rollback; a bounded persistent transaction stores only the three tracked Profile files, exact hashes, fixed lifecycle state, and timestamps. Startup recovery accepts a byte-exact applied state or a provably plugin-only running mutation, uses the atomic journal backup when needed, and blocks conflicts. Exact lock/integrity and compatibility checks, disabled lifecycle scripts, the Profile-local pnpm store, software-Key isolation, and explicit native confirmation remain mandatory. End users do not need to install or operate Node.js/pnpm themselves.
