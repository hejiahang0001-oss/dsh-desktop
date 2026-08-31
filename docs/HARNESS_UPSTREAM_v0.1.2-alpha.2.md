# DeepSeek Harness alpha.2 mapping for DSH Desktop V1.1.1

## Fixed source identity

- Repository: https://github.com/deepseek-ai/deepseek-harness
- Tag: `dsh-v0.1.2-alpha.2`
- Commit: `0a53fb55bea101816fa226bb964ae2bed71c343b`
- CLI package: `@deepseek-ai/dsh@0.1.2-alpha.2`
- Build: Node `v24.19.0`, upstream pnpm `11.7.0`, frozen upstream lockfile.
- Expected packed payload: 245 DSH-family packages and 9 supporting Cordis packages (254 total). Package count is not a count of active plugins or user Skills.

The original source is not patched. The build runs the upstream official build, release-family validation and package-invariant validation, then assembles a link-free runtime with exact source provenance. Desktop Electron `43.4.1` and pnpm `11.19.0` remain unchanged.

## Compatibility boundaries

- Remote transport still uses the authenticated loopback `client-request` / `server-response` envelope. Namespaced `RemoteError` codes and details must reach callers unchanged; prompts are not automatically retried after a rejection or ambiguous receipt.
- Queue promotion recognizes `session/queue-item-not-found` as well as the old code. Other error categories are not silently treated as a completed task.
- Permission reads now require `permissionPresets.current(session)`, not `current(session.events)`. Background creation and pre-submission checks pass the authoritative Session to the projection-backed service; Workspace Write + Ask is still required and widened permissions reject admission.
- Session list, projection cursor, history pagination and `session/control` streaming remain validation points. Desktop handoff and background tasks continue using the public Host services, rather than reaching into replaced Client result helpers.
- The default official Web bundle uses JSONL persistence. SQLite schema advances from 19 to 20 upstream; this release does **not** implement or promise SQLite migration. Custom SQLite profiles require a separate backup/migration assessment before upgrading.
- `scripts/smoke-harness-upgrade.cjs` compares old/new runtime reads of a copied completed-conversation fixture. It copies sessions and projection cache only, never credentials/settings, and checks source session hashes without displaying transcript text.
- Upstream Web UI changes require actual document-intake, composer, draft, interruption, review and background-task smoke checks; a successful build alone is insufficient.

## Release policy

V1.1.1 belongs to product Latest / GitHub Pre-release. V1.1.0 remains Stable and GitHub's formal Latest release; its tag and binary hashes are not changed. V1.0.5 is retained. Source dependency downloads may include optional third-party agent SDKs; that does not certify or enable those integrations in the desktop product.

See [official release notes](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.2), [upstream safety guidance](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.2/SAFETY.zh.md), and [execution evidence](../PROGRESS.md). Harness is still a developer preview. Neither worktrees nor the permission UI provide VM-grade isolation. The installer remains unsigned and automatic installation stays disabled.
