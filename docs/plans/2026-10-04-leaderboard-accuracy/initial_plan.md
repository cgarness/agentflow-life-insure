# Archived initial leaderboard proposal

Historical planning record only. The complete current proposal is [implementation_plan.md](implementation_plan.md); do not implement this archived scope on its own.

> Superseded in scope by [the full audit](full_audit.md), completed after Chris confirmed every new policy counts as a sale. The earlier findings below remain a record of the initial investigation; they are not a complete reporting correction plan. The expanded audit found call/appointment duplicates, additional sale-writer gaps, viewer-dependent legacy premium, cross-surface source differences, and duration-provenance risk. Do not release only this initial scope as a complete accuracy fix.

Status: read-only audit complete; proposed corrections awaiting approval. No application code, production data, migration, deployment, or public repository content changed during this audit.

Source: `cgarness/agentflow-life-insure`, main `436d9d840732bca1262559597c17e5ef09893fbf`. Production project: `jncvvsvckxhqgqvkppmj`. Organization: `a0000000-0000-0000-0000-000000000001`. Audit branch: `codex/leaderboard-accuracy-audit-20261004`.

## 1. Findings affecting the current agency leaderboard

### Missing historical sales

The organization has eight clients with sale dates and six canonical wins. Exactly two clients have no linked win. None of the eight clients has an `additional_policies` array. No client was created after the October 4 UTC sale-writer migration timestamp. The six existing wins all have agents and linked clients; one legacy zero-premium win correctly uses the documented client-premium fallback. Their canonical annual premium totals $8,172.84.

The latest canonical win is September 17. Therefore Today, This Week, and October currently return zero wins and zero sale premium. This is consistent with the event records but omits the two September 28 policy entries if Chris confirms they were new sales. The prior release fixed future explicit sale recording; it deliberately did not repair history.

Do not switch Policies Sold to a count of all clients. Clients can represent existing books, and one client can hold multiple policies. Do not change the established `wins.created_at` period semantics to sold date as an incidental repair.

### Display and export precision

The current shared `formatMetricValue` and both rankings tables divide seconds by 3,600 and display one decimal hour. Today's Chris total of 29 seconds and Alexa total of 52 seconds each display as `0.0 hrs` / `0.0h`. Raw values and ranking are retained, but the visible numbers hide real activity.

`formatPremiumSold` rounds annual premium to whole dollars. CSV export also applies `Math.round` to premium and minutes. This loses cents and subminute precision in the exported data. CSV fields are joined without escaping commas or quotes, which can shift columns for affected agent or organization names.

### Canonical calculations and scope

The live organization aggregate definition hash is `ad7a611db564d737d1dc50a7622f3500`. It retains authenticated organization derivation, the no-wait advisory guard, active roster, and the approved sale snapshot logic. Agency standings, TV totals, and the monthly Dashboard leaderboard use this aggregate. TV totals sum the returned agent values.

Calls are outbound/outgoing rows by `created_at`; duration is the sum of nonnegative canonical `calls.duration`. Appointments use booking `created_at` and `COALESCE(created_by,user_id)`. Policies count wins and annual premium is monthly premium multiplied by 12, respecting immutable snapshots and legacy fallback. Conversion Rate is the existing policies/calls ratio, not unique converted leads. Contacted calls are not a leaderboard metric. No contacted metric was inferred or invented.

All of this week's outbound calls belong to active roster profiles. The 24 appointments have setters; none needs the fallback or has missing attribution. There are 2,199 calls across all directions this week, including 2,148 outbound/outgoing calls. Those figures intentionally differ. No weekly call has null `started_at`, null duration, or negative duration. This checks stored records, not provider-level telephony completeness.

## 2. Reconciled production totals

Frozen end: `2026-10-04T04:47:28.434692Z` (October 3, 9:47:28 PM America/Los_Angeles). Start bounds are local midnight October 3, Monday September 28, and October 1. Every comparison is half-open `[start,end)` and includes active profiles.

| Period | Outbound calls | Appointments set | Duration seconds | Exact duration | Wins | Annual premium |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| Today | 11 | 3 | 81 | 1m 21s | 0 | $0.00 |
| This Week | 2,148 | 24 | 38,509 | 10h 41m 49s | 0 | $0.00 |
| This Month | 1,263 | 15 | 19,662 | 5h 27m 42s | 0 | $0.00 |

Weekly agent reconciliation:

| Agent | Calls | Appointments | Duration seconds | Wins |
| --- | ---: | ---: | ---: | ---: |
| Teo Hampton | 987 | 5 | 15,985 | 0 |
| Will Harrison | 806 | 5 | 16,406 | 0 |
| Alexa Segura | 208 | 12 | 4,266 | 0 |
| Keenyun Williams | 111 | 0 | 1,086 | 0 |
| Desiree Montgomery | 20 | 0 | 661 | 0 |
| Chris Garness | 16 | 2 | 105 | 0 |
| Other two active profiles | 0 | 0 | 0 | 0 |

The browser uses its local timezone. The figures above apply when the browser uses America/Los_Angeles, matching the agency setting. A different browser timezone can produce different valid day/week/month bounds. Reports use stored policies and sold dates; those figures are not interchangeable with win-event totals. No signed-in production screen or authenticated user/API response was captured in this audit.

## 3. Proposed frontend corrections

1. Introduce one shared duration formatter using seconds as input, displaying seconds/minutes/hours without making nonzero values appear zero. Apply it to the normal and TV podiums and rankings. Keep numeric sorting and the stored call duration unchanged.
2. Display annual premium with two decimal places consistently in the leaderboard, TV totals/rankings, and Recent Wins. Make the annual unit explicit. Keep calculation based on immutable monthly snapshots and the existing legacy fallback.
3. Make CSV exports lossless for the available data: two-decimal annual premium; integer duration seconds, with a clearly labeled column; proper quoted-field escaping. Preserve current rank and scope.
4. Add focused regressions for 0/29/52/81/3,600+ seconds, premiums with cents, CSV commas/quotes, and TV/main consistency. Reuse existing status, scope-switch, request-gate, and widget tests. Preserve polling, backoff, advisory locking, avatar loading, and stale/error states.
5. If the historical repair is approved, honor `celebrated=true` on realtime win events: refresh standings/feed through the existing gate, but do not enqueue a new-win flash or spotlight for those events. New ordinary wins retain current celebration behavior. Deploy this before the repair, and verify historical and ordinary realtime cases separately.

Intended files, finalized against current main before implementation:

- `src/components/leaderboard/leaderboardTypes.ts`
- `src/components/leaderboard/LeaderboardRankingsTable.tsx`
- `src/components/leaderboard/TVRankingsTable.tsx`
- `src/components/leaderboard/TVAgencyTotalsStrip.tsx` and `RecentWinsPanel.tsx` only for unit-label consistency
- `src/pages/Leaderboard.tsx` and a focused CSV helper under `src/components/leaderboard/`
- `src/hooks/useLeaderboardData.ts` and its existing tests, only for the approved historical-event celebration guard
- Relevant leaderboard formatter/export/rendering tests
- This plan, root `implementation_plan.md`, and `WORK_LOG.md`; update `AGENT_RULES.md` only for an approved new invariant

No change to call classification, appointment definitions, conversion semantics, agent roster, timezone boundaries, policy writers, RLS, or telephony is proposed.

## 4. Exact historical repair proposal

This operation needs confirmation that both entries were new sales, that the named agents deserve original sale credit, and that the exact client-creation timestamps are acceptable proxies for the missing event times. The database cannot establish those facts. Earlier implementation/release approval expressly excluded this historical repair.

| Field | Teo Hampton | Will Harrison |
| --- | --- | --- |
| Client ID | `54d44dc5-98c8-4778-a71d-f0b1d595d992` | `71137434-036b-4b3f-8e0a-c6e290b096ba` |
| Agent ID | `4ef505e0-7520-4a7a-a622-095914ba40c1` | `e5c4ee04-a792-47ce-ad18-953777f6d1d9` |
| Policy type | Final Expense | Whole Life |
| Carrier | Americo | Americo, retaining stored trailing whitespace |
| Sold date | 2026-09-28 | 2026-09-28 |
| Monthly snapshot | $58.45 | $41.64 |
| Annual premium | $701.40 | $499.68 |
| Proposed event timestamp | `2026-09-28T23:44:55.365470Z` | `2026-09-29T17:39:18.606999Z` |
| Existing linked wins | 0 | 0 |

After approval, author a new migration that inserts exactly one win for each manifest entry, with `premium_snapshot=true`, `celebrated=true`, the above organization, and deterministic `idempotency_key` values `repair:manual-client:<client-id>:primary`. Generate new win IDs and record them for exact read-back and rollback identification. Derive display names from verified source rows. Leave campaign/call links null because none is established.

Recheck policy identity, source preimages, duplicate candidates, agent credit, premium, sold date, and creation timestamps immediately before execution. Lock/recheck the relevant rows and make the operation atomic and idempotent. Stop on any drift or conflicting win; a retry must verify the same repaired events and add none. Validate the actual schema, triggers, receipt-key mechanism, grants, and migration metadata before authoring SQL. Do not assume a repair key is sufficient without checking its database uniqueness mechanism.

No client/policy mutation, notifications, `notify_win`, or customer communication. Production has no noninternal wins triggers, but wins are in the realtime publication. The current leaderboard subscriber ignores `celebrated` and would animate a direct historical insert; merely skipping `notify_win` does not suppress that effect. The small frontend guard above addresses this for updated tabs. Existing open tabs running the older bundle must be closed/refreshed before the repair to claim that all historical flashes are suppressed. Do not disable realtime, RLS, triggers, or grants to work around old clients. Record that deployment/open-tab limitation honestly if it cannot be verified.

Test exact migration bytes in an isolated database for first run, safe retry, changed premium/owner, already-linked win, rollback on either-row failure, and expected aggregate deltas. Apply only under explicit production authorization for this exact manifest. Read back both win IDs and compare unchanged calls, appointments, clients, assignments, and policies.

Expected impact with the proposed timestamps:

- Week beginning September 28: **+2 policies, +$1,201.08 annual premium**.
- Teo: **+1 policy, +$701.40**. Will: **+1 policy, +$499.68**.
- September: 2 recorded policies/$2,004.24 becomes **4/$3,205.32**.
- October and October 3: **no increase**. These are September sales.
- Rolling seven-day wins change only while each event timestamp remains within that window.

A rollback, if separately approved, must identify only these two generated IDs and keys and refuse unrelated deletion. A frontend rollback must not remove the repaired events. No migration or repair has been authored or applied in this audit.

## 5. Other discovered paths, separated from the current symptom

The agency has no group membership. The live group RPC still counts clients as policies, includes all call directions, uses the caller agency's timezone, and has different roster rules. Browser supplemental premium/recent-win queries can have row-limit and RLS visibility differences. These are real consistency defects but cannot explain this agency's current org-only screen. A separate bounded group plan must align the complete aggregate and access boundary without raw browser metric fanout before Group is used as an equivalent view.

`AgentScorecardModal.tsx` has no importer anywhere in `src`. Its dormant code uses overlapping eight-day windows, `started_at` rather than canonical `created_at`, all call directions, raw RLS-restricted row queries, monthly premium, and error-to-zero fallbacks. Unstable Date dependencies can also retrigger reads after rendering. These defects were found during inspection but are not presented as the current displayed leaderboard's cause. Do not activate this component without replacing those paths and validating goals and coaching-note behavior.

## 6. Verification and authorization

Completed: read-only production reconciliation, live function and policy inspection, full source-path tracing, and **140 passing tests in five files**: standings hook, truthful status surfaces, TV regression, Dashboard widget, and policy sale recording. Existing tests pass despite the precision gaps; add targeted coverage as part of the proposed fix. No live provider comparison, signed-in browser verification, or new-sale production smoke was performed.

Before release: run focused tests, root `npx tsc --noEmit`, the real app typecheck against exact main's baseline, build, applicable CI, and normal/TV visual checks. Verify Today/Week/Month and agent totals at identical frozen bounds. Use authorized real sessions for Agent/Admin access verification; do not fabricate production JWT identity or insert fake sales. Stop optional testing once the concrete risks are resolved.

`AGENT_RULES.md` section 8 requires a reviewable implementation plan and Chris's approval before application edits. This is that plan. The prior approval did not include these new formatting/export changes or historical correction. Requested decision: approve the bounded frontend correction scope and separately confirm/authorize the two-event repair with the listed credit, premiums, and event-time proxies. Production publication/release must be explicitly covered when implementation is approved. Do not interpret approval of frontend formatting as permission to alter sale history.
