# Authentication contracts and limits

MCP validates RS256 JWT access tokens using `jose` and the configured issuer's JWKS.
No token-derived JWKS URL or token passthrough. Required: exact issuer/audience,
sub, iat, exp, allowed native client ID, maximum one-hour lifetime and explicit
knowledge scopes. ID tokens are rejected using access-token type semantics as well
as audience/scope/client checks. Locally the Keycloak audience and **Subject mapper**
are explicit; a successful ID-token flow alone is insufficient to test MCP tokens.
The server offers protected-resource metadata and `WWW-Authenticate` challenges.
The supplied Keycloak reference uses pre-registered PKCE clients, not anonymous DCR.

A custom IdP must satisfy this claim contract or receive a separately reviewed
adapter. Current implementation accepts RS256 only; unsupported issuer algorithms
are an explicit integration gate, never accepted opportunistically.

Review uses a different confidential OIDC client with code+PKCE, nonce/state and
one-shot login state, then rotates to an opaque server-side session. Shared cookies
are `__Host-elm_session`, Secure, HttpOnly, SameSite=Lax; local HTTP uses a different
cookie name. The review service rejects **every Authorization header**, even if it
belongs to a Curator. POSTs require exact approved Origin and a session CSRF token.

The MCP process never receives the review client secret or review DB URL. Both
services reread local active membership on each transaction. JWT validation does
not instantly detect a new IdP-only disable: local principal disable is immediate
for subsequent requests; otherwise detection is bounded by token expiration.
Browser session lifetime is eight hours; local account disable still wins. IdP
backchannel logout and opaque-token introspection are not implemented.

Authorization is transaction/statement bounded: a change committed before a fresh
request is checked. In-flight responses cannot be retroactively withdrawn. Received
knowledge already in an IDE/provider context cannot be recalled by the MCP.
