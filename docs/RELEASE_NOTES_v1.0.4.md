# DSH Desktop V1.0.4

Candidate: native-isolated workbench. Stable V0.5.4 is unchanged.

- Six native, separately sandboxed tools dock inside the main window: terminal, Office, tasks, extensions, Wiki and worktrees. File/review/preview controls share the workbench bar.
- Collapse, switch or detach/redock the terminal without restarting its PTY. Closing the terminal or switching workspace still stops it. Keyboard navigation and project-specific layout persistence are included.
- `desktop_terminal_read` lets the current foreground agent request up to 8,000 recent terminal characters. Every nonempty snapshot requires native confirmation and rechecks the session/workspace/terminal identity. Known credentials are masked; users still review business data before consent. There is no model-facing desktop-terminal write or clipboard tool.
- Native views keep their existing guarded IPC and sandbox. They are not iframes granted shell access. Office uses a compact docked layout; standalone windows remain available.

368/368 source tests pass. Real composed-window, native IPC and PTY checks pass at normal/compact sizes and 80%/120%/140% zoom, including close/reopen and detach/redock. A real paid model read a random terminal marker through the new tool and wrote the correct result file; the isolated smoke approved the exact native confirmation dialogs. Side panels reserve horizontal room and prefer the last opened side when space is tight. Final package, installed validation and anonymous public download verification are required before delivery. Unsigned automatic installation remains blocked.
