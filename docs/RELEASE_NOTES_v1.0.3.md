# DSH Desktop V1.0.3

Pre-release: scoped review and line-comment feedback. Stable V0.5.4 remains unchanged.

- Review unstaged/new files, staged changes, branch commits against an existing base branch, or changes since a verified automatic checkpoint in the current session. Missing baselines are explicit, never invented.
- Add, edit and delete line comments using real old/new source-line numbers. Send the checked comments into the current input draft for your confirmation, without automatic submission. Reject changed diffs and cross-session feedback.
- Staged, branch and last-turn comparisons are read-only; existing user-change protections and native confirmations still govern accept/reject actions.
- Unresolved merge conflicts have an explicit status and cannot be staged or restored by one-click review actions.
- Preserve drafts without accumulating extra blank paragraphs when attaching documents. Improve review keyboard focus, cancellation and readable status feedback.

Comments are temporary per-session review notes, capped at 30 per session. They are not published GitHub review comments and do not survive application exit. Binary files cannot receive line comments; large diffs remain bounded.

Credential protection keeps the Chromium profile encryption state together with the Windows-bound vault; copying only the vault into a different profile is not a supported migration. Automatic installation remains blocked while signing is unavailable.

360/360 source tests pass, including mixed staged/unstaged files, renames, binary data, exact checkpoint trees, stale comments, cross-session rejection and unresolved merge conflicts. Real Harness/Git/IPC review interactions pass. Final unpacked and overwrite-installed review, document, IPC, Office, Harness and terminal acceptance pass. Installed application bytes match the final package; the overwrite installation preserves the checked semantic user-data snapshot. Windows-bound credential reopening is verified without exposing the key. Public artifact download verification is tracked separately after upload.
