# DSH Desktop v0.4.3

V0.4.3 follows official DeepSeek Harness `0.1.1-rc.2` and completes the Chinese process-language layer that was prepared after V0.4.2.

## Highlights

- Replace the pinned Harness `0.1.0-rc.8` runtime with official `0.1.1-rc.2` while retaining the packaged Node.js runtime and loopback-only desktop boundary.
- Gain the upstream multimodal `DeepSeek-V4-Flash-Vision-Exp` model, Files API image upload/reuse, model-aware image conversion and resizing, multiline `ask_user_question`, responsive table improvements, and upstream security fixes.
- Compose a bounded desktop prompt overlay: Chinese conversations use Simplified Chinese for generated reasoning, tool summaries, plans, progress, questions, and final answers while code, commands, paths, identifiers, errors, and raw output remain unchanged.
- Translate the remaining fixed `Session log`, `Think`, `Thinking`, and `(no output)` labels without rewriting code blocks, inputs, editable content, or persisted session records.
- Keep the software-managed DeepSeek Key at highest priority and remove inherited `DEEPSEEK_API_KEY` values from Harness and integrated-terminal child environments.
- Package the entire official default-Web dependency closure. Optional upstream alternatives and community plugins remain excluded until a permission-visible plugin manager is available.

## Plugin boundary

- Official source monorepo: 234 package manifests.
- Packaged DSH dependency closure: 188 `dsh` / `dsh-*` packages.
- Official default Web composition: 135 plugin rows.
- Community plugins: not bundled.

See `docs/HARNESS_PLUGIN_INVENTORY.md` for why these counts are intentionally different.

## Verified in this build

- 74 automated tests pass.
- Source, unpacked, and installed Harness runtimes report `0.1.1-rc.2`; unpacked and installed Harness smoke checks return HTTP 200 with successful Workspace synchronization.
- The software-managed Key remains highest priority and a real `DeepSeek-V4-Flash High` Chinese turn completed in two seconds without exposing the credential.
- Direct overwrite installation exited with code 0, retained 12 persisted sessions, and created a thirteenth session for the real-model check.
- The installed `app.asar` and localization patch exactly match the unpacked build; the installed closure has no reparse points.

## Download integrity

- Installer: `DSH-Desktop-Setup-0.4.3.exe`
- Size: `158,566,564` bytes
- SHA-256: `039460E59FBCDE18F70C724926E473AC74FE02CFE06EEA5C47CAD3E77D5B181E`
- Packaged `app.asar` SHA-256: `C37A4B871DC3D8CD999AECF632982E222F350A972E6F25A1943FFD5A0E38C70A`

## Known limits

- Historical English reasoning or tool descriptions already persisted in sessions are not rewritten.
- The workspace file viewer remains read-only and the integrated terminal remains a controlled single-command runner rather than a persistent PTY.
- The installer is not code-signed, so Windows SmartScreen may show a warning.
- Credential Manager/DPAPI integration, automatic updates, rollback, and the native plugin manager remain pending.

DSH Desktop is an independent community project and is not affiliated with or endorsed by DeepSeek.
