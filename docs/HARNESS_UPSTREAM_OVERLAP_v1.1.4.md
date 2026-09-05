# DSH Desktop V1.1.4 official-overlap audit

This audit compares the DSH Desktop features already implemented at V1.1.3 with the official DeepSeek Harness `dsh-v0.1.2-alpha.3` through `dsh-v0.1.2-alpha.5` releases. The decision rule is strict: the official implementation replaces a desktop implementation only when both own the same user action and the official path is available in the bundled runtime. Partial overlaps keep only the desktop-specific extension.

## Decision matrix

| Official Harness capability | Existing DSH capability | Overlap decision | V1.1.4 action |
| --- | --- | --- | --- |
| Built-in queue, queued-message up-arrow steer, `Ctrl+Enter` steer and Stop | Custom queue/interrupt controller, duplicate workflow bar and private `resume-queue` host operation | Exact overlap; the desktop interception could reject a valid official action after workspace selection | **Use official**; delete the custom controller, renderer interception, duplicate buttons, IPC methods and private queue-resume operation |
| Reliable images queued during a running turn; image follow-ups to continuable children | Office document intake for XLSX/DOCX/PDF/CSV/TXT and pass-through for images | Different media scope; DSH must not capture official image intake | **Keep only the Office extension**; images continue through the official Harness handler |
| Extensionless image detection by `read_image` | Office file catalog and disk-backed document references | No functional duplication | Use official image reader; keep DSH document references |
| Parent/continuable-child Agent-to-Agent `send_message` | Human-facing Tasks/Subagents inspection and bounded follow-up controls | Different actor and control plane; DSH does not recreate the Agent tool | Use official Agent messaging; keep the desktop management surface |
| Long-session navigation/rendering and syntax-highlight performance | No alternative long-session renderer in DSH | Official-only | Use official unchanged |
| Custom model discovery headers and model-catalog filtering | Desktop Key storage and network/proxy configuration | Different responsibility | Use official model discovery; keep encrypted software-first Key and desktop network settings |
| `web_fetch` enabled for more official profiles | Extension center capability/status display | DSH is metadata presentation, not a Web-fetch implementation | Use official capability; keep the read-only status surface |
| Schedule-catalog narrow-layout fix | Isolated scheduled tasks in DSH-owned Git worktrees with history, caps, notifications and recovery | Partial visual/domain overlap only; execution and isolation contracts differ | Use official header layout; retain the isolated desktop scheduler |
| Sequence-based immutable Session event access | Session/worktree handoff with inherited-history verification | DSH consumes the official observation snapshot and adds directory/Git transfer safeguards | Keep the desktop handoff extension; no live `Session.events` access |
| Upgrade/startup and missing-title fixes | Desktop packaging, backup and overwrite installation | Different layer | Use official fix; retain desktop delivery controls |
| Per-session text draft persistence | Office reference continuity and source-preserving worktree handoff | Partial overlap; removing the desktop store would lose document metadata and handoff transfer | Keep the extension for document metadata/handoff; do not use it to replace official queue or steer behavior |

## Removed duplicate surface

- `electron/harness-reliable-interrupt.cjs`
- `assets/harness-reliable-interrupt.js`
- `assets/session-workflow.js`
- `harness:interrupt-and-prompt`, `harness:interrupt-queued`, and `harness:workflow-state` desktop IPC methods
- `resume-queue` in the desktop Session-control host
- The duplicate “排队发送 / 插话并继续 / 停止当前回合 / 继续排队消息” bar

The real-model interaction smoke now drives the official Harness composer and controls directly. A regression test fails if these deleted interception surfaces return.

## Source references

- Official [alpha.3 release notes](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.3)
- Official [alpha.4 release notes](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.4)
- Official [alpha.5 release notes](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.5)
- Bundled source: `vendor/harness-source-0.1.2-alpha.5`

V1.1.0 Stable and the public V1.1.1 Pre-release remain unchanged. V1.1.4 is local-only until explicit publication approval.
