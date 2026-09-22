# Architecture

## Boundaries

One TypeScript repository, two process entry points, one authoritative PostgreSQL
database. `apps/mcp` authenticates protocol requests and exposes five fixed tools.
`apps/review` handles human OIDC sessions and review/administration. Shared domain
code knows neither corporate gateways nor model providers. `elm_mcp` cannot write
publications, reviews, memberships, lineage or sessions; `elm_review` has narrowly
defined review privileges. Only `elm_maintenance` can call retirement/retention gates.
An owner role owns schema objects but is never used by a runtime process.

A migration caught and fixes a subtle PostgreSQL distinction: a schema-scoped
REVOKE cannot remove the global default PUBLIC EXECUTE privilege on functions.
Migration 004 removes existing public grants and changes future global defaults.
Runtime startup and direct-SQL tests check this boundary.

All protected tables use FORCE ROW LEVEL SECURITY. A transaction sets principal
and organization with parameterized `set_config(...,true)`, checks active account
and the serving gate, obtains a bounded concurrency slot, and commits the entire
operation. Pool reuse cannot retain identity. Search policies resolve membership
sets once per SQL statement to avoid per-result nested authorizer lookups; this is
not a cross-request membership cache.

## Knowledge lifecycle

Proposals have immutable revisions and pending/changes-requested/accepted/rejected/
withdrawn states. Expired proposals cannot publish. Review binds the displayed hash,
revision, target audience and expected learning revision; peer approval requires a
different active authorized person. Publication, current pointer and audit commit
atomically. UUID idempotency is principal+operation scoped and payload hashed.

A project-to-team sharing action creates a new sanitized proposal. Review requires
both source and destination authority; provenance stays in a restricted table.
Team readers see only sanitized content/evidence. Security withdrawal of a source
suspends descendants. Purge recursively removes recorded derived content, related
proposals/revisions/feedback and delivery copies. It cannot discover unlinked human
or external copies of a sentence.

Only active, unexpired current revisions are served. Search previews retain
applicability, never truncated instructions. `get` returns the bounded complete
body. SQL uses a `simple` full-text vector plus exact component matching; candidates
are bounded at 100, returned results at 10. Unknown semantic versions require a
check; explicit mismatches are excluded. No claim of perfect semantic recall.
Published conflicts must be declared by curators; no automatic truth synthesis.

Receipts store the hash of the exact domain representation, revision, recipient,
time and policy, not query text or a redundant body. Receipt and audit failures
prevent content delivery. “Provided” does not mean “used” or “correct”.

## Input and runtime budgets

Strict unknown-field rejection; JSON depth 12; max body 12 KiB, query 1 KiB, request
64 KiB, complete dual MCP output 32 KiB. No truncation of safety conditions.
Gitleaks 8.30.1 runs as a fixed local subprocess without shell or client-controlled
paths. Output is discarded and bounded; timeout 2.5 s, max four concurrent scans,
GOMAXPROCS=1. Only schema-validated UUID idempotency metadata is substituted before
scanning to avoid a proven generic-API-key false positive. All free text is scanned.

DB admission: five concurrent transactions per principal; pool 10/process;
3 s SQL, 1.5 s lock, 2.5 s connection and 4 s driver query deadlines. Default quotas:
120 reads/minute, 20 proposals/day and 60 feedback/minute, using database counters.
MCP ingress is bounded at 50 in-flight calls. Production proxy-level abuse controls
remain a deployment requirement. Resource saturation returns a real error, not an
empty successful search. Fixed pilot limits currently live in code, not an admin UI.

## Versioned choices

Node 24.20.0, TypeScript 7.0.2, official MCP SDK 2.0.0, PostgreSQL 18.6 and Keycloak
26.7.4 were resolved and exercised in the development reference. Patch dependencies
and image digests are pinned. SDK transport compatibility, not a handwritten JSON-RPC
implementation, handles protocol negotiation including a tested legacy handshake.
TypeScript 7's pinned AST API is used by the development boundary checker; runtime
code does not depend on it.
