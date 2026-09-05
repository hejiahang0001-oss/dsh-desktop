# Contributing to DSH Desktop

Thanks for helping improve DSH Desktop. Small, focused changes with reproducible evidence are easiest to review.

The authoritative iteration, code, test, review, packaging, and release rules are in [docs/DEVELOPMENT_PLAYBOOK.md](docs/DEVELOPMENT_PLAYBOOK.md). Contributors should read it before changing privileged Electron surfaces, Harness integration, persistence, Office/Wiki tools, or release behavior.

## Before opening a change

- Use GitHub Discussions for open-ended product questions and early ideas.
- Search existing issues before filing a bug or feature request.
- For vulnerabilities, follow [SECURITY.md](SECURITY.md) and do not publish exploit details in an issue.
- Keep DSH Desktop an independent community project; do not imply DeepSeek endorsement.

## Local development

DSH Desktop currently targets Windows x64.

```powershell
pnpm install --prod=false
pnpm electron:fetch
pnpm runtime:fetch
pnpm runtime:deploy
pnpm test
pnpm start
```

The test suite uses Node's built-in test runner. Run `pnpm test` before opening a pull request.

## Pull requests

- Explain the user problem and the product boundary affected.
- Keep Electron's renderer sandbox, context isolation, disabled Node integration, loopback-only host, and navigation restrictions intact.
- Add or update focused tests for Supervisor, workspace, session, credential, Agent/tool, or change-review behavior.
- Never commit API keys, `.credentials.yaml`, `.credentials.dpapi.json`, settings containing secrets, logs with user content, runtime caches, or packaged installers.
- Include screenshots only when the visible UI changes.
- Separate verified facts from intended or future behavior.
- Classify review findings as Blocking, Important, Nit, or Suggestion, and include the trigger, impact, proposed fix, and verification for every blocking concern.
- Update the matching release note, validation evidence, and Wiki-facing knowledge when a versioned capability changes.

By contributing, you agree that your contribution may be distributed under the repository's MIT License.
