# Client onboarding

## 1. Server-side preparation

An operator registers the exact MCP resource URI and separate public native OAuth
client IDs at the approved authorization server. Use authorization-code + PKCE S256;
never install a native client secret on developer machines. The token needs the
exact configured MCP audience, issuer, subject, expiry, issue time, allowed client
ID (`azp`/`client_id`) and access-token semantics. Read, propose and feedback scopes
are separate. Review OIDC tokens never authorize MCP publication.

Create an active Principal for the stable issuer+subject pair, then assign the
required project/team roles through the registry UI. E-mail matching and a claimed
repository URL grant no access. Obtain the current client version and callback
from its documentation/help. Register that exact callback. Default synthetic
`elm-codex`, `elm-claude` and `elm-cursor` clients have intentionally empty redirect
lists until this has been done. No open redirect or DCR broker is provided.

## 2. Connect the remote MCP

These are configuration starting points checked against current documentation on
2026-09-22, **not executed native-client acceptance**. Verify installed CLI help.

```sh
codex mcp add engineering-learning --url "$ELM_MCP_URL" --oauth-client-id "$ELM_CODEX_CLIENT_ID"
codex mcp login engineering-learning

claude mcp add --transport http --scope user --client-id "$ELM_CLAUDE_CLIENT_ID" engineering-learning "$ELM_MCP_URL"
# In Claude Code: /mcp, select this server, authenticate.
```

For Cursor merge `packages/client-kit/templates/cursor.json` into the appropriate
MCP settings. Replace the `.invalid` URL and public client ID. Select read-only
scopes for users who should not submit. Use the normal client-managed login; never
put bearer tokens in tracked configuration. Templates are not automatically applied.

Sources: https://developers.openai.com/codex/mcp ;
https://code.claude.com/docs/en/mcp ; https://cursor.com/docs/mcp .

## 3. Install behavior rules

Run the dry-run installer, inspect the proposed changes, then use `--apply`.
`AGENTS.md` is canonical; `CLAUDE.md` imports it explicitly with `@AGENTS.md`.
Use Cursor's supported AGENTS.md behavior in the selected Agent mode. Confirm in
the real client that this file actually loads; do not assume inline completion or
cloud sessions have the same context. Do not install another conflicting copy in
Cursor rules. Existing differing managed blocks require an explicit human merge.

Enable participation in the review UI. Manual mode requires confirmation in the
coding client; auto mode allows qualified task-end proposals, not auto-publication.
The server cannot attest to a click inside an IDE. It does enforce active local
participation, API scope and a separate peer-review boundary.

## 4. Required acceptance exercise per exact IDE/CLI/OS

Resolve a synthetic registered project, list the allowed tools, search and read a
published revision. Submit with a UUID key; retry with the same key and payload.
Confirm pending status, no self-publication and no foreign-project disclosure.
Have another user review, then use a different client to read the exact revision.
Revoke access and knowledge; verify subsequent reads fail without leaking content.
Test expired access tokens, re-login/refresh, logout, unavailable server and actual
loading of the instruction file. Record versions and negotiated protocol.

A passing official SDK transport test does not satisfy these native-client gates.
Cloud agents need separate network, authentication, provider and residency approval.
