# Security policy

Do not post credentials, company content, private source, or exploit details that
expose a live deployment in public issues. Use the repository owner's private
contact channel for sensitive reports. This is a reference implementation, not a
certified security boundary or a production service operated by its author.

Public users get no access to a deployed knowledge instance through this source
repository. Review the threat model and deployment gates before using real data.
Keep runtime, review, migration and maintenance credentials separate. Revoke an
exposed token immediately; deleting it from a proposal does not rotate it.

All default fixtures are synthetic. Do not add real company data to tests or CI.
