# DSH Desktop V0.5.1

V0.5.1 adds explicitly confirmed recovery to the automatic local Git checkpoints introduced in V0.5.0 while keeping official DeepSeek Harness `0.1.1-rc.2` pinned.

## Added

- Restore the latest code checkpoint with `Ctrl+Alt+R`, the View menu, or the fixed `Ctrl+Shift+P` command palette.
- Preview the bounded number of affected code paths, untracked files that will enter the Windows Recycle Bin, sensitive paths that will remain untouched, and whether the Git index will change.
- Create a separate safety checkpoint immediately before recovery. After a successful recovery it remains the latest checkpoint, allowing an immediate second restore to undo the recovery.
- Refresh the workspace file tree and Git review state after a successful restore without reloading Harness or interrupting the current session.

## Recovery safety

- Recovery is unavailable while the integrated terminal or Harness Agent is active, waiting, or has queued work.
- The native warning dialog defaults to **Cancel**. No renderer code can bypass the confirmation or directly invoke Git or the Windows shell.
- The current branch and HEAD never move. Tracked and checkpointed untracked code return to the saved snapshot, while newly created untracked files enter the Windows Recycle Bin.
- Credential-like working-tree paths and their current staged/index entries remain unchanged, including `.env`, `.credentials*`, private keys, package credentials, and secret files.
- Recovery fails closed above 500 affected paths. If applying the selected checkpoint fails, DSH Desktop automatically applies the safety checkpoint and reports whether rollback succeeded.

## Boundary

- V0.5.1 restores the latest code checkpoint only. Browsing older checkpoints, restoring a Harness conversation, and selecting code and conversation rewind independently remain later slices.
- Checkpoints remain local Git objects and do not replace commits, branches, or a normal remote backup.

## Verified

- 98 automated checks pass. Temporary real Git repositories cover tracked and untracked recovery, exact no-change preview, Recycle Bin failure rollback, a 501-path fail-closed boundary, sensitive worktree/index preservation, safety-point undo, HEAD stability, and Windows CRLF behavior.
- In the real packaged 1024×720 desktop, `Ctrl+Alt+R` opened the native summary with **Cancel** focused. Pressing Enter cancelled recovery while the complete Git status and index SHA-256 remained unchanged.
- V0.5.1 directly upgraded V0.5.0 while preserving thirteen sessions, credential/state hashes, and two real project checkpoint refs. The installed Harness runtime returned HTTP 200 with title `DeepSeek Harness`.
- The final installer and installed `app.asar` were independently hashed and matched the unpacked build.

## Download

- Installer: `DSH-Desktop-Setup-0.5.1.exe`
- Latest release: <https://github.com/hejiahang0001-oss/dsh-desktop/releases/latest>
