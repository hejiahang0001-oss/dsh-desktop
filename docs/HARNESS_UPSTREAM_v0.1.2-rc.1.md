# DeepSeek Harness rc.1 mapping for DSH Desktop V1.1.6

## Fixed source identity

- Repository: https://github.com/deepseek-ai/deepseek-harness
- Tag: `dsh-v0.1.2-rc.1`
- Commit: `a66e4702047846cdaa10c66c9d3df3951f5ea70d`
- CLI package: `@deepseek-ai/dsh@0.1.2-rc.1`
- Build: Node `v24.19.0`, upstream pnpm `11.7.0`, frozen upstream lockfile.
- Packed payload: 242 DSH-family packages and 9 supporting Cordis packages, 251 total. The assembled runtime has 23,866 files, 244,474,542 bytes and zero reparse points.

The upstream source is unmodified. DSH runs the official build, release-family verification and compiled-package invariant checks before assembling a link-free runtime. The generated provenance records the repository, tag, full commit, package count, Node version and pnpm version.

## Exact alpha.5 to rc.1 delta

The official compare contains two commits and 252 changed files. Every changed file is a `package.json`, and every content change is only the package version from `0.1.2-alpha.5` to `0.1.2-rc.1`. There is no application source, API, configuration, lockfile or runtime-logic delta between the two tags.

The broader rc.1 release notes summarize work since `0.1.1-rc.2`; those capabilities were already present in the alpha.5 source bundled by DSH V1.1.3–V1.1.5. They are not a reason to delete another desktop feature in V1.1.6. See the official [alpha.5 to rc.1 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.2-alpha.5...dsh-v0.1.2-rc.1) and [rc.1 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1).

## Compatibility work

- All active product, build, packaging, test and license bindings now resolve `0.1.2-rc.1`; the new assembled runtime contains no `0.1.2-alpha.5` identity.
- Plugin peer checks now preserve prerelease identity. An exact alpha.5 peer no longer passes against rc.1, and a range that cannot safely establish prerelease compatibility is marked for review rather than verified.
- Package governance now verifies the official repository and tag in addition to the root DSH version, full commit, package count and provenance format.
- The Harness smoke is release-blocking when the runtime closure is degraded, any plugin is failed or transitional, or the session controller, workspace controller and session-log export modules are not enabled and active.
- The upstream interaction ownership test derives the source checkout from the pinned runtime manifest. Clean CI checkouts explicitly skip source-only assertions while still checking the pinned identity; local compatibility validation runs them against the exact ignored source checkout.

## Verified observations

- The source-built CLI reports `0.1.2-rc.1`; runtime assembly reports 251 release packages and no linked paths.
- An authenticated source smoke returns HTTP 200, creates and synchronizes a workspace/session, creates an independent Workspace Write Side Chat, and reports a 492/492 healthy runtime closure.
- The official inventory reports 152 plugin rows, 123 active, zero failed. `@deepseek-ai/dsh-api-session-controller`, `@deepseek-ai/dsh-api-workspace-controller` and `@deepseek-ai/dsh-session-log-export` are all active.
- Five copied completed JSONL-Zstd sessions produce identical alpha.5 and rc.1 history hashes. The five source files remain unchanged; no credential was copied and no model call was made.
- The generated JavaScript license inventory remains 530 packages in eight declaration groups.

## Boundaries

- The isolated source smoke does not replace packaged or overwrite-installed validation. Existing Profiles and the maintainer's real user data are checked only after a complete package is ready and overwrite installation is explicitly confirmed.
- A community report describes failed Web loader entries in some rc.1 installations. It was not reproduced in the isolated fixed source runtime; the stricter named-module and zero-failure gates protect DSH against a mixed or stale packaged Profile.
- V1.1.0 remains Stable and public V1.1.1 remains the current Pre-release. V1.1.6 is not published or promoted without an explicit maintainer instruction.
