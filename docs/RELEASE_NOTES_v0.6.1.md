# DSH Desktop V0.6.1

V0.6.1 is a focused reliability release for supplemental messages sent while the Agent is already replying. Stable remains V0.5.4; official DeepSeek Harness stays pinned to `0.1.1-rc.2`, Electron to `43.4.1`, Node.js to `24.19.0`, and bundled pnpm to `11.19.0`.

## Reliable interruption

- `Ctrl+Enter` on a bounded plain-text draft now asks the official Harness session to cancel the running turn, waits for a verified idle boundary, and then submits the complete correction through the official session API.
- The visible queued-message interrupt action reads the complete authoritative queue item through Harness's WebSocket downlink, removes that exact item, requests cancellation, and resubmits the full text. It does not reconstruct a message from a shortened UI preview.
- The renderer cannot choose a session id. The main process re-reads the current Harness selection and verifies that the ordinary session belongs to the exact active workspace before any cancel, queue, or prompt action.
- The draft is cleared only after Harness accepts the correction and only if the user has not edited it while the request was pending. Failure leaves the draft or queued item available with a visible status.

## Preserved boundaries

- The desktop still uses one official DeepSeek Harness Agent loop; it does not create a parallel chat implementation.
- Attachments, slash commands, references, content longer than 8000 characters, subagent sessions, and mismatched workspaces are not converted to the plain-text interrupt path.
- A turn that finishes immediately before cancellation remains a valid race: the correction is still delivered once without treating the already completed turn as an error.

## Verification status

- The focused reliable-interrupt suite passes 10/10; the complete source suite passes 261/261.
- An isolated real DeepSeek session records an aborted original turn and returns both direct and queued correction markers. The temporary credential copy is removed and the result artifact contains no API key.
- The final unpacked and installed GUI matrices and terminal smokes pass. The installed tree contains every unpacked file at equal length plus only the normal uninstaller, has zero reparse points, and matches the unpacked `app.asar` SHA-256.
- Silent overwrite registers V0.6.1 and preserves all 27 credential-free semantic files byte-for-byte before install, after install, and after installed smoke. The verified rollback backup also retains all three V0.6.0 release assets.
- PR/CI and GitHub asset evidence remain pending before this candidate is published as a product-Latest Pre-release.

Final local installer: `DSH-Desktop-Setup-0.6.1.exe` — 184,048,445 bytes, SHA-256 `8B344A63EDB18ED955A3826E7A12AC8EC3DEE8C09945B16E4B81818EFEF523CB`. Its 188,952-byte blockmap hashes to `2EB7872D030AFB277257A9CD263284FAE26E2DCA82BEA34294A28879DFBA8F74`; the checksum manifest hashes to `E999AA27FAF1BC0C62FEA725BA8FBDEC14EF8257E9A439FBE5AAC369463D785A`. Stable remains V0.5.4 unless the maintainer explicitly promotes a tested Latest build.
