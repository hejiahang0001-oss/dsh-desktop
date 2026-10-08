# Private PowerShell export JSDoc-only source increment

This separately reviewed increment documents 17 exported symbols in five existing private PowerShell source files. It changes comments only: stripped TypeScript AST output and emitted JavaScript are identical for all five preimages/postimages. The original parent profile and PS7 patch remain immutable.

`profile.json` pins the parent and this patch plus exact before/after hashes. `source.patch` applies to the reviewed parent private-PS7 source, independently of the disjoint official attachment increment. The unmodified upstream export checker reproduced all 39 full-source baseline findings on the exact five-file fixture and reports zero findings on these postimages. The integrated full-tree gate/build are coordinator-owned and pending in this frozen proposal record.

See `artifacts/stable-readiness-20261007/jsdoc/README.md` and `proposal-v1/result.json` for the semantic scope, evidence, and coordinated apply plan. Do not hand-edit vendor, overwrite historical build evidence, or infer Stable promotion from this documentation increment.
