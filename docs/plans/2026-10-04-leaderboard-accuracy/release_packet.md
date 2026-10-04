# Reporting and leaderboard correction release packet

**Release approved October 4 at 05:35 PDT; permission amendment approved 05:46 PDT. Not deployed; remaining verification gates must pass.** Branch `codex/leaderboard-accuracy-audit-20261004`, base `436d9d840732bca1262559597c17e5ef09893fbf`. Chris approved isolated implementation and verification of the full plan. Chris subsequently approved the reviewed release and explicitly approved removal of anonymous trusted-Dialer RPC execution. Proceed through the packet’s sequential publication, verification, production and exact historical-sale checkpoints; no evidence-dependent call/booking corrections are authorized by this approval.

The implementation enforces one original sale per distinct new primary/additional policy, unifies active performance displays, makes bookings atomic/replayable, and records call-attempt/duration provenance. The two historical missing sales have an exact guarded repair. Historical call and booking anomalies still require evidence review. Reports remains another build.

## Review contents

- `implementation-files.json`: SHA-256 inventory of authored source, tests, migration/ops SQL and supporting documents. The inventory excludes itself.
- `verification.md`: executed checks and unexecuted gates.
- `reconciliation-manifest.json`: frozen source IDs/hashes and unresolved candidates, with no selected canonical mappings.
- `reports_handoff.md`: final schema/API boundaries and intentional remaining differences.
- `implementation_plan.md`, `implementation_progress.md`, `full_audit.md`: approved scope, decisions and baseline findings.

## Migration order — all eight UNAPPLIED

| Order | Generated migration | Purpose |
| --- | --- | --- |
| 1 | `20261004054235_policy_identity_sale_integrity.sql` | Durable policy identities, unique original sales, immutable snapshots, first/additional policy writers and enforcement. |
| 2 | `20261004055216_performance_reporting_contract.sql` | Secured board/feed and canonical fact definitions; empty reviewed-duplicate map; compatible old reader projections. |
| 3 | `20261004060013_performance_scoped_summaries.sql` | Authorized Dashboard, goal, selected-user summaries and bounded detail queries. |
| 4 | `20261004060713_booking_disposition_receipts.sql` | One booking per request, atomic disposition+booking and browser identity protection. |
| 5 | `20261004061001_call_attempt_duration_provenance.sql` | New-attempt uniqueness and signed-provider evidence reconciliation. |
| 6 | `20261004061538_performance_reader_indexes.sql` | Bounded metric indexes; typed duration-quality aggregation. |
| 7 | `20261004062049_external_booking_identity_guard.sql` | Prevent new duplicate external-provider event identities; retain historical collisions. |
| 8 | `20261004062224_trusted_dialer_canonical_counts.sql` | Canonical exclusions and no legacy disposition-name fan-out, preserving campaign/agent-local scope; explicitly revoke anonymous execution after exact live-ACL verification. |

All filenames came from the Supabase CLI. Existing applied migration files were not edited. Exact function preimages and relevant authorization metadata are guarded. Locks are bounded; an error aborts the containing migration. Do not bypass a preimage/permission/timeout failure, or automatically apply unrelated pending migrations from this repository.

The new UI requires these RPCs. Schema enforcement also rejects legacy direct browser booking/policy bypasses. **This is not a zero-downtime mixed-client rollout.** Coordinate an approved write-maintenance window and stop new sales/booking/dialer actions, wait for active calls to finish naturally, then update backend and frontend together and refresh old tabs. Never interrupt calls to obtain that condition. Native tests and release review must validate this sequence before execution.

## Deployed Edge baselines and release checkpoints

| Bundle | Read-only baseline | SHA-256 of deployed index |
| --- | --- | --- |
| `twilio-voice-status` | v44 | `4b1b16e63093888b6c20fed6a17666d73016dc2de40f2ac580a4cee470b2a668` |
| `google-calendar-inbound-sync` | v491 | `6184ff86d37d407cafa3ea0cff010bb608b6218f60473d8dc3a63e923b6e60e4` |

The voice baseline was newer than main. Its deployed best-effort `dial-evidence.ts` is now included **byte-for-byte**, SHA-256 `6e9f30fdddcef5d7831526b71a1fe8471e7a28efefc0c8e625e458fce8d413a1`. Other voice dependencies match deployed bytes except the deliberate duration changes. Google v491 matched repository baseline; only org-scoped lookup and uniqueness-race recovery were changed.

Retrieve both complete deployed bundles again before release and stop on drift. Install database dependencies before either Edge patch. Keep full dependency bundles, Twilio signature verification, existing JWT settings, DNC admission, status ladder and retryable failures. Do not deploy unrelated telephony/routing functions. Provider callbacks must be tested without real customer calls in an authorized isolated environment.

## Historical sale operations — separately quarantined

These are **outside `supabase/migrations`** and cannot be included by an automatic schema push:

1. `supabase/ops/reporting-accuracy/pending/20261004062851_reviewed_legacy_policy_links.sql` links the six exact, unambiguous single-primary conversion events; changes no event facts and creates no events. Retain identities on rollback.
2. `supabase/ops/reporting-accuracy/pending/20261004062328_reviewed_missing_policy_sales.sql` repairs only clients `54d44dc5-98c8-4778-a71d-f0b1d595d992` and `71137434-036b-4b3f-8e0a-c6e290b096ba`. Seller IDs, monthly snapshots $58.45/$41.64 and client-creation event-time proxies are fixed in the approved-plan table. Stored carrier whitespace is retained. Campaign/call attribution remains null.
3. `reverse_reviewed_missing_policy_sales.sql` permits reversal only of those generated event IDs with exact recorded postimages and deterministic keys. It retains audit receipts/identities, never deletes the original six events and refuses silent reapplication after reversal.

Expected frozen result:

| Measure | Before | After two-event repair |
| --- | ---: | ---: |
| Lifetime events | 6 | 8 |
| Annual premium | $8,172.84 | $9,373.92 |
| Week beginning September 28 | 0 / $0.00 | 2 / $1,201.08 |
| September | 2 / $2,004.24 | 4 / $3,205.32 |
| October | 0 / $0.00 | 0 / $0.00 |

Those event times are disclosed proxies, not recovered sale timestamps. Fresh source/readback hashes, exact script approval, current trigger review and refreshed historical-celebration suppression on both UI paths are prerequisites. These scripts do not send `notify_win` or customer communications. Capture generated IDs/postimages and compare all unrelated source rows before/after any future execution.

## Unresolved historical data

The frozen audit contains five duplicate provider-ID pairs, 260 outbound rows without provider IDs, 236 negative elapsed intervals and three old ringing rows (overlapping classes; 277 distinct candidate rows). Appointment candidates contain five exact excess copies plus intent-dependent similarities; Will's weekly cluster has two exact excess copies and one strong candidate.

No candidate is an applied exclusion. A missing SID does not prove a non-call, reversed elapsed time does not establish talk duration, and a repeated contact/time does not prove duplicate booking intent. Conditional frozen weekly/October call totals 2,145/1,260 and booking totals 22/13 (or 21/12 if the further candidate is proven) are **not certified totals**. Obtain authorized provider/history evidence, choose exact canonical rows, review reminder/workflow side effects and generate a separately guarded mapping/repair with per-agent deltas and reversal. Do not delete operational history or cancel appointments merely to improve reporting counts.

Use `scripts/reconcile_reporting.mjs` only after schema installation, with an explicitly provided read-only connection, organization UUID and frozen as-of. It forces read-only repeatable-read transactions, never loads application env files and prints no credentials. Its SQL is also tested on disposable data.

## Required release sequence and recovery

1. Recheck fresh main, Reports overlap, live migration history, function hashes/ACLs, triggers, Edge bundles and source census. Resolve conflicts while preserving concurrent work.
2. Run exact-head full frontend/DNC/backend CI, native reporting contention/security/index gates, and expanded browser fixture. Verify authenticated Agent/Admin/TL/Group flows on an authorized isolated environment. Current local evidence is 521 passing frontend tests plus embedded SQL; native/browser gates remain unexecuted.
3. Review the concrete commit/manifests and obtain separate authorization for publication and the exact production checkpoints. No approval is being inferred from completion of isolated implementation.
4. Coordinate the write window described above. Apply only the eight exact migrations in order; verify schema, function owner/ACL/security configuration and empty historical mappings. Deploy the two reviewed Edge bundles in their separate checkpoints, then the frontend to both production projects. Verify exact revision, READY deployments and domain aliases.
5. Refresh tabs after active calls finish. Verify all metric/period/scope/precision/error states and actual reads. Observe the existing stop rule: two successful standings responses over two seconds stop rollout and require investigation. Monitor duration errors/conflicts, booking RPC failures and stale states. Do not manufacture production sales or calls for tests.
6. Only after that checkpoint, consider separately approved six-link/two-sale scripts and exact readback. Run read-only reconciliation at common bounds. Historical call/booking corrections remain independent evidence-dependent work.

**Recovery:** retain additive identities, receipts, immutable events, provenance and raw history. A presentation-only revert can keep the new persistence/read adapters. A blind full frontend or voice-bundle rollback is unsafe: old booking writers conflict with enforcement, and old duration writers bypass provenance. Pause affected actions and roll forward with a tested compatible fix; any full backend downgrade/guard disable needs its own reviewed migration and authorization. The exact two-sale reversal above is data-specific and does not authorize a general database rollback. Never drop legitimate sales or remove DNC/queue guards to restore a screen.
