# Automations V2 release and rollback plan

**Status on November 23, 2026: prepared, nothing released.** No migration, Edge function, Vercel deployment, release control or schedule was changed. Every numbered step below needs Chris's own exact approval before it runs.

## What production holds today

Read-only checks on November 22, 2026 against Supabase `jncvvsvckxhqgqvkppmj`:

| Item | Observed |
| --- | --- |
| Migration ledger | 395 entries, ending `20261122001044`. None of the seven V2 versions is present. |
| First release | Its four migrations are installed. All 16 functions V2 replaces match the recorded first-release fingerprint: definition, owner, definer flag, search path, grants and volatility. |
| Release controls | One agency row. Builder visible for one agency. Zero agencies enrolling. Zero agencies delivering messages. |
| Automations data | One draft definition, zero published versions, zero open activations, zero events, zero runs. |
| Worker | `workflow-resume-paused` is version 44, last updated May 22, 2026. The Automations worker code was first written on November 21, so that version cannot contain it. |
| Receipt endpoint | `automation-provider-receipt` does not exist. |

The last recorded primary frontend is `666387b06236281a1e61b1d0fc765284bc63cd99` ([work log](../../../WORK_LOG.md), November 21). Vercel was not read again for this plan.

## What ships

| Part | Content |
| --- | --- |
| Seven migrations | `20261122100000` through `20261122100600` under `supabase/migrations/`, applied in order. |
| Frontend | The pull request head. |
| Worker package | `supabase/functions/_shared/automations/` as used by `workflow-resume-paused`. Only needed when execution is turned on. |

### New tables and access rules to approve

No existing table's row-level security policy changes. `public.calls` gets no policy.

| Object | Access |
| --- | --- |
| `public.inbound_callbacks` (new) | Row-level security on, no policy, no browser grant. Read and changed only through `inbound_callback_queue`, `claim_inbound_callback`, `release_inbound_callback` and `complete_inbound_callback`, which check the caller's agency, Inbounds access, contact visibility and View As. |
| `public.policy_issuance_confirmations` (new) | Row-level security on. One SELECT policy, `policy_issuance_read`: same agency and a client the reader can already see. Written only through `confirm_policy_issuance`. Updates and deletes are refused by a trigger. |
| `private.automation_sms_purposes`, `private.automation_task_receipts` (new) | Row-level security on, no policy, no browser or service grant. |
| `public.tasks` | Adds `all_day` (default true) and `automation_run_id`. `created_by` becomes nullable only for a row that names an automation run (CHECK). A trigger refuses any browser write that sets or clears `automation_run_id`. |
| New triggers on existing tables | `public.calls` (after a status update, inbound terminal calls only), `public.wins` (after insert), `private.dialer_disposition_receipts` (after insert), `private.appointment_occurrences` (after insert or close), `private.appointment_outcome_events` (after insert). Each does nothing when the agency is not enrolling, waits at most 200 ms for a lock and never raises into the CRM write. |
| New indexes on existing tables | `private.appointment_occurrences(organization_id, contact_id) WHERE seq = 1`, for "Stop when an appointment is booked". `private.automation_runs(organization_id, event_id)`, so an appointment change finds its runs without scanning them all. |
| New functions | None is executable by `PUBLIC` or `anon`. Worker functions are `service_role` only. |

## Release order: database first, then frontend

1. **Preflight (read-only).** Confirm the ledger tail, that the 16 function fingerprints still match, and that enrollment and message delivery are off for every agency. Confirm a restorable backup.
2. **Apply the seven migrations in order, outside calling hours.** Each file is one transaction with a 5-second lock wait. The install creates no definition, version, enrollment, task, callback or message. Run the Supabase advisors before and after. Expect brief locks while each file commits:
   - Creating a trigger locks writes to its table: calls, sales, disposition receipts and the two appointment tables.
   - Building the two new indexes locks writes to `private.appointment_occurrences` and to `private.automation_runs`, which production keeps empty while enrollment is off.
   - Adding the two `public.tasks` columns locks the tasks table briefly. The new check is added without scanning existing rows.
   - On Supabase, `CREATE POLICY` (the issuance migration) also locks the sign-in and storage tables until that file commits.
   If any lock is not granted within 5 seconds the file fails and changes nothing. Retry it when the database is quieter.
3. **Check the installed frontend still works.** The first-release frontend and worker passed their own acceptance script unchanged on the V2 database in the local rehearsal (below).
4. **Frontend.** Promote the pull request head. Agents refresh after their current call.
5. **Verify signed in.** Open Automations, create and leave a blank canvas with zero writes, open the existing draft, confirm Agency enrollment and Agency message delivery both read Off.

No worker is released with this. Production has no Automations worker today, and the first one ever released must be this V2 package: the first-release worker does not enforce a pinned SMS requirement and cannot run V2 steps (it fails them without sending). The worker, its schedule and the receipt endpoint stay under the separate approvals listed under Live dependencies.

Two effects start at step 2 and do not wait for the frontend:

- A version published after step 2, from either editor, gets its SMS consent requirement pinned by the server. Custom wording requires marketing consent even when the first-release editor shows the author an informational choice. Versions published before step 2 keep their stored purpose.
- A stale draft save, publish or session change now answers HTTP 409 at once. Before, the request never answered because PostgREST retries SQLSTATE 40001 without limit.

Turning enrollment on is not part of this release. When it is later turned on for an agency, V2 tasks and callbacks are created as soon as a published automation is active. Message delivery stays behind its own switch.

## Rollback order: fence first, then frontend

1. **Fence.** Set `enrollment_enabled=false` and `dispatch_enabled=false` for every agency and read both back. From this moment no automation creates a task or callback, and no message is handed to a provider. Runs already under way hold until the fence is lifted; while the V2 functions are installed, a run on hold for seven days ends.
2. **Hand over open callbacks.** The previous frontend has no callback list. Before restoring it, list each agency's open and claimed callbacks and give them to the agency for manual follow-up:

   ```sql
   select b.organization_id, b.status, b.caller_phone, b.claimed_by, b.created_at, b.title
   from public.inbound_callbacks b where b.status in ('open','claimed') order by b.organization_id, b.created_at;
   ```

   Tasks automations created stay on the contacts, with their time of day.
3. **Frontend.** Promote the previous READY deployment. A draft that uses V2 content opens for inspection only in the first-release editor. A first-release draft stays editable.
4. **Worker.** There is no earlier Automations worker to restore. If the V2 worker was released, keep it, or turn its schedule off. Against the restored functions it runs first-release versions exactly as the first release defines them: claims carry no context, and each version 1 SMS step uses its stored purpose. That is correct for every version the rollback leaves active, because it pauses every version whose pinned requirement differs from the stored purpose. After step 5, while the fence is still on, turn the schedule off: the restored first-release functions retry a held step every five minutes with no end, so the seven-day end no longer applies.
5. **Database, only if the V2 functions themselves are at fault.** Run [`rollback/20261122100600_automation_v2.rollback.sql`](../../../supabase/migrations/rollback/20261122100600_automation_v2.rollback.sql) as one transaction, outside calling hours:

   ```bash
   psql -X -1 -v ON_ERROR_STOP=1 -f supabase/migrations/rollback/20261122100600_automation_v2.rollback.sql
   ```

What the rollback file does:

| It does | It never does |
| --- | --- |
| Refuses outside a transaction, while any agency is not fenced, and when any of the 22 functions it replaces has drifted from the V2 definition. It turns psql's ON_ERROR_STOP on itself, so a refusal stops psql even when the documented flags are left out. It holds the release controls until it commits, so the fence cannot be lifted half way. | Remove a task, callback, issuance confirmation, pinned SMS requirement, event, run, version, draft or history row, or change what one says. It only sets status and timing fields: it stops runs, closes activations, pauses automations, marks pending V2 events handled and parks their intake repairs and deferred admissions. |
| Restores the 16 first-release function bodies byte for byte and checks each fingerprint afterwards. | Drop a table, column, constraint, index, policy, grant or trigger. |
| Turns the six V2 event observers into no-ops. Their triggers stay attached, because on Supabase dropping a trigger also locks every sign-in and storage table. | Lock calls, sales, dispositions, appointments, policies or the sign-in tables. It locks `public.automation_intervals` from its data phase until it commits, so publishing, pausing and resuming wait. It locks `public.workflows` and `private.automation_runs` only from creating their guards until the commit right after, so draft saves, replies and the worker keep writing while it works. With 100,000 unfinished runs the whole file took about 1 second locally, and each version is judged once. |
| Pauses every automation whose published version needs V2: a V2 step, a V2 re-entry or stop rule, or an SMS consent requirement stricter than the step's stored purpose. The decision reads only stored data, so it never changes for a version; editing a saved message later cannot stop an automation that was allowed to run. | Change release controls. |
| Stops every unfinished run on those automations, and any other run only V2 can execute, with the reason "Stopped when Automations V2 was rolled back". | Touch contacts. |
| Adds three guards, on `private.automation_runs`, `public.automation_intervals` and `public.workflows`: no run is enrolled on a version that needs V2, and such a version can neither be made current nor resumed, even by a publish that started before the rollback. A text published from the first-release editor may not take a weaker requirement than the marketing consent V2 last pinned for the same step. A refusal says what the author can do now: choose Marketing for the text, publish the current draft when it no longer needs V2, or wait until V2 is installed again when the earlier editor cannot change the draft. | |

After the rollback, a stale save, publish or session change again never answers (the inherited 40001 behaviour). Installing V2 again is a new migration that reinstalls the V2 function bodies (the six observers included), drops the three guard triggers and their functions, releases the intake repairs and deferred admissions the rollback parked, and fills `scope_key` for runs created while V2 was absent. The seven original files cannot be replayed over the retained tables.

## Rehearsal evidence

All of this ran on a disposable local PostgreSQL 17.6, GoTrue and PostgREST stack with synthetic contacts and in-memory transports. The browser could reach loopback only.

| Rehearsal | Command | What it showed |
| --- | --- | --- |
| Database first | `bash e2e/automations-local/run.sh backend-first` | Two first-release runs that were waiting and queued when the seven migrations were applied kept their state and completed. The first release's own acceptance script passed unchanged with the first-release frontend and worker on the V2 database. The V2 editor then opened, saved and republished those automations with every step ID, wording and stored purpose kept. |
| Rollback seen from the browser | same command | After fencing and the rollback file, the first-release frontend kept its automation active and editable. The automation republished under V2 was paused, a resume request answered HTTP 409 with a plain reason, and its draft opened for inspection only. |
| Rollback on real V2 work | `supabase/tests/automation_v2_rollback.sql` through `e2e/automations-local/rollback-rehearsal.sh` | Refused while a control was on and when run outside a transaction, with or without psql's flags, changing nothing. Applied once. Refused a second run. Stopped four runs (including a first-release run on an automation it paused), paused five automations, kept two first-release automations running, and kept every V2 record. A lead captured before the fence enrolled afterwards only on first-release versions. A text republished from the first-release editor with a weaker requirement than V2 pinned could not be resumed or published, and the refusal named the consent requirement. A saved message edited after a republish did not stop that automation enrolling. The six first-release SQL suites passed on the rolled-back database. |
| Install from a pre-feature database | `bash e2e/automations-local/run.sh release` | Eleven migrations in order with zero install deltas and an unchanged legacy graph hash, old sessions fenced, the four enrollment and delivery combinations, and a data-preserving hide. |

The "first release" source in the rehearsal is `d85434f635bbf2d4118781e6d254798eef699363`. It differs from the deployed frontend `666387b06236281a1e61b1d0fc765284bc63cd99` in three documentation files only.

Not rehearsed: the complete current production schema (the fixture replays 105 historical migrations), the managed migration runner, Vercel promotion, and any real provider.

## Live dependencies, each needing its own approval

These gate execution. None is part of the builder release above.

| Dependency | State today | Needed before it is turned on |
| --- | --- | --- |
| Scheduler | None of the 14 active database cron jobs names a workflow or Automations endpoint (read November 22). A job that reaches the worker through a wrapper, or a scheduler outside the database, was not ruled out. V2 installs none. | One bounded, owned schedule for `workflow-resume-paused`, with its owner and interval recorded. |
| Worker | No Automations worker is released. | The V2 package, retrieved and compared against the live function immediately before release. |
| Enrollment | Off for every agency. | A per-agency decision. Tasks and callbacks start with it. |
| Message delivery | Off for every agency. | A per-agency decision after the three rows below are in place. |
| Email sender | `private.automation_email_senders` holds zero rows (read November 22). A connected Google mailbox does not count. | A verified agency sender with a connected reply inbox. |
| Receipts | `automation-provider-receipt` is not released. | The endpoint with signed callbacks. Its `verify_jwt=false` setting needs explicit approval. |
| Recipient eligibility | `private.automation_channel_policies` and `private.automation_recipient_facts` hold zero rows (read November 22). | Agency sending limits and hours, a verified recipient time zone, SMS consent for the pinned purpose, sticky-number readiness and A2P registration. Missing evidence holds the step with a visible reason. |
