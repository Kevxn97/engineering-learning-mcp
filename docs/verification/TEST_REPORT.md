# Verification record — reference implementation

Development reference: 2026-09-22, Node 24.20.0, PostgreSQL 18.6, Gitleaks 8.30.1,
Keycloak 26.7.4, official MCP SDK 2.0.0. Synthetic projects and actors only.

Local executed evidence: the final combined `npm run verify` passed **46 tests**,
with **zero skipped tests**, including real PostgreSQL role/domain/transport tests,
maintained Gitleaks scans, withdrawal, feedback, derivation, outage and scoped catalog
checks. Source-boundary, dependency-lock and client-kit checks also passed. This was
executed locally against PostgreSQL 18.6, not an in-memory substitute.

Use the exact CI commit and job outcomes for the additional clean-install, container
and Chromium-browser evidence. Native coding-client acceptance is separate.

The live Keycloak HTTP test completed real code+PKCE, nonce/state, access-token
validation, MCP proposal, cookie rotation, peer review, CSRF/Origin rejection and
bearer rejection at review. It is not a native IDE test. Chromium navigation was
blocked by the local environment's browser policy; that policy was not bypassed.
The separate CI browser job **passed** on the actual reference containers at commit
`330bd3352929949fe7b3ace728d8f4c8506ca171`, run `35791190333`. It completed the
real Keycloak flow and Chromium login, rendered the reviewed proposal at desktop
and mobile sizes, and checked mobile horizontal overflow. Screenshots were visually
inspected. This is not a test of every UI action or any native coding client.

See `CI_REFERENCE_RUN.json` for the exact scope and failed capacity experiment.
Clean install, 46-test correctness, tracked-source scan, dependency audit at the
high-severity threshold, SBOM generation and container build passed in that run.

| Master criterion | Evidence and exact scope |
|---|---|
| A01 | transport.test: missing/malformed/expired/wrong issuer/audience/access-token semantics; signed synthetic fixtures |
| A02 | transport.test scope/type/client checks; integration strict unknown-field checks |
| A03 | integration disabled local account despite previously resolved identity |
| A04 | integration foreign scope, repository hints, direct ID and derived source isolation; not a formal noninterference proof |
| A05 | integration strict context schema and lookup; no auto-registration tool exists |
| A06 | live OIDC review rejects bearer request; MCP role has no review credential |
| A07 | direct SQL under elm_mcp cannot publish/admin/maintain; startup checks narrow function privileges |
| A08 | actual restricted roles; transaction-local identity and pool reuse checks |
| A09 | integration self-review and unauthorized team derivation rejection |
| A10 | integration local disable + old-key retry, per-request membership checks |
| B01 | integration pending proposal invisible to other readers |
| B02 | integration exact hash/revision/audience checks and current publication |
| B03 | integration changed revision/hash rejection |
| B04 | real audit INSERT failure rolls back publication/review |
| B05 | proposal/feedback/review exact retry returns one result |
| B06 | payload mismatch conflicts; keys are actor+operation scoped in SQL |
| B07 | committed-operation retry exercised; deliberate network-drop-after-COMMIT injection remains PARTIAL |
| B08 | independent SQL transactions race, only one publishes; independent OS-process fault test remains PARTIAL |
| B09 | revoked/expired/old-revision reads rejected; active-only RLS/search |
| B10 | team readers cannot see source/provenance; derived security suspension and purge tested |
| C01 | real scanner canaries for bodies/query/feedback/derived bodies; payload-free logging by construction; comprehensive log-channel audit remains PARTIAL |
| C02 | missing scanner/deadline/cap failure is closed; no skipped scanner tests |
| C03 | unknown permissions/schema rejected; no executable knowledge path; actual model prompt-injection efficacy NOT VERIFIED |
| C04 | escaping and active-content rejection; actual browser evidence belongs to CI job |
| C05 | metadata/loopback/credential URLs rejected; source fetching absent |
| C06 | SQL/tsquery parameter binding, controls/nesting/size/schema tests |
| C07 | no server test-verification claim; strict evidence schema and reviewer-checked label |
| C08 | no independent-support counter/model grader; copied evidence is not counted as additional proof; human review quality NOT VERIFIED |
| C09 | real scanner blocks source/derivation secrets before persistence |
| C10 | live OIDC CSRF/Origin/bearer rejection and cookie rotation; foreign object tests |
| D01 | empty successful search versus serving-gate failure tested |
| D02 | DE/EN terms and exact component match in synthetic corpus; semantic relevance beyond fixtures NOT VERIFIED |
| D03 | known mismatch rejected; unknown range explicitly requires check |
| D04 | visible conflicts returned only for jointly readable items |
| D05 | actual structured/text dual size bound; no truncation of body conditions |
| D06 | database quota, scanner cap/deadline, retry tests; 10-rps capacity target OPEN |
| D07 | representation and revision hashes checked against delivery receipt |
| D08 | logical old-row snapshot + external purge manifest replay; physical backup/restore is OPEN |
| D09 | shared-start guards, restricted role and privilege checks; real shared deployment OPEN |
| D10 | dry-run, preservation, backup, repeated install and symlink rejection tests; MCP config deliberately untouched |
| E01 | Claude Code actual native session: NOT VERIFIED |
| E02 | Codex actual native session: NOT VERIFIED |
| E03 | Cursor actual native session: NOT VERIFIED |
| E04 | Real multi-native-client round trip: NOT VERIFIED; SDK + real IdP + HTTP review is narrower |
| E05 | Native client-C negative path: NOT VERIFIED; server scope test exists |
| E06 | All three native clients after revoke: NOT VERIFIED; server revoke test exists |
| E07 | Actual native instruction loading: NOT VERIFIED |
| E08 | Native refresh/callback/rights behavior: NOT VERIFIED; reference PKCE and local rights are exercised |
| E09 | Native outage UI behavior: NOT VERIFIED; server returns bounded explicit errors |
| E10 | Native/SDK/cloud evidence deliberately separated; no fabricated native results |

## Capacity

See LOCAL_CAPACITY_EXPERIMENT.json for a **failed** 10-rps profile, with its error
count and scope. Gitleaks's cold process startup was significant. RLS search sets
were optimized without bypassing grants. The lower local profile in
LOCAL_LIGHT_LOAD.json completed 20/20 requests at 1 rps (p95 488 ms). The CI 10-rps
profile still failed: 89/200 succeeded and 111 were rate-limited. Neither profile
includes actual HTTP/OAuth/IDE overhead. Resource saturation is reported as
RATE_LIMITED, not successful empty results. CI reports the capacity experiment
separately with an artifact; correctness green does not close this gate.

## Failures found and fixed during construction

- UUID idempotency metadata caused Gitleaks's generic credential rule to fire;
  only the strict UUID metadata field is normalized, never free text.
- Keycloak reference access tokens lacked sub: fixed explicit Subject mapper,
  retaining required subject validation.
- Per-schema default-privilege revocation left maintenance functions PUBLIC:
  explicit global revocation plus existing-function grants and startup tests.
- Excessive nested row authorizers hurt 10k-row search: membership-set init plans
  now retain forced RLS while removing repeated per-row membership queries.
- Forced test database deletion terminated idle pg connections: orderly pool close,
  completion and non-forced synthetic database deletion.

This record is not a penetration test, legal/privacy review or production approval.
