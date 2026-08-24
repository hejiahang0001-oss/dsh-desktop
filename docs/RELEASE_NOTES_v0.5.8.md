# DSH Desktop V0.5.8

V0.5.8 is the context-transparency release. It keeps Stable at V0.5.4, DeepSeek Harness pinned to `0.1.1-rc.2`, and Electron pinned to `43.4.1`.

## Context sources

- Add a local-only, read-only context source window under the Tools menu.
- Show the Code preset, the desktop language policy, the discovered project-rule candidate chain, and the durable Harness session layer in their source order.
- Mirror the pinned Harness instruction discovery rules for `AGENTS.md`, `CLAUDE.md`, `AGENTS.local.md`, and `CLAUDE.local.md`, from the global Harness home through the project path to the active workspace.
- Report only bounded file metadata, including whether a source exceeds Harness's 1 MiB per-file limit. Content deduplication, total-budget omission, and truncation remain explicitly Harness decisions because the desktop does not read rule prose.
- Allow revealing a discovered user-controlled rule only through a short-lived internal identifier. The renderer cannot submit an arbitrary filesystem path.

## Memory boundary

- State explicitly that the pinned default Web profile has durable Harness sessions but no separate long-term memory database bundled by DSH Desktop.
- Treat external memory supplied by MCP or plugins as Harness-managed capability; the desktop does not claim to inspect or edit it.

## Validation status

- All 128 source tests pass, including source order, workspace reset, exact trusted-frame IPC, packaged assets, and the absence of arbitrary paths or file-reading APIs. Production dependency audit reports no known vulnerabilities and main-branch Windows CI passes.
- Unpacked and installed desktop, real Harness, IPC-security, PDF, and context-source smokes all exit with code 0. The final context window renders at 1359×965, exposes exactly three narrow methods, reports two real candidates, and does not expose their marker prose.
- The final installer is `183,277,540` bytes with SHA-256 `7EFD2B18B5ABD10EAE24923303FA05EDB35C0993815EB7AE5F3E75704DDB47DC`; the packaged and installed `app.asar` SHA-256 is `8666CBEF8312262934A43E1AE545DD715EEDFD9244E7DCE27B4484CE2360E7CE`.
- The installer overwrites V0.5.7 with exit code 0 and registers V0.5.8. Fourteen sessions and all 29 selected semantic user-data files retain identical hashes; the rollback snapshot is `backups/pre-v0.5.8-20260825-015249` and contains no credential-file copy.
- The GitHub release is a non-draft Pre-release. All three remote asset sizes and SHA-256 digests match, the installer direct download returns HTTP 200, and V0.5.4 remains GitHub's formal `Latest release`.

## Release boundary

- V0.5.4 remains Stable and the GitHub `Latest release`.
- V0.5.8 advances only the product Latest/Pre-release channel after all release gates pass; it does not promote Stable.
