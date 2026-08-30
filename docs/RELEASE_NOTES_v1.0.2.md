# DSH Desktop V1.0.2

Published Pre-release: document intake and encrypted software credentials. Stable V0.5.4 is unchanged; no automatic installation or Stable promotion.

## Changes

- Add multiple local XLSX, DOCX, PDF, PPTX, CSV, TXT and Markdown files through the document entry or drag/drop. External files are copied into bounded workspace-owned attachment directories; workspace files are referenced without copying. Original files are not modified.
- Validate supported signatures, sizes, names and directory links; reject legacy DOC/XLS, macros, fake formats and protected credential paths with actionable feedback. Images keep the upstream image path; mixed image/document drops request separate batches.
- Insert references through the upstream rich-text editor's paste path. Preserve existing drafts and rich attachments; verify that references enter the actual upstream send payload. Revalidate session before insertion. User-imported files are protected against reject-all Git operations.
- Encrypt software credentials and their atomic backup through Windows DPAPI. Confirm the encrypted provider is active and the plaintext provider is disabled before removing the unchanged legacy credential document. Never materialize the Key in child-process environment or ordinary support data.

## Boundaries

Maximum 10 files per batch, 32 MiB per file and 64 MiB total. Import success is not a claim that the model has read the file. PDF import/preview does not imply scanned-PDF OCR. File catalogs remain in memory until the session-continuity milestone.

DPAPI does not protect against code running as the same Windows user or trusted code inside Harness. Older versions cannot read the new encrypted credential format and need the Key re-entered; no plaintext rollback copy is created. See [Key storage](KEY_STORAGE.md).

## Evidence

350/350 source tests pass. Unpacked and installed builds pass document intake, IPC isolation, Harness startup, Office center and real two-command terminal checks. A paid real-model acceptance in the unpacked build verified exact XLSX totals and a random DOCX marker using migrated encrypted credentials. Windows registers 1.0.2 after overwrite installation. All 31 semantic files match immediately before/after installation; subsequent normal startup intentionally migrates credentials. PR #62 and main CI 33325999737 passed. All four public assets match local size and SHA-256 after anonymous re-download. The release targets cfc5d388f59898636383147281eeaeffd9f892cd; Stable remains V0.5.4.

A first-start upstream session-directory race occurred once and passed on retry; bounded startup recovery remains a V1.0.5 acceptance item. Test profiles must keep their Chromium user data with their encrypted Harness vault.
