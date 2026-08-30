# DeepSeek Harness upstream mapping for DSH Desktop V1.0.0

## Fixed source identity

- Repository: `https://github.com/deepseek-ai/deepseek-harness.git`
- Tag: `dsh-v0.1.2-alpha.1`
- Commit: `cd5ef8148158c3a752a658978873241fdf8e2bbc`
- CLI package: `@deepseek-ai/dsh@0.1.2-alpha.1`
- Build runtime: Node.js `v24.19.0` and the upstream-declared pnpm `11.7.0`
- Distribution: source build. The npm `latest` package remained `0.1.1-rc.2` when this upgrade was prepared, so DSH Desktop does not mislabel an older npm package as the tagged source release.

The runtime build checks out the exact tag and commit, requires a clean tracked source tree, installs the frozen upstream lockfile, runs `build:official`, `release:verify --family dsh`, and `verify-built-package-invariants`, then packs the 241 DSH-family and 9 supporting Cordis release packages. The final link-free runtime records all 250 package payloads in `harness-runtime.json`; release governance refuses a package with another version, commit, package count, or provenance schema.

## Desktop compatibility mapping

The upstream Web host now emits a one-time loopback token. DSH Desktop exchanges that token only against the exact random `127.0.0.1` origin, accepts only the bounded same-origin redirect and session cookie, removes the token from public state and logs, and installs the cookie only in trusted Harness browser sessions. Authenticated fetch never forwards the cookie to another origin.

The upstream HTTP API changed from dot-named endpoints to Remote endpoints with nested positional arguments. DSH Desktop maps its fixed internal calls to the reviewed upstream shapes, including `skills/list`, `session/list`, `session/create`, `session/prompt`, `session/page`, and the Subagent routes. The compatibility adapter reconstructs the existing bounded history view from `session/list` projections plus `session/page`; arbitrary method, endpoint, or URL input is not exposed to the Renderer.

Workspace selection now follows the official page-selected session when it is a live ordinary member of the selected Workspace. If it is absent, stale, a Subagent, or belongs to another path, DSH Desktop creates a new official session instead of silently reopening an unrelated one.

Reliable interruption reads the authoritative queue through the authenticated `session/control` Remote stream rather than the removed `events.mux` queue message. Both a running-turn correction and an already queued correction are rechecked against the selected Workspace/session before cancellation and delivery.

## Verified upstream surface

- Real Electron smoke: Harness HTTP 200, Workspace synchronized, independent Side Chat created with Workspace Write, `session/control` queue baseline readable, and the 489-node launcher closure resolved 489/489 from the fixed runtime.
- Live official inventory: 176 plugin rows, 146 active, 0 failed; Skills surface 7 total/4 active; MCP ready at `0.1.2-alpha.1`; Hooks still reported unsupported.
- Bundled user Skills discovered through the actual `skill.list`: Word, Excel, PowerPoint, and five Wiki Skills, all model-invocable in the source smoke.
- Real DeepSeek acceptance: running and queued interruption both accepted and delivered; the original long turn records an aborted end and both marker replies complete.

These counts describe different upstream layers. A source package, installed dependency, plugin row, active plugin, and model-invocable user Skill are not interchangeable.

## Safety and rollback

- The tokenized startup URL is never returned through normal desktop diagnostics and is redacted before Harness log persistence.
- API Key files, proxy values, workspace paths, and session text stay outside release provenance and public smoke artifacts.
- The installer remains unsigned; automatic download and installation remain disabled. V0.5.4 remains formal Stable/GitHub Latest.
- Before overwriting the maintainer installation, release validation preserves the prior installer, portable executable, blockmap, and a credential-free semantic-state snapshot. A failed V1.0.0 candidate can be replaced by the last known good product build or V0.5.4 Stable without deleting user data.
