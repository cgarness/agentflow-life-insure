# AgentFlow reporting and leaderboard correction plan

Prepared October 3, 2026, Pacific / October 4 UTC. **Released October 5, 2026 under the approved coordinated write window.** PR #416, eight schema migrations, both reviewed Edge bundles and both production frontend targets are deployed. The exact six-link/two-sale repair is applied and verified: eight policies/eight sale events/$9,373.92 annualized premium. See `production-release.md` and `production-release-evidence.json` for authoritative final status and verification limits. Original planning checkpoints below are retained; historical call/booking candidates remain unresolved.

Chris requested a full correction plan and reserved Reports for another build. This replaces the narrow proposal archived in initial_plan.md. Evidence is in full_audit.md. All eight audited policies should have sale events; that business decision is already confirmed.

Repository: cgarness/agentflow-life-insure. Branch: codex/leaderboard-accuracy-audit-20261004. Base main: 436d9d840732bca1262559597c17e5ef09893fbf, refreshed and unchanged during planning. Production project: jncvvsvckxhqgqvkppmj. Audited organization: a0000000-0000-0000-0000-000000000001. Historical repairs are limited to that organization; forward fixes must work securely for all organizations.

## 1. Scope and intended outcome

Every displayed metric must have a defined source, agent credit, date, timezone and unit. Business actions must save complete, nonduplicated records. Failed reads must not appear as zero.

**One distinct new policy creates exactly one sale event.** Primary and additional policies count equally. Editing, reassigning, retrying or calling an existing client again creates no extra sale. A contact without policy evidence creates no sale. A policy leaving the current book does not erase an actual historical sale; lifetime production and the active book are different measures.

| Included now | Reserved for the Reports build |
| --- | --- |
| Policy/sale integrity, snapshots and bounded historical repairs | Reports page, charts, filters and exports |
| Organization leaderboard, TV, Dashboard leaderboard and Group | Existing get_report_* signatures, permissions and policy-source definitions |
| Recent Wins, precise formatting, leaderboard CSV, loading/error/stale states | Reports sold-date/current-owner and campaign attribution decisions |
| Dashboard performance cards/drilldowns, goals and user-management performance | New Reports KPIs and conversion funnels |
| Call/booking idempotency, duration provenance and Dialer stats failure handling | Campaign card Converted semantics and legacy campaign-counter modernization |
| Reconciliation tools and a Reports integration handoff | Current-book profile redesign and activation of unused AgentScorecardModal |

Source repairs may naturally affect existing Reports results. However, new duplicate exclusions used by performance readers will not silently change Reports SQL: that build must explicitly adopt them. Until then, record the expected difference between preserved raw rows and reconciled metrics. Do not claim Reports is corrected by this release.

## 2. Approved metric contract

These concrete decisions intentionally update the browser-local leaderboard convention and misleading Conversion Rate label. Document the approved implemented changes in AGENT_RULES.

| Metric or behavior | Definition |
| --- | --- |
| Policies Sold | Durable policy sale events; original seller credit; at most one original-sale event per stable policy identity. |
| Sale date for performance | Keep wins.created_at event-time semantics. Retain sold_date separately. Reports continues to use sold_date until its separate build. |
| Annualized Premium | Monthly sale snapshot × 12 for each primary/additional policy, preserving cents. Payment frequency remains schedule metadata. |
| Legacy premium | Same secured server fallback everywhere, guarded by organization. Do not resolve it through browser-visible client records or claim fallback is recovered sale-time truth. |
| Unknown premium | Count the sale; distinguish unknown from known zero. Sum known amounts and expose incomplete coverage. Never borrow the primary premium for an additional policy or an immutable zero/unknown snapshot. |
| Calls Made | One canonical persisted outbound attempt on calls.created_at. Legitimate failed/no-answer attempts count; only verified duplicate records are excluded. Missing provider ID alone is not an exclusion. |
| Talk Time | Canonical calls.duration, once per included attempt, in integer seconds. Sole writer remains twilio-voice-status. Distinguish provider values, estimates and unknown provenance; do not call it human conversation time. |
| Appointments Set | One booking creation on created_at, credited to COALESCE(created_by,user_id). Reschedule/cancel retains booking credit. Retry duplicates count once. |
| Appointment workload | Upcoming/assigned activity stays on start_time and user_id. It is not setter production. |
| Shared agency periods | Organization's configured IANA timezone, consistently across browsers. This agency: America/Los_Angeles. Weeks begin Monday. |
| Bounds | One frozen as-of per refresh; current performance uses [period start, as-of). All metrics in a snapshot share the bounds. No future rows. Previous comparisons state their actual window. |
| Missing timezone | Configuration/unavailable state with Retry; no silent browser/UTC fallback for an official agency view. |
| Dialer period | Preserve agent-local day and selected-campaign scope; label that intentional difference. |
| Ranked roster | Preserve active profiles and all permitted roles. Label totals as active-agent totals. Reconcile inactive/unattributed activity separately instead of presenting an active-only sum as unrestricted agency activity. |
| Group | Same metrics and one explicitly labeled comparison window/timezone for all members, using the viewing agency's configured timezone. Preserve membership authorization. |
| Ratio | Rename Conversion Rate to Policies per 100 Calls. Policies ÷ outbound calls × 100, potentially above 100. No calls means —, sorted after defined values and exported blank with denominator. |
| Recent Wins | Latest 20 events across all periods, labeled accordingly. Rolling seven-day badges are separately labeled and do not equal the selected-period count. |
| Truthful states | Valid zero, empty, loading, stale, offline, configuration, denied and failed remain distinct. Keep only same-scope last-good data with its timestamp. Unavailable is —, not zero. |

Dashboard sales cards, goals and user performance use the same event facts for equivalent scopes. Monthly premium goals stay monthly. Current-book profiles stay monthly/current-owner book measures. Matching timezone does not make book ownership, seller credit, sold date and event time interchangeable.

The organization leaderboard keeps its 35-day guard. Dashboard Year requires a separately bounded, authorized, indexed summary endpoint; no widening that guard or raw browser fanout.

## 3. Staged delivery

Use small reviewable PRs, with an evidence packet per checkpoint. Presentation work can run alongside writer work after approval; backend/frontend release dependencies remain sequential.

| Stage | Deliverable | Exit condition |
| --- | --- | --- |
| A | Metric contract, source/consumer inventory, baseline and failing regressions | All findings assigned; exact source and live definitions recorded |
| B | Atomic, identity-based policy lifecycle | Every supported new policy produces one event; edits/retries produce none |
| C | Leaderboard and shared performance consistency | Secured reads, agency periods, precision, Group and truthful states reconcile |
| D | Exact two-event historical sale repair | Frozen census reconciles to 8 events / $9,373.92 annual premium |
| E | Booking/call persistence and duration provenance | Lost responses, concurrency and late callbacks cannot duplicate or lose actions |
| F | Evidence-backed historical call/appointment corrections | Exact before/after deltas, preserved history and enumerated unresolved rows |
| G | Deployed verification and Reports handoff | Verified scopes have no unexplained numeric mismatch; evidence limits disclosed |

B/C/D are the first useful leaderboard release. They do not need to wait for unavailable Twilio history. E/F remain part of the full program; do not announce the entire audit resolved after only fixing sales and formatting.

## 4. Stage A — Baseline and regressions

1. Refresh main and check overlapping work, especially Reports. Record exact source SHA, applied migrations, live function bodies/signatures/ACLs, deployment identity and data census. Never edit an applied migration.
2. Build reusable read-only reconciliation queries by agent and period: canonical calls/seconds, setter bookings, sale events, known/unknown premium, active/inactive/unattributed buckets and reviewed duplicate exclusions. Include frozen bounds/timezone.
3. Convert demonstrated defects into failing-on-base behavior tests: missing Sold Date; first/additional policy on existing client; disposition-only phantom sale; viewer-dependent $900 premium; hidden seconds/cents; CSV escaping; booking retry/lost acknowledgement; estimate blocking later provider truth.
4. Distinguish stored arithmetic, business-record legitimacy and authenticated UI checks. Passing one does not prove the others.

Frozen audit baseline: October 3 at 9:56:52 PM Pacific, 2026-10-04T04:56:52.764028Z.

| Period | Outbound rows | Booking rows | Duration seconds | Exact duration | Sale events | Annual premium |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| Today | 11 | 3 | 81 | 1m 21s | 0 | $0.00 |
| Week beginning September 28 | 2,148 | 24 | 38,509 | 10h 41m 49s | 0 | $0.00 |
| October | 1,263 | 15 | 19,662 | 5h 27m 42s | 0 | $0.00 |

These are raw recorded totals before duplicate reconciliation. Lifetime: 8 policies, 6 events, $8,172.84 canonical annual event premium. Recheck immediately before repair; these are not permanently current values.

## 5. Stage B — Complete policy/sale lifecycle

### Identity and enforcement

- Preserve primary client columns and custom_fields.additional_policies so Reports/profile stored-policy readers remain compatible. No replacement policies-table project.
- Add a stable primary-policy ID and IDs on additional-policy objects, protected from generic custom-field editing. A private organization-scoped registry links identities to clients/source and original sale IDs; linked wins have a unique organization/policy identity.
- Identity survives edits, array reorder, reassignment and current-book removal. Do not derive it from array index, mutable policy number/carrier or call ID. A separate/renewal policy is an explicit new-policy operation.
- Keep request receipts for lost responses, but enforce identity uniqueness independently: a different request ID cannot sell the same registered policy again. Lock and validate the actor/org/client, then persist policy + event + receipt in one transaction.
- Register existing identities/link existing events only where evidence is unambiguous. No incidental historical sale backfill; the two known omissions use Stage D. Preserve receipts after client deletion.
- Enforce the new-policy/event relationship at the database write boundary, not only in UI validation. A newly added policy identity must have its event at commit; an ordinary registered edit retains identity without another event. Grandfather unchanged legacy records while mapping them; reject ambiguous replacement instead of guessing.
- Validate both sides: event belongs to an authorized policy/client/org; new policy cannot commit without its event. Never use a browser flag or caller-set SQL setting as authorization. Keep private helpers unexposed and public entry points authenticated/scoped.
- Do not relax existing client/win RLS. Any actual existing-policy permission change must be separately documented and receive the repository-required explicit RLS approval.

### Entry paths

| Path | Required result |
| --- | --- |
| Contact-only client | Contact saved, zero events. Default policy_type=Term alone is not policy evidence. |
| New client/new primary policy | Required fields and Sold Date validated; client/policy/event commit together. Blank date retains draft with error. |
| First policy through existing-client Edit | Route no-policy → policy transition through the atomic service, one event. |
| Additional policy on existing client | Focused Record Policy action/modal using shared fields/validation; append identity and event together. |
| Conversion with N policies | Existing converter/lineage behavior preserved behind wrapper; N identities and N events atomically. |
| Edit/reassign/reorder | Preserve sale identity, seller and snapshot; zero additional events. Correcting an actual sale snapshot needs a distinct audited correction, not ordinary client Edit. |
| Existing-client converting disposition | Disposition alone creates no event. When another policy was sold, run Record Policy and continue only after it succeeds. |
| Double click/retry/two tabs | Same operation returns original receipt; same identity cannot create another sale; changed completed payload fails clearly. |
| Historical policy entry | One historical event with explicit seller/date treatment and import/audit timestamp; no fresh-win celebration. Never silently count import time as today's production. |
| Current client importer | Preserve contact-only operation; test no phantom Term policies. No new bulk policy-import feature. |
| Any actual/future policy-bearing import | Shared policy service and historical/new intent required; reject unsupported policy data instead of bypassing event creation. |

Remove the unchecked-sale escape hatch for a newly recorded policy. Historical mode is explicit, not a no-event bypass. Proposed date-only convention: use the start of the supplied sold date in the agency timezone, mark event-time provenance as a date-only proxy, retain the real ingestion timestamp, and show that treatment before saving. This convention applies only to an explicitly historical operation; ordinary new sales keep their server event time. Require an authorized seller and valid date; unresolved entries remain drafts instead of generating today's production. The exact repair below uses its separately listed client-creation proxies, not this convention. Existing event timestamps are not rewritten.

Generic create/update and Contact Details must detect newly introduced policy evidence. Unknown versus zero premium must survive form → database → event → reader. A failed sale insert rolls back the policy. Failed notification delivery after commit does not undo or duplicate the sale.

## 6. Stage C — Consistent active performance displays

### Secured data and scope

1. Keep organization standings server aggregated; reuse shared private metric/premium functions behind individually authorized public endpoints. Do not reconstruct peer statistics from RLS-limited browser rows.
2. Add a minimal Recent Wins reader that resolves legacy premium securely and exposes only permitted feed data plus coverage metadata. Ordinary Agents must see the same allowed $900 amount as Admin without reading that client's private record. Group feed authorization is checked in the RPC, not inferred from caller-supplied IDs.
3. Replace Group's client count/all-direction call logic with wins, outbound calls, setter bookings, canonical premium, active-role parity, explicit shared bounds and server seven-day counts. Remove browser metric fanout. Old callers get compatible corrected results or an explicit unavailable/version state, never silently wrong old semantics.
4. Use one agency timezone resolver/period helper. Snapshot/cache identity includes viewer, org/group, timezone, period start and filters. Delivered snapshots include as-of. Reject responses after identity/scope/timezone/date rollover. Compare identical as-of instants.
5. Preserve single-flight scheduling, per-org no-wait advisory guard, PT429/backoff, 25-second timeout, 30-second visible/online polling, hidden/offline suppression and separate avatar cache. New endpoints join this discipline; no per-agent metric N+1 reads.
6. Retain active ranked roster; label totals and reconcile excluded inactive/unattributed activity separately.

Validate response schemas and numeric ranges before committing a snapshot. A missing field, invalid number, partial result or scope mismatch must not become zero through coercion. Unknown premium coverage is part of the validated contract. Apply the agency-period helper to performance readers only; do not incidentally change Calendar, upcoming workload or the Dialer's local-day behavior through a shared helper replacement.

### Display and export

- Shared formatter across normal/TV podiums, rankings, totals, Recent Wins and Dashboard leaderboard: 0s, 29s, 52s, 1m 21s, 10h 41m 49s. Never display nonzero activity as zero.
- Premium uses two decimals and explicit annualized units, including $701.40. Numeric sorting keeps full values.
- Rename the ratio in filters, tooltips, TV rotation, persistence compatibility and exports; undefined values sort after valid ratios, with deterministic name/ID ties.
- Display period/timezone/scope/last successful update consistently. Recent Wins explicitly spans periods. Historical events refresh data without fresh-sale animation.
- Export only a successful current-scope snapshot, with explicit as-of and stale label when applicable. Include bounds, timezone, scope, raw integer seconds, precise premium, counts and denominator. Encode commas, quotes and line breaks; neutralize spreadsheet formulas in text fields; numeric values stay locale-independent. Failed/partial first loads or another selection cannot export.
- Test long names, ties, cents, large totals, unknowns, no photos, 0/1/2/many agents, narrow/desktop/TV layouts and every metric/period. Preserve shipped TV geometry and motion.

### Adjacent displays

- Dashboard sales cards/drilldowns: replace client counts and primary premiums with scoped event summaries. Keep appointment workload on assignee/scheduled time. Personal cards compare to their authorized agent scope, not the entire board.
- Goals: server aggregates with both bounds for sales, monthly premium and setter bookings. Preserve units and configured targets; define zero-target and unknown-coverage behavior.
- User-management performance: authorized selected-agent summaries, outbound calls, same sales/premium facts, server-enforced self/Admin/downline scope; no arbitrary agent-parameter access.
- Trusted Dialer stats: preserve campaign/agent-local scope; typed unavailable on failure and same-scope stale cache instead of zeros. No selected campaign still means neutral zeros.
- Profile book metrics retain normalized current policies/current owner/monthly premium. Do not switch those book totals to wins.
- AgentScorecardModal remains unmounted. Its known window, attribution, premium, goal and failure-state defects are recorded for a future activation/replacement; no new importer.

## 7. Stage D — Exact historical sale repair

All eight policies are confirmed sales. Proposed credit uses current stored owners; proposed event time uses exact client creation as a proxy. These choices need inclusion in the eventual repair authorization, not a claim that missing original event times were recovered.

| Field | Teo Hampton | Will Harrison |
| --- | --- | --- |
| Client ID | 54d44dc5-98c8-4778-a71d-f0b1d595d992 | 71137434-036b-4b3f-8e0a-c6e290b096ba |
| Agent ID | 4ef505e0-7520-4a7a-a622-095914ba40c1 | e5c4ee04-a792-47ce-ad18-953777f6d1d9 |
| Policy | Final Expense / Americo | Whole Life / Americo |
| Sold date | 2026-09-28 | 2026-09-28 |
| Monthly snapshot | $58.45 | $41.64 |
| Annual premium | $701.40 | $499.68 |
| Event-time proxy | 2026-09-28T23:44:55.365470Z | 2026-09-29T17:39:18.606999Z |
| Existing linked events | 0 | 0 |
| Repair key | repair:manual-client:54d44dc5-98c8-4778-a71d-f0b1d595d992:primary | repair:manual-client:71137434-036b-4b3f-8e0a-c6e290b096ba:primary |

Preserve stored policy bytes, including Will's carrier whitespace. Link stable policy identities when installed; check existing conversion keys and repair keys so identity rollout cannot duplicate a sale.

1. Deploy suppression in BOTH realtime handling and RecentWinsPanel's top-item flash/spotlight. Historical/celebrated events refresh through the gate but do not celebrate; normal new wins still do. Skipping notify_win alone is insufficient.
2. Account for older open tabs; refresh/close relevant tabs after active calls finish before claiming no historical animations. Do not disable realtime/RLS or interrupt calls.
3. Generate a new migration via CLI and freeze exact SQL. Lock/recheck source clients, owners, policy IDs, premiums, dates, missing events and duplicates. Stop on drift.
4. Atomically insert exactly two wins with premium_snapshot=true, celebrated=true, approved sold dates/premiums/event times and deterministic keys. Record generated IDs and provenance. Leave unestablished call/campaign links null. No notify_win or customer communications.
5. Retry verifies original repaired rows and adds none; partial failure rolls back both; conflicting preimages/events fail. Test exact bytes on isolated native PostgreSQL.
6. Read back the two IDs and verify unrelated clients/policies/calls/appointments unchanged. Do not rewrite the existing six events or call their legacy fallback immutable historical truth.

| Frozen measure | Before | After repair |
| --- | ---: | ---: |
| Lifetime sale events | 6 | 8 |
| Lifetime canonical annual premium | $8,172.84 | $9,373.92 |
| Week beginning September 28 events / premium | 0 / $0.00 | 2 / $1,201.08 |
| September events / premium | 2 / $2,004.24 | 4 / $3,205.32 |
| October events / premium | 0 / $0.00 | 0 / $0.00 |

Only these two generated IDs/keys may be reversed by a separately approved drift-checked repair. Frontend rollback never deletes legitimate sales.

## 8. Stage E — Prevent call and booking defects

### Calls and duration

- Trace pre-dial creation, Voice.js association, wrap-up reuse, webhook updates and terminal cleanup. One deliberate attempt has a stable identity reused by retries/callbacks; a real redial gets another.
- Preserve DNC admission, canonical disposition IDs, queue claims/locks, campaign attribution and all Voice.js reentrancy guards. No production test calls.
- Add uniqueness only for verified canonical provider identity, including account/leg semantics where needed. Parent/child Twilio legs are not automatically separate user attempts or duplicates. Classify existing collisions before enabling constraints.
- Retain legitimate failed/pre-provider attempts. Capture acceptance/failure/correlation so a missing SID does not require guessing. Browser-blocked actions that never create an attempt are not calls.
- Keep calls.duration solely owned by twilio-voice-status; add provenance/observation metadata for provider, estimate and legacy unknown.
- Make reconciliation authority-aware: signed provider duration can replace an elapsed estimate even when smaller; estimates and late failure cannot overwrite authoritative duration. Validate same call/leg and callback ordering; flag conflicting final provider evidence.
- Preserve nonnegative and late non-answer protections. This explicitly refines invariant #8's monotonic rule only for estimate → authoritative correction. No browser/recording-derived duration writer.
- Negative elapsed times and stale ringing require authoritative evidence. Never compute replacement talk time from ended_at minus started_at. No blanket historical duration rewrite.

### Appointments and callbacks

- Stable booking request ID per intentional scheduling operation, backed by org-scoped uniqueness/receipt. Double-click, retry and lost response return the same appointment. A separate intentional booking gets a new key; no contact/time/title uniqueness rule.
- One awaited service across Dialer, Calendar and Contact scheduling. Preserve setter/assignee permissions. Pending saves prevent repeat submission; failure retains draft; close only after persistence.
- Wrap canonical disposition persistence plus idempotent booking in one transaction where they are one action. Preserve the canonical disposition/DNC body. If a prior disposition committed, replay still ensures its missing booking exists exactly once; replay must not skip it.
- Callback state and required schedule record form one replayable operation. Partial failure cannot falsely close/advance/claim success.
- Workflow delivery cannot abort core CRM saves; retry must not duplicate workflow/history delivery. Do not rewrite queue logic.
- Reschedule/cancel retains original booking credit; it does not create another booking event.

## 9. Stage F — Historical call/appointment reconciliation

Create an immutable manifest per cluster: org, exact IDs, payload hashes, evidence, canonical row, proposed classification, per-agent/period deltas and reversal. Preserve source history.

Prefer a private audited duplicate-to-canonical mapping consumed by secured performance readers over deleting operational rows or cancelling appointments just to fix counts. Enforce same org, valid target, no cycles and one canonical identity. Changes are guarded migrations. Reconcile canonical call attribution/duration before choosing a row; do not pick arbitrarily or sum duplicate durations. Appointment exclusions do not automatically cancel reminders or undo workflows; review pending side effects separately before operational cleanup.

| Evidence | Planned treatment | Unsupported shortcut |
| --- | --- | --- |
| 5 provider-ID duplicate pairs / 5 excess rows | Authorized provider reconciliation; distinguish legs/attempts, retain history, map verified duplicates | Delete every second row |
| 3 excess duplicate-ID rows in week/October | If all verified, frozen calls become 2,145 weekly / 1,260 October | Publish conditional totals as certified |
| 260 no-SID outbound rows / 24 weekly | Classify correlated provider calls, legitimate failed attempts and unknowns individually | Exclude all missing-SID/failed calls |
| 236 negative elapsed rows / 18 weekly | Investigate ordering and evidence-based timestamps | Derive talk time from reversed elapsed |
| 3 old ringing rows | Verify terminal status and exact repair if warranted | End a call purely because it is old |
| 5 exact appointment excess rows | Review full equality, history and intent; map approved duplicates | Delete based only on contact/time |
| Will's 4-row weekly booking cluster | 2 exact excess rows plus 1 strong candidate, individually reviewed | Claim all 3 are proven duplicates |
| Possible retained duration estimates | Compare authorized provider final durations and quantify exact repairs | Claim a production inflation amount without evidence |

For Will's cluster, approving only two exact excess rows makes frozen weekly/monthly appointments 22/13; approving the third candidate too makes 21/12, from 24/15. Other clusters require their own date deltas. Audited duplicate call pairs have zero stored durations, so excluding just those rows changes calls, not talk-time totals.

Twilio history was unavailable in the audit. Obtain authorized provider evidence/export without exposing secrets. If still unavailable, finish deterministic sale/writer/display fixes and list precisely which call figures remain unverified.

The Reports build must explicitly adopt the canonical mapping. Until then its preserved raw call/booking counts can differ; this is an integration gap to disclose, not proof the corrected board is wrong.

## 10. File and migration boundaries

Finalize each PR's exact file list before edits; update this plan for necessary expansion. Keep surgical wiring in large components. New module names are proposed.

| Area | Existing paths expected to change | New work |
| --- | --- | --- |
| Policy service/forms | src/lib/policySaleRecording.ts; src/lib/clientSaleForm.ts; src/lib/supabase-clients.ts; src/lib/supabase-conversion.ts; src/components/contacts/AddClientModal.tsx; src/components/contacts/ConvertLeadModal.tsx | policyIdentity helper, RecordPolicyModal, identity/writer migrations and native tests |
| Policy integrations | src/pages/Contacts.tsx; src/pages/ContactDeepLinkPage.tsx; src/components/contacts/FullScreenContactView.tsx; src/components/layout/FloatingDialer.tsx; src/lib/win-trigger.ts | Entry-point, reserved-metadata and retry regressions |
| Import | supabase/functions/import-contacts/index.ts only if actual policy-bearing path is found; otherwise tests only | Contact-only/no-phantom policy regression |
| Readers | src/hooks/useLeaderboardData.ts; src/hooks/useLeaderboardWidgetStandings.ts; src/components/leaderboard/leaderboardPremium.ts | src/lib/performanceQueries.ts; src/lib/performancePeriod.ts; secured feed/Group/summary migrations |
| Leaderboard UI | src/pages/Leaderboard.tsx; src/components/leaderboard/leaderboardTypes.ts, LeaderboardFilters.tsx, LeaderboardRankingsTable.tsx, TVRankingsTable.tsx, TVAgencyTotalsStrip.tsx, RecentWinsPanel.tsx, TVMode.tsx, TVPodium.tsx, LeaderboardPodiumCard.tsx | Shared precise formatter/CSV helper and rendering tests; edit consumers only where not inherited |
| Dashboard/performance | src/hooks/useDashboardStats.ts; src/lib/dashboard-period-bounds.ts; src/components/dashboard/StatCards.tsx; src/components/dashboard/DashboardDetailModal.tsx; src/components/dashboard/widgets/LeaderboardWidget.tsx; src/components/dashboard/widgets/GoalProgressWidget.tsx; src/lib/supabase-users.ts; src/components/settings/user-management/UserProfileModal.tsx | Scoped summary/error/period tests and bounded longer-period endpoint |
| Dialer stats/bookings | src/lib/supabase-dialer-stats.ts; src/pages/DialerPage.tsx; src/lib/dialer-api.ts; src/components/dialer/DialerHeaderStats.tsx; src/components/calendar/AppointmentModal.tsx; src/contexts/CalendarContext.tsx | src/lib/appointmentPersistence.ts; transaction/receipt migration and concurrency tests |
| Calls/duration | src/contexts/TwilioContext.tsx; supabase/functions/twilio-voice-status/index.ts; supabase/functions/twilio-voice-status/duration.ts | Attempt/provenance migration and callback races; list any additional actual writer before editing |
| Historical correction | No applied SQL edits | Separate generated repair migrations, read-only preflight/readback, canonical mapping and guarded recovery |
| Verification/docs | Existing focused policy/leaderboard/Group/DNC/frontend runners as needed; root implementation_plan.md, WORK_LOG.md and approved implemented AGENT_RULES invariants | Reconciliation runner, verification.md, manifests and reports_handoff.md |

Reports source/RPCs and dormant scorecard remain excluded. Reports compatibility tests still run. Generate database types through the established process only when needed; no unrelated type repairs. Never hand-invent migration timestamps.

## 11. Acceptance tests and release gates

| Area | Required evidence |
| --- | --- |
| Policy counts | Primary → 1; primary + 2 additional → 3; existing-client additional → +1; contact-only → 0; edit/reassign/reorder/retry → +0 |
| Atomicity | Policy/event/receipt commit together; concurrent/lost-ack retry returns one result; changed payload and recreation after deletion fail safely |
| Authorization/enforcement | New-policy bypass cannot omit event; forged org/foreign policy/agent/campaign/null permission denied; authorized self/Admin/TL/View As retained |
| Premium | Agent/Admin allowed feed agrees on $900; cents retained; unknown/zero never falls back; edits do not mutate sale snapshots |
| Periods | Pacific/Eastern/UTC browsers share agency totals; DST, Monday/month/year rollover, exact start/end, no future events; documented sold/event differences |
| Numeric parity | Canonical fixture → RPC → normal board → TV → widget → CSV match at identical bounds/scope; monthly goals stay monthly |
| Scope | Agent/Admin/TL/Super Admin, inactive/unattributed, authorized/removed/no group membership, org switch, no CRM data leak |
| Calls/duration | True redials distinct; duplicate callback/save once; inbound excluded; no-SID not discarded; estimate 120 → provider 90 works; late failure cannot corrupt truth |
| Bookings | Awaited saves, retained failure draft, double click/lost-ack, replay after committed disposition, setter vs assignee, reschedule/cancel and workflow isolation |
| UI/errors | Initial failure never zero; stale current scope labeled; old scope cleared; no hidden/offline requests, retry storm or late commit |
| Formatting/export | 0/29/52/81/3600+ seconds, cents/large/unknown values, comma/quote/linebreak/formula strings, exact numbers and scope/as-of |
| Repair | Exact two-row first-run/retry/drift/rollback; +2/$1,201.08 in September week, zero October increase; both celebration paths suppressed |
| Performance | Native indexed PostgreSQL, representative volume, 35-day guard, bounded Year endpoint, advisory-lock contention/release, timeout/backoff |
| Browser | Real authorized Admin/Agent; all metrics/periods, normal/narrow/TV/widget/feed/export; permitted Group fixtures; no synthetic production records |

Audit evidence already available: 340 existing tests passed in 21 files; six expected-failure reproductions demonstrated gaps. They do not prove the fixes. Production sign-in returned “Failed to fetch”; authenticated screen/new-sale verification is still unproven.

Each PR runs focused behavior tests, applicable native DB/security/concurrency workflows, root tsc, actual app tsc against exact base, scoped lint and build. Last verified base has 88 existing app TypeScript diagnostics; require no new diagnostics, not a false global-clean claim. Real isolated browser fixtures precede release.

Unresolved provider history can only remain as a precise disclosed limitation with affected counts. Do not certify all historical reporting until resolved or explicitly accepted as unresolvable with truthful presentation.

## 12. Deployment, recovery and handoff

1. Read current Supabase changelog/relevant official docs before backend implementation. Verify live definitions/history and create new migrations through CLI.
2. Ship backward-compatible additive schema/readers/writers, after native verification. Preserve tenant authority, RLS, original conversion/queue/DNC bodies and private helper grants.
3. Exact-preimage migration guards, bounded lock/statement timeouts, stop on drift. Respect the existing leaderboard incident's no-active-dialing condition for applicable backend work; never interrupt calls to manufacture that condition.
4. Backend before frontend; fetch deployed Edge source before full-bundle changes. Call/duration changes receive their own release checkpoint. Verify merged SHA, both production frontend projects and aliases.
5. Celebration suppression before separate two-sale repair. Keep data repairs separate from schema/duplicate classification for traceable deltas. No fake production rows or customer calls/messages.
6. Perform the established bounded ten-minute leaderboard observation: response latency, PT429/5xx, request volume, contention and stale/error behavior. Reuse the existing stop condition of two successful standings responses over two seconds unless explicitly reviewed otherwise.
7. Recovery retains legitimate events, identities, receipts and evidence. Roll back to a compatible frontend or withhold the affected feature truthfully. Never restore a sale-dropping writer, anonymous privileged access, or drop schema containing dependent data. Recovery migrations verify exact postimages.
8. Deliver a repeatable read-only reconciliation command/report for policy/event mismatches, unknown premiums, duplicate provider IDs, unresolved attempts, booking replay gaps and numeric differences. Include post-release and follow-up observation runs. No scheduled automation is created by this planning task.
9. Give Reports the metric dictionary, schema additions, canonical mapping, manifests, access rules, fixtures and explicit event-date/sold-date, seller/current-owner differences. Do not edit Reports as an incidental dependency.

## 13. Audit coverage

| Audit finding | Planned resolution |
| --- | --- |
| F1 — Missing sale events | B prevents recurrence; D repairs the exact two omissions |
| F2 — Writer gaps / phantom events | B covers new, first, additional, conversion, edit, retry and disposition paths |
| F3 — Call anomalies | E prevents duplication; F reconciles exact historical candidates |
| F4 — Duplicate/lost bookings | E adds awaited atomic/replayable persistence; F classifies old clusters |
| F5 — Viewer-dependent legacy premium | C resolves the secured feed and aggregate consistently |
| F6 — Divergent performance sources | C unifies active performance consumers; Reports/book semantics remain explicit |
| F7 — Timezone, dates, attribution and labels | Contract in section 2 and C; no silent rewrite of historical dates |
| F8 — Precision/CSV | C shared formatters, exact export and UI verification |
| F9 — Duration provenance | E authority-aware writer; F provider-supported historical repair only |
| Group defects | C complete server aggregation and membership tests |
| Dormant scorecard defects | Keep inactive; explicit future replacement, not a current-screen cause |

## 14. Approval and current state

Chris approved the full plan with “Proceed with implementation” on October 3 at 22:41 PDT and subsequently asked to continue. The isolated implementation is complete on the stated branch. This supersedes the original planning-only status, without extending authorization to public publication, production release or evidence-dependent data repair.

| Stage | Implemented status |
| --- | --- |
| A | Read-only production audit, exact preimages, source inventory and frozen reconciliation manifest complete. |
| B | Stable policy IDs, atomic one-policy/one-sale writers, receipts, first/additional policy UI and enforcement implemented; embedded regressions pass. |
| C | Shared secured reads, agency bounds, normal/TV/widget/feed/CSV precision and adjacent performance consumers implemented; tests pass. |
| D | Exact six legacy links, two missing sale insertions and guarded reversal prepared outside automatic migrations; verified on disposable fixtures, not applied. |
| E | Atomic booking/disposition replay, call-attempt identity, signed duration authority/provenance and Google event race protection implemented; embedded and frontend tests pass. Native multi-session tests remain a release gate. |
| F | Immutable candidate manifest and read-only reconciliation command complete. Historical provider/intent evidence is unresolved; no guessed exclusions, status changes, duration rewrites or deletes. |
| G | Release packet, Reports handoff, CI/native/browser fixtures and local verification complete. Native/browser execution, full remote CI and production checks remain outstanding. |

Final evidence: **521 passing tests in 27 changed/new frontend files, two existing skips; both embedded SQL suites pass; no new app TypeScript or lint errors; production and isolated visual-fixture builds pass.** Local browser verification is blocked by Chromium download certificate validation; native PostgreSQL startup is blocked by account-switch permissions. See `verification.md` for bounded claims.

`release_packet.md` defines exact migration order, Edge baseline drift, mixed-client rollout constraints, separate repair checkpoints and recovery. `implementation-files.json` records actual authored files/hashes; the earlier boundary table is an allowed scope, not a claim that every listed file required a change. Reports source and `get_report_*` RPCs are unchanged. No production data, migrations, provider requests, deployments, customer calls/messages or public publication occurred.
