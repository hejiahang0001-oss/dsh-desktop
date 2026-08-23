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
- A desktop plugin marketplace or one-click installer in the current V0.4.4 release. Upstream `dsh plugin` delegates package installation to pnpm; V0.6 will bundle a pinned pnpm runtime behind the native plugin manager, while continuing to deny third-party plugin code automatic execution rights.

## Product rule

Upstream default-Web plugins follow the pinned Harness release automatically after compatibility tests. Optional official and community plugins remain opt-in until DSH Desktop can show source, version, permissions, enabled state, update status, and rollback. This avoids silently granting filesystem, shell, network, credential, or subprocess access merely because a repository uses the word “plugin”.

The native plugin manager is committed to the V0.6 extension milestone. It will install into an isolated user-data profile, expose only controlled install/update/remove/enable/disable/rollback actions, retain a lockfile and last-known-good snapshot, and require explicit confirmation of third-party source and permissions. End users will not need to install or operate Node.js/pnpm themselves.
