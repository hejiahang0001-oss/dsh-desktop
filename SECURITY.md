# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.5.x | Yes |
| 0.4.x | Security fixes only |
| 0.3.x and earlier | No |

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting flow from the repository **Security** tab. Do not open a public issue containing credentials, exploit code, private repository paths, session content, or other sensitive evidence.

If private reporting is temporarily unavailable, open a public issue that contains only a request for a private maintainer contact. Do not include vulnerability details until a private channel is established.

Include:

- affected DSH Desktop version;
- Windows version and architecture;
- impact and reproducible steps;
- whether the issue requires a malicious repository, local access, network access, or an existing API key;
- a minimal proof of concept with secrets and personal paths removed.

## Security boundaries

- DSH Desktop is an independent community shell around DeepSeek Harness, not an official DeepSeek product.
- The renderer is sandboxed with context isolation, no Node integration, restricted navigation, and a loopback-only Harness host on a random port.
- The application must not read, display, log, or transmit plaintext API keys for diagnostics.
- The pinned Harness `0.1.1-rc.2` stores its software-managed credential in `.credentials.yaml` under the Windows user data directory. It relies on user-directory ACLs; Windows Credential Manager/DPAPI integration is not complete.
- Software-selected proxies apply only to Harness external traffic. Proxy URLs with credentials are rejected; inherited proxy variables are removed from Harness, and loopback services plus the integrated terminal stay outside that route.
- The trusted Harness main frame may write sanitized text to the clipboard for copy actions. Clipboard reads, subframes, unrelated origins, and every other Web permission remain denied.
- Conversation-linked checkpoints keep session ids and completed-turn sequence values in private Git metadata. The renderer receives only bounded capability booleans, and official session forks are accepted only after source, workspace, lineage, and non-subagent verification.
- Full Access bypasses the Harness command sandbox. DSH Desktop never switches permission modes automatically.

We will acknowledge a complete private report, assess scope, prepare a fix when applicable, and coordinate disclosure after an update is available.
