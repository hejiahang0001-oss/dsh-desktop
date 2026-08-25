# DSH Desktop V0.5.12

V0.5.12 adds bounded compatibility evidence for installed third-party Profile extensions and a repeatable real-plugin gate. It keeps Stable at V0.5.4, DeepSeek Harness pinned to `0.1.1-rc.2`, and Electron pinned to `43.4.1`.

## Third-party compatibility evidence

- Inspect only bounded package metadata: fixed/ranged registry, local or Git source class; Bundle Patch validity; Web/Host client platform; Peer dependency counts; and the names of real install hooks.
- Never send dependency specifications, hook bodies, Patch content, plugin configuration, credentials, session content, or arbitrary paths to the Renderer.
- Accept a shared Peer reached through the Harness fallback only when its real target remains inside the fixed packaged runtime. A junction or link to any other location fails closed.
- Mark a blocked extension as non-toggleable and degrade its Profile health rather than attempting to load or repair it silently.

## Real community-extension gate

- Use the public MIT package `@nonamelego/dsh-catppuccin`, fixed to reviewed versions `0.3.0` and `0.3.1` with exact npm integrity values.
- Run the official `dsh plugin --profile web add` path inside a new isolated Harness home with `--save-exact` and `--ignore-scripts`; no arbitrary package, version, or pnpm argument is accepted by the validator.
- Validate seven stages: install and durable-state write, restart, disable, re-enable, upgrade, rollback, and final upgrade.
- At every stage, require the fixed Harness closure to remain 432/432 and compatibility to remain verified. While disabled, the Harness root must stay HTTP 200 and the plugin route must become HTTP 404; after re-enable and every version transition, the exact state must return.
- Do not bundle or silently install the community plugin for users. General controlled installation remains scheduled for V0.5.14.

## Validation status

- The real seven-stage plugin gate passes and ends on `0.3.1`; state survives every restart and version transition, install scripts are ignored, and the software-managed DeepSeek Key is not forwarded.
- Ten focused source/contract tests pass. The complete versioned suite passes 152/152, and the production dependency audit reports no known vulnerability.
- All six unpacked and installed smoke classes pass. The Windows registration reports `0.5.12`; the installed tree has 29,371 files, zero reparse points, and zero terminal PDBs. The unpacked tree has 29,370 files, so the only installed addition is the normal uninstaller.
- The installer is 183,289,373 bytes with SHA-256 `9D594631A435E0281FA7BB5DDB6546E3DFC1FD18EA78C8933DAB338EC57992B0`. Installed and unpacked `app.asar` SHA-256 is `1195FF068947213202012F27EB93B0CC8C344F254275C463A14EE3674D37DE11`.
- Twenty-five semantic user-data files, including fourteen sessions, retain the exact aggregate digest across the overwrite. The rollback snapshot includes the V0.5.11 release files and no credential-named file or reparse point.
- GitHub PR/main CI and remote Pre-release asset verification remain required before public publication.
- V0.5.4 remains the formal Stable and GitHub Latest release.
