# DSH Desktop V0.5.10

V0.5.10 adds a local, read-only extension-health surface. It keeps Stable at V0.5.4, DeepSeek Harness pinned to `0.1.1-rc.2`, and Electron pinned to `43.4.1`.

## What changed

- Added **Tools → Extension health…** to show the fixed Harness runtime closure, shared fallback-link integrity, initialized Profiles, ordered bundle layers, and Profile-declared external dependencies.
- Kept Harness as the source of truth: packages shipped in the upstream runtime are not described as enabled unless the active Profile actually lists them.
- Mirrored the fixed Harness resolution boundary: bundle layers resolve from the software installation first and then the Profile; Profile dependencies resolve through its pnpm-managed `node_modules` and the Harness-maintained parent fallback.
- Audited the full fixed runtime dependency and peer-dependency closure, then checked every expected fallback junction against its exact packaged target.
- Exposed only package names, versions, resolution source, and health state. Plugin configuration, `cordis.patch.yml`, credentials, dependency specifications, session content, and arbitrary paths never reach the renderer.
- Added strict package-name validation, bounded profile/package counts, 1 MiB manifest limits, realpath containment, a narrow three-method preload, exact-page IPC checks, and a packaged screenshot smoke.

## Boundaries

- This release diagnoses extension state; it does not install, enable, disable, update, or remove plugins.
- pnpm manages only out-of-tree dependencies declared by a Profile. The software ships a reviewed hoisted Harness runtime; it does not require users to install pnpm to launch the default Web Profile.
- Community plugins and every package in the upstream monorepo are not automatically bundled or enabled.
- Stable remains V0.5.4. V0.5.10 advances only the product Latest/Pre-release channel after package, overwrite, installed-smoke, and remote-asset gates pass.

## Final validation

- All 138 local tests pass; the production dependency audit reports no known vulnerability, and the pull request/main quality, security, and package-data CI jobs pass.
- The local installed Harness `0.1.1-rc.2` closure currently resolves 432 expected packages with 432 correct shared fallback links; the Web Profile resolves both fixed bundle layers and declares no external plugin dependency.
- Unpacked and installed desktop, Harness, IPC, PDF, context-source, and extension-health smokes pass. The installed archive exactly matches the unpacked `app.asar`, and the installed tree adds only the normal uninstaller.
- Twenty-five semantic user-data files, including fourteen sessions, retain the exact aggregate digest across the overwrite. The rollback snapshot contains 33 files, zero credential copies, and zero reparse points.
- The published [v0.5.10 Pre-release](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.10) is not a draft. All three remote asset sizes/digests match the local artifacts and return HTTP 200; V0.5.4 remains GitHub's formal Latest release.
