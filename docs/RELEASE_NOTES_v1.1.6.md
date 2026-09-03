# DSH Desktop V1.1.6

V1.1.6 is a local install candidate that upgrades the bundled DeepSeek Harness runtime from `0.1.2-alpha.5` to the fixed `0.1.2-rc.1` release candidate without changing the Stable channel.

## Changes

- Pin official tag `dsh-v0.1.2-rc.1`, commit `a66e4702047846cdaa10c66c9d3df3951f5ea70d`, the upstream frozen lockfile and pnpm `11.7.0`; assemble a link-free 251-package runtime.
- Confirm the alpha.5-to-rc.1 delta is package-version-only. Keep the existing official/desktop ownership boundary and do not remove non-overlapping Windows, Office, Wiki, review, preview, task, Key or proxy capabilities.
- Preserve prerelease identifiers in third-party plugin peer checks. Exact alpha packages cannot be reported as compatible with rc.1, and uncertain prerelease ranges remain review-only.
- Require exact upstream repository and tag in packaged provenance, not only a matching version, commit string and package count.
- Make source Harness acceptance fail when the runtime closure is degraded, a plugin is failed/transitional, or the official session controller, workspace controller or session-log export module is not active.
- Derive source-only interaction checks from the runtime manifest, avoiding a stale hard-coded alpha.5 checkout and allowing clean CI to skip only the ignored source inspection.
- Make packaged runtime discovery fail closed: installed builds ignore `DSH_DESKTOP_NODE`, `DSH_DESKTOP_DSH_BIN` and `DSH_DESKTOP_PATCH`, resolve only the fixed files under application resources, and remove those override variables from child environments.
- Bind the release gate to the complete shipped Harness `node_modules` content hash, the exact 242 DSH and nine vendor package inventory, three reviewed auxiliary packages, the actual `app.asar` application version and fixed legal-notice hashes.
- Treat only required dependencies and required peer dependencies as runtime-closure requirements. Optional peer accelerators such as `bufferutil`, `utf-8-validate` and `@cfworker/json-schema` remain optional, while a missing declared runtime dependency still degrades health.

## Validation

- Official source build, release-family validation and compiled-package invariants pass. The source deployment contains 23,866 files, 244,474,542 bytes, zero reparse points and no alpha.5 identity.
- The final unpacked runtime is bound to 23,854 payload files and 243,748,493 bytes with SHA-256 `77e4f3ee552fbbf830bb334e58b03d5c53c1b00879583d0dc1b5a02d42081d05`. Packaged provenance and actual content match; all 251 release packages and three auxiliary packages have the expected identities.
- The authenticated source and final unpacked Harness smokes pass. The required runtime closure is 491/491 healthy; the official inventory is 152 total, 123 active and zero failed; all three required controller/export modules are active.
- Five copied completed JSONL-Zstd sessions have identical alpha.5 and rc.1 event counts and history hashes; source files are byte-for-byte unchanged and no credentials or model calls are involved.
- The generated license inventory contains 530 packages in eight declaration groups.
- The complete source suite passes 411/411 with no failures or skips; 219 existing version-controlled and release-added JavaScript files pass syntax validation, `git diff --check` passes, and the production dependency audit reports no known vulnerabilities.
- The final unpacked eight-part matrix passes draft continuity, workbench UI, native XLSX/DOCX/PDF drag, authenticated Harness, IPC isolation, Office center, PDF rendering and Git review. The fixed packaged terminal also passes working-directory, second-command and credential-isolation checks.
- Real-model final-artifact acceptance passes three cross-workspace cases. The official queued-message up-arrow, `Ctrl+Enter` steer and Stop controls execute successfully; document sources remain unchanged and session drafts remain isolated.
- Package governance reports `packageReady=true`, zero reparse points, the exact V1.1.6 `app.asar`, fixed Office/Wiki/pnpm/legal resources and 96.5027% reusable installer bytes versus V1.1.5.
- Setup is 188,643,588 bytes with SHA-256 `c084cc1b255cd7914b737de027784610779773759bf9b9474fbb99b7181c5469`. Portable is 187,952,074 bytes with SHA-256 `b5b0037f407ef7c13c8012f32022305433f8fe0906c540dd0459c3fc7fc99515`; all three checksum entries match their generated files.

V1.1.6 is a verified local install candidate. Overwrite-installed validation is intentionally still pending because closing and replacing the maintainer's running V1.1.5 requires explicit confirmation immediately before installation.

## Release policy

- V1.1.0 Stable is unchanged.
- Public V1.1.1 remains the current Pre-release until a newer candidate is explicitly published.
- V1.1.6 is not a GitHub release and must not be promoted to Stable without a maintainer instruction.
- The installer remains unsigned, so automatic installation remains disabled.

See the [rc.1 compatibility map](HARNESS_UPSTREAM_v0.1.2-rc.1.md), [official-overlap audit](HARNESS_UPSTREAM_OVERLAP_v1.1.6.md) and [execution evidence](../PROGRESS.md).
