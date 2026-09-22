# Client and protocol matrix

| Client / surface | Version | Evidence | Status |
|---|---|---|---|
| Official TypeScript SDK test client | 2.0.0 | Real HTTP connection, tools/list, scope filtering, calls | AUTOMATED |
| Legacy protocol request | 2025-03-26 | Official server adapter handles initialize + tools/list | AUTOMATED |
| Synthetic native OAuth client against Keycloak | Keycloak 26.7.4 / openid-client 6.8.8 | Actual code+PKCE, nonce/state, issued access token, MCP calls | AUTOMATED; not an IDE |
| Review HTTP session flow | Playwright APIRequestContext 1.63.0 | Actual OIDC HTML forms, cookies, CSRF, peer review | AUTOMATED; not a browser |
| Chromium browser | Playwright 1.63.0 | Separate CI job and screenshots | See CI job outcome, not implied by HTTP test |
| Claude Code native CLI / IDE | Not installed for this task | Config + onboarding supplied | NOT VERIFIED |
| Codex selected native surface | Not installed for this task | Config + onboarding supplied | NOT VERIFIED |
| Cursor Agent mode | Not installed for this task | Config + onboarding supplied | NOT VERIFIED |
| Hosted/cloud agents | Not configured | Separate network/provider approval needed | NOT VERIFIED |

Native registrations start without wildcard redirects. Record each actual OS,
version, callback, negotiated revision, server commit, token refresh and instruction
loading result during acceptance. OAuth client names are self-report, not attestation.
