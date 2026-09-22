# Implementation plan — 2026-09-22

Build a standalone service in this repository only. No existing enterprise gateways, no model API, no production deployment.

1. Verify SDK 2.0.0, Node 24, PostgreSQL 18, OAuth/OIDC and scanner contracts. Pin dependencies; maintain evidence.
2. Build PostgreSQL migrations with separate owner/MCP/review/maintenance roles, request-local identity, RLS, immutable revisions, atomic review and idempotency.
3. Implement strict schemas, Gitleaks stdin admission, five MCP tools, membership-aware retrieval, delivery receipts and failure handling.
4. Build separate OIDC browser review application: participation, proposals, revision-bound peer review, updates, feedback, team derivation, registry.
5. Provide native-client configuration/rules without overwriting project settings. No untested client compatibility claims.
6. Run unit, real-PostgreSQL/security, SDK HTTP and local Keycloak/browser tests. Add retention/restore procedures and explicit unresolved enterprise gates.

Local sandbox initially has no external DNS or package registry access. Public build dependencies are resolved in a read-only GitHub Actions job and brought back as artifacts for local execution. This is not a production deployment.
