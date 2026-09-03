# DSH Desktop V1.1.5

V1.1.5 is a local Latest candidate focused on the desktop-owned workbench UI. It keeps the official Harness `0.1.2-alpha.5` renderer and interaction controls unchanged.

## Changes

- Separate primary tools, auxiliary panels and window controls in the bottom workbench toolbar; preserve keyboard tab behavior and add a quiet indicator for tools already open.
- Let primary tool tabs scroll at narrow widths instead of compressing every action.
- Present Office attachments as a compact surface aligned with the official composer, with clearer file chips, status hierarchy and drag feedback.
- Hide accept/reject actions when the current Git scope has no actionable change; protected and read-only scopes no longer look executable.
- Add visible compound-control focus, high-contrast, forced-color and reduced-motion handling without adding blur or a second visual framework.
- Remove stale CSS left behind by the V1.1.4 custom interruption controls.

## Validation

- Targeted UI regression tests pass for the native dock, document intake, review panel and official composer integration.
- Real Harness source smokes pass for compact/expanded dock layouts, Office, native XLSX/DOCX/PDF drag, composer draft preservation and scoped Git review.
- Composed screenshots were inspected at normal and compact heights; the empty review state no longer exposes irrelevant action buttons.
- Full source tests pass 406/406 with no skips; the production dependency audit reports no known vulnerabilities.
- The unpacked and installed application each pass the eight-part base smoke matrix. Package governance reports `packageReady=true`, the exact Harness alpha.5 commit and zero reparse points.
- The overwrite installation preserved 34 semantic state/session files, the encrypted software Key and Electron Local State. The verified backup excludes credential files.
- Setup: 188,638,503 bytes, SHA-256 `28c18ffeb762b87c1c054bd4fc5e5fdceed786b924cc0f7f432ac623b7f75609`.
- Portable: 187,947,003 bytes, SHA-256 `407d497ed9c0352dbe1d3a9714b112cbbc1228fbdd118aae0278b2f865bc9908`.

## Release policy

- V1.1.0 Stable is unchanged.
- Public V1.1.1 remains the current Pre-release until a newer candidate is explicitly published.
- V1.1.5 is not a GitHub release and must not be promoted to Stable without a maintainer instruction.
- The installer remains unsigned, so automatic installation remains disabled.
