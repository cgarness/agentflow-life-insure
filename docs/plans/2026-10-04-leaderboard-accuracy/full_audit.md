# AgentFlow reporting accuracy — full audit

Audit completed October 3, 2026, Pacific time / October 4 UTC. Production remained read-only. This report supersedes the earlier assumption that the two missing sale events and display precision were the complete corrective scope.

**Verdict: reporting is not yet consistently accurate across AgentFlow.** The organization aggregate correctly implements its documented arithmetic, but its source records contain duplicates and missing events. Other screens also use different sources, date rules, and visibility-dependent premium calculations. A successful query or matching row count does not certify business accuracy.

Chris confirmed: **every new policy should be considered a sale.** The audit therefore treats a newly recorded policy as requiring one durable sale event, including each additional policy. Editing an existing policy must not create a second sale. Existing-book imports need an explicit historical-policy treatment, not a silent new-sale omission or an invented sale date.

## Scope and method

- Repository: `cgarness/agentflow-life-insure`, main `436d9d840732bca1262559597c17e5ef09893fbf`; fetched again at closeout, with no source/migration drift.
- Production: `jncvvsvckxhqgqvkppmj`, organization `a0000000-0000-0000-0000-000000000001`.
- Census: **5,220 calls, 89 appointment rows, eight clients/policies, six wins, eight active profiles**. Detailed call reconciliation covers September 1 through October 3; all-time checks cover duplicates, direction, attribution, invalid elapsed times, and missing provider IDs.
- Inspected live function definitions, RLS policies, function grants, relevant triggers, and the deployed `twilio-voice-status` source. Inspected all current frontend policy/sale writers and the main reporting consumers.
- Compared the main leaderboard, TV, Dashboard leaderboard, Dashboard stat cards, goal progress, Reports, profile book metrics, user-management performance, Group, Recent Wins, and CSV. The unused scorecard was separately classified.
- No production INSERT/UPDATE/DELETE, migration, JWT impersonation, customer call, message, account change, or deployment was performed. Only audit documentation was added to the isolated local branch.
- Authenticated screen verification was attempted through secure browser sign-in. The live form returned **“Failed to fetch.”** It did not establish a signed-in session. No authenticated Agent/Admin screen equivalence or live sale smoke test is claimed.

## Findings that affect current reporting

### F1 — Two policies are missing their sale events — high priority, confirmed data gap

The eight normalized policy records total **$781.16 monthly / $9,373.92 annual premium**. There are only six canonical wins, totaling **$8,172.84 annual premium** using the documented legacy fallback. All eight policies have sold dates, positive known premiums, monthly payment frequency, and active assigned agents. There are no normalized additional policies, malformed additional-policy containers, undated policies, or duplicate carrier/policy-number identities in this organization.

| Agent | Policy sold date | Monthly premium | Annual premium | Linked wins |
| --- | --- | ---: | ---: | ---: |
| Teo Hampton | September 28 | $58.45 | $701.40 | 0 |
| Will Harrison | September 28 | $41.64 | $499.68 | 0 |

Under the confirmed policy rule, these two policies represent **two missing sale events / $1,201.08 annual premium**. The bounded IDs and proposed timestamps remain in `implementation_plan.md`. The current assignee and the client creation timestamp are stored facts; historical seller attribution and missing event time still need to be treated as approved repair choices, not recovered original win data.

The prior forward fix is installed, but there have been no new client records since its migration timestamp. Thus this audit cannot claim a successful authenticated production use of the new writer.

### F2 — Policy entry does not consistently guarantee a sale — high priority, reachable code defects

| Entry path | Current behavior | Accuracy consequence |
| --- | --- | --- |
| New Client with sale checked and Sold Date present | Atomic client + win, stable request key | Correct forward path within this contract |
| New Client with sale checked but Sold Date blank | Silently sets `recordSale=false` before validation | Policy details can save without a sale; the checked intent is not enforced |
| New Client with checkbox unchecked | Persists no win | Requires explicit historical/existing-policy treatment under the new rule |
| Adding first policy details to an existing client through Edit | Direct client UPDATE only | No new sale event |
| Lead conversion with primary and additional policies | Atomic wrapper records one win per policy | Correct forward path; retry receipt prevents duplicate events |
| Adding another policy after a client already exists | No dedicated sale-recording UI/API flow was found | New-policy lifecycle is incomplete outside conversion |
| Generic client creation / client import | Direct client INSERT, no win | No universal database guarantee that a new policy has a sale event |
| Existing-client floating-dialer conversion disposition | Calls `triggerWin` with a per-call key, without persisting a new policy | Can count a sale that has no newly recorded policy; repeated qualifying calls can produce multiple sales for one client |

The last path has a second problem: nonduplicate win-insert errors are logged and swallowed after disposition save, so a successful disposition does not guarantee a recorded sale. All six current wins have conversion keys; **no current `disposition:` wins were found**, so phantom existing-client sales are a confirmed forward risk, not an observed historical overcount.

Sources: `AddClientModal.tsx`, `supabase-clients.ts`, `supabase-conversion.ts`, `FloatingDialer.tsx`, `win-trigger.ts`, `import-contacts/index.ts`; live sale-writer functions. There is no client trigger that universally creates missing policy sale events.

### F3 — Duplicate call identifiers and unverified call attempts — high priority, confirmed source anomalies

Five valid-format Twilio call IDs each appear on two outbound rows: **ten records for five provider identities**. All-time excess is five rows; **three excess rows fall in this week and October**. The duplicate pairs belong to Will (September 24, two pairs), Keenyun (October 1, one pair), and Teo (October 2, two pairs). Their stored durations are zero.

The leaderboard, Reports and Dashboard count call rows rather than unique provider calls. These duplicate rows therefore affect dial counts unless intentionally classified as separate failed attempts. Provider reconciliation is necessary before assigning a final corrected “Calls Made” value or deleting/merging any row.

Other call quality findings:

- **260 outbound rows all-time lack a Twilio call ID**, all with zero duration; **24 are in this week** (Will 11, Keenyun 6, Teo 5, Alexa 2).
- Of the 24 weekly rows without provider IDs, 18 are marked completed and six failed. A missing ID alone is not proof that a call never occurred, nor permission to discard it.
- **236 all-time rows have `ended_at < started_at`**; 18 are in this week. Observed reversal ranges from 0.017 to 33.745806 seconds. Do not derive talk time from these timestamps.
- Three old rows remain marked ringing: two inbound September records and one outbound October 1 record. Their terminal state is not trustworthy as a live-call signal.
- No unknown directions, negative stored duration, missing outbound agent profile, cross-organization outbound agent reference, or future creation timestamp was found.
- The 11 outbound rows after the October 2 PDT disposition release have no duplicate provider IDs, missing IDs, or negative elapsed times. This is encouraging bounded evidence, not proof that all writer races are fixed.

Do not simply filter out all failed calls or all missing IDs. Define which attempts count, reconcile provider evidence, retain history, then make the writer idempotent and repair only identified duplicates.

### F4 — Duplicate appointment records inflate booking counts — high priority, confirmed records with bounded uncertainty

There are **five excess rows with exactly identical payloads** after excluding IDs and creation/update timestamps across the 89 appointment rows. Grouping by contact, appointment start, setter, assignee and title identifies seven excess candidates overall.

This week's material case is Will: **four bookings for the same contact, time and title**, created from `2026-10-02T01:25:11.455414Z` through `01:25:13.214224Z`. Three have identical complete payloads; the first differs in contact-name/notes metadata. Thus **two excess rows are exact copies, and a third is a strong duplicate candidate** requiring review. The currently reported weekly 24 and monthly 15 include all four rows. Removing all three excess candidates would make those counts 21 and 12, respectively; those are conditional totals, not approved repairs.

No appointment lacks an effective setter. Setter/assignee currently agree for all 89 rows, and there are no negative meeting lengths. This validates attribution arithmetic, not the legitimacy of duplicate bookings.

Forward persistence gaps also remain: the main Dialer's standalone AppointmentModal starts `saveAppointment` without returning/awaiting its promise, closes immediately and swallows failures. The callback modal also swallows failures and closes. Disposition persistence and appointment creation are separate operations; an appointment failure after a committed disposition can remain missing because a replay skips scheduler writes. Appointment rows have no operation-level idempotency in the inspected path.

Sources: `DialerPage.tsx` standalone appointment/callback handlers and disposition scheduling path; `dialer-api.ts` `saveAppointment`; live appointment census. Do not cancel/delete candidates casually: appointment writes have workflow and contact-history triggers.

### F5 — Recent Wins premium depends on the viewer — high priority, confirmed code/RLS mismatch with a live affected record

One existing Alexa win has a NULL stored premium and a client monthly premium of $75. The organization aggregate correctly shows **$900 annual premium** for that win via its secured server fallback. The Recent Wins reader instead looks up clients in the browser.

Wins are organization-readable, while the clients ALL policy restricts an ordinary Agent to their assigned clients (with the existing Admin/Super Admin/Team Leader branches). Another Agent can therefore see this win but receive no client row for the fallback. The helper produces $0 and the Recent Wins panel omits the premium badge. An authorized owner/Admin can see $900 for the same event. A focused reproduction demonstrates the 900-versus-0 difference; no production impersonation was used.

New immutable snapshots avoid this fallback problem. Existing legacy events still need a secured, consistent reader or a reviewed snapshot repair. **Do not loosen client RLS** to fix a public-facing leaderboard amount.

### F6 — Reporting surfaces do not share one sales definition — high priority, confirmed live divergence

| Surface | Policy source | Date basis | Agent credit | Premium basis |
| --- | --- | --- | --- | --- |
| Organization leaderboard / TV / Dashboard leaderboard widget | Wins | Win `created_at`, browser-local bounds | Win agent, active roster | Monthly snapshot × 12; legacy client fallback |
| Reports Policies | Normalized stored primary + additional policies | Stored sold date, agency calendar | Current client assignment | Policy counts; attribution explicitly labeled |
| Agent/Team Profile book | Normalized current policies | Lifetime book / stored sale dates for milestones | Current assignment | Current monthly policy premium |
| Dashboard sales cards | Client rows | Client `created_at`, browser-local bounds | Current assignment and viewer scope | Primary client premium × 12 |
| Goal Progress | Wins | Current browser-local month, lower bound only | Win agent | Monthly win premium; no legacy fallback |
| User-management performance | Wins for sales; raw calls of every direction | Current browser-local month, lower bound only | Selected agent | Monthly win premium; no legacy fallback |

For the week beginning September 28, the Dashboard card source returns **2 policies / $1,201.08**, Reports returns **2 stored policies**, and the leaderboard returns **0 wins / $0**. This is a current data-source disagreement, not a render-only problem. Counting clients will also overcount contact-only clients and undercount multiple policies per client as the book grows.

The goal widget is explicitly labeled **Monthly Premium**; failing to multiply it by 12 is not itself an annualization bug. Its missing legacy fallback, lack of upper bound, and unpaginated win data remain consistency risks. Unpaginated browser aggregations in Group, goals and user-management are vulnerable to configured API row limits; the actual deployed row cap was not established, so no current cap-related deficit is asserted.

User-management performance includes inbound calls and can turn query errors into zero. The trusted Dialer header also returns an empty/zero stats object on RPC error. These are truthful-state defects outside the main leaderboard, whose failure handling is substantially stronger.

### F7 — Date, credit and ratio labels can make valid calculations appear contradictory — medium priority, confirmed definition differences

Leaderboard/Dashboard bounds use the browser timezone; official Reports uses `America/Los_Angeles` from agency settings. At the frozen audit instant:

| Browser timezone | Today outbound calls | October outbound calls |
| --- | ---: | ---: |
| America/Los_Angeles | 11 | 1,263 |
| America/New_York | 0 | 1,263 |
| UTC | 0 | 1,374 |

The UTC month includes 111 additional calls that occurred on September 30 Pacific time. This is the current documented contract, not proof of a new timezone calculation regression. Official agency comparisons should use one explicit timezone or clearly disclose different scopes.

Three existing wins also have event dates different from their stored sold dates: August 14 → August 26, August 21 → August 26, and August 26 → August 27. Consequently daily/weekly sale counts can differ even after missing events are repaired. Current assignment versus immutable seller credit can diverge after reassignment; all six current wins still match their client's current owner.

“Conversion Rate” on the leaderboard is policies divided by calls, not unique converted leads divided by worked leads. Manual/multiple-policy sales make that distinction material; with zero calls it displays 0% instead of an undefined ratio. Reports deliberately avoids that label. Define or rename the ratio before treating it as a comparable conversion KPI.

Recent Wins is the latest 20 events across periods. It is not filtered by the selected Today/Week/Month. The seven-day count used elsewhere is a separate rolling window. Neither should be interpreted as the selected period's sale total.

### F8 — Display and export precision is lost — medium priority, reproduced

- 29 seconds and 52 seconds each display as `0.0 hrs` / `0.0h`.
- Annual premium $701.40 displays as $701; cents are discarded in the CSV too.
- CSV duration is rounded to whole minutes, so 29 seconds exports as zero minutes.
- CSV joins fields with commas without escaping. An agent name containing a comma shifts columns; quotes/newlines are also not handled correctly.

Numeric ranking itself uses the underlying values; no corruption of the aggregate numeric values was found here. Use a shared precise duration/premium formatter and a real CSV encoder.

### F9 — “Talk Time” cannot yet be certified as exact provider talk duration — medium priority, deployed-source risk

The organization/Reports arithmetic sums the same nonnegative `calls.duration` and agrees. However, the deployed voice-status handler falls back to elapsed time since `started_at` when a completed callback has no duration. Its monotonic helper then refuses any smaller later duration. For example, an elapsed estimate of 120 seconds cannot be corrected to a later provider value of 90 seconds. A focused source reproduction confirms that behavior.

This can retain an estimate containing setup/ringing time. The database does not retain enough provenance in this audit to identify which durations came from that fallback. **No production inflation amount is asserted.** Provider call records/status events are required before repairing talk time or claiming it is human conversation time. Do not rewrite telephony duration from browser timers or recording length.

## Other confirmed defects with limited current exposure

### Group leaderboard

The live group RPC counts clients as policies, includes every call direction, uses the caller organization's timezone and a different roster rule (excluding Super Admin). It has no shared explicit end bound with the browser supplemental premium reads. Premium and seven-day counts are browser-side follow-ups with RLS/row-limit exposure. These sources can disagree with both the organization leaderboard and one another.

**This agency has no group membership**, so Group cannot explain the current organization view. It still needs correction before it can be certified as an equivalent reporting mode. Do not broaden peer access to clients.

### Unused agent scorecard

`AgentScorecardModal.tsx` has no importer in `src`. It contains an extra day in weekly bounds, overlapping weeks, `started_at` instead of canonical call `created_at`, all-direction raw calls, incomplete appointment setter fallback, monthly premium, error-to-zero handling, and unstable Date dependencies that can repeat reads. Goal-progress calculations also use mismatched denominators. It is defective code, but **not a cause of the currently displayed leaderboard**. Keep it inactive until replaced or repaired.

## Reconciled raw-record totals

Frozen end: **October 3, 2026, 9:56:52 PM Pacific** (`2026-10-04T04:56:52.764028Z`). Half-open windows begin at Pacific midnight October 3, Monday September 28, and October 1. Counts below are current source totals, not deduplicated/certified business totals.

| Period | Outbound call rows | Contacted calls | Appointment rows created | Duration seconds | Exact duration | Win events | Annual win premium |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| Today | 11 | 0 | 3 | 81 | 1m 21s | 0 | $0.00 |
| This Week | 2,148 | 182 | 24 | 38,509 | 10h 41m 49s | 0 | $0.00 |
| This Month | 1,263 | 98 | 15 | 19,662 | 5h 27m 42s | 0 | $0.00 |

Reports' live private call-facts helper returned the same calls and duration, with no join-induced duplicate rows for these windows. Contacted follows configured disposition flags or duration over 45 seconds, with system No Answer excluded. The leaderboard has no Contacted metric. There are zero converting people in these windows under the Reports disposition definition; that is distinct from the two manually recorded policies.

All weekly outbound rows belong to active same-organization profiles. There is no current active-roster loss in these totals. September's normalized book has four dated policies/$3,205.32 annual premium; the current event log has two September wins/$2,004.24. **October genuinely has no newly recorded policy in the inspected book.** Repairing September sales must not fabricate October sales.

## What was verified successfully

- Live organization arithmetic, active roster attribution, half-open filtering and premium snapshot behavior match the current documented contract.
- The two new atomic sale writers and their private helpers are installed. Snapshot zero does not inherit another policy's premium; conversion retry keys are retained.
- Anonymous execution is denied on organization/group leaderboard, Reports summary and profile book functions. Authenticated execution is available with the existing internal scope checks. No ACL or RLS change is proposed as an accuracy shortcut.
- Current call-facts joins have no duplicate disposition labels or cross-organization disposition UUID references. Legacy calls without disposition UUID use the intended name fallback.
- Main leaderboard error/stale states, scope masking, period/metric switches, request gating, hidden/offline behavior, TV rendering, Dashboard leaderboard behavior and sale recording pass the existing focused suites.

## Test evidence and limits

**340 existing tests passed across 21 files**, using current-main source and America/Los_Angeles. Selection covered standings/gates/status/TV, Dashboard leaderboard and appointment goals, Reports contracts/queries/export/policy sources, normalized policies, manual/conversion sale recording, floating dispositions, and voice duration/terminal guards.

An isolated diagnostic suite reproduced six failing correctness expectations in current code: short-duration precision, premium cents, viewer-dependent legacy premium, CSV cents, CSV quoting, and correction of an oversized elapsed duration estimate. These are intentionally marked expected failures to document existing defects, **not evidence that fixes are implemented**. Two controls passed: immutable-zero snapshot handling and frozen-time local-day boundaries. The initial seven-case suite also ran in New York and UTC; the eighth duration-provenance case was added and run in Pacific time.

No application files were modified. No new build/typecheck was necessary for this read-only source/data audit. Provider API reconciliation, true production Agent/Admin browser comparisons, and production policy-write smoke tests remain unverified. The sign-in failure is a concrete browser limitation, not evidence that the public site or user sessions are down.

Live definition fingerprints: organization leaderboard `ad7a611db564d737d1dc50a7622f3500`; Group `8bd49ee01e0b92abd3e66548569f36bb`; Reports call summary `ad6f05fdcb2c08823625bd42ff1f961d`; policy facts `6d418bd7de99ff6690c6afca1add651c`.

## Corrective scope and order

1. **Define and enforce one policy-to-sale lifecycle.** Every new primary/additional policy gets exactly one durable sale identity and seller credit. Require valid sale facts rather than silently turning off checked sale intent. Separate edits from new policies. Remove disposition-only phantom wins. Preserve atomic conversion, retries and immutable premium snapshots.
2. **Prepare bounded historical manifests.** Repair the two missing policy events using reviewed attribution/date treatment. Reconcile the five provider-ID duplicate pairs, missing-ID attempts, and appointment duplicate clusters before deciding deletions or reporting exclusions. Keep all original history and avoid customer/workflow side effects. Do not bulk “clean” 260 calls or 89 appointments.
3. **Unify reporting contracts.** Use secured server aggregates for all agency performance surfaces and legacy premium resolution. Distinguish current book, sold policies, seller credit and appointment workload. Choose and label agency date boundaries and sale-date/event-date semantics explicitly. Keep monthly premium goals labeled monthly. Replace error-to-zero and unbounded raw aggregates.
4. **Fix precision, export, and stale presentation.** Shared duration and annual-currency formatting, correct CSV quoting/precision, explicit period/timezone/source labels where needed. Preserve the existing request gate, advisory lock, backoff, 30-second visible/online polling, avatar cache, and truthful unavailable states.
5. **Close end-to-end verification.** Verify real Admin and Agent sessions, all period/metric combinations and Group's permitted roles; compare UI/export/aggregate with identical frozen windows. Verify primary/additional policy creation and retries in an isolated environment, then an explicitly authorized production workflow. Reconcile provider duration provenance before claiming exact talk time.

The earlier two-fix implementation plan is **insufficient as a full reporting release plan**. This audit expands its evidence and scope; it does not authorize unrelated code changes or production repair. A complete implementation plan should preserve the exact findings, manifests, safety boundaries and unresolved measurement limits above.
