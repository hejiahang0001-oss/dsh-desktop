# Harness plugin inventory boundary

Snapshot date: 2026-08-24

Pinned upstream runtime: `@deepseek-ai/dsh@0.1.1-rc.2`

## What DSH Desktop includes

- The complete production dependency closure pulled by the official `@deepseek-ai/dsh` package for its default Web profile.
- 62 direct dependencies in the official launcher package, including 54 `@deepseek-ai/dsh-*` dependencies.
- 188 installed `dsh` / `dsh-*` packages in the packaged dependency closure.
- 135 plugin rows in the official default Web composition, including the DeepSeek model adapter, filesystem and search tools, PowerShell and shell tools, skills, plans, goals, jobs, workflows, in-process subagents, MCP client, plugin inventory, settings, sessions, Web host, and Web client UI.
- The `0.1.1-rc.2` authorization package added since the previous `0.1.0-rc.8` runtime.

These numbers describe different layers. An installed package can provide a service, browser module, schema, provider, or support code without being a separately visible or active plugin row.

## What DSH Desktop does not include or activate

- Every one of the 234 package manifests in the upstream source repository. The monorepo also contains alternative applications, SDK/ACP packages, examples, experimental packages, test support, and provider variants that are not part of the default Web production closure.
- Optional official alternatives such as ACP/SDK runtimes, E2B integrations, Claude Code or Codex subagent bridges, and experimental team packages unless the official Web profile later composes them.
- Community plugins from GitHub topics, catalogs, discussions, or third-party repositories.
- An unrestricted plugin marketplace or arbitrary one-click installer. V0.5.15 bundles pnpm `11.19.0` behind the native manager, but exposes only the separately reviewed `@nonamelego/dsh-catppuccin` lifecycle for the Web Profile. The only accepted versions are `0.3.0` and `0.3.1`; package name, version, registry, path, lifecycle action arguments, and pnpm arguments are not free-form user inputs.

## Product rule

Upstream default-Web plugins follow the pinned Harness release automatically after compatibility tests. Optional official and community plugins remain opt-in until DSH Desktop can show source, version, permissions, enabled state, update status, and rollback. This avoids silently granting filesystem, shell, network, credential, or subprocess access merely because a repository uses the word “plugin”.

The native plugin manager starts in V0.5.14 with fixed-catalog fresh install. V0.5.15 adds reviewed upgrade, uninstall, enable/disable, and selectable last-known-good rollback; a bounded persistent transaction stores only the three tracked Profile files, exact hashes, fixed lifecycle state, and timestamps. Startup recovery accepts a byte-exact applied state or a provably plugin-only running mutation, uses the atomic journal backup when needed, and blocks conflicts. Exact lock/integrity and compatibility checks, disabled lifecycle scripts, the Profile-local pnpm store, software-Key isolation, and explicit native confirmation remain mandatory. End users do not need to install or operate Node.js/pnpm themselves.
