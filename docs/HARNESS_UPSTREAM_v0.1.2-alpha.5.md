# DeepSeek Harness alpha.5 mapping for DSH Desktop V1.1.3

## Fixed source identity

- Repository: https://github.com/deepseek-ai/deepseek-harness
- Tag: `dsh-v0.1.2-alpha.5`
- Commit: `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`
- CLI package: `@deepseek-ai/dsh@0.1.2-alpha.5`
- Build: Node `v24.19.0`, upstream pnpm `11.7.0`, frozen upstream lockfile.
- Packed payload: 242 DSH-family packages and 9 supporting Cordis packages, 251 total. This is a dependency-closure count, not an active-plugin count.

The upstream source remains unmodified. DSH runs the official source build and release-family checks, then assembles a link-free runtime with the exact identity above. Electron `43.4.1` and the desktop-managed pnpm `11.19.0` are not changed by this upgrade.

## Upstream changes carried through

- Alpha.3 improves long-session navigation/performance, image queue and follow-up reliability, extensionless image reading, backend-stall disconnect handling, and narrow schedule layouts. It removes the optional SQLite Session persistence package; existing files are not deleted, but an old build is required to export custom SQLite history.
- Alpha.4 replaces the old one-way subagent report flow with parent/continuable-child `send_message`, adds custom model-discovery headers and Web-fetch support to more profiles, changes Web PTC defaults, and replaces the mutable `Session.events` surface with sequence-based access plus stable snapshots.
- Alpha.5 fixes upgrade failures and missing session titles seen when moving from rc.2 or alpha.3.

See the official [alpha.3](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.3), [alpha.4](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.4), and [alpha.5](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.5) release notes.

## DSH compatibility work

- The desktop session controller continues to consume `sessionQuery.observeSession(...).events`, which is the public immutable observation snapshot. It does not read the removed live `Session.events` property.
- Worktree handoff now creates an explicitly seeded child session with `meta.isSeeded=true` and the exact `inheritedEventCount`. The persisted inherited prefix is still checked by SHA-256, and only the official empty `session/end-seed` boundary is accepted after it.
- Slash commands used by unattended acceptance now execute through the official `commands.execute` endpoint. Sending `/permission ...` as ordinary `session.prompt` content no longer counts as a command.
- Queue and interruption logic retains namespaced error handling, exact queued-message identity and the authoritative selected-session workspace checks introduced before this upgrade.
- The upstream Web patch remains an additive DSH host patch. The alpha.5 Web bundle, native document intake, Office center, review, dock and PDF surfaces have all been exercised against the source runtime.

## Verified data and extension boundaries

- Five copied completed JSONL-Zstd sessions produce identical alpha.2 and alpha.5 history hashes; all five source files remain unchanged. Credentials were not copied and no model call was made for this check.
- The default Web profile reports 152 plugin inventory rows, 123 active and zero failed in source smoke. The fixed runtime closure reports 492/492 healthy entries. These are runtime-health observations, not a claim that every upstream or community plugin is enabled.
- The package inventory contains 530 third-party package rows in eight license groups.
- Custom SQLite migration is not supported or tested. The current DSH default is JSONL-Zstd; users of a custom SQLite profile must export with the old Harness before upgrading.

## Release policy

V1.1.3 is a product Latest candidate. V1.1.0 remains Stable and GitHub's formal `Latest release`; V1.1.1 remains the current public Pre-release until V1.1.3 is explicitly published. The installer is unsigned, automatic installation remains disabled, and Harness is still a developer preview.
