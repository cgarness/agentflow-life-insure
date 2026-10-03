# AgentFlow leaderboard data and TV mode fix plan

Date: October 3, 2026. Status: implementation approved by Chris on October 3 at 13:49 PDT; isolated branch build in progress. Repository edits and disposable tests are authorized. No production writes, migrations, or deployments are authorized.

## Objective

Correct missing sale metrics, remove the entire “No activity … Go to Dialer” section, prevent overlapping profile images in TV mode, and center the top three against the Agency Totals box. Preserve the existing visual design and leaderboard performance safeguards.

## Verified evidence

### Data and sales recording

Read-only production queries against `jncvvsvckxhqgqvkppmj`, scoped to Chris’s home organization, found the following at the time of inspection. Windows use America/Los_Angeles and end at the query time; “This Week” begins Monday September 28.

| Period | Outbound calls | Appointments created | Recorded wins |
| --- | ---: | ---: | ---: |
| Today | 11 | 1 | 0 |
| This Week | 2,148 | 22 | 0 |
| This Month | 1,263 | 13 | 0 |

All of these calls belong to active roster agents. The weekly appointment counts also reconcile to the canonical setter attribution: `COALESCE(created_by, user_id)`.

Two client records created this week have September 28 sale dates: one assigned to Teo and one to Will. Neither has a matching win record. Neither carries converted-lead lineage. Their canonical premium values are 58.45 and 41.64. This proves a source-record mismatch; it does not prove which UI action originally created them or establish that either record should be backfilled without review.

The live organization standings function counts sales from `wins`, with annual premium derived from each win and the canonical `clients.premium` fallback. It is active, retains its concurrency guard, and contains no maintenance pause. Its metric definitions match the documented contract. This inspection does not constitute an authenticated browser/API verification.

Current source confirms that `clientsSupabaseApi.create` inserts only a client. The inspected Contacts handler reports success without recording a win. Lead conversion uses a different, after-commit win path. `triggerWin` currently logs non-duplicate win insertion errors and returns without surfacing a durable recording failure. Missing win records can therefore exist while a client or conversion save succeeds. Do not conflate a saved sale record with a successfully delivered celebration.

### Misleading activity message

`src/pages/Leaderboard.tsx` checks activity only for the selected metric. The default metric is Policies Sold, so zero wins can produce a general “No activity” banner despite thousands of calls. Remove the entire banner and its Go to Dialer action, as requested. Preserve real loading, offline, maintenance, stale-data, and failed-request notices.

### TV alignment and overlap

`TVMode.tsx` places Agency Totals in its own centered 72rem container. The podium is centered in the middle of a separate `18rem / 72rem / 22rem` grid. Unequal side widths displace the podium from the totals center; fixed track widths also exceed smaller viewports.

The podium uses agent-keyed, absolutely positioned cards under `AnimatePresence mode="sync"`. Metric switches can keep departing and arriving cards in the same slot until exit completes. The normal leaderboard already remounts its podium on metric changes; TV mode does not. This is a code-supported overlap mechanism, but the user’s exact visual occurrence has not yet been reproduced in a browser.

The TV table divides its remaining height into seven rows while avatars remain 32px tall. There is no minimum row height protecting those avatars. Short viewports can squeeze rows below their content height. This is a separate layout risk to reproduce and fix.

A local execution of the existing ranking helper also confirmed that `rankAgents([...agents], metric)` mutates the original agent objects’ `rank` fields. TV mode uses this shallow-copy pattern. Clone row objects before TV ranking so presentation state is isolated; do not describe this as evidence that numerical call or sale values were corrupted.

## Proposed implementation

### 1. Frontend corrections

- Remove the activity banner and unused imports/calculations.
- Put Agency Totals and the podium on the same centered, responsive width. Give the lower ranking panels their own layout so their side widths cannot move the podium. Preserve the 2–1–3 ordering and existing styling.
- On automatic or manual metric switches, commit the new ranking and reset metric-specific animation/odometer state together. Avoid simultaneous outgoing/incoming cards for a filter-driven swap. Preserve appropriate live-update animations within one metric, with cleanup of obsolete timers.
- Clone agent objects before TV ranking. Verify exiting TV mode leaves normal-page rankings consistent with the normal-page metric.
- Give table rows enough space for the avatar and text. Use responsive podium sizing and a contained overflow strategy when the available height is insufficient; never compress seven rows below readable height merely to keep everything on one screen.
- Retain genuine error and stale states. Metric changes remain local and make no new standings request.

### 2. Repair the sale-recording path

Keep `wins` as the canonical sale source. Do not switch leaderboard aggregation to all client rows or synthesize sales in browser code.

Before editing the writer, reconcile current Contacts work and enumerate the actual explicit sale entry paths: interactive new-client policy entry, lead conversion, and additional-policy recording. Distinguish a newly recorded sale from an imported existing book, a contact-only addition, and an edit to an existing policy.

Recommended contract: when an interactive operation explicitly records a newly sold policy, persist the policy and its canonical win through a durable, idempotent server operation. Validate the actor, organization, permitted agent attribution, policy identity, premium, and dates. A retry or double submission must resolve to the same sale. Routine edits and historical imports must not create additional wins. Notifications remain after-commit and must not turn delivery failures into lost sales or roll back a committed sale.

Use the smallest migration-backed implementation compatible with the existing permission model. Preserve conversion lineage, its existing idempotency key, and all Dialer/DNC invariants. If that requires expanding the approved file scope into Dialer or conversion internals, document the exact change and impact before editing them. Do not weaken RLS or create a privileged shortcut for arbitrary agent/org attribution.

Preserve the current `wins.created_at` reporting bucket and monthly-to-annual premium convention. A change to sold-date reporting would affect other reports and is not bundled here.

### 3. Existing-record reconciliation

Prepare a bounded, read-only manifest of confirmed missing sale events. The two observed client IDs are `54d44dc5-98c8-4778-a71d-f0b1d595d992` and `71137434-036b-4b3f-8e0a-c6e290b096ba` in organization `a0000000-0000-0000-0000-000000000001`.

Before proposing repair, verify policy legitimacy, duplicates, attribution, monthly premium, event-time evidence, and existing notifications. Specify exact rows, idempotency keys, timestamp handling, totals affected, and whether notifications will be suppressed. Do not backdate timestamps speculatively or insert every client as a sale. Production repair requires Chris’s approval of that exact manifest and action.

## Intended file scope

List and confirm the final manifest on the implementation branch before edits.

Frontend:

- `src/pages/Leaderboard.tsx`
- `src/components/leaderboard/TVMode.tsx`
- New focused TV layout/podium components under `src/components/leaderboard/`, only where needed to keep components manageable
- `src/components/leaderboard/TVDeepRankPanel.tsx` or `tvPanelLayout.ts` only if the lower-panel sizing fix needs them
- Relevant existing leaderboard page/status tests and a focused TV regression suite

Sales-path work, after confirming current callers and the exact server design:

- `src/lib/supabase-clients.ts` and its focused tests
- The current explicit sale submission handler in `src/pages/Contacts.tsx` or its current extracted component
- `src/lib/win-trigger.ts` and focused idempotency tests where needed
- `src/lib/supabase-conversion.ts` only if required to preserve reliable canonical sale recording; no casual Dialer changes
- A new CLI-generated migration and isolated database tests for the approved server operation
- Generated RPC types if the contract changes

Documentation:

- Dedicated task plan plus an additive link in the existing root `implementation_plan.md`
- Newest-first `WORK_LOG.md` entry
- `AGENT_RULES.md` only for an approved new invariant or discovered production gotcha

Preserve concurrent Contact History, repeated-field, A2P, and DNC work. Existing root plans are historical records and must not be overwritten.

## Verification

- Reconcile Today, Week, and Month for the same organization, roster, and timestamp bounds across the main leaderboard, TV totals, and Dashboard widget. Compare metrics from authoritative records, not screenshots alone.
- Verify both Agent and Admin visibility with real authorized sessions; do not forge production identity claims.
- Test a new explicit manual sale, ordinary contact-only creation, historical import, conversion retry, additional-policy sale, duplicate submission, permission denial, missing org, and notification failure in an isolated environment. Verify no lost sale and no double counting.
- Verify fixed-metric rendering, manual switches, 30-second rotation, live rank changes, period changes, TV entry/exit, and photo-load completion.
- Visually verify 1366×768, 1920×1080, and 3840×2160 plus browser zoom. Measure podium and Agency Totals center coordinates; confirm no avatar/text overlap or clipped cards. Test one, two, three, and more than ten agents with isolated fixtures.
- Run `npx tsc --noEmit`, the actual application typecheck, production build, and focused tests. Compare existing diagnostics to the exact base; root tsc alone is insufficient in this repository.
- Preserve the shared request gate, 30-second visible/online polling, backoff, advisory guard, avatar cache, and lean numeric RPC payload. No production load tests or customer calls.

## Authorization and delivery

`AGENT_RULES.md` §8 requires an implementation plan and Chris’s approval before code changes. This document is that reviewable proposal. Implementation approval is for an isolated branch and disposable tests; production migrations, historical repair, PR merge, and deployment need their separately stated exact authorization.

Current limitations: no production screenshot supplied, no authenticated UI walkthrough performed, and the specific avatar-overlap occurrence is not yet browser-reproduced. The database/source findings and rank-mutation reproduction above are verified.

## Copyable execution prompt

```text
TASK TYPE: BUGFIX — AgentFlow leaderboard data and TV mode
Repo: cgarness/agentflow-life-insure
Production Supabase: jncvvsvckxhqgqvkppmj

Read AGENT_RULES.md, VISION.md, WORK_LOG.md, the current implementation_plan.md,
and this task plan. Check newest work-log entries and current PRs for conflicts.
Update the task plan and list exact files before editing. Wait for Chris's explicit
implementation approval if it is not already present in this session. Once the
plan is approved, complete the authorized build and verification on an isolated branch.

Remove the entire No activity / Go to Dialer section. Center TV's top three on the
same centerline as Agency Totals, independent of the lower table and side panels.
Fix avatar overlap from metric transitions and insufficient row height. Clone row
objects before TV ranking; keep rotations, live updates and returning to normal
mode coherent. Preserve the existing design and all real error/loading/stale states.

Investigate and fix the missing canonical sale-record path described in the plan:
two sold-date client records exist without wins, and interactive client creation
does not record a win. Do not replace wins with client-row counts. Record explicit
new policy sales durably and idempotently, preserve authorization and attribution,
and prevent imports, ordinary edits and retries from becoming duplicate sales.
Keep notification delivery separate from canonical sale persistence. Preserve
reporting-date semantics and prepare any historical correction for exact approval.

Keep changes surgical. Respect organization_id and RLS; use maybeSingle when zero
rows are possible, Zod for forms/modals, and Tailwind only. Keep new components
under 200 lines. No production mock data, exposed secrets or frontend service-role
keys. Use new migrations for schema changes; never edit applied migration bytes.
Preserve request gates, polling/backoff, lean payloads, photo caching, and single-leg
Voice.js dialing. If conversion/Dialer work is necessary, read TwilioContext.tsx,
preserve re-entrancy/telemetry/DNC protections, and verify call records, status,
dispositions and logs without live customer calls.

Run the plan's focused database, ranking, date/scope and visual checks;
npx tsc --noEmit; actual app typecheck against base; and production build.
Append a newest-first WORK_LOG entry. End with changes, decisions, exact files,
test evidence, migrations/deploys, blockers, and next steps. Do not push to main,
merge, deploy, mutate production or send messages without the required authorization.
```

Suggested model: GPT-6.1 in Codex, with thorough reasoning for the sale-recording work.

## Approved build refinement and exact initial manifest

Base: main c8b3a682, including Contact History PRs 407/408. Branch codex/leaderboard-data-tv-20261003. Old leaderboard PRs 382/383 remain unmerged and are not reused.

Backend design: add private transaction receipts and internal policy-event writer; two narrow authenticated entry points create a self-owned manual client or wrap the unchanged canonical conversion transaction. Derive actor/org from profiles, reject stale organization/attribution, preserve original conversion authorization, and validate campaign provenance. New manual sales are explicit via a Record as new sale option; contact-only saves and imports do not produce wins. The option defaults on for an interactive new client but requires a Sold Date; agents can turn it off when entering an existing book. New conversions record their primary and additional policy events transactionally; primary retains conversion:<lead> so older retry calls cannot duplicate it. Legacy conversions are not silently backfilled. Sale-event persistence is atomic; existing idempotent notify_win is called only after commit. No existing RLS policy, converter body, source-history trigger, or telemetry writer changes.

Before implementation the concrete file list is: Leaderboard.tsx; TVMode.tsx; new TVPodium.tsx, tvPodiumMetal.ts, TVRankingsTable.tsx and useTVRankMotion.ts; AddClientModal.tsx; Contacts.tsx (save call only); supabase-clients.ts; supabase-conversion.ts; new policySaleRecording.ts; generated RPC types; new 20261003205341_leaderboard_sale_recording.sql; new policy_sale_recording.sql, run_policy_sale_recording_tests.sh and matching scoped CI; existing leaderboardPage, conversionContract, contactsApi and clientCustomFieldsWriteGuard tests; new TV and sale-operation tests; task plan, verification and repair proposal, root plan link, WORK_LOG and a narrowly scoped AGENT_RULES addendum. Changes to actual conversion callers stop at the existing helper signature; TwilioContext was inspected and will not be edited.

Premium correctness refinement: new policy events explicitly mark their premium as a frozen snapshot, including unknown/zero. Add wins.premium_snapshot with a false legacy default; the internal writer sets it true. The org aggregate preserves all legacy fallback semantics but will not borrow the primary client premium for a new additional-policy event with no premium. Group/Recent Wins premium presentation honors the same flag. Additional exact files: leaderboardPremium.ts, leaderboardTypes.ts, its existing premium unit suite, and guarded one-expression replacement of get_org_leaderboard_stats in the new migration. No polling, scope, roster, ACL or index change.

Form validation extraction: new `src/lib/clientSaleForm.ts` keeps the touched modal under 200 lines and validates explicit sale intent, carrier, real dates, and monthly premium. Missing context/pre-save refusal now rejects instead of closing the modal as if saved. Unassigned conversion attribution is preserved as NULL, never silently credited to the converter. Campaign linkage requires source lead membership in the same organization.

Authorization review refinement (before the final writer edit): preserve the existing authorized View As client-creation behavior. The manual entry point validates the selected owner's profile in the caller's home organization and applies the existing clients permission predicate (self, same-org Admin/Super Admin, or Team Leader ancestor). The server derives org/actor and validates owner instead of silently replacing it. An ordinary agent still cannot attribute a sale to a peer or another organization. Receipt retries recheck the stored/current client owner. The conversion wrapper independently repeats the intended lead permission predicate with `coalesce(...,false)`, because the legacy converter's nullable `IF NOT` guard cannot safely authorize the new event writer; the existing converter body stays unchanged.

Verification additions: disposable fixture builder `scripts/policy_sale_fixture.py`, scoped PostgreSQL CI workflow, and local-only browser fixture/tests under `scripts/tests/leaderboard-visual/`. Native browser and PostgreSQL startup are blocked by this session's socket/process restrictions; embedded PostgreSQL is used for transactional/permission checks. Real independent-session contention and screenshot checks remain explicit release gates.

## Implementation handoff

Code and embedded transactional tests are complete; see `verification.md` for the exact file manifest, executed checks and explicit pending release gates. The browser/socket and native PostgreSQL permission restrictions remain unresolved. `historical-sale-review.md` is a bounded conditional proposal; no repair or release is authorized by this build approval.
