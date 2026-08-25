# DSH Desktop V0.5.13

V0.5.13 adds evidence-based package governance and update/signing readiness checks. It keeps Stable at V0.5.4, DeepSeek Harness pinned to `0.1.1-rc.2`, and Electron pinned to `43.4.1`.

## Evidence-based package cleanup

- Remove the unused app-bundled `node-pty` and `node-addon-api` copies only after confirming that packaged terminal execution resolves exclusively from `resources/terminal`.
- Keep the isolated terminal's pinned Win-x64 package metadata, JavaScript runtime, native prebuilds, ConPTY helpers, and license. Continue rejecting foreign-platform prebuilds, PDB files, and reparse points.
- Remove xterm TypeScript source, source maps, and unused ESM builds while retaining the exact UMD JavaScript, CSS, and licenses loaded by the terminal page.
- Do not remove any Harness package merely because its filename or content appears similar. The fixed 432-package closure and all unpacked/installed smoke classes remain release gates.

## Differential-update governance

- Decode electron-builder gzip blockmaps with compressed, decompressed, file-count, and chunk-count limits.
- Compare chunks as a checksum-and-size multiset so duplicate chunks cannot be over-counted.
- Confirm the current blockmap byte total equals the exact installer size before accepting the report.
- Keep `compression: store`: V0.5.11 to V0.5.12 already demonstrates 98.9421% byte reuse and an estimated 1,939,098-byte differential instead of a full 183,289,373-byte download.

## Signing boundary

- Inspect the PE Certificate Table structurally and report whether an embedded signature exists; this is readiness evidence, not certificate-chain validation.
- Keep automatic update disabled while the installer is unsigned, `verifyUpdateCodeSignature` is false, or trusted-chain, expected-Publisher, and separated-feed evidence is absent.
- Require a trusted signing identity, timestamped installer/application signatures, Publisher matching, a Valid Windows verification result, and distinct Stable versus product-Latest feeds before enabling unattended download or replacement.

## Validation status

- The complete versioned source suite passes 159/159, and the production dependency audit reports no known vulnerability.
- The unpacked tree falls from 29,370 files and 685,196,921 bytes to 29,331 files and 673,292,351 bytes. `app.asar` falls from 6,818,148 bytes to 1,046,561 bytes; the app-bundled PTY/addon copy is zero files.
- The isolated terminal retains nineteen package files and every required Win-x64 runtime file, with zero foreign-platform file, PDB, or reparse point. A real packaged-terminal smoke completes two commands in one PTY and confirms that the software-managed Key is absent.
- The final candidate installer is 180,063,440 bytes with SHA-256 `FE1AF65E08FC641E0937E8D045B06934087C31CE58DF7959144BE11FAA486AE1`. Its blockmap estimates a 1,023,617-byte differential from V0.5.12 with 99.4315% reuse.
- PE inspection and Windows Authenticode both report unsigned; automatic update remains blocked.
- V0.5.13 directly overwrites V0.5.12. The installed tree has 29,334 files and differs from the current unpacked tree only by the normal uninstaller; the installed `app.asar` matches SHA-256 `8C069093DDEEC9BEDA097C5EC6430226554951865023189292184254AB8FE7DA`.
- All seven installed smoke classes pass: desktop, Harness, IPC isolation, PDF rendering, context sources, third-party plugin health, and a real two-command PTY with credential isolation. The 25-file semantic snapshot, including fourteen sessions, is byte-for-byte unchanged after overwrite.
- The last-known-good backup is `backups/pre-v0.5.13-20260825-092028`; it contains no credential-named file or reparse point and retains all three V0.5.12 release assets.
- PR #18 and main CI pass all three jobs. The published Pre-release contains three uploaded assets whose remote sizes and SHA-256 digests match the local artifacts; the installer URL returns HTTP 200.
- V0.5.4 remains the formal Stable and GitHub Latest release.
