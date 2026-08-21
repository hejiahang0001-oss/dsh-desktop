# DSH Desktop v0.3.8

V0.3.8 adds an official Plan entry and a guarded multi-file Git review flow to the Windows desktop shell around DeepSeek Harness.

## Highlights

- Enter rc.8 Plan mode from the native Agent menu, see whether Plan is active, locate the official execution confirmation, or exit Plan without approving execution.
- Review up to 30 changed files from the native Changes menu with pending, protected, accepted, and truncated counts.
- Accept and stage or reject one file at a time.
- Batch accept or reject only after every selected change passes a full safety preflight.
- Preserve pre-existing user edits and the Git staged baseline; rejected new files go to the Windows Recycle Bin.
- Keep software-managed DeepSeek credentials at the highest precedence and outside ordinary rollback backups.

## Verified in this build

- 50 automated tests pass.
- A real `DeepSeek-V4-Flash High` Plan changed two files and created a third only after the official Harness execution approval.
- Batch accept staged all three files.
- A second real three-file edit was batch rejected and restored to the staged baseline without losing the staged changes.
- The V0.3.8 installer directly upgraded V0.3.7 while preserving nine persisted sessions and the configured software Key state.
- The unpacked and installed applications both started Harness on a random loopback port and returned HTTP 200.

## Download integrity

- Installer: `DSH-Desktop-Setup-0.3.8.exe`
- Size: `158,435,283` bytes
- SHA-256: `4F1124B398AD5EB4CA617618E8F992776B94CFFA9FD54BE1BED5000D03F8022C`

## Known limits

- The installer is not code-signed, so Windows SmartScreen may show a warning.
- Multi-file review is currently a native menu hierarchy, not a persistent standalone Diff/File panel.
- Automatic checkpoints and session rewind are not implemented yet.
- Harness rc.8 Workspace Write may still crash PowerShell with `0xC0000005`; DSH Desktop reports the failure and does not silently elevate to Full Access.
- The software-managed Key currently relies on the Harness user-data credential file and Windows user-directory ACLs; Credential Manager/DPAPI integration is pending.

DSH Desktop is an independent community project and is not affiliated with or endorsed by DeepSeek.
