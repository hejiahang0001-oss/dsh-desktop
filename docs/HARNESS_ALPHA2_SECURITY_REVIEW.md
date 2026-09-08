# Harness alpha.2 release hold — 2026-09-08

This is a bounded dependency review, not a general security certification. V1.1.10 remains an isolated compatibility candidate; do not overwrite the installed application or publish an installer while this hold is unresolved.

## Separate audit scopes

- Desktop root `pnpm audit --prod --audit-level moderate`: no known vulnerabilities reported.
- Official `dsh-v0.1.3-alpha.2` monorepo, unchanged lockfile and pnpm 11.7.0: 31 advisories (16 high, 14 moderate, 1 low).
- These totals are neither 31 confirmed exploitable desktop vulnerabilities nor a clean bill of health for the bundled runtime. The monorepo includes optional components and the assembler also copies the official DSH package family; physical dependency membership and enabled paths require separate inspection.

The downloaded, integrity-checked runtime was recursively inspected (581 `package.json` files, including nested manifests). Eight audited package names are physically present, each with one matching manifest: `js-yaml@4.2.0`, `protobufjs@7.6.4`, `fast-uri@3.1.3`, `undici@8.10.0`, `ip-address@10.2.0`, `hono@4.12.29`, `@hono/node-server@1.19.14` and `qs@6.15.3`. The other three audited names — `brace-expansion`, `postcss` and `nanoid` — are absent. Presence verifies the dependency version, not exploitability; only the focused Agent Presets chain below has been traced here.

## Confirmed affected production dependency

The official lockfile fixes `js-yaml@4.2.0`. Two reviewed high-severity advisories affect this version:

| Advisory | Behavior | Fixed 4.x version |
|---|---|---|
| [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m) | Merge-key chains can cause quadratic synchronous CPU consumption. | 4.3.0 |
| [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) | `!!omap` resolution can cause quadratic synchronous CPU consumption. | 4.3.1 |

Source at commit `82a5fd61a7cf5c293cec4bdff68f455398d685e9` establishes the relevant chain:

1. The default Web patch enables Agent Presets; its user-root discovery is enabled by default.
2. Session agent creation resolves/mounts Agent Presets, which lists and discovers preset metadata.
3. `packages/preset/agent-presets/src/metadata.ts` reads `preset.yml` without a byte limit and calls `yaml.load(raw)` without a restricted schema. The locked default schema includes merge and omap handling.

Malicious YAML must first reach a discovered preset directory, for example through a user import or a tool-created preset. No unauthenticated network exploit, credential disclosure or destructive attack was tested or established. App Boot and Include use `JSON_SCHEMA`; they are **not** confirmed merge/omap trigger sites and must not be counted as such.

## Next decision

The narrowest candidate fix for these two advisories is a reviewed, exact `js-yaml` 4.x security override at 4.3.1 or a later verified fixed release, followed by upstream semantic, preset, migration and desktop regressions. Other advisories still need actual payload membership checks. A security override changes the official frozen dependency graph and must be recorded as such; it must not be mislabeled as an unchanged official runtime.

Retain V1.1.9 installed/Latest and V1.1.0 Stable. Do not waive the audit gate or silently substitute third-party files inside an already-hashed runtime.
