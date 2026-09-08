# Harness alpha.2 security build review — 2026-09-08

This is a bounded dependency review, not a general security certification. The maintainer approved the minimum security build and Latest iteration. Installation/publication remain gated on the rebuilt physical payload audit and compatibility evidence; Stable is unchanged.

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

## Approved bounded remediation

`runtime/harness-security/overrides.json` pins seven affected versions to fixed releases within their existing major: js-yaml 4.3.1, protobufjs 7.6.5, fast-uri 3.1.6, ip-address 10.3.1, hono 4.12.34, @hono/node-server 1.19.15 and qs 6.16.0. The generated upstream lock diff only changes these entries/references. SHA-256 `c2249475d8c65c196ad3ab5d8c53c47a306244122c67e82545e0e238da9395db` binds the reviewed lock. Build inputs are verified before and after the build; official application source is unchanged. Provenance is explicitly `desktop-security-frozen-lockfile`, revision `desktop-security-1`.

The physical runtime's undici 8.10.0 is outside this audit's affected 7.x range (`>=7.0.0 <7.29.0`); it is not downgraded. Absent monorepo packages are not added merely to satisfy an unrelated workspace audit. `audit-harness-runtime.cjs` recursively inventories actual shipped package versions, checks advisory ranges using pinned semver, binds the payload hash, and fails on moderate/high/critical findings or registry errors. This supplements, not replaces, the desktop-root audit.

The new runtime is built into a separate directory; the previous rc.1 and unpatched alpha.2 runtimes are retained for rollback/diagnosis. Do not waive the audit gate or silently substitute third-party files inside an already-hashed runtime. Actual audit/build results are recorded in VALIDATION.md as they complete.
