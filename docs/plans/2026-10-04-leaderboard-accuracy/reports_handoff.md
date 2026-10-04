# Reports build handoff — reporting integrity corrections

Prepared October 3, 2026 Pacific / October 4 UTC. **Implemented on the isolated reporting branch; no production deployment or historical application.**

Companion documents: implementation_plan.md and full_audit.md in this directory. Source base: 436d9d840732bca1262559597c17e5ef09893fbf. Coordinate against fresh main when either build begins.

## Ownership boundary

The current correction program owns sale/call/booking integrity and active performance displays. The separate Reports build owns Reports UI, get_report_* contracts, sold-policy reporting, filters, charts, exports and attribution decisions.

Do not replace Reports Policies Sold with COUNT(wins) to make a screen match. Its approved source is normalized primary plus additional stored policies, using sold date and current assignment. The leaderboard uses sale events, event timestamp and original seller. Both require clear names and source reconciliation.

## Contracts to preserve

| Concept | Implemented performance / leaderboard contract | Existing Reports contract |
| --- | --- | --- |
| Policy | Stable identity on primary/additional stored policy, linked to one original-sale event | Normalized primary client columns plus additional_policies objects |
| Sales period | wins.created_at; explicit approved proxies for missing historical events | Stored sold_date; legacy additional issueDate fallback |
| Agent credit | Recorded seller | Current client assignment |
| Premium | Monthly snapshot × 12 for annualized production; known/unknown coverage | Preserve existing policy-source contract; do not infer new premium metrics from this plan |
| Timezone | Agency IANA timezone for shared performance | Existing agency timezone |
| Calls | Canonical outbound attempts; exact provider duration/provenance; reviewed duplicates excluded | Existing call facts must explicitly adopt canonical exclusion/provenance rules later |
| Booking credit | created_at, COALESCE(created_by,user_id), once per intentional booking | Preserve setter definition; explicitly adopt reviewed duplicate mapping |
| Book metrics | Current owner/current policies remain separate | Reports must choose and label book versus production where relevant |
| Converted people | Not policy count; multiple policies may belong to one person | Preserve unique-person/disposition distinction and campaign visibility |

There are three legacy wins whose event day differs from sold day. Aligning timezone does not eliminate those differences. Reassignment may also make original seller and current owner totals differ.

## Implemented additive changes to accommodate

- Stable primary/additional policy IDs and a private policy-to-sale registry, with unique original-sale linkage and request receipts.
- Existing policy payload fields remain intact; preserve new identifiers during imports, updates and JSON rewriting. Do not generate new identity merely because a policy moved in an array.
- Sale snapshots distinguish recorded zero from unknown and prevent fallback from an additional policy to the primary.
- Private, reviewed duplicate-to-canonical mapping for calls and bookings, retaining original operational rows and provenance.
- Duration source/observation metadata distinguishing provider, estimated and legacy unknown.
- Secured private metric helpers used by individually authorized public endpoints.

Exact schema contracts:

- `clients.primary_policy_id`; `custom_fields.additional_policies[].policyId`; `wins.policy_id`, `recorded_at`, `event_time_source`; registry `private.policy_identities` and unique `(organization_id, policy_id)` original-sale linkage. Existing historical events retain null `recorded_at`; don't present migration time as original ingestion time.
- `private.performance_duplicate_rows(organization_id, kind, duplicate_id, canonical_id, evidence_hash, reviewed_at)` is empty until a separately reviewed correction. Raw operational rows are retained.
- `calls.attempt_id`, `duration_source`, provider account/SID/sequence/observed-at/conflict fields; `private.call_duration_observations` preserves evidence. `legacy_unknown` is not proof of bad duration.
- `appointments.booking_request_id`, `booking_kind`, `external_identity_guarded`; private booking receipts persist across deletion. Provider uniqueness applies to guarded new identities, preserving legacy collisions.
- `get_leaderboard_snapshot(p_period, p_group_id)` supplies bounded active rows, organization/group/period/timezone/start/as-of and excluded-activity counts. `get_leaderboard_recent_wins(p_group_id)` supplies the latest 20 before server as-of with secured annual premium/known flags.
- `get_performance_summary(p_period, p_mode, p_agent_id)` and `get_performance_details(p_kind, p_period, p_mode, p_agent_id, p_asof, p_offset)` authorize own/selected/downline/agency scopes on the server. Details are fixed pages of 20; comparison is the previous complete calendar period. Scheduled workload remains assigned-time activity, separately named from setter bookings.
- `private.performance_rows` and `private.performance_sale_monthly` hold canonical definitions; their grants are private. No raw CRM grants were expanded. Existing org/Group readers project the same definitions; trusted Dialer retains campaign and agent-local bounds.

See `release_packet.md` for eight generated migration filenames and `implementation-files.json` for exact bytes. These files are **not applied**. Do not copy a private helper into Reports without rechecking Reports-specific scope, agency bounds, export permissions and campaign privacy.

## Historical facts and prepared changes

| Audited evidence | Expected effect |
| --- | --- |
| 8 stored policies, 6 events | Prepared, unapplied two-event repair would give 8 lifetime events |
| $8,172.84 canonical event annual premium | Repair adds $1,201.08, totaling $9,373.92 |
| Teo/Will policy sold dates September 28 | Reports already sees those two policies; adding wins must not add two more stored policies |
| Proposed event proxies September 28/29 | Event repair affects that September week/month; no October sales |
| 5 duplicated provider-ID pairs, 3 excess this week/October | Exclusion only after provider reconciliation; Reports needs explicit mapping integration |
| Will's 4 booking rows | 2 exact excess copies and 1 strong candidate; no indiscriminate deletion |
| 260 calls without provider ID | Missing evidence, not automatic exclusion |
| Elapsed-duration fallback risk | No quantified inflation yet; only provider-supported historical corrections |

Because duplicate source rows remain for history, Reports may still count them until its facts adopt the reviewed canonical map. This discrepancy is explicitly outstanding, not concealed by relabeling totals.

## Coordination and acceptance

1. Rebase against fresh main and inspect other build's actual migration/consumer changes before editing shared sources.
2. Preserve Reports authorization, downline scopes, campaign metadata privacy, disabled-state controls and export permissions.
3. Add fixtures for one client/multiple policies, edits and reorder, retries, unknown amounts, no-policy contacts, deleted/current-book differences, ownership transfer, differing event/sold dates and timezone/DST boundaries.
4. Add call/booking canonicalization fixtures only from the finalized correction contract, including unresolved attempts that still count.
5. Compare report and performance totals only where source, credit, date and roster are equivalent. For different definitions, produce an explicit reconciliation instead of asserting equality.
6. Run existing Reports backend/frontend compatibility gates during the performance build; run all Reports gates after integration.
7. Release packet must identify migrations actually applied, schema/API versions, approved repairs, frozen expected deltas, remaining evidence gaps and rollback compatibility.

No Reports code, permissions, queries, exports, production records or schedules were changed for this handoff.



## Verification handoff

The reporting implementation's 27 changed/new frontend suites pass (521 tests, 2 existing skips); both disposable SQL suites pass. Native PostgreSQL contention and real browser verification remain release gates. Tests include three-policy conversion, explicit zero/unknown premium, policy removal/deletion retaining events, Agent/Admin equal secured legacy premium, downline/foreign-group denial, agency DST and calendar boundaries, historical celebration suppression and exact repair/reversal. The repaired fixture has 8 events / $9,373.92 annual premium; this is not a production readback.

Reports UI/query/RPC source and profile book aggregators were not changed. `reportsContracts.test.ts` now excludes the obsolete byte hash of `supabase-dialer-stats.ts`, which this approved build changes; Reports-owned helper/permission/default hashes remain. Coordinate future Reports source adoption against a fresh main and the actual applied schema. Do not treat either pending repair as two new stored policies.
