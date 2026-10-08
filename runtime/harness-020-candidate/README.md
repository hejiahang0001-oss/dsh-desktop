# Harness 0.2.0-rc.2 isolated candidate inputs

Not the active production runtime. Do not point the installed application here or publish these inputs as a completed desktop release.

Preparation entrypoint: `node scripts/prepare-harness020-candidate.cjs --source-root=<absolute-clean-checkout>`. It validates the exact commit, clean checkout, patch and input hashes before applying the reviewed patch and security lock. A fresh independent checkout passed on 2026-10-02. This is not the production builder or a promotion command.

- Repository: https://github.com/deepseek-ai/deepseek-harness.git
- Tag: dsh-v0.2.0-rc.2
- Commit: 639ed015397290b3745d163aafe02ffee4aa3f84
- Source package manager: pnpm 11.7.0 (desktop root stays 11.19.0)
- Original lock SHA256: 80fe05eae33582ae26839afd05f1965f9b0e4be11034ddf9797af6085d5ba9b1
- Original workspace SHA256: 8486cab8bfbba2b0f740eac3d5109132b18a3bd53d3b07aebf441e4f1462eb4e
- Candidate lock SHA256: a9987755c972ccab17c40b3060e76bbc94fb550ce0058c6cd9fb89561df26b67
- Candidate workspace SHA256: 3a62d083c8de76a46a8dd364a3bbb445c1d0cba5fa802c6e4b967c4b1d8b0893
- source.patch SHA256: 3da22e265d82d30ba2cbd15d89b53b81c769245101a60c12617161fcab5523fe

Apply source.patch only to the exact clean commit, then use the candidate lock. The patch fixes exact audited dependencies, portable Vitest fixture types, and package self-reference resolution in the upstream test harness (with a regression test). It does not change the production Agent loop. Reverse-application check passed against the tested source checkout.

Evidence and remaining acceptance gates: ../../docs/HARNESS_FULL_ADAPTATION_2026-09-30.md. Production builder/profile integration, complete GUI/model/Office/proxy checks, packaging, overwrite/data-retention and publication are still pending. Office source availability remains a publication gate. No user credentials or profiles belong in this directory.
