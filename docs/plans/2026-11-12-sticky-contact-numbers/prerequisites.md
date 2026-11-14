# Prerequisite checkpoint — November 13, 2026 Pacific

Base `2129fa8b195cee77ad75f614abe655facfad2725`. Claude's reported `d070707` was not found in the accessible checkouts or remote sticky branches. This is a reconstruction, not recovery of that commit.

Nine attachment hashes verified. Two missing applied migrations restored byte-for-byte against SELECT-only history exports; identities and hashes are in prerequisite-manifest.json. No applied source was edited or executed against production.

Six independent complete Edge snapshots were captured, 75 returned files. Eight file differences from main: old dispatch/wire dependencies in workflow-executor and sms-consent-worker, old wire in twilio-sms-webhook, and three ClearPath files implementing already-live detailed alerts. Preserve the main manual dispatch safeguards and signature compatibility; test older packages explicitly. ClearPath remains unchanged and undeployed. No merge/cherry-pick of #429 or #444.

Native PostgreSQL 17.6 isolated replay completed. All 85 captured telephony function definitions/owners/security/search-path/ACLs and all 45 captured table definitions/columns/constraints/indexes/triggers/RLS/policies/ACLs match the live catalog exactly. The captures include dial evidence, duration, admissions, SMS ledger, policy, numbers, campaigns and contact authorization. No dial-evidence or application authorization objects were stubbed.

Platform-only harness: synthetic auth/storage; no Vault secrets; HTTP throws; no cron worker or pg_net; cron metadata is inert. Excluded production data repair/activation operations. Replayed exact documented Reports disable operations between packages. Three additional already-applied Reports/Fidelity/carrier statements were captured and applied only to the disposable baseline; repository historical sources were not broadened. `RESET ALL` between migrations and UTF8 database creation are required. Full command/query/results are retained in the recovery evidence.

Exact-base regression: root tsc exit 0; Vite build exit 0; app tsc exit 2; eslint exit 1; full Vitest exit 1 (7,164 passed, 3 failed, 8 pending of 7,175 test cases; some suites could not load without a Supabase URL). Retain exact logs and rerun baseline/candidate under the same isolated environment before final conclusions. Do not label the global suite clean.

Both Vercel agentflow and agentflow-life-insure target this repository. Environment metadata requests returned 403 and no authenticated CLI was available. Preview database isolation is not established. This is a publication/release gate, not a blocker to isolated implementation. Open conflicting work is captured; no remote changes were made.

Changes: exact historical source restorations and plans. Decisions: verified local baseline is the feature base. Migrations/deployments: local historical replay only, no production mutations. Verification: zero relevant catalog differences; package/artifact hashes recorded. Blockers: publication remains held. Next: persistent endpoint foundation and scoped role tests, then SMS/voice/UI/reconciliation.
