# DSH Desktop V1.0.1

V1.0.1 is a focused trust and discoverability update on the same pinned DeepSeek Harness `0.1.2-alpha.1` source runtime. It is prepared as a product Latest candidate; V0.5.4 remains Stable and is not promoted or replaced automatically.

## Changed

- Git review now distinguishes Git unavailable, non-repository workspaces, status-read failures, clean repositories, and repositories with changes. A repository containing only untracked files is never reported as clean.
- Git-dependent review actions fail closed without blocking chat, Office, Wiki, file preview, or the isolated terminal.
- The Office delivery center and Help/About surface read the current application version instead of displaying stale V0.6 copy.
- Command-palette failures remain visible in an accessible error state with bounded detail, retry, and a path back to the command list. Unknown failures no longer make the unverified blanket claim that no modification occurred, keyboard focus remains inside the visible dialog, and key menu accelerators use the same recovery path.
- Network and proxy settings remain reachable from the Harness startup-status page and model diagnostics, including when Harness has not connected yet.

## Safety boundaries

- Network settings still allow only direct, Windows system, or credential-free HTTP(S) proxy modes; changing settings remains native-confirmed and restarts Harness.
- Software-managed API Key priority is unchanged. The Key is not exposed to the renderer, PTY, Office tools, ordinary diagnostics, or release artifacts.
- V1.0.1 does not enable automatic installation, code signing, arbitrary plugin installation, remote development, or automatic Stable promotion.

## Validation status

The local candidate passes 325/325 source tests and six-part unpacked plus installed smoke coverage for Desktop, IPC, Office, command feedback/network access, Harness, and terminal. The interaction smoke verifies a real failure, retry focus, forward/backward focus wrapping, a fully loaded proxy dialog, and an unobstructed maximized failure surface. Silent overwrite installation registers V1.0.1, and all 31 credential-free semantic state files remain byte-identical. Exact artifact hashes and rollback evidence are recorded in `PROGRESS.md` and `docs/VALIDATION.md`.

Publication evidence is intentionally absent until a matching GitHub Pre-release and public re-download verification exist.

## Rollback

Before overwrite installation, retain the previous V1.0.0 installer/portable assets and a credential-free semantic-state snapshot. If the candidate regresses, reinstall the retained V1.0.0 product build or V0.5.4 Stable without uninstalling DSH Desktop; user data under `%APPDATA%\DSH Desktop` remains separate from the program directory.
