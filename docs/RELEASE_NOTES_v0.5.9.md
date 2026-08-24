# DSH Desktop V0.5.9

V0.5.9 is the durable-state and CI-gate release. It keeps Stable at V0.5.4, DeepSeek Harness pinned to `0.1.1-rc.2`, and Electron pinned to `43.4.1`.

## Atomic desktop state

- Route workspace, workbench layout, and network settings through one serialized atomic JSON writer.
- Write each candidate to a unique same-directory temporary file, flush it, parse it again, and only then replace the primary file.
- Preserve the previous valid primary as a flushed and re-read `.bak` last-known-good copy. A corrupt primary is never promoted into the backup.
- Recover from a valid backup on startup and repair the primary through the same atomic path; clean pending temporary files after both success and failure.
- Serialize concurrent writes in call order so rapid panel resizing or settings updates cannot let an older operation finish last.

## Semantic overwrite evidence

- Add a credential-safe semantic snapshot for fixed desktop state, Harness sessions, workspace catalogs, and LevelDB data files.
- Exclude credentials, private keys, transient LevelDB logs, locks, and links from the snapshot; log rotation no longer creates a false data-loss alarm.

## CI layers

- Split Windows CI into quality tests, a pinned pnpm production dependency audit, and package plus semantic-data contract tests.
- Keep actual Electron packaging, installed runtime smoke, and overwrite installation as local release gates because generated runtimes and archives are intentionally not committed.

## Validation status

- All 134 local tests pass; the pull request and main-branch quality, production-security, and package/semantic-data CI jobs pass.
- The installed and unpacked applications pass desktop, Harness, IPC, PDF, and context-source smokes. Their packaged `app.asar` SHA-256 values match.
- The overwrite preserves the exact aggregate digest of 25 semantic user-data files, including 14 sessions, while excluding transient and restricted files.
- The published [v0.5.9 Pre-release](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.5.9) is not a draft. All three remote asset sizes and SHA-256 digests match the local release artifacts, and each direct download returns HTTP 200.

## Release boundary

- V0.5.4 remains Stable and GitHub's formal `Latest release`.
- V0.5.9 advances only the product Latest/Pre-release channel after all gates pass.
