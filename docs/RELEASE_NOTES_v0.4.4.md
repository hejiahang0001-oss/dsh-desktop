# DSH Desktop v0.4.4

V0.4.4 upgrades the bottom workbench terminal from a single-command runner to one persistent interactive PowerShell PTY while continuing to use official DeepSeek Harness `0.1.1-rc.2` as the Agent and Web UI.

## What changed

- Start one explicitly confirmed PowerShell PTY in the active Harness workspace.
- Run consecutive commands in the same shell and retain working directory, variables, prompts, and ANSI output.
- Resize the terminal with the bottom panel and restore recent output and state after the Harness page reloads.
- Stop the complete Windows process tree from the terminal panel.
- Render with pinned xterm components and a packaged, isolated `node-pty` helper; the target computer does not need Node.js or pnpm installed.
- Keep the software-managed DeepSeek API Key out of the PTY host and PowerShell environment.
- Filter terminal clipboard-write control sequences and bound input, protocol messages, and retained output.
- Disable Git accept/reject while the terminal is active, then refresh the user-change protection baseline after it stops.

## Validation

- 78/78 automated tests passed.
- A real Windows PTY passed consecutive-command, resize, recovery, Key-isolation, failure, and long-running process-tree-stop tests.
- Normal and maximized desktop layouts were visually checked without terminal or Harness clipping.
- Unpacked and installed applications passed V0.4.4, `zh-CN`, safe-storage, random-loopback HTTP 200, title, and Workspace synchronization smoke checks.
- Direct overwrite installation preserved 13 sessions, the software Key, desktop state, and workbench layout.
- Installed and unpacked `app.asar` files match exactly.

## Download integrity

- Installer: `DSH-Desktop-Setup-0.4.4.exe`
- Size: `162,555,535` bytes
- SHA-256: `348E26C211C19344FE59F0FF425F932306F4781953F3EDC11A91F8F4F706FFDC`

## Current limits

- This release has one persistent PTY; terminal tabs, split panes, shell snapshots, and automatic checkpoints are not included.
- Workspace file viewing remains read-only and application preview is not included yet.
- Harness `0.1.1-rc.2` still stores its managed credential in the user-data profile protected by Windows user-directory ACLs; Credential Manager/DPAPI integration is pending.
- The Windows installer is not code-signed, so SmartScreen may warn on first download.
- DSH Desktop is an unofficial community desktop host and is not endorsed by DeepSeek.
