# Harness 0.1.5-alpha.1 — V1.1.11 candidate

Status: implementation in progress; not installed or published. Stable remains V1.1.0.

- Official tag `dsh-v0.1.5-alpha.1`, commit `5dda764ed3aa172535a7967b06ff95d9cbfe536a`; Node v24.19.0 and build pnpm 11.7.0 remain fixed.
- Release inventory: 258 DSH packages plus 9 Cordis packages, SHA-256 `8efa42e476fd2da21ad1dafeb53ad2dc63dbf606c4a79099e8726814a35d13dd`.
- Session V3 uses the official adjacent migration. Original generations and an independent pre-install backup must survive; old binaries must not resume the upgraded active profile.
- Inbox callers use the public `nextTurn` and `nextStep` lists. Handoff preserves the exact inherited prefix and tagged seed marker. Cold history must not activate an Agent.
- Official right Sidebar owns the ordinary file tree and text tabs. Office validation/receipts, Wiki, Git review and non-overlapping desktop preview capabilities remain separate. Official desktop-shell migration is excluded.
- Official native locking replaces fs-ext. The desktop no longer compiles or packages that removed dependency; cross-process write-lock contention remains an acceptance gate.

## Reviewed dependency changes

The unmodified upstream workspace audit on 2026-09-09 reports 60 advisories (29 high, 28 moderate, 3 low). This includes development and optional components and is not a count of confirmed desktop vulnerabilities. The actual shipped dependency graph is audited independently, and a registry error or moderate/high/critical finding blocks release.

Revision `desktop-security-2` pins eight runtime dependencies using nine exact selectors: js-yaml 4.3.2 (both 4.2.0 and 4.3.1 predecessors), protobufjs 7.6.5, fast-uri 3.1.6, ip-address 10.3.1, hono 4.13.5, @hono/node-server 1.19.15, qs 6.16.0 and sharp 0.35.4. Sharp's platform packages follow its exact patch. No application source is patched. The reviewed lock and workspace digests live in `runtime/harness-security/overrides.json`; these are checked before assembly.

The official desktop's pnpm and documentation/testing dependencies are not adopted into our desktop runtime. Our distributed user-facing pnpm remains 11.19.0. The upstream-pinned 11.7.0 is a build-only tool; it is not a clean-audit claim for the upstream monorepo.

## Acceptance

Baseline V1.1.10: frozen install, root production audit, 585/585 tests and Windows unpacked build pass. Candidate runtime build, migration/cold history, official Sidebar, packaged/installed smokes, overwrite retention and public asset verification are pending. This file must not be interpreted as release approval.

Source: https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-alpha.1
