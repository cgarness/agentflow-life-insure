# Reports V2 security evidence — owner waiver recorded

## Current owner decision — November 6, 2026 Pacific

Chris explicitly said “Waive it” after the independent-review requirement and residual access-control risk were explained. The independent reviewer requirement is **WAIVED BY OWNER**, not passed. No independent reviewer was appointed, no independent review occurred, and no signature or automated substitute is claimed. The recorded decision is also in [PR #517](https://github.com/cgarness/agentflow-life-insure/pull/517). It supersedes the independent-sign-off gate in the historical packet below and its references, for this release only.

Organization isolation, permissions, S1–S15/S14a/S14b verification, E1–E6 limits and separately authorized production-user read-back remain required. The waiver does not authorize a migration, category/policy correction, merge, deployment or release-stage dispatch. The frozen SQL, runner and workflow remain byte-identical to `38bd32dbddc21ec6c3d4adbcc8489f06cb64bb7c`.

Chris separately authorized `America/Los_Angeles` for the three listed organizations; saved values and `private.report_agency_time_zone` were verified again. The current unchanged preflight passes all 27 function preimages and the report permission matrix; it reports four active-user organizations and **zero** invalid reporting zones. Production remains at 356 migrations, head `20261105051037`, with no Reports v3 migration. Later-package preimages match and the category baseline remains 36 locked defaults / zero custom rows.

Security advisors were retrieved again: 267 findings across the same seven categories/counts as the recorded baseline below. Existing findings remain separate work, including [the two RLS-disabled tables](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public). No unrelated hardening was performed. This is supporting verification, not a security certification. See the current readiness record for native rehearsal evidence and its limits.

## Historical independent-review packet (unsigned)

**NOT SIGNED OFF.** Prepared 2026-11-06 00:32 UTC. Candidate `38bd32dbddc21ec6c3d4adbcc8489f06cb64bb7c`. Reviewer: **not appointed**. No production-user impersonation/read-back was executed.

Inspect the exact SQL under frozen-source/ and the immutable links/hashes in Frozen_release_manifest.md. Automated tests are supporting evidence, never a substitute for independent review.

## Read-only findings

Production project jncvvsvckxhqgqvkppmj has 356 migrations, head 20261105051037; no V3 installed. The frozen preflight passed its 15 v2/12 closure fingerprints, postgres ownership, security mode/volatility/search-path, current report ACLs and absent-v3 checks.

Current preimages: performance_sale_monthly `deb0d3330a432cd4324ea422856d67a0`; performance_monthly `7e7063317a34f37d90faf14914b98827`; policy-record companion `d39e03a7dd2cf122a68dc0fefcbfb44a`; conversion companion `4d6803ff7d94b7735e3f1b3baf18456c`.

The nine v3 public readers are postgres-owned, SECURITY DEFINER, STABLE PL/pgSQL with `search_path=pg_catalog, pg_temp`. They resolve organization, role, permissions, hierarchy and permitted agent filters server-side. Callers cannot supply organization, time zone or as-of. Definer access bypasses ordinary RLS, so review every org predicate/join; RLS enabled alone is insufficient.

Creation files revoke default client access. The existing public function defaults grant client roles, making those explicit revokes and enable-time checks essential. New private ledger/evidence tables enable RLS and deny client table grants. Review writer authorization separately.

## Permission matrix requiring sign-off

| Surface | anon/PUBLIC | authenticated | service_role |
|---|---|---|---|
| Created v3 readers before enable | Denied | Denied | Denied |
| Enabled six v2 + nine v3 readers | Denied | Execute, then actor authorization/scope | Execute, then actor requirements |
| Private report helpers / legacy rpc_report_* | Denied | Denied | Denied |
| Private schema USAGE | Denied for anon | Denied | Review infrastructure privileges separately |
| Enabled listed class-W application RPCs | Denied | Execute; RPC-specific auth | No direct EXECUTE grant |
| New private evidence/correction tables | No client access | No client access | No direct grant from package |

Agent defaults to personal and cannot widen to team/agency. Team Leader defaults to team and cannot widen to agency. Admin defaults to its home organization. An agent filter narrows only. Review Super Admin handling without assuming cross-org permission.

## Test-to-source trace

| Requirement | Exact frozen evidence |
|---|---|
| S1–S5: seals, role inheritance, owner, definer/search path, accepted arguments | [supabase/tests/reports_v3_security.sql](https://github.com/cgarness/agentflow-life-insure/blob/38bd32dbddc21ec6c3d4adbcc8489f06cb64bb7c/supabase/tests/reports_v3_security.sql) |
| S6–S8: scope hierarchy, invalid filter/date, authorization before timezone error | Same security suite and existing report_access_v2 dependency |
| S9: cross-org mutations, including malformed references | Same security suite |
| S10–S13: helper ACLs, markers, identifiers/phones/timestamps, scoped agent rows | Same suite and reports_v3_controls.sql |
| S14a unrelated identities; S14b linked-history effects | Security suite plus reports_v3_sale_facts.sql, reports_v3_journey.sql and reports_v3_calls_identity.sql |
| S15 enabled/disabled/recovery states | reports_v3_controls.sql, scripts/reports_v3_fixture.py and scripts/tests/reports_release_test.py |
| Writer auth, org predicates and evidence RLS | Migrations ...20, ...30, ...31, ...40, ...41, ...42 and paired tests |
| Production-user read-back | [supabase/ops/reports_v3_readback.sql](https://github.com/cgarness/agentflow-life-insure/blob/38bd32dbddc21ec6c3d4adbcc8489f06cb64bb7c/supabase/ops/reports_v3_readback.sql) |

[CI run 42079824927](https://github.com/cgarness/agentflow-life-insure/actions/runs/42079824927) succeeded at the exact candidate; the release-rehearsal log independently confirms 17/17. The independent reviewer must trace E1–E6 in both directions and identify missing proofs. Comments still saying “proposed/pending” reflect earlier documentation, not security approval. Do not change pinned code merely to update comments.

## Privacy and filter inference

Option A, ★4 and E1–E6 are conditionally approved; exact staged wording is in focused implementation_plan.md §6.2 and AGENT_RULES_approved_staged.md in the attached packet. Linked out-of-scope history may affect earlier-contact/buyer membership, attempt counts to first contact, 30-day purchases, current state, unresolved same-number history, and current lead assignment. Differencing filters can isolate a person's aggregate effect. No stronger anonymity guarantee is claimed.

Unrelated identities/cross-org activity must not change scoped payloads. No customer names/IDs/phones or out-of-scope agent metadata may escape. Recorded-number evidence may exclude assessability; it must never create identity linkage or sale attribution. Missing history is not zero or complete-history proof.

## Production-user read-back — NOT AUTHORIZED

The pinned script selects eligible real actors in the busiest qualifying organization, sets transaction-local JWT claims and `SET LOCAL ROLE authenticated`, exercises nine readers at agency/team/personal/filtered scopes, and rolls back. Only pass/fail leaves the transaction. Team coverage can be skipped with notice if no eligible Team Leader/downline exists; record the gap.

It uses a 60-second per-scope statement limit and asserts each last-30-day reader takes at most 4 seconds. These controls are distinct from the unchanged 8-second production timeout and accepted 366-day query exception.

Before execution, the independent reviewer must review the exact procedure and automatic actor selection; Chris must separately authorize it. Recheck actor/timezone eligibility and disclose skipped roles. Any procedure change alters pinned bytes and requires new evidence. Never substitute guessed JWTs, browser impersonation or real-user writes.

## Existing advisors / operational prerequisites

| Existing finding | Count | Severity |
|---|---:|---|
| RLS enabled without policy | 45 | INFO |
| Mutable function search_path | 21 | WARN |
| RLS disabled in public | 2 | ERROR |
| Extension in public | 3 | WARN |
| anon executable SECURITY DEFINER | 52 | WARN |
| authenticated executable SECURITY DEFINER | 143 | WARN |
| Leaked-password protection | 1 | WARN |

267 findings. Pre-existing RLS-disabled tables are public.app_config and public.webhook_debug_log. Review intersection with report trust boundaries and post-release deltas; do not casually change those policies in this release.

Four organizations have active users; three lack a valid reporting time zone. Fail-closed readers prevent an all-users acceptance claim until correct settings are approved or a narrower intended rollout is explicitly defined. No timezone was guessed or changed.

The dashboard showed a high-CPU warning during inspection. Recheck health before the release window; a single banner is not a sustained-performance diagnosis or permission to restart optimization.

## Required sign-off record

- Reviewer full name, role and independence:
- Exact candidate and manifest hashes reviewed:
- S1–S15, S14a/S14b evidence and missing proofs:
- Organization/permission matrix determination:
- E1–E6/filter-inference decision:
- Read-back procedure determination (not execution authorization):
- Findings/remediation or explicit none:
- Signed decision and UTC timestamp:
- Durable review URL or attached signed evidence:

Until actual sign-off is recorded, Package A remains blocked.

## Preparation update — November 6, 2026 UTC

The independent reviewer is still not appointed. No signature or independent security acceptance is inferred from the preparation or automated checks. The review branch carries 34 pinned SQL files plus the unchanged runner/workflow; every byte matches candidate 38bd32dbddc21ec6c3d4adbcc8489f06cb64bb7c. Package A clauses alone are staged in root AGENT_RULES; later-package clauses are retained in the focused plan. The Package B FullScreenContactView exception allows only the existing single onPolicyRecordChanged prop, no additional mount or unrelated refactoring.

The specifically approved B6 query passed 55 isolated synthetic checks, then ran unchanged read-only against only a0000000-0000-0000-0000-000000000001. It returned 44 sale events and 2 distinct discrepant events, each with separate premium and Sold Date flags. Redacted output is attached; classification and correction remain pending and unauthorized. This inventory is not the prohibited production-user read-back procedure.

Three organizations lack company_settings rows and each has one active user. See the identifier-only time-zone worklist. No zone inferred, no default applied, no configuration mutation.

Contract-3.3.0 payloads were generated using the frozen isolated fixture with A+B+C+D retained. The local visual database used embedded PostgreSQL 17.5: the concurrent index was built non-concurrently in the adapter and eight related negative-control steps were skipped because the embedded engine cannot reproduce those native catalog/concurrency behaviors. No SQL file or application code changed. This supports synthetic UI/CSV evidence only, not a new PostgreSQL 17.6 release rehearsal, performance pass, RLS audit or independent sign-off. The exact frozen native CI rehearsal remains attached as historical 17/17 evidence.
