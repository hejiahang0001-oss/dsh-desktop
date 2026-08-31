# DSH Desktop V1.1.2

Unpublished Latest candidate. V1.1.0 Stable and the currently public V1.1.1 Pre-release are unchanged.

## Fixes

- Resolve chat-scoped operations against the selected Harness Session's authoritative working directory, instead of the native desktop launch directory. This covers interruption, queue promotion, draft recovery and document intake after selecting a different workspace in the sidebar.
- Preserve validation of session identity, local directory, subagent boundaries and context changes before mutations. Queue promotion still uses the exact existing message identity and never resends a consumed message.
- Handle the full file-drag lifecycle before the upstream image-only overlay. Keep image drops on the official image route and plain-text drags native; retain the Add File button, explicit document import confirmation and source-file preservation.

## Validation and boundaries

418 source tests and the production dependency audit passed. Both source and final unpacked builds passed the cross-workspace document, draft-continuity and real-model up-arrow/interruption suites; the final unpacked build also passed all eight baseline interaction suites. XLSX, DOCX and PDF files were dragged using the full Chromium native drag lifecycle with real disk-backed files, and the original files remained unchanged. Queue/interruption marker files proved execution in the selected Session directory. This does not claim physical Explorer-drag testing on another computer.

The Windows installer and portable build are ready locally, with SHA-256 checksums. Overwrite installation, installed-app acceptance and public release remain pending user confirmation to close the running app. See [PROGRESS.md](../PROGRESS.md) for completed gates and retained failure evidence. Do not treat unpacked acceptance as installed-app or public-download acceptance.

The native terminal/project is not silently switched when selecting a chat. Reading a terminal still requires its cwd to match the selected chat and explicit confirmation. The Harness pin remains 0.1.2-alpha.2; no dependency upgrade is included. Unsigned installers, disabled automatic installation, custom SQLite migration and long-term stability boundaries remain unchanged.
