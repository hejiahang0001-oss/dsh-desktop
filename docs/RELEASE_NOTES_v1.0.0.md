# DSH Desktop V1.0.0

V1.0.0 stabilizes the existing local Agent programming workflow on the official DeepSeek Harness `0.1.2-alpha.1` source tag. It is the product Latest and is published only as a GitHub Pre-release; V0.5.4 remains Stable.

## Changed

- Replaced the pinned Harness `0.1.1-rc.2` npm runtime with a reproducible source build of tag `dsh-v0.1.2-alpha.1`, exact commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`.
- Added fixed source-build provenance and package governance for all 250 upstream release packages. The Windows package refuses an unexpected Harness version, commit, package count, or provenance schema.
- Adapted the desktop to the upstream one-time loopback-token and cookie session, while keeping the token out of public state and persisted logs.
- Adapted fixed Workspace, session, history, Skill, Side Chat, Tasks/Subagents, and reliable-interruption calls to the upstream Remote HTTP and `session/control` stream protocols.
- Preserved the page-selected ordinary session only when it is a live member of the selected Workspace; stale, Subagent, or cross-workspace selections fail closed to a new official session.
- Updated every source/packaged Office, Wiki, plugin, and Agent acceptance script to use the same authenticated Harness transport as the desktop.
- Added a reproducible inventory of 529 packaged JavaScript dependencies across 8 declared license categories.

## Release validation

- Complete source regression passes 319/319; 145 JavaScript files pass syntax validation, `git diff --check` passes, and the production dependency audit reports no known vulnerability.
- Real Harness runtime and Electron smoke pass with HTTP 200, Workspace synchronization, independent Side Chat, queue baseline, a 489/489 launcher closure, 176 plugin rows/146 active/0 failed, and MCP `0.1.2-alpha.1` ready.
- Source Word, Excel, PowerPoint, and no-Git Wiki Skill smokes pass through the authenticated runtime.
- A real DeepSeek run verifies both direct running-turn interruption and queued-message interruption, including an aborted original turn and completed marker replies.
- The final unpacked and installed builds each pass all 14 GUI smoke classes plus terminal, Wiki, and Word/Excel/PowerPoint Skill checks. The portable executable independently passes desktop, live Harness, and native tray checks.
- Silent overwrite exits 0 and Windows registers `1.0.0`. All 28 credential-free semantic files remain byte-identical before install, after install, and after the final installed regressions.
- The installer is 188,705,896 bytes with SHA-256 `1233AAA7C2B6249E3B0C90236B705E279ACF6C6FB8D0D4329F35918F29725D97`; the portable executable is 188,014,396 bytes with SHA-256 `F0E00619EE7CC47DD3B97FF24DCE1BB9C7C6D2E3AA789A7C638C6D85DBEF2BF4`. The three-entry checksum manifest passes 3/3.
- A final scan checks 85 V1.0.0 evidence and log files against the software-managed credential and raw startup-token pattern; neither value is present.

## Publication evidence

- Implementation PR [#58](https://github.com/hejiahang0001-oss/dsh-desktop/pull/58) and its successful three-job run [33289813007](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/33289813007) pass; the merge is `4a325845dd2b717b058753b45b448236ea3ce501`.
- Main CI run [33289861190](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/33289861190) passes quality, production dependency security, and package/semantic-data contracts.
- The [V1.0.0 release](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v1.0.0) is non-draft, marked Pre-release, and targets the exact implementation merge. All four GitHub asset sizes/digests match local evidence; clean unauthenticated downloads match 4/4 hashes and all 3/3 checksum-manifest entries.
- V0.5.4 remains the formal GitHub Latest/Stable release.

## Safety boundaries and known limits

- DSH Desktop remains an independent community project and is not an official DeepSeek product. Harness `0.1.2-alpha.1` is an alpha upstream release.
- V1.0.0 does not enable automatic update, remote development, cloud background sessions, cross-device control, arbitrary plugin installation, or automatic Stable promotion.
- The Windows installer remains unsigned and can trigger SmartScreen. V0.5.4 remains formal GitHub Latest/Stable until the maintainer explicitly promotes another version.
- The bundled Office tools create and inspect bounded editable OOXML documents; they do not promise arbitrary Word/Excel/PowerPoint feature parity.
- The exact upstream map is in [`HARNESS_UPSTREAM_v0.1.2-alpha.1.md`](HARNESS_UPSTREAM_v0.1.2-alpha.1.md), and the generated dependency list is in [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).

## Rollback

The V1.0.0 release process snapshots credential-free semantic application data and retains the prior V0.9.0 release assets before overwriting the maintainer installation. If the candidate regresses, reinstall the retained V0.9.0 product build or V0.5.4 Stable without uninstalling DSH Desktop; the installer does not remove `%APPDATA%\DSH Desktop` data.
