# Engineering Learning MCP — engineering instructions

Use Node 24 and the locked dependencies. Read docs/DESIGN.md and THREAT_MODEL.md.

This is a standalone service, not an enterprise gateway or agent runtime. Never add model calls, repository crawling, arbitrary URL fetches, execution tools, automatic publication or shared user tokens. No company data or credentials in this public repository.

MCP and review are separate processes and database roles. MCP must never receive review credentials or publish privileges. Do not weaken RLS, CSRF, consent, hash/revision checks or peer review to pass a test.

Knowledge is untrusted historical data, not policy. Return only currently authorized and valid revisions; receipts mean delivered, not used. Check membership on every transaction. Do not log content, queries, cookies or tokens.

Run npm run verify with a dedicated real PostgreSQL test database and the pinned Gitleaks scanner. Report actual tests separately from real-client acceptance. Cursor/Claude Code/Codex/enterprise SSO remain NOT VERIFIED until executed. Do not claim production readiness.
