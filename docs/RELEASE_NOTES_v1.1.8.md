# DSH Desktop V1.1.8

V1.1.8 is an unpublished local Latest candidate focused on turning the existing local Wiki tools into a coherent, recoverable product surface. It retains the fixed DeepSeek Harness `0.1.2-rc.1` runtime from V1.1.7 and does not change the Stable or public Pre-release channels.

## Changes

- Add a three-step first-use flow and one health dashboard for Wiki setup, local query, selected-session capture, current-project synchronization, DSH history import and release-knowledge maintenance.
- Show bounded product and Harness versions, configured-vault state, managed-page health, source freshness, last verified synchronization and executable recovery actions without exposing page content or credentials to the Renderer.
- Preserve the six-page release-knowledge contract and its provenance, confirmation and non-overwrite rules. Windows path comparison is case-insensitive, while stored release paths remain canonical and duplicate aliases fail closed.
- Serialize session capture, project synchronization, DSH history import and query-log mutation with one vault-wide lock. Initialization creates only missing structure under the desktop mutation gate, while recovery clear uses a separate vault-root guard. Interrupted writes retain an exact recovery marker or lock, block later query and mutation, and point to a validated transaction archive instead of silently reclaiming a stale path.
- Clear a confirmed recovery state by atomically claiming the complete staging directory under a vault-root guard, validating the exact directory identity and protection digest, retaining an audit copy, and creating a new plain staging directory.
- Persist the recovery-clear guard as append-only checksummed frames with a previous-frame hash chain. A later frame must explicitly bind any incomplete tail before resuming; empty or partial first writes are safely resettable, while complete corrupt frames remain write-blocking and expose a manual native inspection path without automatic deletion.
- Treat Windows rename and link errors as completion-ambiguous: probe the source and destination identities before deciding whether to retry, restore or retain recovery protection.
- Bind page publication to the expected file and parent-directory identities, preserve concurrent human edits, and never overwrite unmanaged pages. History-source cleanup claims the exact source bytes before removal and preserves a replacement.
- Route missing managed pages and retained recovery locks to explicit protected-state guidance. The UI never reports recovery success unless the exact protection was cleared and the refreshed vault state is ready.

## Validation status

Closed as a local candidate on 2026-09-05. The final bundled-Node source suite passes **536/536**, with 0 failures and 0 skips. The production dependency audit refresh succeeds with 0 known vulnerabilities. Package/source binding, all three asset hashes, packaged Wiki CLI/GUI, unpacked two-instance lifecycle and safe-exit checks pass.

The final Setup, Portable and unpacked application contain identical payloads: 24,433 files / 734,069,182 bytes. The release gate now verifies every payload file using pinned 7zip-bin 5.2.0, rejects invalid archive/path identities and detects changes during verification. Project and history synchronization also refuse to overwrite existing pages without a committed SHA-256 ownership record.

Safe-exit validation now drains the guardian's final stdout frames and uses a fixed, authorized 180-second continuation wait. The final application and guardian both exit 0 with no owned-process or port residue.

Portable's real desktop smoke passes, but cold launch through wrapper exit takes about **3 minutes 56 seconds** on this machine. Portable two-instance lifecycle is not verified. This performance issue is retained for a later iteration.

Artifacts and evidence are in `artifacts/v1.1.8-release-candidate`. Exact sizes, SHA-256 values, package fingerprint, commands/results and limits are recorded in [validation evidence](VALIDATION.md). The installer is unsigned; automatic update remains unavailable.

## Release policy

- This version is a local candidate; no overwrite installation, GitHub push/publication or Stable promotion occurred.
- It retains the pinned Harness runtime, software-managed Key priority and official Queue/Steer/Stop ownership.
- The user's 2026-09-05 instruction closes work at V1.1.8. Later roadmap versions are deferred.

See the [execution evidence](../PROGRESS.md) and [iteration plan](../DSH_DESKTOP_ITERATION_PLAN.md).
