# Follow-up required for the strict official client build

Apply `type-only.patch` **after** this directory's original `source.patch` and before the comment-only `../harness-021-jsdoc-fix/source.patch`.

This changes only the newly added navigation regression fixture's TypeScript types. Runtime `hub.ts` and `facade.ts` are unchanged, and the emitted fixture JavaScript is identical. The first official build exposed the missing branded SessionId / typed callback declarations; its failure is retained, not rewritten as a pass.

The canonical patch bytes are identical to the build's frozen `artifacts/stable-readiness-20261007/attachment/types-v1/source.patch`, SHA-256 `6fcd92dcdd9618baed95c2c040c317f33022ba5d66c97790dca91c803d5a9c2a`. The public copy exists so that reproducing the source fix does not depend on a private artifacts folder.

Before applying, use `git apply --check` on the precisely prepared parent+attachment source. After applying, `packages/client/ui-conversation/tests/attachment-navigation.client.spec.ts` must have SHA-256 `21596bb944c1c5bd7fc626f57e2f715d1c5b4ef65d2acdb9da7c5c9607e2b5f2` (LF bytes). Do not apply to another upstream version or regenerate a historical profile in place.

Validated on the fixed 0.2.1-alpha.1 source: full client aggregate TypeScript check, 11 navigation behavior tests, and the final complete official build. These source results are not installed-app or Stable acceptance.
