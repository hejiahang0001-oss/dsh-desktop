# Harness 0.1.3-alpha.2 compatibility for DSH Desktop V1.1.10

Status: isolated implementation candidate; official runtime construction, synthetic migration and real renderer attachment gates pass. Packaging, overwrite installation and publication are held by the [upstream dependency security review](HARNESS_ALPHA2_SECURITY_REVIEW.md). Do not treat this page as publication evidence.

## Fixed identity

- Official repository: https://github.com/deepseek-ai/deepseek-harness
- Tag: `dsh-v0.1.3-alpha.2`
- Commit: `82a5fd61a7cf5c293cec4bdff68f455398d685e9`
- Build: Node `v24.19.0`, upstream pnpm `11.7.0`, unchanged upstream lockfile.
- Release family: 251 DSH packages plus 9 Cordis supporting packages; inventory SHA-256 `f28b3917e722e1843aa28da324c849f4bfd0a5f912d907365a6963b3e976a6e9`.

Source references: [alpha.1 changes](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.3-alpha.1), [alpha.2 changes](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.3-alpha.2). This iteration includes both deltas from the previously bundled rc.1.

## Compatibility decisions

| Surface | Desktop adaptation |
|---|---|
| Session history | The retired history Remote route is replaced with official cold `observeSession` and `sessionController.page` over the existing private child IPC. A read must never call `follow` or activate an Agent. Pagination retains the first exact cursor and rejects incomplete event sequences. |
| Session lifecycle | Official write handles own persistence; task creation and fork use the public `flush` barrier. Fork accepts only the exact V2 inherited boundary marker. |
| Session V2 consumers | User messages use direct `data`; final assistant messages still use `data.message`. Wiki preserves nested event sequence/time and interruption markers. Failed attempts are not final answers. |
| Language | Use `personaSuffix` and retain the official Harness identity. The removed `persona` option is not silently carried forward. |
| Network | Official Harness owns outbound proxy dispatch. Desktop retains software/system proxy selection and explicitly clears lower-priority environment values when direct/custom is selected. |
| Attachments | Official Harness owns upload and drag/drop, including mixed images/files. Desktop no longer captures global drag events. Native workspace import remains a separate bounded copy/reference operation, not a second upload transport. |
| Office | Official attachments live outside the workspace and have different admission policies. Tools retain strict workspace and OOXML checks; explicitly selected attachments must be copied without overwriting to the active workspace before strict inspection/editing. |
| Open In | Use the official application launcher; do not introduce a second privileged launcher or duplicate Web control. Existing native menu access remains available. |

## Windows build

The new `fs-ext@2.1.1` dependency is imported even when Windows uses Harness's native semaphore lease. It must be genuinely compiled for the bundled Node ABI, not stubbed out. Runtime assembly verifies the real module can load and records its build step. A Windows GitHub Actions runner supplies the build toolchain; users of the installer do not need that toolchain.

Windows source clones explicitly use `core.symlinks=false`, matching the local checkout's representation of documentation link blobs. The source commit and clean-worktree checks, plus the packaged runtime's rejection of filesystem links, remain intact.

## Migration and rollback

The bundled rc.1 actually writes Session v0. The official adjacent stages restore v0/v1 as V2 and retain predecessor generations. Predecessor retention is not downgrade support: a previous binary must not resume work in an upgraded live profile and assume it can see new messages.

The migration gate uses only synthetic plain/Zstd sessions through the SDK without Agent, Provider or real credentials. It compares complete message/tool semantics, stream content, metadata and source-file hashes; it also exercises write leases, repeated reopening, V2 appends and an independent pre-upgrade backup. Real-user rollback requires a separately retained pre-upgrade data snapshot and preservation of later V2 data for recovery.

Stable remains V1.1.0. Acceptance and distribution status are tracked in [VALIDATION](VALIDATION.md); untested upstream plugins, long-session performance, another computer and 24-hour aging must not be represented as verified.
