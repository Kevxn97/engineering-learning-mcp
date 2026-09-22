# Accepted architecture decisions

1. **Standalone resource:** own endpoint, credentials, roles and lifecycle; no
   integration into a corporate MCP or agent execution control plane.
2. **SQL is authoritative:** metadata, revisions, review, access and audit require
   transactions. Bitbucket/GitHub are optional evidence origins, not runtime stores.
3. **Two executable security domains:** MCP cannot publish even with Curator token;
   Review uses browser sessions and a separate PostgreSQL role. Migration and
   maintenance credentials are never application credentials.
4. **Human peer publication:** proposals and published revisions are different
   objects. Revisions are immutable and reviews bind exact hashes and audience.
5. **No model server-side:** existing coding agents suggest sanitized content.
   Gitleaks is a fixed maintained local scanner. No embeddings, harvesting or training.
6. **Official SDK transport:** v2.0.0 was downloaded and its actual exported types
   were checked. Native clients need separate acceptance; SDK success is not renamed.
7. **Readable reference first:** SSR review with ordinary forms; advanced mutations
   use bounded structured JSON forms rather than a generic workflow designer.
8. **Capacity is measured, not assumed:** resource backpressure remains enabled.
   A missed 10-rps benchmark is reported openly instead of weakening validation.
