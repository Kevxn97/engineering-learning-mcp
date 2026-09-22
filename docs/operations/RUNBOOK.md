# Operations and rollout runbook

## Shared deployment prerequisites

Deploy MCP and Review separately with their own DB credentials. Inject no review
secret into MCP. Use a private network and approved reverse proxy terminating HTTPS,
exact canonical URLs, explicit Host/Origin allowlists, request/connection abuse
limits, encrypted storage/backups and a reviewed identity provider. Do not trust
arbitrary forwarded headers; the current app does not enable blanket proxy trust.
Run containers non-root, no extra capabilities, read-only filesystem, no host
workspace mounts and no corporate gateway tokens. Outbound network should be
limited to the issuer/JWKS and the database. No arbitrary evidence fetch is needed.

The `.env.example` shared attestations default false. They express operator review,
not automatic proof of TLS or encryption. Migration requires an administrator who
can create the dedicated roles/schema. Default seed and local-init refuse nonlocal
or non-synthetic database names. Establish the real organization and first admin
through a separately reviewed migration/bootstrap transaction, not a public signup.

Health endpoint `/healthz` checks database reachability, not full business-readiness.
An external readiness exercise must verify the serving gate, OAuth, scanner and a
synthetic authorized read. Never put private content in health/metrics output.
Application logging intentionally excludes request/response payloads and credentials.
Gather process health, DB latency, error rates and review backlog through approved
infrastructure; no employee productivity dashboard is included.

## Backups and restore

Use the operator's normal encrypted `pg_dump`/snapshot process with explicit
retention. Protect review session data; do not expose backup contents as CI artifacts.
Before creating a restore target, keep routing/firewall access disabled. After
restoring, block serving **before making it reachable**:

```sh
# Environment: restricted ELM_MAINTENANCE_DATABASE_URL and ELM_ORGANIZATION_ID.
node dist/scripts/maintenance.js block
node dist/scripts/maintenance.js apply /approved-external-store/current-retirements.json
# Verify organization, freshness, content purge, current ACLs and session invalidation.
node dist/scripts/maintenance.js enable --external-manifest-reconciled
```

`apply` validates the manifest schema/checksum and leaves the database blocked.
The final flag is explicit operator attestation, not proof of freshness. Do not
restore an old `serving=true` snapshot into a live route. Invalidate old browser
sessions using an approved administrator operation before re-enabling traffic.
Rotate credentials where incident response requires it.

The automated test is a **logical pre-deletion row snapshot + external-manifest
replay**, not a full storage-volume or disaster-recovery rehearsal. Run an actual
backup/restore in the target environment before shared acceptance.

## Retirement and purge

Curators suspend/revoke/archive through the review UI. Security-related source
withdrawal suspends linked derivatives. New reads reject retired/expired revisions.
For deletion, persist a protected external intent before deleting database content:

```sh
node dist/scripts/maintenance.js purge /approved-external-store/new-intent.json LEARNING_UUID
# This leaves serving blocked; reconcile the manifest before an intentional re-enable.
```

The file must be new (`wx`) and is written 0600. Do not keep its only copy inside
the same database backup. Purge removes tracked derivatives, proposals/revisions,
feedback and receipts; unlinked manual copies or content already sent to providers
are outside this database's control. Minimal retirement IDs and audit may remain
under separately approved retention. IDs and hashes are not anonymous.

```sh
node dist/scripts/maintenance.js export /approved-external-store/retirements.json
ELM_PROPOSAL_RETENTION_DAYS=30 ELM_RECEIPT_RETENTION_DAYS=90 ELM_AUDIT_RETENTION_DAYS=180 \
  node dist/scripts/maintenance.js retain
```

These are sample periods, not a legal policy. Schedule via existing operations after
approval; the service does not silently install a cron job. Learning expiry is
query-enforced, independent of the retention job.

## Incident response

Block the affected principal locally and revoke relevant access at the IdP. Suspend
or revoke the learning; choose security-related withdrawal for dependent review.
Rotate leaked credentials; deletion alone is insufficient. Preserve approved minimal
audit, record the external retirement manifest, investigate actual delivered revisions,
and review client/provider retention. Do not claim a server revoke erased IDE chats.

## Releases and rollback

Review the lockfile, image digests, migrations, threat model and test artifacts.
Use `npm ci --ignore-scripts`; never run runtime services as schema owner. All SQL
migrations are checksum-checked and forward-only. Do not silently edit applied
migrations. Application rollback requires a schema-compatible version, otherwise an
approved blocked restore plus current external retirement manifest. Re-run native
client checks after meaningful protocol/auth changes.
