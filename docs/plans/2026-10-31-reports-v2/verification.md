# Reports V2 — Package B preparation verification

November 7, 2026 Pacific. Scope: technical source inspection, read-only production catalog/preimage checks and local documentation verification. No production writes, impersonation, workflow dispatch or independent human sign-off in this preparation.

## Fresh production preflight

| Check | Observed result |
|---|---|
| History | 364 rows; latest 20261105120017; all eight Package A rows recorded |
| Basis | contract 3.0.0; corrections/sale_call_links/appointment_evidence not_installed |
| V3 readers | Nine callable by authenticated |
| performance_sale_monthly function definition MD5 | 51e06b46a13c3a8eec4d672bec158376 — expected |
| performance_sale_monthly body MD5 | deb0d3330a432cd4324ea422856d67a0 — expected |
| performance_monthly body MD5 | 7e7063317a34f37d90faf14914b98827 — expected |
| report_v3_sale_premium definition MD5 | 37800ccc8ada2fae26b86dd5a610eb09 — expected |
| report_v3_basis_flags definition MD5 | e446177c344762bec8caf7d5e9321d9b — expected |
| Package B objects | Ledger, two RPCs, effective/original readers and book parser absent |
| Advisors | Security 276; performance 463; health 0 |

Only aggregate/catalog output was retrieved. Live campaign_actor definition confirms auth.uid is required, JWT organization must equal the database profile organization, profile must be Active, and role/is_super come from the database. No user_metadata authorization or caller-selected organization was introduced.

## Frozen SQL security and write review

Reviewed ...20 correction ledger/writer/history reader, ...21 basis replacement/grants, ...22 report enable, and ...20 rollback. Source bodies stay frozen.

| Area | Observed implementation and release implication |
|---|---|
| Tenant authorization | Writer resolves campaign_actor, requires Admin/Super Admin/is_super, selects sale and client in actor home organization; no organization input. Existing actor helper independently checked live. |
| Ledger isolation | Private schema, organization_id required, RLS enabled; no policies or client table grants. PUBLIC/anon/authenticated/service_role table privileges revoked. SECURITY DEFINER RPCs deliberately mediate access; RLS alone is not their authorization boundary. |
| Audit | Append-only revision chain, unique org/request and org/win/revision, predecessor and sale identity checks; UPDATE/DELETE/TRUNCATE refused by three triggers. No FK to wins so a ticketed reversal retains inert audit rows. |
| RPC exposure | ...20 creates both RPCs sealed; ...21 grants authenticated only and checks effective ACLs. Service role, anon and PUBLIC remain denied. Writer access becomes active before frontend release, so later ...21 approval must expressly include it. |
| History scope | Admin home org, original seller, or Team Leader ancestor of seller. Book values/request IDs/can_correct reserved for Admin. Correction notes/history are intentionally visible to the authorized seller/team reader. |
| Concurrency and idempotency | Organization-scoped request and policy transaction advisory locks; client FOR UPDATE; expected revision/effective amount/raw book value; same actor + identical payload returns prior result; conflicting replay gives PT409. |
| Book writes | keep_current leaves book untouched. match_sale requires a present matching policy and non-diverged book. Primary known-zero write refused; additional numeric zero permitted. Update targets the already locked home-org client. |
| Immutable sale/commissions | No writes to wins or saved commission tables; optional book update and ledger insert share one transaction. Corrected value credits original seller/Sold Date through shared calculation. |
| Input constraints | Required IDs/revision/reason/note/book mode; bounded two-decimal amount or unknown; same-value allowed only to freeze legacy fallback. Server errors distinguish denied, invalid, missing and stale/conflict. |
| Release value identity | ...20 and ...21 collect preimages and compare every sale's values before commit; attributes preserved. Empty ledger means no intentional AP change at installation. |
| Rollback | Always seals application RPCs; restores old functions only with empty ledger and exact compatible postimages. Never drops ledger/guards. If corrections exist, readers retain corrected values. A re-forward is a new reviewed migration. |

No new blocking defect was identified in this bounded source/preimage review. This is not fresh production authenticated-write testing or a claim that all repository security findings are resolved. The frozen native evidence below supplies the synthetic write/concurrency tests; production mutations remain gated.

## Conflicting work and evidence provenance

Current main is 15d967320af7a0bd9774e09bc57e0dd31f97900c. PR #486 is open at 2de28c320547983f68bed5f77d8ec9684ea3643d. Its 23-file diff does not replace or pin performance_sale_monthly; the older direct-function-overlap statement is superseded. It modifies commission validation/grid helpers and has its own historical premium derivation. Keep its backfill and exact financial approvals separate; do not redefine commission basis through this release. PR #514 at 3c54f4d13de7b6901db33c111d94fb70d4f42f6a overlaps shared docs only and was not incorporated.

Prior assembled native verification is retained, not rerun or relabelled as new: PostgreSQL 17.6 + TLS + CLI 2.121.0, release harness 17/17, non-performance security/contract/seal/index suites, premium correction concurrency in both orders, appointment-link race. Source: evidence/release-readiness-2026-11-06.md. Log hashes: release-rehearsal.log 3955075c9f0097beae3e861a014bb951af29cb60c09596ada32961c2edd39294; v3-suites.log c5c560008e702b6622aa2c250b4fc013d0767b53023714ba64fe67c3f4cb122d. Package A production verification and its conditional-scope limitation are recorded in production-release.md.

## Local verification

Passed: root `npx tsc --noEmit` (exit 0); `git diff --check`; exact eight-path allowlist; all 34 pinned SQL byte lengths/SHA-256 hashes and all 36 release files compared byte-for-byte with frozen candidate. The only command warning was npm's existing http-proxy environment-config deprecation; no TypeScript diagnostic. No new runtime tests are necessary for documentation-only changes; prior native/runtime evidence retains its stated limits. Hosted checks are not claimed before publication.

Existing advisors are tracked separately. Relevant remediation references: [authenticated SECURITY DEFINER exposure](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [public RLS disabled](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public). No unrelated hardening is authorized here.

Current GitHub push/pull_request workflow path filters have no match for these eight documentation files. This does not guarantee that Vercel or Supabase integrations will skip their own checks. Publication must observe their results without altering settings.
