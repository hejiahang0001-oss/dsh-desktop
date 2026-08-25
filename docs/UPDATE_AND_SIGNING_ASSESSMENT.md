# Update and signing assessment

## Current decision

DSH Desktop generates electron-builder blockmaps and publishes them beside product-Latest Pre-releases, but it does not yet perform automatic update. V0.5.13 keeps that boundary: differential delivery is technically useful, while safe unattended replacement is blocked by the unsigned installer, disabled signature verification, and the deliberate separation between GitHub's Stable `latest` release and product-Latest Pre-releases.

## Measured differential value

The real V0.5.11 and V0.5.12 blockmaps contain 8,720 and 8,728 chunks. Of the V0.5.12 installer's 183,289,373 bytes, 181,350,275 bytes match reusable V0.5.11 chunks. The estimated differential is 1,939,098 bytes, a 98.9421% reuse ratio.

This is why the build retains `compression: store`: the complete installer is larger, but small-version updates remain highly reusable and independently hashable. A switch to solid maximum compression would need a measured blockmap comparison, not an assumption based only on the full installer size.

## Package boundary

The application previously contained an automatically collected `node-pty`/`node-addon-api` copy in `app.asar` and `app.asar.unpacked`, including foreign-platform native files. Packaged PTY execution does not use that copy; it resolves from the separately filtered `resources/terminal` Win-x64 runtime. V0.5.13 excludes only the redundant app copy and unused xterm development surfaces, then re-runs terminal, IPC, package-layout, and full desktop smoke gates.

The resulting unpacked tree is 11,904,570 bytes smaller, and `app.asar` is 5,771,587 bytes smaller. The complete installer decreases from 183,289,373 to 180,063,440 bytes. The real V0.5.12→V0.5.13 blockmap still reuses 179,039,823 bytes and estimates a 1,023,617-byte differential, a 99.4315% reuse ratio.

The Harness runtime remains untouched. Its 432-package fixed dependency closure is a functional boundary, not a pool of files eligible for filename-based deletion.

## Signing prerequisites

Before automatic update can be enabled:

1. Obtain a trusted Windows code-signing identity suitable for CI or a managed signing service, with private-key access restricted outside the repository.
2. Enable electron-builder signing for the application, uninstaller, and installer, with an RFC 3161 timestamp.
3. Enable update signature verification and require the expected Publisher identity.
4. Verify every final artifact with Windows Authenticode and require `Valid`, a trusted chain, a timestamp, and the expected subject.
5. Define separate Stable and product-Latest feeds. GitHub's formal `releases/latest` remains V0.5.4 by product policy, while daily product Latest versions are Pre-releases.
6. Add download-to-temporary-file, hash/blockmap verification, user confirmation, last-known-good retention, failed-start rollback, and post-update semantic data checks.

Until all six are complete, DSH Desktop may publish full installers and blockmaps but must not silently download or replace the installed application.
