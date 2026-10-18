# Fixed alpha.2 source recipe

This is an independent lulu build of official tag `dsh-v0.2.1-alpha.2`, commit
`d743267388641bc76f17c45ce8b4c231aed1d32c`. It is not the unmodified official binary.
The preparation profile never grants installation, publication or Stable approval.

Use a separate clean checkout of the exact commit, Node 24.19.0 and build-only
pnpm 11.28.5. The desktop's separate package manager remains 11.19.0. Verify each
patch SHA-256 against `profile.json`, then apply its `patchChain` in order using
`git apply --check` followed by `git apply`. Do not use the historical alpha.1
aggregate patch: its workspace and security overrides differ from this release.

`security.patch` contains only two remaining exact dependency overrides and the
reviewed HCS RFC patch; `security-lock.patch` records the exact pnpm-generated
lock delta from the official tag, so replay does not resolve versions afresh.
The following four patches retain private PowerShell 7,
Windows process protections and pending-attachment lifecycle, including the
necessary type-only/JSDoc corrections. The latter four patch files are exact
copies of the reviewed alpha.2 preflight payloads, not newly inferred fixes.

Use the recorded source lock and workspace hashes to reject dependency drift.
No lifecycle script permission is implied: resolve/install with the reviewed
pnpm command and disabled scripts before `build:official`. The source recipe is
not evidence that a new build has passed. Actual controlled build/pack receipts,
the selected production lock, native checks and the complete materialized tree
are separately pinned by the deployment profile before runtime deployment.

Evidence and current readiness: `docs/HARNESS_UPSTREAM_v0.2.1-alpha.2.md`.
Do not reuse old build success as a new run or claim source preparation as an
installed desktop. All existing user data, credentials and Stable remain outside
this preparation directory.
