# DSH Desktop V0.6.2

V0.6.2 is a focused usability release for computers where Git is not installed or the selected workspace cannot provide Git checkpoints. Stable remains V0.5.4; official DeepSeek Harness stays pinned to `0.1.1-rc.2`, Electron to `43.4.1`, Node.js to `24.19.0`, and bundled pnpm to `11.19.0`.

## Quiet best-effort checkpoints

- Clicking or typing in the Harness composer still attempts the existing automatic code checkpoint when possible.
- If an automatic checkpoint is unavailable, DSH silently continues to the normal Harness send path instead of showing the generic Git warning.
- Manual checkpoint creation still reports unavailable Git or repository state, so the explicit recovery controls remain understandable.
- Word, Excel, PowerPoint, ordinary chat, and the official Harness Agent loop do not depend on Git checkpoints and are unchanged.

## Verification status

- The old behavior is captured by a failing regression assertion; the focused checkpoint and command-palette suites pass 5/5 after the fix.
- Full source passes 261/261 and the focused checkpoint/command suites pass 5/5. Production dependency audit, syntax checks, and diff whitespace checks pass.
- Unpacked and installed runtime matrices each pass 10/10; the installed packaged terminal also passes working-directory, credential-isolation, and second-command checks.
- Silent overwrite registers V0.6.2 and preserves all 27 credential-free semantic files byte-for-byte before install, after install, and after installed smoke. Rollback backup: `backups/pre-v0.6.2-20260826-213117`.
- A true no-Git installed run confirms `/excel-xlsx` suggestions still appear while automatic checkpoint warnings stay silent after composer click, input, and delayed refresh. No message was submitted during this UI gate.
- Installer: 184,048,484 bytes, SHA-256 `B4E5364F081E748A754647CA5FCD1833C8F215434EE855DB86B9D041F4A9A1CF`. Blockmap: 188,963 bytes, SHA-256 `ECDB3F890CBD2BFA46903B8B4E8CAFD46994B89BBE495EA831BA938A4AE73B32`. Manifest SHA-256: `F5DC76A85F793B5A4E2422AE130F06AD3FFB9F30EF4FF348272F5DC2B407F6A6`.
- Implementation PR [#43](https://github.com/hejiahang0001-oss/dsh-desktop/pull/43) and main CI pass all three Windows jobs. The non-draft [V0.6.2 Pre-release](https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.6.2) targets exact merge `3af68ef9d39eaf489164394855b57e73b1604829`; GitHub asset metadata and a public clean download reproduce all three local SHA-256 values, and the downloaded manifest passes 2/2. Stable remains V0.5.4.

Local installer: `DSH-Desktop-Setup-0.6.2.exe`. Stable remains V0.5.4 unless the maintainer explicitly promotes a tested Latest build.
