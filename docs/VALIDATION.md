# Validation evidence

This page preserves the detailed V0.4.0 engineering evidence without making the README front page carry the full verification ledger.

## Automated and runtime checks

- 56 Supervisor, workspace mapping, loopback safety, session catalog, credential precedence, Agent/tool/Plan state, Git review, bounded Diff, symbolic-link isolation, and workbench-layout tests pass.
- Syntax validation passed for every Electron CommonJS module and the injected workbench panel script; `git diff --check` also passed.
- The Windows x64 unpacked and installed applications start the real Harness service and receive HTTP 200 from a random loopback address.
- Both runtime smoke checks reported DSH Desktop version 0.4.0, `zh-CN`, and Windows safe storage available.
- The installer contains 29,278 files; the embedded Harness closure contains 29,201 files and no reparse points.
- The NSIS medium passes a 7-Zip structure test with `Everything is Ok`.
- The installed application reports version 0.4.0 and its packaged `app.asar` exactly matches the unpacked build.

## Release integrity

| Item | V0.4.0 value |
| --- | --- |
| Installer | `DSH-Desktop-Setup-0.4.0.exe` |
| Size | `158,441,823` bytes |
| SHA-256 | `2CB32FAF22F8D76E1CEF30D29209D5B87A50A119EACA26E6262703C3A5DE14E0` |
| Files in installer archive | `29,278` |
| Packaged `app.asar` SHA-256 | `4BF5251ACD2BCDB92D26A4392DECCB6561789F529F1FA0B2CFCBEB540CEF2690` |

The installed `app.asar` and the unpacked build have the same SHA-256.

## Persistence and credential checks

- V0.4.0 was installed directly over V0.3.8; the Windows uninstall record reports `DSH Desktop 0.4.0`.
- Nine zstd persisted sessions remained discoverable after the upgrade.
- The software-managed Key remained configured, retained software-first precedence, and ignored a competing environment value.
- Validation did not print or copy the plaintext credential value.
- The usable pre-upgrade snapshot is `backups/pre-v0.4.0-20260822-120413`; it contains 31,582 files, no credential file, and no reparse point.
- An earlier copy attempt met a locked Chromium cookie file and is explicitly retained as `backups/incomplete-pre-v0.4.0-20260822-120253`; it is not a rollback point.

## Persistent review-panel checks

- An isolated real Git repository exposed three states at once: one pending Agent-produced file, two protected pre-existing files, and later one accepted staged file.
- Selecting the pending file displayed its bounded worktree Diff. After native acceptance, the same file displayed the staged Diff from `git diff --cached`.
- The native confirmation dialog kept Cancel as the default. Cancelling left Git unchanged; confirming staged only `agent-output.js`.
- The panel width was dragged from the 340-pixel default to 418 pixels and persisted to the isolated workbench state.
- Closing and reopening with `Ctrl+Alt+D` preserved the 418-pixel width. A full Harness page reload restored the panel, file states, and selected staged Diff.
- Normal and maximized layouts were visually checked without clipping. The compact overlay rule is implemented but has not completed the same visual matrix.
- The installed V0.4.0 application opened with the right review panel visible and a truthful empty Git state for the current temporary workspace.

## Safety boundary

- Diff reads are bounded to 50,000 characters. New untracked previews are limited to 256 KiB; binary files are identified, and symbolic links are never followed for preview.
- Renderer requests are accepted only from the trusted random IPv4 loopback Harness origin.
- Accept and reject continue through the existing native confirmation gates and workspace-path validation.
- Pre-existing changes remain protected from one-click rejection, and batch actions refuse the full batch when any selected path is protected or unavailable.

## Evidence boundary

These statements describe the locally verified V0.4.0 build. V0.4.0 is the first persistent workbench slice; it does not yet include the planned file tree, integrated terminal, preview, checkpoints, or session rewind. This evidence does not imply that DeepSeek endorses DSH Desktop, that Harness rc.8 is production-stable, or that the unsigned installer will pass every Windows reputation check.
