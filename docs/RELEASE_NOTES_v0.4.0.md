# DSH Desktop v0.4.0

V0.4.0 begins the persistent Windows workbench around DeepSeek Harness with a resizable right-side Git change review panel.

## Highlights

- Keep the change list and a bounded real Git Diff visible beside the official Harness page.
- Review pending worktree changes, protected pre-existing changes, accepted staged changes, and new text files without loading unbounded content.
- Accept and stage or reject one file at a time, or use the existing guarded batch flow.
- Preserve pre-existing user edits and the Git staged baseline; rejected new files continue to use the Windows Recycle Bin.
- Resize the panel from 280 to 520 pixels, hide or reopen it, and retain the chosen layout across reloads and application restarts.
- Use `Ctrl+Alt+D` to show or hide the panel and `Ctrl+Alt+J` to focus it.

## Verified in this build

- 56 automated tests pass, including a regression proving that untracked symbolic-link previews never follow targets outside the repository.
- A real isolated Git repository showed pending, protected, and accepted files independently.
- The panel displayed the real worktree Diff before acceptance and the staged Diff after acceptance.
- Native confirmation remained the safety gate; cancelling changed nothing, while confirming staged only the selected file.
- Drag resizing persisted at 418 pixels, closing and reopening preserved the layout, and a full Harness page reload restored the panel and selected staged Diff.
- The V0.4.0 installer directly upgraded V0.3.8 while preserving nine persisted sessions and the configured software-first Key state.
- The unpacked and installed applications both started Harness on a random loopback port and returned HTTP 200.

## Download integrity

- Installer: `DSH-Desktop-Setup-0.4.0.exe`
- Size: `158,441,823` bytes
- SHA-256: `2CB32FAF22F8D76E1CEF30D29209D5B87A50A119EACA26E6262703C3A5DE14E0`

## Known limits

- The installer is not code-signed, so Windows SmartScreen may show a warning.
- This is the first V0.4 workbench slice. File tree, integrated terminal, preview, command palette, automatic checkpoints, and session rewind are not included yet.
- Compact-window behavior is implemented as an overlay layout but has not completed the same visual matrix as the normal and maximized layouts.
- Harness rc.8 Workspace Write may still crash PowerShell with `0xC0000005`; DSH Desktop reports the failure and does not silently elevate to Full Access.
- The software-managed Key currently relies on the Harness user-data credential file and Windows user-directory ACLs; Credential Manager/DPAPI integration is pending.

DSH Desktop is an independent community project and is not affiliated with or endorsed by DeepSeek.
