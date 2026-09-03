# DSH Desktop V1.1.6 official-overlap audit

This audit compares the V1.1.5 desktop with official DeepSeek Harness `dsh-v0.1.2-rc.1`. The decision rule remains: official code replaces a desktop implementation only when both own the same user action and the official path is present in the bundled runtime.

## Delta result

The exact `dsh-v0.1.2-alpha.5...dsh-v0.1.2-rc.1` source comparison changes only 252 package version fields. No Agent loop, Remote API, session model, Web UI, plugin composition or configuration source changed. The rc.1 release page is cumulative from `0.1.1-rc.2`, so its feature list must not be treated as new relative to DSH V1.1.5.

## Ownership decisions

| Capability described by the rc.1 release | Current owner | V1.1.6 decision |
| --- | --- | --- |
| Queue, queued-message up-arrow, `Ctrl+Enter` steer and Stop | Official Harness | Keep the V1.1.4 removal of the duplicate desktop queue/interruption layer; do not add another controller |
| Conversation folding, width, token/time stats, turn navigation and font size | Official Harness Web UI | Use unchanged; DSH keeps only native window/workbench layout |
| Connection state/retry, Remote gateway and Session history transport | Official Harness | Use official protocols; retain desktop process supervision, loopback authentication and workspace binding |
| Provider/model settings and subagent `send_message` | Official Harness | Use official model discovery and Agent-to-Agent messaging; retain encrypted software-first Key storage and human-facing Tasks/Subagents management |
| Draft queue, text drafts, references and images | Official Harness for chat/image input | Keep official chat/image flow; retain only XLSX/DOCX/PDF and other desktop document-reference metadata and continuity |
| Plugin groups, Profiles, Skills and MCP | Official Harness composition | Keep official inventory and lifecycle authority; DSH only provides a bounded native extension/status surface and controlled reviewed install flow |
| Inspector/Web Preview experiments | Official Harness experimental surfaces | Do not silently activate; retain DSH native Git Review, safe local file preview and software-owned loopback application preview because their scope and trust boundary differ |
| Schedules in the Harness header | Official Harness session UI | Retain DSH isolated background scheduler because it owns Windows tray operation, DSH worktrees, caps, notifications and recovery rather than the header presentation |

## Result

No additional desktop capability is removed in V1.1.6. The only implementation changes are the fixed rc.1 runtime identity and stricter compatibility/release gates discovered during adaptation. Official Queue/Steer/Stop ownership and the V1.1.4 removed-surface regression test remain in force.

## Sources

- Official [alpha.5 to rc.1 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.2-alpha.5...dsh-v0.1.2-rc.1)
- Official [rc.1 release notes](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1)
- Previous [V1.1.4 ownership audit](HARNESS_UPSTREAM_OVERLAP_v1.1.4.md)
- Exact [rc.1 compatibility map](HARNESS_UPSTREAM_v0.1.2-rc.1.md)

V1.1.0 Stable and public V1.1.1 Pre-release remain unchanged. V1.1.6 remains local until explicit publication approval.
