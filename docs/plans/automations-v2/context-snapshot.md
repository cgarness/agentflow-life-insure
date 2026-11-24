# Automations V2 context snapshot

**November 22–24, 2026.** Branch `claude/cool-maxwell-15hyq7`, targeting `feat/self-service-automations` (PR #534's head `d85434f635bbf2d4118781e6d254798eef699363`, with main's `83a0ed509be89274d18b229239a3112de0a5dbf6` merged in as `0e49940`). On November 24 the released contact work (`2128bb641afecae1bf45e6a3ce9b3e8b2e04b15b`, which both primary domains serve, and its release record `d4bf96e`) was merged in as `5faa6ac`; `TwilioContext.tsx` is byte-identical to it.

**Nothing is released.** No production migration, Edge function, Vercel deployment, release control or schedule was changed. Production was read only. Enrollment and message delivery stay off for every agency. The branch is excluded from Vercel deployments in `vercel.json`.

[Draft pull request 536](https://github.com/cgarness/agentflow-life-insure/pull/536) · [Release and rollback plan](release-plan.md) · [Screenshots and run evidence](evidence/) · [Implementation plan entry](../../../implementation_plan.md)

## What changed

| Area | Change |
| --- | --- |
| Builder | One Create automation button opens a blank unsaved canvas. Desktop has Canvas and List views with the selected step's settings on the right. Phones have a timeline and a settings sheet. Cards show a category icon and a readable summary. The add-step picker is searchable, grouped, and offers only valid choices. |
| Saving | Three separate actions with separate results: Save draft, Save & review, Publish version. The editor shows saved or unsaved state, and the agency's switches, Agency enrollment and Agency message delivery, as On, Off or Unknown. |
| Message editor | A direct Message box (and Subject for email). Use saved message fills the fields, asks before replacing wording and never changes the saved message. Insert field sits beside every personalizable input and inserts at the cursor by mouse, keyboard or touch. |
| SMS consent | The author no longer chooses a purpose. At publish the server pins one per SMS step: an unchanged agency saved message keeps its recorded purpose, any other wording requires marketing consent. The worker enforces the pinned requirement at handoff. Versions published before V2 keep their stored purpose. |
| Step details | Every step takes an optional name (80 characters) and description (500), stored beside the step's settings. Step IDs never change. A run shows the name from the version it executed. |
| Workflows | Six new triggers (disposition saved, appointment booked, appointment outcome recorded, inbound call missed, sale recorded, policy issuance confirmed), a Create task action and a Wait until before appointment step. Together they build the five workflows: new lead callback, no-answer follow-up, appointment reminders and no-show recovery, missed inbound callback, policy follow-through. |
| CRM | Contact tasks show a real due time for timed tasks. Inbounds lists claimable callbacks with Claim, Release and Done. Each policy has Confirm issuance, reachable on a phone. Issuance and callbacks are for the pilot agency only. No screen dials automatically. |
| November 24 round | Task deadlines count from the event. Callbacks and tasks only for calls nobody answered, and closed when an answer is confirmed late. Reminders resume once after cancel, move while cancelled and reopen. Lead-only messages shown in the preview. Confirm issuance tapped through on a 375 px phone for the pilot; every other agency's contact screen unchanged. One save message on the phone builder. A rehearsed recovery for an installation that stops part way. |

## Decisions made during the build

1. **Re-entry identity is a scope, not always the contact.** The contact for lead, campaign and disposition triggers; the appointment slot, the appointment outcome, the call or the policy for the others. Two policies on one client each get their own follow-up.
2. **Message steps deliver to leads only.** For a client, a recruit or an unmatched caller the step is skipped and the run continues. The builder preview has a Test contact choice that shows the skip, and the publish review says it. Tasks and callbacks work for every contact type.
3. **Tasks and callbacks are not behind the message delivery switch, but they are behind enrollment.** They are created while an agency is enrolling and the automation is active. Turning enrollment off holds task steps already under way.
4. **A task goes to the contact's current active assigned agent, for every trigger.** A known caller who rings another agent's direct line still gets a task for their own agent. With no active owner the step holds with a visible reason (a missed call becomes an Inbounds callback instead). A converted or removed contact stops the run. A repeated trigger does not stack a second open task on the same agent; a task left with a former agent does not hold back the current agent's.
5. **A reschedule before any reminder went out moves the waiting run. After a reminder went out, the automation starts again for the new time when every reminder it gave would still be ahead for that time,** so the new time gets every reminder. Only admitting the new time restarts it, ending the old run in the same statement. Until then the worker leaves the old run alone, so it never acts on the old time. If a restart would lose reminders (a move into the first reminder's window) or the admission is refused, the run keeps its place and its next reminder moves to the new time. A cancellation or deletion stops the run. When the appointment stands again at a time still to come (a cancellation taken back, restated, or an appointment moved while cancelled and then reopened), the latest run a cancellation stopped carries on exactly once, under admission's locks; if its reminders were for the old time it starts over through admission, as for a move of an appointment that stood. A verified reply in between keeps a stop-on-reply run ended. A plain wait keeps its end, or ends on reopening when that end passed while cancelled. A slot a run already reminded for is never handled twice. A reminder whose time has passed is skipped unless the author chose to continue.
6. **Callbacks and tasks only for calls nobody answered.** A missed inbound call waits one minute before enrolling, so late answer evidence can arrive. Work is made only when nobody claimed the call on a computer, no forward was answered and the agent's phone never connected. An accepted phone leg with no bridge result, an unconfirmed bridge, or records that disagree hold the step with a plain reason and never turn into a missed call by waiting. An answer confirmed later dismisses the shared callback and closes the run's still-open automated task with a note, including one being created at that moment (task creation holds a share lock on the call row, which every answer writer needs). There is at most one callback per call, claiming is one conditional update, and a callback whose call was later proven answered cannot be claimed. A person viewing as someone else cannot claim. The list shows up to 100 of the viewer's own claims, open callbacks and other agents' claims each, with server counts.
7. **Only an explicit Confirm issuance starts delivery follow-up.** A sale, an effective date or a legacy issue date never does. A confirmation is permanent: there is no edit or undo yet.
8. **A stale save, publish or session change answers HTTP 409 (`PT409`).** The first release raised SQLSTATE 40001, which PostgREST retries without limit, so the request never answered. V2 replaces those three functions.
9. **The save gate is strict.** Malformed step details or unknown settings refuse the save instead of being stored and reported later.
10. **One guarded rollback file covers the seven migrations,** because they are released together, and a second backs out an installation that stopped part way. The implementation plan had listed one per migration.
11. **The first release stays usable on the V2 database.** Its editor opens V2 drafts for inspection only and cannot overwrite them.
12. **A hold retries less often the longer it lasts and ends after seven days.** The first retry is five minutes out, then half the time held so far, at most six hours. The run then stops with the reason it was held.
13. **Republishing an unchanged graph creates a version when an SMS step would now be pinned differently,** so review and publish always agree.
14. **A super admin session the server cannot verify cannot claim callbacks or confirm issuance.** A sign-in from before the Automations upgrade keeps View As in the browser only, so it must sign in again.
15. **The rollback never drops a trigger.** On Supabase that also locks every sign-in and storage table. It turns the eight observers into no-ops instead.
16. **The rollback decides once per version, from stored data only.** It never re-reads a saved message, it holds the locks on runs and workflows only for the moment before it commits, and it stops itself on a refusal even when psql's flags are left out.
17. **A task is due from the event, not from when the worker got to it** (`automation_runs.paced_from`): the event for a step with no wait before it, then the end each wait was given, never earlier than a reopening. A late worker, a hold or a replay never moves a deadline.
18. **Issuance confirmation, the callback list and the phone contact pan are pilot-only,** on the same flag as the builder, in the server and the browser. Opening them wider is Chris's decision. Every other agency's contact screen is exactly as released.
19. **An installation that stops part way is resumed or backed out, never mixed.** The builder stays hidden during installation, the probe reports which files are in, the back-out records itself, and no V2 file installs over a back-out or a rollback.

## Migrations prepared, none executed

| File | Content |
| --- | --- |
| `20261124100000_automation_v2_authoring.sql` | Step catalog, step details, field validation, saved messages, SMS requirement pinning, publish, overlap, `PT409`. |
| `20261124100100_automation_v2_events.sql` | Typed and optional contacts, event facts, re-entry scope, `paced_from`, disposition and sale observers, appointment state and waits, stop rules, admission, and carrying runs on after a reopening. |
| `20261124100200_automation_v2_tasks.sql` | `tasks.all_day`, `tasks.automation_run_id`, the provenance guard, task receipts. |
| `20261124100300_automation_v2_appointment_timing.sql` | Appointment booking, reschedule, removal and outcome observers, and the reopening observer on the appointment change log. |
| `20261124100400_automation_v2_inbound_callbacks.sql` | `public.inbound_callbacks` (with `closed_reason`), the missed-call observer, `automation_inbound_evidence`, the late-answer observer and settlement, the pilot check and the four callback functions. |
| `20261124100500_automation_v2_policy_issuance.sql` | `public.policy_issuance_confirmations`, `confirm_policy_issuance`, `policy_issuance_available`, the pilot checks, the issuance observer. |
| `20261124100600_automation_v2_runtime.sql` | Claim, finish, `automation_create_task` (due from `paced_from`; holds on unsettled call evidence), message time zone, activity, stop. |
| `rollback/20261124100600_automation_v2.rollback.sql` | The guarded, data-preserving inverse of all seven. |
| `rollback/20261124100600_automation_v2_stopped_install.rollback.sql` | The guarded back-out of an installation that stopped after 1 to 6 files. |
| `supabase/ops/automation_v2_install_state.sql`, `supabase/ops/automation_v2_dependency_check.sql` | Read-only: which files are in (or a back-out or rollback), and the relations and functions V2 depends on. |

Each of the seven files starts with a guard that refuses to install over a rollback or a back-out.

The four applied first-release files are unchanged. No existing table's row-level security policy changes. The two new public tables and their access rules are listed for approval in the [release plan](release-plan.md).

## Independent review

On November 22–23 nine independent reviewers, one per area, read the change and tried to break it on the scratch databases. Eight reported 42 findings (12 major, 30 minor). The ninth, requirement and documentation coverage, and the separate refutation pass were stopped by a usage limit, so every finding was reproduced again before it was fixed. Each code fix has a SQL, Deno or Vitest case that fails on the previous code and passes now; findings in documents and code comments were corrected in the text.

| Area | Fixed |
| --- | --- |
| Authoring | Republishing an unchanged graph pins a changed SMS requirement. Fields are checked one field at a time. Outcome automations overlap only on a shared outcome. Step names use one explicit control-character set in the browser and the database, counted as characters. |
| Events and appointments | A reschedule after a reminder starts the automation again for the new time. Taking a cancellation back lets the reminder carry on. The booking a disposition save makes does not stop that save's own run. A repaired missed-call event keeps its one-minute settle. Re-entry and booking checks use indexes. |
| Tasks and worker contract | Turning enrollment off holds task steps. A task left with a former agent does not block the current agent's. Holds back off and end after seven days. A page of stopped runs no longer hides live work. A blank rendered title takes the step's name, the caller's number or the task type. SMS appointment reminders find the recipient's zone for an 11-digit phone. |
| Missed calls and issuance | A known caller's task goes to the contact's own agent. A recorded "unconfirmed" bridge is final and a missing one is waited for ten minutes. An answered call's callback cannot be claimed. An unverified super admin session cannot claim or confirm. |
| Rollback | No trigger is dropped (dropping one locked the sign-in tables). Refuses outside a transaction. Stops runs on the automations it pauses. Guards new runs and resumes on any version that needs V2, including a text republished without its pinned requirement. The release plan now covers worker handling, open callbacks and migration locks. |
| Builder | Reopening waits for the current record. Unsaved changes are protected on every way out. Save & review saves an incomplete draft and says so. Each problem shows once. Focus returns to a newly added step on phones. A failed background read no longer replaces an open editor (found while fixing the others). |
| CRM | Callback conflicts show the server's message. Callback buttons name the caller and only the pressed one shows as busy. The task list re-reads the clock and the tasks, and disables completion for anyone but the assignee or creator. Confirm issuance re-reads the status after a refusal and refuses dates before 1900. |

On November 23 a second pass tested those fixes. Four checkers reported 18 findings (3 major) and a skeptic for each area confirmed 15 and refuted 3. It also completed the requirement and documentation review. One refuted finding was fixed anyway. Moving an appointment into its first reminder's window after that reminder went out lost every remaining reminder. The skeptic read that as the restart rule working as written, but it defeats the rule's purpose. The missing touch test was also added, because the requirement names touch. The 40001 finding stays refuted: the rollback restores the first-release behaviour on purpose.

| Area | Fixed in the second pass |
| --- | --- |
| Appointments | A restart happens only when it gives the new time every reminder. Otherwise the run moves to the new time in place. The worker can no longer reach the old run first and cancel the restart. Taking back a cancellation keeps a plain wait's remaining time. An appointment change finds its runs through a new index. |
| Callbacks | Title and notes an automation rendered for a known contact are shown only to people who can see the contact. |
| Rollback | Judges each version once and holds the lock on runs only for the moment before it commits. Locally, 100,000 unfinished runs took about 1 second, where the earlier file held that lock for about 16 seconds. The decision reads only stored data, so editing a saved message later cannot stop an automation. A publish that loosens a text's consent requirement is refused with a reason that names it. A refusal stops psql even without its flags. |
| Builder and CRM | Refusals that signing in again fixes show the server's words. The preview names a missed call's blank task after the caller's number. Fields accept the longest allowed text even as emoji. The text-step hint says only an agency saved message keeps its consent type. |
| Verification and documents | The changed CRM screens and Insert field by touch are now checked in a real browser. Every result under Verification was produced again at the fixed code. The release plan says to turn the worker schedule off after a database rollback. Two wrong statements were corrected. |

A third pass, also on November 23, checked the second round of fixes. Three checkers reported 10 findings and a skeptic per area confirmed all 10 (5 major). Two came from second-pass fixes of mine: the worker-side restart could still act on the old time or end a run with no replacement, and doubling the browser limit on step details let a long paste make the whole draft refuse to save.

| Area | Fixed in the third pass |
| --- | --- |
| Appointments | The restart is one decision, made when the new time is admitted. The old run ends in the same statement as the new one starts, including a run still waiting to hear whether its last message was accepted. Until then the worker leaves a run whose appointment moved after it gave a reminder alone, so no step acts on the old time. If the admission is refused, the run keeps its place. An appointment change moves every waiting reminder to the new time. Taking back a cancellation revives every run that cancellation stopped, including one that moved with a reschedule. A new column, `private.automation_runs.reminded_for`, records which time a run's reminders were for. |
| Rollback | A text's requirement is compared with the most recent pin V2 made for the same step. When only a text's requirement stands in the way and the earlier editor can change the draft, the refusal says to choose Marketing and publish again. The header, the plan and the rules now say exactly which status and timing fields the file sets. |
| Builder | A step's name and description are cut to their limits, counted in characters, as they are typed or pasted. |
| Verification and documents | The task row is checked at 375 px too. On a phone the contact screen's Tasks column stays on screen; only the policies column is pushed off, the reverse of what the notes said. |

A fourth pass, also on November 23, checked the redesigned reschedule logic and the rollback guards. Two checkers reported 5 findings; a skeptic per area confirmed 4 (2 major) and refuted 1. One came from the third-pass redesign: taking back a cancellation missed a run when the cancellation had been restated, for example by retyping the appointment. The others: moving a cancelled appointment without reopening it started reminders for it (this predates the redesign); a refusal told an author to wait for V2 when publishing the current draft would fix the automation; and a V2 publish already under way when the rollback ran could still make a version that needs V2 current.

| Area | Fixed in the fourth pass |
| --- | --- |
| Appointments | Taking back a cancellation revives every run stopped by that cancellation or a restatement of it. A slot with no recorded outcome takes the appointment's own final status, so a cancelled appointment moved to a new time never starts reminders. |
| Rollback | A third guard, on `public.workflows`, refuses making a version that needs V2 current, even for a publish that started before the rollback. Each refusal says what the author can do now. |

A fifth check, on November 23, reviewed every committed screenshot against the design standard. Four inspectors read all 27 screenshots and a skeptic per group re-checked each claim, measuring colours in the image and reading the source. All 18 claims held, all minor. Five were capture artifacts in the harness, ten were in screens this branch adds or changes, and three are inherited and listed under [failures that exist on the base](#failures-that-exist-on-the-base-branch).

| Area | Fixed after the screenshot review |
| --- | --- |
| Builder | The status panel names its switches Agency enrollment and Agency message delivery, as the first release did. "Enrollment: On" beside a draft's "cannot enroll" line read as a contradiction. The Canvas/List toggle marks the open view with its own border and colour; the shared outline toggle used the hover fill. Publish review steps sit on bordered cards, so their consent badges keep their shape. The phone field's sample in Insert field is the stored number, as the field writes it. |
| CRM | A task's type is a shared info badge; the old tint measured 3.2:1. An Inbounds callback's state is a status badge, its row stacks left-aligned on a phone, and the card says it covers missed calls to any agency number, which the room's own activity does not count. |
| Harness | Screenshots are taken with the pointer resting off every control, so no button is captured in its hover colour. The keyboard check's dark captures were taken mid theme-switch and are now fully drawn at twice the density. The Inbounds capture centres the callbacks card. |

A second check of the regenerated screenshots, all but the two rollback rehearsal captures, confirmed 8 of 11 claims and refuted 3. Two were major: the phone timeline captures did not show the timeline. Fixed: Automation activity wrote times in the browser's own format, with seconds and no time zone, and now uses the agency's date and time format; Step details sat 8 px inside the rest of the step settings; and a run rule's label that wraps to two lines had no line spacing. The canvas, list, message editor, publish review and phone timeline were cut at the bottom of the window, so the editor checks now capture them as whole pages. One finding is inherited and listed below.

A third check confirmed 4 claims, all minor. The publish review's Publish version button sat flush against the bottom of the page, so the editor now has bottom padding of its own. Two whole-page captures had been taken with the window scrolled 4 px, which draws the fixed sidebar and header low, and the backend-first editor capture predated the run rule fix. The harness now scrolls to the top before a whole-page capture, and every capture was taken again.

On November 24 five reviewers, one per area of that day's fixes, tried to break them on scratch databases and replica pages, and a verifier re-checked every finding. All 17 findings were confirmed. Sixteen are fixed, each with a check that fails on the previous code; the seventeenth, the 768 to 1023 px contact-screen clipping, predates V2 and is listed for a decision.

| Area | Fixed on November 24 |
| --- | --- |
| Task deadlines | The Create task step said its due time counted from when the step runs; it now names the event or the end of the last wait. A run that carried on after a reopening dated its next task to a moment while the appointment was cancelled; it now counts from the reopening. |
| Missed calls | The open-first callback list could hide the viewer's own claim behind 100 open callbacks; it now takes up to 100 from each group. An answer committed while the task or callback was being made left it open; task creation now holds a share lock on the call row, which every answer writer needs, so the answer waits and then closes it. The Inbounds panel flashed for agencies outside the pilot while loading or after a failed read, and kept asking; it now appears only after a read says the agency has a list, and stops asking when told it has none. |
| Appointments | Cancel, move while cancelled and reopen carried the old run on in place, so a two-reminder automation lost the new time's first reminder, and the result depended on when the worker ran; such a run now starts over through admission. Carrying a run on was not ordered with admission, so two runs could follow one appointment; it now takes admission's locks. A verified reply while cancelled did not keep a stop-on-reply run ended; it does now. |
| Phone and pilot | The phone pan opened every agency's contact screen on the details column with Call and Schedule off screen; it is now pilot-only and opens on the old right-hand view. Column snapping never took effect and is gone. The browser check passed its phone task-row assertion only because Playwright panned the screen; it now checks what is on screen before any pan and drags with a finger. A pause, resume or archive made with unsaved edits was not reported; it is again. |
| Installation recovery | The probe reported a backed-out or rolled-back database as a resumable stopped installation; the back-out now records itself, the probe reports `backed_out` or `rolled_back` with no next file, and the files refuse to install over either. The back-out assumed the builder was hidden while the plan kept it visible; the plan now hides it for the installation. The release packet's checksums, grant count, ledger and counts were stale; they are regenerated. |

Accepted as they are, and stated here so they are not mistaken for fixed:

- An automation task assigned to an agent who later leaves can be completed only by that agent. Opening tasks to anyone else would change the existing `public.tasks` row-level policies, which needs `#APPROVE_RLS_CHANGE`. The contact's new agent now gets their own task.
- The worker's queue is shared by every agency and has no per-agency share. Backoff and the seven-day end bound how much a held backlog costs.
- While a save is in flight, under a second, leaving is not held. While a step is open, a problem only the server can see is hidden if the browser reports another problem for that step.
- Two callbacks from the same number have buttons with the same accessible name. A permission refusal (42501) that signing in again does not fix still reads "You cannot change this callback."
- On a window about 1000 px tall the editor's workspace ends below the window once the save notice and the status card are shown, so the canvas zoom controls need a short page scroll. The workspace height does not yet allow for those two panels.
- The rollback restores the first-release functions byte for byte. Afterwards a stale save, publish or session change again never answers (SQLSTATE 40001), and a held step retries every five minutes without an end. The release plan says to turn the worker schedule off after a database rollback.

## Verification

The November 24 results below are for the code at `7a027ee` and `b9bcde6` as marked. Two later commits change code: `345d773`, the callback list after it closes, and `a12f73a`, one harness check. Their results are in the row before GitHub Actions. The other later commits change documents and evidence only. Earlier rounds' results are in the git history of this file.

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Pass at `b9bcde6`. |
| App TypeScript, `A2P_BASE_SHA=d85434f635bbf2d4118781e6d254798eef699363 node scripts/verify-a2p-types.mjs` | 78 diagnostics on the base and on the candidate at `b9bcde6`. Zero new. |
| `npm run build` | Pass at `b9bcde6`. |
| `npx eslint` on the 17 frontend files changed this round | 0 errors, 1 warning that `useInboundCallbacks.ts` already had. |
| `npx vitest run` (full, at `7a027ee`) | 7,471 passed, 40 skipped, 1 failed. 507 files passed, 4 skipped, 9 failed; all nine failures exist on the base and are listed below. `b9bcde6` changed only the Create task wording, and its suite passes. |
| Deno: `_shared/automations/` | 39 passed, 0 failed. |
| Native SQL on PostgreSQL 17.6 | All 14 `supabase/tests/automation_*.sql` suites pass at `b9bcde6` inside the harness modes, plus `automation_install_stop.sql` at every stopping point. |
| `concurrency.py`, `concurrency_v2.py` | Pass at `b9bcde6`: one winner of two simultaneous callback claims; one task from a twice-delivered step; one callback for a call two automations reached together; an appointment saved in 0.3 s during a held publish lock; an answer committed while a missed call's task or callback was being made closed it; a reopening during the new time's admission left one run. The last two fail on the code before this round. |
| `bash e2e/automations-local/run.sh` (builder) | Pass in 379 s at `b9bcde6`: 19 checks, including the phone save measurement and the CRM screens on a 375 px touch phone for the pilot and an agency outside it. |
| `bash e2e/automations-local/run.sh install-stops` | Pass in 66 s at `b9bcde6`, for each stopping point after 0 to 6 files. |
| `bash e2e/automations-local/run.sh release` | Pass in 119 s at `b9bcde6`: twelve migrations in order in 2.2 s with unchanged legacy records, and the guarded rollback rehearsal. |
| `bash e2e/automations-local/run.sh backend-first` | Pass in 112 s at `b9bcde6`. |
| Rollback at scale | Measured November 23 with 100,000 unfinished runs: about 1 second in all. Not repeated this round. |
| Browser | 1440 px and 375 px, light and dark. The only request that tried to leave the machine was the app's Google Fonts stylesheet, which the harness blocked. Zero provider requests. |
| After the CI follow-up, at `a12f73a` | Full Vitest: 7,473 passed, 40 skipped, 1 failed (the same nine files as the base) and no unhandled error. Root and app TypeScript (78, as on the base), the build, and ESLint on the changed files (0 errors, the warning `useInboundCallbacks.ts` already had) pass. The builder harness passed in 456 s at about 07:00 UTC, in the hours when the phone count used to fail, and install-stops (78 s), release (146 s) and backend-first (120 s) passed after it. |
| GitHub Actions | At `ce843d0` (the code of `b9bcde6` plus a clearer failure message in `scripts/verify_reports_frontend.py`) and at `7e33280`: 25 jobs passed and Supabase Preview was skipped, including Reports frontend verification, which runs both typechecks and the full Vitest suite on the base and on this branch and found no new failing test, diagnostic or runtime error. At `7e33280` the UV profile browser job passed on its one re-run; its first run stopped while `apt` waited on the Ubuntu mirror during `playwright install --with-deps`, before any test. On `b9bcde6` the Reports check failed twice with "New unhandled runtime error": a race in the Dialer page that predates this branch, described under the failures that exist on the base. The pull request shows the results for the final head. |

### Where each required check lives

| Requirement | Verified by |
| --- | --- |
| Blank Create, then Back, writes nothing | `builder.mjs`, `v2-editor.mjs`, `mobile-keyboard.mjs` |
| Save draft, Save & review and Publish version have different results | `v2-editor.mjs` |
| Saved-message selection, editing, replacement protection, insertion at the cursor, email subject rendering | `v2-editor.mjs`, `insertFieldCursor.test.tsx`, `insertFieldHook.test.tsx`, `inspectorStepDetails.test.tsx` |
| SMS purpose enforcement | `automation_v2_authoring.sql`, `channel_test.ts`, the consent scenario in `v2-workflows.mjs` |
| Old and new graph round trips | `graph_test.ts`, `draftGraph.test.ts`, `automation_v2_authoring.sql`, `backend-first.mjs` |
| A run shows the step name of its own version | `v2-editor.mjs`, `automation_v2_tasks.sql` |
| Tenant isolation and role boundaries | A second agency and non-author roles in every V2 SQL suite, `v2-editor.mjs` |
| Concurrent edits | `v2-editor.mjs`, `session-tabs.mjs` |
| The five workflows through normal entry points | `v2-workflows.mjs` and the task, appointment, inbound and policy SQL suites. Workflow A runs on New lead created in the browser; its campaign-entry form (a lead added to a selected campaign gets a call task due in five minutes, and the same event replayed creates one task) is the last case in `automation_v2_tasks.sql` |
| Opening, editing and previewing enroll nobody and send nothing | `builder.mjs` (opening and leaving a blank canvas writes nothing; Preview made zero enrollments or handoffs), `v2-editor.mjs` (Preview starts no run) |
| Duplicate events | `automation_v2_tasks.sql`, `automation_v2_inbound.sql`, `concurrency_v2.py` |
| Reschedule and cancel races | `automation_v2_appointments.sql`, `v2-workflows.mjs` |
| Concurrent inbound claims | `concurrency_v2.py`, `v2-workflows.mjs` |
| Two policies on one client | `automation_v2_policies.sql`, `v2-workflows.mjs` |
| Missing sender or consent evidence | `automation_intake_eligibility.sql`, `channel_test.ts`, `v2-workflows.mjs` |
| The first release keeps working on the V2 database, and the rollback | `run.sh backend-first`, `rollback-rehearsal.sh`, `automation_v2_rollback.sql` |
| The changed CRM screens in a real browser: a timed automation task, Confirm issuance and the Inbounds callback list | `v2-crm.mjs`, `tasksPanel.test.tsx`, `policyIssuance.test.tsx`, `roomCallbacks.test.tsx` |
| Insert field by touch | `v2-editor.mjs` (a touch session at 375 px), `insertFieldHook.test.tsx` |
| Task deadlines from the event, delayed processing and replay, a task after an explicit Wait | `automation_v2_tasks.sql`, `taskDue.test.tsx` |
| Only genuinely unanswered calls; held unresolved or conflicting evidence; late answers for callbacks and open tasks | `automation_v2_inbound.sql`, `concurrency_v2.py` (an answer during task creation) |
| The callback list cannot hide open callbacks or the viewer's own claim | `automation_v2_inbound.sql` (test 14), `roomCallbacks.test.tsx` |
| Cancel, move while cancelled, reopen: reminders resume exactly once | `automation_v2_appointments.sql` (three processing orders, two reminders, a passed wait, a reply), `concurrency_v2.py` (a reopening during admission) |
| Lead-only messages shown in the preview; tasks for clients and recruits | `previewContacts.test.tsx`, `graph_test.ts`, `automation_v2_appointments.sql` |
| Confirm issuance tapped through on a 375 px touch phone; the pilot and an agency outside it | `v2-crm.mjs`, `automation_v2_policies.sql`, `usePolicyIssuanceAvailable.test.tsx` |
| One save message on the phone builder | `v2-editor.mjs`, `editorIssues.test.tsx` |
| An installation that stops after any of 0 to 6 files; the probe; refusals after a back-out or rollback | `install-stops.sh` with `automation_install_stop.sql` and `install-catalog.sql` (`run.sh install-stops`) |

### Failures that exist on the base branch

These fail identically on `0e49940` and were not touched.

- Eight Vitest suites cannot load without a Supabase URL: `addLeadAssignmentGate`, `dialerCampaignPresenceHook`, `contactName`, `contactScope`, `leadDisposition`, `userLocalDayBounds`, `runtimeEventLogger`, `custom-fields-settings`.
- One Vitest assertion: `recordingRetentionVoicemail > handler wiring > byte-identical to deployed v29`.
- An intermittent Vitest unhandled error, which the Reports check counts as new whenever this branch's run hits it and the base run does not. `src/pages/DialerPage.tsx` never clears its delayed stats refreshes (`window.setTimeout` of 3 s after a save in three places, and of 4 s after a hang-up) when the page unmounts. When `src/pages/__tests__/dialerAppointmentSave.test.tsx` finishes, one can fire after the jsdom environment is torn down and before the worker exits; the refresh's state update then throws `ReferenceError: window is not defined` (`DialerPage.tsx:1125`). Both files are identical on `main` `83a0ed5`, the base `d85434f` and production `2128bb6`. The base's own head failed the Reports check with the same message on November 22, and `b9bcde6` failed it twice. Of four full local runs on two cores with `--maxWorkers=2`, one recorded this error and nothing else, and a scratch environment that waits 4 s after the jsdom teardown records it every time (four errors, all 34 tests passing). A fix that tracks those timers, clears them on unmount and skips state updates once the page has closed removes it, and the five test files that render the Dialer pass (62 tests) with ESLint and the app typecheck unchanged. It changes the production Dialer page, so it is proposed as a separate change rather than made here.
- Two more sources of the same error, found by holding each test worker open after its jsdom teardown, as a loaded runner does. `TwilioContext.tsx` starts a 1 s call-duration interval when a call is dialing or accepted and clears it only when the call ends, so a provider unmounted mid-call leaves it running; after `twilioProviderLifecycle.test.tsx` and `teamOpenRevealIntegration.test.tsx` it can tick once `window` is gone and throw `ReferenceError: window is not defined` from `setCallDuration`. The floating dialer's delayed search does the same after `floatingDialerRecentStates.test.tsx`. Both are identical on the base, which recorded the same errors under the same hold. A four-line unmount cleanup in `TwilioContext.tsx` removes the first, as a scratch copy showed, but TwilioContext stays as released in this pull request, so both are listed for separate changes.
- `supabase/functions/_shared/sms/affinity.test.ts` needs its own loopback gateway and was not run. No file under `_shared/sms/` changed.
- The screenshot reviews found four things this branch does not change. The shared Switch draws its off state with the divider colour, about 1.2:1 on a card; the standard lists the stronger control outline as a pending shared-theme refinement, and Run rules uses that Switch. In dark theme the shared destructive colour makes the contact screen's "Delete Lead" link about 1.8:1. The contact screen's closing-appointment lines take the client's primary carrier and policy type for every policy (`get_policy_appointment_links`), so a client with two policies shows two identical lines. On a contact opened at `/leads/:id` or `/clients/:id` the breadcrumb reads "Page" and no sidebar item is marked active, because the page titles and the sidebar match `/contacts` only.
- The harness prints `workflow_on_lead_created dispatch failed … http_request_queue` warnings from the legacy dispatcher, which has no URL configured in the fixture.
- At 768 to 1023 px the contact screen clips Schedule and the conversation column (with the sidebar expanded, Schedule is fully visible from about 975 px). It is the same in production and unchanged here; fixing it would change every agency's contact screen, so it is listed for a decision. Below 768 px, agencies outside the pilot keep the production phone layout, in which the details and policies column is off screen.

### Limits of this verification

- The complete current production schema was not rehearsed: it needs the operator's schema-only archive bundle, which this session cannot produce (read-only SQL access, no database credentials). The [release plan](release-plan.md#the-complete-current-production-schema) lists what is needed and the dependency comparison made instead. The fixture replays 105 of the 122 earlier migrations. Left out because they need production-only preimages, organization data or release gates: `20261008024220`, `20261008033044`, `20261008035004`, `20261019013824`, `20261019015242`, `20261019032157`, `20261020171244`, `20261023232435`, `20261024045812`, `20261105120016`, `20261105120020`, `20261105120021`, `20261105120022`, `20261105120032`, `20261105120033`, `20261105120043`, `20261105120044`.
- Every provider is an in-memory transport. No real Twilio, Resend, Gmail or Vercel request was made, and no managed migration runner was used.
- GitHub Actions has no workflow for the Automations harness. These results are from local runs.

## Deployment status

| Target | State |
| --- | --- |
| Supabase `jncvvsvckxhqgqvkppmj` | Unchanged. Read on November 24: ledger 396 entries ending `20261123231917 contact_first_sms_sender`, no `automation_v2_…` entry, the 16 first-release functions matching the rollback fingerprints, PostgreSQL 17.6. |
| Vercel `agentflow` | Unchanged. Both primary domains serve `dpl_AZc2iNcS9XTY2nZ6p8hpqs3MeZ5Z` from `2128bb641afecae1bf45e6a3ce9b3e8b2e04b15b` (checked November 24 before the merge). |
| Edge functions | Unchanged. `workflow-resume-paused` is version 44 (May 22, 2026), without the Automations worker. `automation-provider-receipt` does not exist. |
| Release controls | Unchanged. One agency sees the builder, zero enrolling, zero delivering. |

## Blockers

- Each production step needs Chris's exact approval: the seven migrations and the two new tables' access rules, the frontend, and later the worker, its schedule, the receipt endpoint, enrollment and message delivery.
- A complete-schema rehearsal needs the operator's archive bundle.
- Execution also needs a verified email sender, recipient eligibility evidence and an owned schedule. They are listed in the [release plan](release-plan.md#live-dependencies-each-needing-its-own-approval).

## Next steps

1. Review the draft pull request.
2. Decide whether the complete-schema archive is required before the migrations, or the dependency comparison suffices as it did for the first release.
3. Decide separately whether issuance confirmation, the callback list or the phone contact pan should reach agencies outside the pilot.
4. Approve the release window and the exact migration and frontend SHAs, or ask for changes.
5. Decide later, separately, on the worker, schedule, receipts, enrollment and delivery.
