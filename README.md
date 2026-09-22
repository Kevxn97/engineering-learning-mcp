# Engineering Learning MCP

A standalone, peer-reviewed knowledge service for coding teams using **Claude Code,
Codex and Cursor**. Developers keep their tools; observations become small proposals,
a colleague reviews them, and only the published current revision becomes searchable.

**Status: functional reference implementation; shared/production rollout is gated.**
No model calls, session recorder, corporate MCP dependency, repository crawler or
automatic publication. Included users, projects and examples are synthetic.

## Architecture

```text
Claude Code / Codex / Cursor ── OAuth + MCP ── MCP service :4100
                                                   │ restricted elm_mcp role
                                                   ▼
                                              PostgreSQL 18
                                                   ▲
Browser ── OIDC / session cookie / CSRF ── Review UI :4101
                                              separate elm_review role
```

Five tools: `knowledge_context`, `knowledge_search`, `knowledge_get`,
`knowledge_propose`, `knowledge_feedback`. **No publish tool.** The MCP process does
not receive the review database credential or OIDC client secret. Both processes
check fresh membership; PostgreSQL enforces row security and separate grants.

## Start the local reference

Requires **Node 24**, npm, Docker Engine and Docker Compose v2. A browser is needed
for human review. On Linux and macOS, from this repository:

```sh
npm ci --ignore-scripts
npm run local:configure
docker compose --env-file .local/compose.env -f compose.local.yml up -d --build
```

Open `http://localhost:4101`. Synthetic user names and randomly generated local
passwords are in **`.local/config.json`**. Alice contributes to Synthetic Alpha;
Bob and Dana can peer-review it; Charlie has a different project and a shared team;
Mallory has no project; Admin manages the registry but has no content access.
Passwords and database URLs are never committed. Keycloak is at
`http://localhost:8180`, MCP at `http://localhost:4100/mcp`.

All host ports in the local Compose file bind **127.0.0.1**. Keycloak `start-dev`,
HTTP, local database initialization and synthetic memberships are local-only.
Never expose this reference stack directly to colleagues or the internet.

```sh
# Stop; retain local volumes.
docker compose --env-file .local/compose.env -f compose.local.yml down
# Destructive local reset, only when intentionally discarding all synthetic data:
# docker compose --env-file .local/compose.env -f compose.local.yml down -v
```

The realm is imported only on its first start. Editing the realm JSON does not
silently mutate an existing realm. Restart after changing source via `up -d --build`.

## Connect your coding tool

See **[Client onboarding](docs/CLIENTS.md)**. Config fragments are in
`packages/client-kit/templates`; shared rules and task-end extraction instructions
live beside them. Preserve existing servers and project instructions.

```sh
# Preview only: no writes by default.
node scripts/client-kit.mjs --project /absolute/path/to/your/project
# Apply managed AGENTS.md rules + explicit CLAUDE.md import, with backups.
node scripts/client-kit.mjs --project /absolute/path/to/your/project --apply
```

The installer intentionally **does not rewrite MCP JSON/TOML configurations**.
Native client OAuth callback registrations start empty: register the actual,
documented callback for your exact client, not a wildcard. Templates are not
proof that a real IDE has connected. Native IDE acceptance remains **NOT VERIFIED**.

## What works

- Current project/team-scoped search and exact-revision reads, including conditions,
  evidence quality, expiry and hashed delivery receipts.
- Strict proposals, participation consent, UUID idempotency keys, duplicate checks,
  review requests, rejection, revision, author withdrawal and peer publication.
- Sanitized team derivations, restricted provenance, conflicts, feedback,
  suspension/revocation and dependent knowledge suspension.
- Real JWT validation and a separate code+PKCE OIDC browser-session flow, no fake login.
- Registry and membership administration, maintained Gitleaks secret detection,
  forced RLS, transaction-local identity, audit rollback and bounded resource use.
- Local containers, lifecycle/retention utilities, external retirement-manifest
  handling, tests, GitHub CI and client instruction installation.

## Verify locally

Tests use a dedicated local PostgreSQL administrator to create and drop databases
named `elm_test_<random>`. They **refuse missing or nonlocal test configuration**.
They never silently substitute an in-memory database or mock secret scanner.

```sh
scripts/install-gitleaks.sh .local/bin
export ELM_GITLEAKS_BIN="$PWD/.local/bin/gitleaks"
# Supply credentials for your LOCAL synthetic PostgreSQL instance; do not use production.
export ELM_TEST_ADMIN_URL='postgresql://postgres:LOCAL_PASSWORD@127.0.0.1:5432/postgres'
npm run verify
npm audit --audit-level=high
npm run sbom > sbom.cdx.json
# With the reference stack running:
npm run build
npm run test:e2e
# Additionally require a real browser in a permitted environment:
npx --no-install playwright install chromium
ELM_BROWSER_E2E=true npm run test:e2e
```

`npm run verify` checks TypeScript, real SQL/domain/transport/security tests, source
boundaries, the dependency lock and client-kit behavior. `test:e2e` signs in against
the real local Keycloak; without `ELM_BROWSER_E2E=true` it drives HTTP login forms,
**not a browser or an IDE**. CI has a separate real Chromium job.

`npm run loadtest` runs a 10,000-record, ten-user synthetic service/DB/scanner capacity
experiment, not a provider/IDE performance claim. It records errors and latency.
The first restricted-sandbox 10 requests/second profile **did not meet its target**;
Gitleaks process startup and explicit concurrency backpressure were limiting.
Correctness tests and capacity qualification are deliberately separate. The CI
capacity step reports a warning/artifact on a missed target rather than hiding it.

## Shared deployment is a separate acceptance decision

Use [OPEN_GATES](docs/verification/OPEN_GATES.md), [security model](THREAT_MODEL.md),
[operations](docs/operations/RUNBOOK.md), [authentication](docs/AUTH.md) and
[verification report](docs/verification/TEST_REPORT.md). Do not label this release
production-ready or claim Claude Code/Codex/Cursor were tested when only the SDK was.

Bitbucket or GitHub can provide evidence references; neither host is a runtime
dependency. The service does **not** synchronize SCM permissions or attest to test
results. Internal storage does not guarantee internal-only model processing.
