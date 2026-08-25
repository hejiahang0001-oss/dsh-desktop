# DSH Desktop V0.5.14

V0.5.14 adds the first controlled third-party extension installation path. Stable remains V0.5.4; DeepSeek Harness remains pinned to `0.1.1-rc.2`, Electron to `43.4.1`, Node.js to `24.19.0`, and the new bundled pnpm runtime to `11.19.0`.

## Controlled installation

- The Extension Health window contains a reviewed catalog rather than a package-name or command input. This release exposes only `@nonamelego/dsh-catppuccin@0.3.1` for the Web Profile.
- Installation requires a Windows-native confirmation whose default and close actions cancel. The main process rechecks the exact catalog id, opaque Profile id, runtime/Profile health, task idleness, and current installation state immediately before changing the Profile.
- The command is fixed to the official `dsh plugin` entrypoint, exact package version, `--save-exact`, `--ignore-scripts`, and `https://registry.npmjs.org`. The Renderer cannot provide a package specification, pnpm arguments, registry, path, or command.
- The installer verifies the installed manifest, exact lockfile integrity, Profile-contained package resolution, bundle patch, Web platform, peer closure, and compatibility status before commit. A failed restart or health check removes and prunes the package, restores the tracked Profile files byte-for-byte, and restarts Harness again.

## Bundled pnpm boundary

- pnpm `11.19.0` is packaged as a fixed application resource and runs only through the bundled Node.js executable. The target computer does not need a system Node.js or pnpm installation.
- The install environment removes inherited PATH, `NODE_OPTIONS`, unsafe Node TLS/module variables, Corepack/pnpm variables, and every inherited `NPM_CONFIG_*` value. It fixes `ComSpec`/`PATHEXT`, uses empty user/global configuration files, enforces TLS, pins the registry, disables lifecycle scripts, saves exact versions, and puts its store under `$DSH_HOME/.pnpm-store`.
- The software-managed `DEEPSEEK_API_KEY` is stripped before every pnpm probe, install, remove, and prune process. Only the currently selected credential-free software proxy settings may be forwarded.
- Release governance now requires the pnpm wrapper, empty configuration, launcher, distribution, manifest, license, exact `11.19.0` version, safe wrapper references, and a link-free package tree.

## Validation status

- The complete source suite passes 167/167 and the production dependency audit reports no known vulnerability. Code review additionally blocks a Profile for the remainder of the process if rollback cannot be verified and prevents the UI from falsely claiming that no visible change occurred.
- The final unpacked candidate contains 29,785 files and 692,326,513 bytes. The pnpm category is 454 files and 19,001,800 bytes; the package tree has zero reparse points, redundant app PTY files, foreign terminal prebuilds, or terminal PDB files.
- Seven unpacked smoke classes pass: desktop metadata, real Harness HTTP/workspace synchronization, IPC isolation, PDF rendering, context-source isolation, extension-health UI, and a real two-command PTY. The extension window shows one reviewed catalog item and one usable install button.
- A fresh real isolated transaction installs `@nonamelego/dsh-catppuccin@0.3.1` through bundled pnpm `11.19.0`, verifies compatibility, proves the software Key and system pnpm path are absent, then removes/prunes the extension and restores the tracked Profile files byte-for-byte.
- The final installer is 183,969,223 bytes with SHA-256 `A394AB263423309A9F6C022C27A11F9737D3E6B25A76AAB5912F6EB0A91DC2FB`; its blockmap SHA-256 is `50405F8E31A919DFF31F9C08E542B80DF1806BAF1569C0576DFE916E420F1DCA`.
- V0.5.13→V0.5.14 reuses 178,965,564 / 183,969,223 blockmap bytes (97.2802%) and estimates a 5,003,659-byte differential. The installer remains unsigned, signature verification remains disabled, and automatic update therefore remains blocked.
- The installer exits with code 0 and registers `DSH Desktop 0.5.14`. The installed raw file set contains all 29,787 unpacked files plus only the normal uninstaller; installed and unpacked `app.asar` match SHA-256 `051254B7703B767EEC7FAB494A96AE362460B3C25A02573D35FD686F7AD00DE4`.
- All seven installed smoke classes pass, including one visible catalog install action, real Harness HTTP 200, real PTY credential isolation, and a second real controlled install/rollback using the installed pnpm resource.
- The overwrite preserves all 25 semantic files and fourteen sessions exactly. The canonical path-and-content aggregate is `0C473FC78E8801581734BDCD37B0A4F04B5750F526593DE58528497A46897233` before and after. The rollback snapshot is `backups/pre-v0.5.14-20260825-105431`, with zero credential-named files, zero reparse points, and all three V0.5.13 release assets.
- [PR #20](https://github.com/hejiahang0001-oss/dsh-desktop/pull/20) and [main CI run 32803918073](https://github.com/hejiahang0001-oss/dsh-desktop/actions/runs/32803918073) pass all three Windows jobs. [v0.5.14](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.14) is a non-draft Pre-release targeting `e6e96ee82f6ebef33d18409e3dd53f385e93b3aa`; its installer, blockmap, and checksum manifest match the local sizes and SHA-256 values, and the installer endpoint returns HTTP 200 with the exact content length. V0.5.4 remains the formal Stable and GitHub Latest release.
- The backed-up V0.5.13 release assets were hash-checked and their local `dist` copies were moved to the Windows Recycle Bin. They can still be recovered from the Recycle Bin or `backups/pre-v0.5.14-20260825-105431`.

## Deferred to V0.5.15

- Upgrade, uninstall, user-selectable rollback, and startup recovery for an interrupted install transaction remain V0.5.15 work. V0.5.14 deliberately supports only a confirmed fresh install from the reviewed catalog.
- The fixed catalog does not imply that every community plugin is safe or built in. Adding another version or package requires its own source, license, integrity, platform, patch, peer, install-hook, runtime, and rollback evidence.
