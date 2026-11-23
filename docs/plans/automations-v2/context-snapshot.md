# Automations V2 context snapshot

**November 22–23, 2026.** Branch `claude/cool-maxwell-15hyq7`, targeting `feat/self-service-automations` (PR #534's head `d85434f635bbf2d4118781e6d254798eef699363`, with main's `83a0ed509be89274d18b229239a3112de0a5dbf6` merged in as `0e49940`).

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
| CRM | Contact tasks show a real due time for timed tasks. Inbounds lists claimable callbacks with Claim, Release and Done. Each policy has Confirm issuance. No screen dials automatically. |

## Decisions made during the build

1. **Re-entry identity is a scope, not always the contact.** The contact for lead, campaign and disposition triggers; the appointment slot, the appointment outcome, the call or the policy for the others. Two policies on one client each get their own follow-up.
2. **Message steps deliver to leads only.** For a client, a recruit or an unmatched caller the step is skipped and the run continues. Tasks and callbacks work for every contact type.
3. **Tasks and callbacks are not behind the message delivery switch, but they are behind enrollment.** They are created while an agency is enrolling and the automation is active. Turning enrollment off holds task steps already under way.
4. **A task goes to the contact's current active assigned agent, for every trigger.** A known caller who rings another agent's direct line still gets a task for their own agent. With no active owner the step holds with a visible reason (a missed call becomes an Inbounds callback instead). A converted or removed contact stops the run. A repeated trigger does not stack a second open task on the same agent; a task left with a former agent does not hold back the current agent's.
5. **A reschedule before any reminder went out moves the waiting run. After a reminder went out, the automation starts again for the new time when every reminder it gave would still be ahead for that time,** so the new time gets every reminder. Only admitting the new time restarts it, ending the old run in the same statement. Until then the worker leaves the old run alone, so it never acts on the old time. If a restart would lose reminders (a move into the first reminder's window) or the admission is refused, the run keeps its place and its next reminder moves to the new time. A cancellation or deletion stops the run. Taking a cancellation back lets every run that cancellation stopped carry on, and a plain wait keeps the time it had served. A slot a run already reminded for is never handled twice. A reminder whose time has passed is skipped unless the author chose to continue.
6. **A missed inbound call waits one minute before enrolling,** so late answer evidence can arrive. A confirmed answer stops the run. A phone that accepted the call holds the step only until its bridge result is recorded, or for ten minutes after the call ended; a recorded "unconfirmed" result leaves the call missed, as Inbounds shows it. There is at most one callback per call, claiming is one conditional update, and a callback whose call was later proven answered cannot be claimed. A person viewing as someone else cannot claim.
7. **Only an explicit Confirm issuance starts delivery follow-up.** A sale, an effective date or a legacy issue date never does. A confirmation is permanent: there is no edit or undo yet.
8. **A stale save, publish or session change answers HTTP 409 (`PT409`).** The first release raised SQLSTATE 40001, which PostgREST retries without limit, so the request never answered. V2 replaces those three functions.
9. **The save gate is strict.** Malformed step details or unknown settings refuse the save instead of being stored and reported later.
10. **One guarded rollback file covers the seven migrations,** because they are released together. The implementation plan had listed one per migration.
11. **The first release stays usable on the V2 database.** Its editor opens V2 drafts for inspection only and cannot overwrite them.
12. **A hold retries less often the longer it lasts and ends after seven days.** The first retry is five minutes out, then half the time held so far, at most six hours. The run then stops with the reason it was held.
13. **Republishing an unchanged graph creates a version when an SMS step would now be pinned differently,** so review and publish always agree.
14. **A super admin session the server cannot verify cannot claim callbacks or confirm issuance.** A sign-in from before the Automations upgrade keeps View As in the browser only, so it must sign in again.
15. **The rollback never drops a trigger.** On Supabase that also locks every sign-in and storage table. It turns the six observers into no-ops instead.
16. **The rollback decides once per version, from stored data only.** It never re-reads a saved message, it holds the locks on runs and workflows only for the moment before it commits, and it stops itself on a refusal even when psql's flags are left out.

## Migrations prepared, none executed

| File | Content |
| --- | --- |
| `20261122100000_automation_v2_authoring.sql` | Step catalog, step details, field validation, saved messages, SMS requirement pinning, publish, overlap, `PT409`. |
| `20261122100100_automation_v2_events.sql` | Typed and optional contacts, event facts, re-entry scope, disposition and sale observers, appointment state and waits, stop rules, admission. |
| `20261122100200_automation_v2_tasks.sql` | `tasks.all_day`, `tasks.automation_run_id`, the provenance guard, task receipts. |
| `20261122100300_automation_v2_appointment_timing.sql` | Appointment booking, reschedule, removal and outcome observers. |
| `20261122100400_automation_v2_inbound_callbacks.sql` | `public.inbound_callbacks`, the missed-call observer, answer evidence, the four callback functions. |
| `20261122100500_automation_v2_policy_issuance.sql` | `public.policy_issuance_confirmations`, `confirm_policy_issuance`, the issuance observer. |
| `20261122100600_automation_v2_runtime.sql` | Claim, finish, `automation_create_task`, message time zone, activity, stop. |
| `rollback/20261122100600_automation_v2.rollback.sql` | The guarded, data-preserving inverse of all seven. |

The four applied first-release files are unchanged. No existing table's row-level security policy changes. The two new public tables and their access rules are listed for approval in the [release plan](release-plan.md).

## Independent review

On November 22–23 nine independent reviewers, one per area, read the change and tried to break it on the scratch databases. Eight reported 42 findings (12 major, 30 minor). The ninth, requirement and documentation coverage, and the separate refutation pass were stopped by a usage limit, so every finding was reproduced again before it was fixed. Each fix has a SQL, Deno or Vitest case that fails on the previous code and passes now.

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

A second check of the regenerated screenshots confirmed 8 of 10 claims and refuted 2. Fixed: Automation activity wrote times in the browser's own format, with seconds and no time zone, and now uses the agency's date and time format; Step details sat 8 px inside the rest of the step settings; and a run rule's label that wraps to two lines had no line spacing. The canvas, list, message editor, publish review and phone timeline were cut at the bottom of the window, so the editor checks now capture them as whole pages. One finding is inherited and listed below.

A third check confirmed 4 claims, all minor. The publish review's Publish version button sat flush against the bottom of the page, so the editor now has bottom padding of its own. Two whole-page captures had been taken with the window scrolled 4 px, which draws the fixed sidebar and header low, and the backend-first editor capture predated the run rule fix. The harness now scrolls to the top before a whole-page capture, and every capture was taken again.

Accepted as they are, and stated here so they are not mistaken for fixed:

- An automation task assigned to an agent who later leaves can be completed only by that agent. Opening tasks to anyone else would change the existing `public.tasks` row-level policies, which needs `#APPROVE_RLS_CHANGE`. The contact's new agent now gets their own task.
- The worker's queue is shared by every agency and has no per-agency share. Backoff and the seven-day end bound how much a held backlog costs.
- A task already created for a known caller is left open if proof that the call was answered arrives later. A callback in the same situation drops off the list and cannot be claimed.
- While a save is in flight, under a second, leaving is not held. While a step is open, a problem only the server can see is hidden if the browser reports another problem for that step.
- Two callbacks from the same number have buttons with the same accessible name. A permission refusal (42501) that signing in again does not fix still reads "You cannot change this callback."
- On a window about 1000 px tall the editor's workspace ends below the window once the save notice and the status card are shown, so the canvas zoom controls need a short page scroll. The workspace height does not yet allow for those two panels.
- A cancelled appointment moved to a new time starts no reminders. If it is later reopened without being moved again, it still gets none, because no booking for its new slot is recorded.
- The rollback restores the first-release functions byte for byte. Afterwards a stale save, publish or session change again never answers (SQLSTATE 40001), and a held step retries every five minutes without an end. The release plan says to turn the worker schedule off after a database rollback.

## Verification

All runs were local, on November 23, 2026, except the GitHub Actions row. The builder and backend-first modes ran at `d40f552`, the final code, and the release mode at `d6be5cc`. Commits after `d6be5cc` change only Automation activity's time format, three styling details and how the harness takes screenshots. All 14 SQL suites passed inside those runs. Both typechecks, the build, lint on the changed files and the Vitest suites for workflows, settings and contacts ran again at `d40f552`; the Automations Deno tests and the Vitest suites for Inbounds and `src/lib` last ran at `d6be5cc`. The full Vitest suite and the SMS Deno tests last ran locally at `28394a2`; GitHub Actions runs the full suite against the base on every push, and the pull request shows the final head's results. Each fix from the four review passes also has its own case that fails on the earlier code. Of the screenshot review's fixes, the switch labels and the callbacks list have one; the others are shown in the screenshots.

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Pass at `d40f552`. |
| App TypeScript, `A2P_BASE_SHA=d85434f635bbf2d4118781e6d254798eef699363 node scripts/verify-a2p-types.mjs` | 78 diagnostics on the base and on the candidate at `d40f552`. Zero new. |
| `npm run build` | Pass at `d40f552`. |
| `npx eslint` on the 89 frontend files this branch added or changed | 0 errors, 3 warnings (two effect-cleanup ref warnings, one fast-refresh warning on the shared badge). The 13 files the screenshot reviews changed: 0 errors, and only the effect-cleanup warning `AutomationActivity.tsx` already had. |
| `npx vitest run` at `28394a2` | 7,410 tests passed, 40 skipped, 1 failed. 504 files passed, 4 skipped, 9 failed. All nine failures exist on the base and are listed below. |
| Vitest for workflows, Inbounds, contacts and `src/lib` at `d6be5cc`; for workflows, settings and contacts at `d40f552` | 3,711 tests passed, 16 skipped; then 868 passed, 5 skipped. The only failing files are among the nine inherited ones below. |
| Deno: `_shared/automations/` and three `_shared/sms/` files | 67 passed, 0 failed (38 Automations, 29 SMS) at `28394a2`. The 38 Automations tests pass again at `d6be5cc`. |
| Native SQL on PostgreSQL 17.6 | All 14 `supabase/tests/automation_*.sql` suites pass inside the harness modes: six first-release, five V2, the rollback rehearsal, the upgrade and intake eligibility. |
| `concurrency.py`, `concurrency_v2.py` | Pass. One winner of two simultaneous callback claims, one task from a twice-delivered step, one callback for a call two automations reached together, and an appointment saved in 0.3 s while a publish lock was held. |
| `bash e2e/automations-local/run.sh` | Pass in 396 s at `d40f552`, including the CRM screen check and Insert field by touch. |
| `bash e2e/automations-local/run.sh release` | Pass in 135 s at `d6be5cc`, including the rollback rehearsal run without psql's flags. |
| `bash e2e/automations-local/run.sh backend-first` | Pass in 126 s at `d40f552`. |
| Rollback at scale | With 100,000 unfinished runs the final file took about 1 second: 879 ms for the data phase, then 2 ms to create the guards, which is all the time the locks on runs and workflows are held before the commit. |
| Browser | 1440 px and 375 px, light and dark: the builder with keyboard authoring and Insert field by touch, and the changed CRM screens. Screenshots are taken fully drawn at twice the pixel density. The only request that tried to leave the machine was the app's Google Fonts stylesheet, which the harness blocked. Zero provider requests. |
| GitHub Actions at `9b6db95`, before the screenshot review's fixes | All 18 jobs passed, including Reports frontend verification, which runs both typechecks and the full Vitest suite on the base and on this branch and found no new failing test or diagnostic. Supabase Preview was skipped. The pull request shows the results for the final head. |

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
| The five workflows through normal entry points | `v2-workflows.mjs` and the task, appointment, inbound and policy SQL suites |
| Duplicate events | `automation_v2_tasks.sql`, `automation_v2_inbound.sql`, `concurrency_v2.py` |
| Reschedule and cancel races | `automation_v2_appointments.sql`, `v2-workflows.mjs` |
| Concurrent inbound claims | `concurrency_v2.py`, `v2-workflows.mjs` |
| Two policies on one client | `automation_v2_policies.sql`, `v2-workflows.mjs` |
| Missing sender or consent evidence | `automation_intake_eligibility.sql`, `channel_test.ts`, `v2-workflows.mjs` |
| The first release keeps working on the V2 database, and the rollback | `run.sh backend-first`, `rollback-rehearsal.sh`, `automation_v2_rollback.sql` |
| The changed CRM screens in a real browser: a timed automation task, Confirm issuance and the Inbounds callback list | `v2-crm.mjs`, `tasksPanel.test.tsx`, `policyIssuance.test.tsx`, `roomCallbacks.test.tsx` |
| Insert field by touch | `v2-editor.mjs` (a touch session at 375 px), `insertFieldHook.test.tsx` |

### Failures that exist on the base branch

These fail identically on `0e49940` and were not touched.

- Eight Vitest suites cannot load without a Supabase URL: `addLeadAssignmentGate`, `dialerCampaignPresenceHook`, `contactName`, `contactScope`, `leadDisposition`, `userLocalDayBounds`, `runtimeEventLogger`, `custom-fields-settings`.
- One Vitest assertion: `recordingRetentionVoicemail > handler wiring > byte-identical to deployed v29`.
- `supabase/functions/_shared/sms/affinity.test.ts` needs its own loopback gateway and was not run. No file under `_shared/sms/` changed.
- The screenshot review found three things this branch does not change. The shared Switch draws its off state with the divider colour, about 1.2:1 on a card; the standard lists the stronger control outline as a pending shared-theme refinement, and Run rules uses that Switch. In dark theme the shared destructive colour makes the contact screen's "Delete Lead" link about 1.8:1. The contact screen's closing-appointment lines take the client's primary carrier and policy type for every policy (`get_policy_appointment_links`), so a client with two policies shows two identical lines. On a contact opened at `/leads/:id` or `/clients/:id` the breadcrumb reads "Page" and no sidebar item is marked active, because the page titles and the sidebar match `/contacts` only.
- The harness prints `workflow_on_lead_created dispatch failed … http_request_queue` warnings from the legacy dispatcher, which has no URL configured in the fixture.
- The contact screen is a fixed desktop layout anchored to the right edge everywhere it is used, and V2 does not change it. At 375 px its right column, with the Tasks tab, stays on screen, but the left column with the policies is pushed off the left edge, so Confirm issuance cannot be reached on a phone. `v2-crm.mjs` checks the task row at both widths and the issuance dialog itself at phone width.

### Limits of this verification

- The fixture replays 105 of the 122 earlier migrations. The complete current production schema was not rehearsed. Left out because they need production-only preimages, organization data or release gates: `20261008024220`, `20261008033044`, `20261008035004`, `20261019013824`, `20261019015242`, `20261019032157`, `20261020171244`, `20261023232435`, `20261024045812`, `20261105120016`, `20261105120020`, `20261105120021`, `20261105120022`, `20261105120032`, `20261105120033`, `20261105120043`, `20261105120044`.
- Every provider is an in-memory transport. No real Twilio, Resend, Gmail or Vercel request was made, and no managed migration runner was used.
- GitHub Actions has no workflow for the Automations harness. These results are from local runs.

## Deployment status

| Target | State |
| --- | --- |
| Supabase `jncvvsvckxhqgqvkppmj` | Unchanged. Ledger 395 entries ending `20261122001044`, read on November 22. |
| Vercel `agentflow` | Unchanged. Not read for this work. Last recorded frontend `666387b06236281a1e61b1d0fc765284bc63cd99`. |
| Edge functions | Unchanged. `workflow-resume-paused` is version 44, last updated May 22, 2026. The Automations worker code was first written on November 21, so that version cannot contain it. `automation-provider-receipt` does not exist. |
| Release controls | Unchanged. One agency sees the builder. Zero enrolling, zero delivering. |

## Blockers

- Each production step needs Chris's exact approval: the seven migrations and the two new tables' access rules, the frontend, and later the worker, its schedule, the receipt endpoint, enrollment and message delivery.
- Execution also needs a verified email sender, recipient eligibility evidence and an owned schedule. They are listed in the [release plan](release-plan.md#live-dependencies-each-needing-its-own-approval).

## Next steps

1. Review the draft pull request.
2. Decide whether a full production-schema rehearsal is required before the migrations, or waived as it was for the first release.
3. Approve the release window and the exact migration and frontend SHAs, or ask for changes.
4. Decide later, separately, on the worker, schedule, receipts, enrollment and delivery.
