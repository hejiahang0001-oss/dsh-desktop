# DSH Desktop V0.6.3

V0.6.3 adds the first native Wiki workflow while keeping V0.5.4 as Stable. DeepSeek Harness remains pinned to `0.1.1-rc.2`, Electron to `43.4.1`, Node.js to `24.19.0`, and bundled pnpm to `11.19.0`.

## What is included

- A local-only **Wiki center** for choosing an existing Markdown vault or initializing only the missing foundation files.
- Bounded Wiki query results with page paths and recorded sources. Compiled pages are searched; `_raw`, `_staging`, `_archives`, `.obsidian`, and Git metadata are excluded.
- Selection of one completed assistant conclusion from the current Harness session, editable preview, sensitive-content warning, native default-cancel confirmation, and a no-overwrite save.
- Successful capture creates one `synthesis` page and updates `index.md` and `log.md` as one verified transaction. The original Harness session remains read-only.
- Fixed native Harness discovery for `wiki-setup`, `wiki-query`, and `wiki-capture`; `llm-wiki` supplies the shared boundary. The foundation requires no Git, Python, QMD, Obsidian, Codex installation, or API-key propagation.

## Boundaries

- V0.6.3 does not yet synchronize a whole project or batch-import DSH history. Those remain V0.6.4 and V0.6.5 work.
- A vault path is selected separately on each computer and retained if the directory is temporarily unavailable.
- Initialization never overwrites an existing Wiki page or configuration file. Capture never overwrites an existing page with the same slug.
- Stable remains V0.5.4. Local package, overwrite-install, installed-runtime, real-model, and data-retention gates pass; V0.6.3 remains a local Latest candidate until PR/CI and public-asset gates are recorded.

Local installer target: `DSH-Desktop-Setup-0.6.3.exe`.
