# DSH Desktop V1.1.1

DeepSeek Harness `0.1.2-alpha.2` compatibility update for **product Latest / GitHub Pre-release**. V1.1.0 Stable is unchanged.

## Changes

- Pin the official Harness alpha.2 tag and commit, frozen build recipe, package payload and packaging provenance.
- Follow upstream connection recovery, settings/extension UI, long-history and streaming improvements without replacing the official Agent loop.
- Preserve namespaced Remote errors and recognize queue-promotion races without resending a consumed message.
- Adapt background-task permission reads to alpha.2's Session projection API, retaining Workspace Write + Ask and pre-submission permission revalidation.
- Remove the outdated V0.5.4 Stable label from the no-update dialog; Stable changes still require explicit maintainer approval.
- Add a credential-free, copied-fixture comparison of persisted JSONL histories across the old and new runtimes.

## Boundaries

Ordinary Excel/Word/PDF intake does not require Git. Worktree-backed background tasks still require Git. Existing software-first encrypted Key storage, document generation and native desktop tools remain in scope for regression checks.

The default JSONL storage and custom SQLite profiles are distinct: upstream SQLite schema changes from 19 to 20 and no SQLite migration is included here. Back up custom profiles before upgrading. Windows EXE file properties still inherit Electron runtime metadata; the app version and installer registration identify the product version. The installer is unsigned, automatic installation is disabled, and short smoke runs do not establish multi-day stability or compatibility with every community plugin.

## Validation

Windows validation: 408 source tests, 8 installed-app interaction suites, isolated PTY and 4 real-model suites passed. Overwrite installation preserved 34 semantic files, the encrypted software Key and Local State. Background tasks, interruption/queue, session handoff and real XLSX/DOCX reads were exercised. One native screenshot attempt failed before model admission; a fresh-profile repeat passed without changing the binaries or capture assertions.

Public-download acceptance is tracked in [PROGRESS.md](https://github.com/hejiahang0001-oss/dsh-desktop/blob/main/PROGRESS.md). Only completed gates there count as verified; V1.1.0 remains the recommended Stable download. Multi-day use, another computer's intranet/proxy and a real-model Plan approval were not revalidated in this release.

## 中文说明

本版用于跟随 Harness alpha.2，发布到 Latest 测试通道，不更换 V1.1.0 Stable。重点验证历史会话、文档拖入、草稿、插话/队列、后台任务和软件 Key。自定义 SQLite 存储不在迁移承诺内，具体完成的检查见执行进度。
