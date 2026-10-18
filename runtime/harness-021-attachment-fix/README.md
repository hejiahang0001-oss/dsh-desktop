# Reviewed official attachment lifetime increment

Applies only to the exact reviewed Harness 0.2.1-alpha.1 source inputs identified by `profile.json`. It does not change the existing deployed runtime, descriptor, source candidate input set, lockfile, permissions, persisted profile or release channel.

`InputHub` holds one existing `SessionReference` while its shell owns browser attachments or unfinished attachment submissions. Navigation releases only the view's reference. Removing the final attachment or finishing a successful submission releases the draft reference; failure restores its original draft. Session deletion disposes the shell, and root teardown retains the original resource cleanup. An attachment-only success now publishes settlement so the final reference can be released. No alternate attachment store, protocol, UI or queue is introduced.

Preparation (source is read-only; output must not already exist):

```powershell
& .\vendor\runtime\win32-x64\node.exe scripts/prepare-harness021-attachment-fix.cjs --source-root=<absolute-reviewed-source> --output-root=<absolute-new-output-directory>
```

The output verifies the patch against isolated copies and contains exact `after/` postimages plus `result.json`. It is not a complete buildable source tree. The caller must integrate these reviewed changes into an isolated full source checkout, rebuild the changed official client package, regenerate the descriptor/materialization evidence, and pass official-page attachment smoke before deployment or package acceptance.

Source behavior verification:

```powershell
& .\vendor\runtime\win32-x64\node.exe scripts/verify-harness021-attachment-fix.cjs --mode=red
& .\vendor\runtime\win32-x64\node.exe scripts/verify-harness021-attachment-fix.cjs --mode=green --suite=adjacent
```

The verifier uses the existing official dependency/test graph and a Vite source overlay for the reviewed files. A uniquely named temporary test fixture is inserted beside official tests and removed after child exit only if its digest matches. It does not replace an existing source file, bypass the ClientSessions implementation, call a model, use real profiles, rebuild or deploy. This is source behavior evidence; it does not close the existing true-Electron release gate by itself.
