# Threat model

Protected assets: unpublished and restricted learning content, evidence references,
active revisions, local membership, reviewer identity, audit/receipts and credentials.
Untrusted: every tool argument, project hint, client name, knowledge body and evidence
claim. OIDC claims are trusted only after cryptographic and resource validation.

| Threat | Implemented control | Residual boundary |
|---|---|---|
| Foreign project IDs / enumeration | Fresh object authorization, FORCE RLS, same NOT_AVAILABLE result | Authorized users can copy permitted data |
| Prompt injection / memory poisoning | Fixed tool descriptions, strict data schema, no execution, peer review | A reviewer can be mistaken; IDE behavior is not controlled by the server |
| Agent publishes itself | No publish MCP tool, separate HTTP session/CSRF and DB credentials | Host or reviewer-session compromise remains privileged |
| Rights revoked | Fresh local membership, current pointer/expiry on each read | In-flight and previously delivered content cannot be recalled |
| Cross-user pool contamination | SET LOCAL inside explicit transaction; real-role tests | A compromised MCP process with arbitrary SQL can impersonate transaction context; RLS does not defeat complete service compromise |
| Privileged stored functions | No PUBLIC EXECUTE defaults, narrow grants, startup checks | DB owner/superuser can override safeguards |
| Stale review or parallel writes | Revision/hash/target checks, locks, atomic audit and publication | Unknown network outcomes require the same idempotency key |
| Secret disclosure | Gitleaks, strict size checks, no payload logging, no rejected-content quarantine | Detection is not complete DLP; human minimization/review remains necessary |
| XSS/SSRF/tracking | Escaped SSR, CSP, URL allowlist, no remote pictures/previews or source fetch | Reviewer may manually open an external reference |
| Team scope leak | New sanitized proposal; source+destination peer review; hidden lineage | Sanitization is a human content decision, not mathematically provable |
| Restore resurrects deleted content | Maintenance serving gate + post-backup external retirement manifest | The same stale backup cannot prove its manifest is current |
| Denial of service | Body/depth limits, scanner cap/timeouts, SQL timeouts, quotas | Native scanner startup limits sustained throughput; reverse proxy protection and capacity qualification required |
| Employee surveillance | No individual rankings, no content payload telemetry | Security audit still contains personal identifiers and requires restricted retention |

This service has no general HTTP, shell, SQL, file, source crawling or model tool.
The one subprocess is the fixed maintained scanner adapter. Hashes prove content
identity, not truth or anonymity. Database audit privileges are not protection
against a database administrator. Client ID is not attestation of client binary,
provider choice, device health, residency or a human clicking inside an IDE.
