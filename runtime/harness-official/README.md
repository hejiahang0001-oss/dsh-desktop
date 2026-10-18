# Fixed official Harness runtime verifier

This directory carries the original `runtime-tree.ts`, `release.ts`, `host-protocol.ts`
and `core-package-set.ts` from DeepSeek Harness tag `dsh-v0.2.1-alpha.1`, commit
`5badb15009ae1756c3afe0ae0cef1faafc290ccc`, without source changes. The official MIT
notice is retained in `LICENSE.deepseek.txt`.

`runtime-tree.cjs` is a generated CommonJS bundle of the official verifier and
`semver@7.8.5` (ISC, `LICENSE.semver.txt`). Its external source map retains the
complete compilation inputs, including semver sources. `build-manifest.json`
records exact source and output SHA-256 values. `build.cjs` uses the existing,
fixed candidate `esbuild@0.28.1` and its verified Windows binary; no package is
installed and the tool itself is not embedded. Its MIT notice is retained for
build provenance in `LICENSE.esbuild.txt`.

`source-compatibility.json` separately records the 2026-10-18 comparison with
tag `dsh-v0.2.1-rc.2`, commit
`687f282e8625c6b8d11ff58211a90524be2e4317`. All four retained TypeScript files
are byte-identical to both the exact rc.2 Git objects and candidate source
files. The record binds their hashes, the existing build manifest, bundle and
source map. No bundle was rebuilt: `build-manifest.json` continues to describe
the original alpha.1 build and dependency inputs, not a new rc.2 compilation.
This establishes verifier-source compatibility only, not acceptance of a
runtime payload, native behavior, desktop host, installation or release.

Check the retained compatibility record without an upstream checkout or network:

```powershell
& .\vendor\runtime\win32-x64\node.exe --test --test-concurrency=2 test/harness-official-compatibility.test.cjs
```

This test checks the committed attestation against the retained sources and
build artifacts; it does not repeat the original upstream Git comparison.

Rebuild from the project root using the project runtime:

```powershell
& .\vendor\runtime\win32-x64\node.exe runtime/harness-official/build.cjs
```

A rebuild rejects changes to the reviewed input/output record. The host bridge
in `electron/harness-desktop-runtime.cjs` calls the official `verifyDesktopRuntime`
for complete payload verification. Windows path, link and file-identity checks
surround that call; they do not replace its package or byte-inventory algorithm.

`runtime/harness/package.json` is the product candidate binding. It does not
authorize installation, publication or Stable promotion. The historical
`runtime/harness-021-candidate/profile.json` remains a frozen preparation record
with `promotionAllowed: false`.
