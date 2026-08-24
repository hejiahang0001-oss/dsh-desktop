# DSH Desktop V0.5.11

V0.5.11 adds bounded enable/disable controls for Profile-declared external extension layers and a repeatable package-size baseline. It keeps Stable at V0.5.4, DeepSeek Harness pinned to `0.1.1-rc.2`, and Electron pinned to `43.4.1`.

## Safe external-extension toggle

- Show an enable/disable action only for a package that is explicitly declared in the selected Profile's dependencies, resolves inside the fixed runtime or Profile module tree, and declares a `dsh.bundle` patch.
- Never expose a toggle for the fixed base/Web bundle layers. The desktop cannot disable `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, or another installation-owned layer unless the user has explicitly made that package a Profile dependency.
- Require a Windows-native confirmation whose default and close action are Cancel. Block changes while an Agent, pending approval, terminal, or checkpoint operation is active.
- Change only the ordered `dsh.profile.bundles` list. Disabling keeps the package and dependency installed; enabling never invokes pnpm, runs a package script, downloads code, or accepts an arbitrary command/specification.
- Restart Harness, rescan the exact runtime/Profile health state, and commit the change only when the requested state is verified.

## Recovery

- Before the manifest replacement, write a non-secret transaction journal and use the shared atomic JSON writer to create a flushed, re-read `package.json.bak`.
- If restart or health verification fails, restore the exact previous manifest and restart Harness again.
- If the process stops between the atomic write and commit, the next launch compares previous/next hashes and restores only when the journal, primary, and verified backup form the expected transaction. Conflicting user edits fail closed and are not overwritten.

## Package-size baseline

- Add a link-free, bounded package-size inventory that separates `app.asar`, the Harness runtime, the external Node runtime, the isolated terminal runtime, and the Electron shell.
- V0.5.11 records a real baseline before any slimming work. No dependency is removed merely to reduce the installer size; future removal requires closure, unpacked, installed, smoke, and overwrite-data evidence.

## Boundary

- Installing, removing, and updating external plugins remains an upstream `dsh plugin`/pnpm responsibility.
- Stable remains V0.5.4. V0.5.11 advances only the product Latest/Pre-release channel after all package, overwrite, recovery, installed-smoke, and remote-asset gates pass.
