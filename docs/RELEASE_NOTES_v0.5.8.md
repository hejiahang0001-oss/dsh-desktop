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

- All new context-catalog and local-window tests pass, including source order, workspace reset, exact trusted-frame IPC, packaged assets, and the absence of arbitrary paths or file-reading APIs.
- Add a packaged Windows smoke that renders the final local window, checks its exact three-method bridge, confirms two real rule candidates without leaking their prose, and captures a screenshot for visual review.
- Full installer, overwrite, data-preservation, installed smoke, and published-asset evidence is recorded after the release candidate completes those gates.

## Release boundary

- V0.5.4 remains Stable and the GitHub `Latest release`.
- V0.5.8 advances only the product Latest/Pre-release channel after all release gates pass; it does not promote Stable.
