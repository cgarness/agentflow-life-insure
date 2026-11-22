# Automations V2 context snapshot

**November 22, 2026.** Branch `claude/cool-maxwell-15hyq7`, targeting `feat/self-service-automations` (PR #534's head `d85434f635bbf2d4118781e6d254798eef699363`, with main's `83a0ed509be89274d18b229239a3112de0a5dbf6` merged in as `0e49940`).

**Nothing is released.** No production migration, Edge function, Vercel deployment, release control or schedule was changed. Production was read only. Enrollment and message delivery stay off for every agency. The branch is excluded from Vercel deployments in `vercel.json`.

[Draft pull request 536](https://github.com/cgarness/agentflow-life-insure/pull/536) · [Release and rollback plan](release-plan.md) · [Screenshots and run evidence](evidence/) · [Implementation plan entry](../../../implementation_plan.md)

## What changed

| Area | Change |
| --- | --- |
| Builder | One Create automation button opens a blank unsaved canvas. Desktop has Canvas and List views with the selected step's settings on the right. Phones have a timeline and a settings sheet. Cards show a category icon and a readable summary. The add-step picker is searchable, grouped, and offers only valid choices. |
| Saving | Three separate actions with separate results: Save draft, Save & review, Publish version. The editor shows saved or unsaved state, and Enrollment and Message delivery as On, Off or Unknown. |
| Message editor | A direct Message box (and Subject for email). Use saved message fills the fields, asks before replacing wording and never changes the saved message. Insert field sits beside every personalizable input and inserts at the cursor by mouse, keyboard or touch. |
| SMS consent | The author no longer chooses a purpose. At publish the server pins one per SMS step: an unchanged agency saved message keeps its recorded purpose, any other wording requires marketing consent. The worker enforces the pinned requirement at handoff. Versions published before V2 keep their stored purpose. |
| Step details | Every step takes an optional name (80 characters) and description (500), stored beside the step's settings. Step IDs never change. A run shows the name from the version it executed. |
| Workflows | Six new triggers (disposition saved, appointment booked, appointment outcome recorded, inbound call missed, sale recorded, policy issuance confirmed), a Create task action and a Wait until before appointment step. Together they build the five workflows: new lead callback, no-answer follow-up, appointment reminders and no-show recovery, missed inbound callback, policy follow-through. |
| CRM | Contact tasks show a real due time for timed tasks. Inbounds lists claimable callbacks with Claim, Release and Done. Each policy has Confirm issuance. No screen dials automatically. |

## Decisions made during the build

1. **Re-entry identity is a scope, not always the contact.** The contact for lead, campaign and disposition triggers; the appointment slot, the appointment outcome, the call or the policy for the others. Two policies on one client each get their own follow-up.
2. **Message steps deliver to leads only.** For a client, a recruit or an unmatched caller the step is skipped and the run continues. Tasks and callbacks work for every contact type.
3. **Tasks and callbacks are not behind the message delivery switch.** They are created whenever an agency is enrolling and the automation is active.
4. **A task goes to the contact's current active assigned agent.** With no active owner the step holds with a visible reason. A converted or removed contact stops the run. An open task from the same step for the same scope is not duplicated.
5. **A reschedule moves the waiting run; it does not start a second one.** A cancellation or deletion stops it. A slot a run already waited for is never handled twice. A reminder whose time has passed is skipped unless the author chose to continue.
6. **A missed inbound call waits one minute before enrolling,** so late answer evidence can arrive. A confirmed answer stops the run, incomplete bridge evidence holds it, and there is at most one callback per call. Claiming is one conditional update. A person viewing as someone else cannot claim.
7. **Only an explicit Confirm issuance starts delivery follow-up.** A sale, an effective date or a legacy issue date never does. A confirmation is permanent: there is no edit or undo yet.
8. **A stale save, publish or session change answers HTTP 409 (`PT409`).** The first release raised SQLSTATE 40001, which PostgREST retries without limit, so the request never answered. V2 replaces those three functions.
9. **The save gate is strict.** Malformed step details or unknown settings refuse the save instead of being stored and reported later.
10. **One guarded rollback file covers the seven migrations,** because they are released together. The implementation plan had listed one per migration.
11. **The first release stays usable on the V2 database.** Its editor opens V2 drafts for inspection only and cannot overwrite them.

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

## Verification

All runs were local, on November 22, 2026. Commits made after the runs changed documentation and renamed one local helper that the lint rule mistook for a React hook. The 17 test files that read those documents, the builder tests, the app typecheck and the builder harness mode were run again afterwards.

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Pass. |
| App TypeScript, `A2P_BASE_SHA=d85434f635bbf2d4118781e6d254798eef699363 node scripts/verify-a2p-types.mjs` | 78 diagnostics on the base and on the candidate. Zero new. |
| `npm run build` | Pass. |
| `npx eslint` on every frontend file this branch added or changed | 0 errors, 3 warnings (two effect-cleanup ref warnings, one fast-refresh warning on the shared badge). |
| `npx vitest run` | 7,381 tests passed, 40 skipped, 1 failed. 502 files passed, 4 skipped, 9 failed. All nine failures exist on the base and are listed below. |
| Focused Vitest: builder, tasks, Inbounds callbacks, policy issuance | 19 files, 217 passed, 5 skipped. |
| Deno: `_shared/automations/` and three `_shared/sms/` files | 63 passed, 0 failed (34 Automations, 29 SMS). |
| Native SQL on PostgreSQL 17.6 | All 14 `supabase/tests/automation_*.sql` suites pass: six first-release, five V2, the rollback rehearsal, the upgrade and intake eligibility. |
| `concurrency.py`, `concurrency_v2.py` | Pass. One winner of two simultaneous callback claims, one task from a twice-delivered step, one callback for a call two automations reached together, and an appointment saved in 0.3 s while a publish lock was held. |
| `bash e2e/automations-local/run.sh` | Pass in 333 s. |
| `bash e2e/automations-local/run.sh release` | Pass in 155 s. |
| `bash e2e/automations-local/run.sh backend-first` | Pass in 143 s. |
| Browser | 1440 px and 375 px, light and dark, with keyboard authoring. The only request that tried to leave the machine was the app's Google Fonts stylesheet, which the harness blocked. Zero provider requests. |

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

### Failures that exist on the base branch

These fail identically on `0e49940` and were not touched.

- Eight Vitest suites cannot load without a Supabase URL: `addLeadAssignmentGate`, `dialerCampaignPresenceHook`, `contactName`, `contactScope`, `leadDisposition`, `userLocalDayBounds`, `runtimeEventLogger`, `custom-fields-settings`.
- One Vitest assertion: `recordingRetentionVoicemail > handler wiring > byte-identical to deployed v29`.
- `supabase/functions/_shared/sms/affinity.test.ts` needs its own loopback gateway and was not run. No file under `_shared/sms/` changed.
- The harness prints `workflow_on_lead_created dispatch failed … http_request_queue` warnings from the legacy dispatcher, which has no URL configured in the fixture.

### Limits of this verification

- The fixture replays 105 of the 122 earlier migrations. The complete current production schema was not rehearsed. Left out because they need production-only preimages, organization data or release gates: `20261008024220`, `20261008033044`, `20261008035004`, `20261019013824`, `20261019015242`, `20261019032157`, `20261020171244`, `20261023232435`, `20261024045812`, `20261105120016`, `20261105120020`, `20261105120021`, `20261105120022`, `20261105120032`, `20261105120033`, `20261105120043`, `20261105120044`.
- Every provider is an in-memory transport. No real Twilio, Resend, Gmail or Vercel request was made, and no managed migration runner was used.
- GitHub Actions has no workflow for the Automations harness. These results are from local runs.

## Deployment status

| Target | State |
| --- | --- |
| Supabase `jncvvsvckxhqgqvkppmj` | Unchanged. Ledger 395 entries ending `20261122001044`, read on November 22. |
| Vercel `agentflow` | Unchanged. Not read for this work. Last recorded frontend `666387b06236281a1e61b1d0fc765284bc63cd99`. |
| Edge functions | Unchanged. `workflow-resume-paused` is version 44 and holds no Automations worker. `automation-provider-receipt` does not exist. |
| Release controls | Unchanged. One agency sees the builder. Zero enrolling, zero delivering. |

## Blockers

- Each production step needs Chris's exact approval: the seven migrations and the two new tables' access rules, the frontend, and later the worker, its schedule, the receipt endpoint, enrollment and message delivery.
- Execution also needs a verified email sender, recipient eligibility evidence and an owned schedule. They are listed in the [release plan](release-plan.md#live-dependencies-each-needing-its-own-approval).

## Next steps

1. Review the draft pull request.
2. Decide whether a full production-schema rehearsal is required before the migrations, or waived as it was for the first release.
3. Approve the release window and the exact migration and frontend SHAs, or ask for changes.
4. Decide later, separately, on the worker, schedule, receipts, enrollment and delivery.
