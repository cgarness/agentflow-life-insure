# Automations V2 release and rollback plan

**Status on November 24, 2026 (second round): prepared, nothing released.** No migration, Edge function, Vercel deployment, release control or schedule was changed. Every numbered step below needs Chris's own exact approval before it runs.

## What production holds today

Read-only checks on November 24, 2026 against Supabase `jncvvsvckxhqgqvkppmj`:

| Item | Observed |
| --- | --- |
| Migration ledger | 396 entries, ending `20261123231917 contact_first_sms_sender`. No entry is named `automation_v2_…`. |
| First release | Its four migrations are installed. All 17 functions V2 replaces match the first-release fingerprint byte for byte (the same digests the rollbacks restore). The seventeenth, `public.automation_authorize_handoff`, which V2 now also replaces, was read again in this round: digest `ad863e11282d5c0b7414fd949b728628`, owner `postgres`, security definer, `search_path=""`, executable by `service_role` only, as in the first release. |
| Database | PostgreSQL 17.6. |
| Release controls | One agency row (read again this round). Builder visible for one agency, CG Financial (`a0000000-0000-0000-0000-000000000001`, "Family First Life - Chris Garness" in the organizations table), out of six agencies. Zero agencies enrolling. Zero agencies delivering messages. |
| Schema fingerprint | Format 2, read through the connector at 19:20 UTC: 34 families. The session settings it ran under match the local image's exactly. 1,010 functions, 1,157 relations, 1,216 constraints, 863 indexes, 387 policies and 219 triggers. This is a reference reading only: `release-full` needs receipts read within two hours of its dump. |
| Automations data | One draft definition, zero published versions, zero open activations, zero events, zero runs, zero steps, zero intents. |
| Worker | `workflow-resume-paused` is version 44, last updated May 22, 2026, so it does not contain the Automations worker (first written November 21). |
| Receipt endpoint | `automation-provider-receipt` does not exist. |
| Sending prerequisites | Zero email senders, zero channel policies, zero recipient facts. |
| Scheduler | 14 active database cron jobs; none names a workflow or Automations endpoint. |
| Frontend | Both primary domains serve READY deployment `dpl_AZc2iNcS9XTY2nZ6p8hpqs3MeZ5Z`, built from `2128bb641afecae1bf45e6a3ce9b3e8b2e04b15b` (checked at the start of this round; the [work log](../../../WORK_LOG.md) records the release). The previous frontend is `dpl_BD2R2C2bBUWc1aiW3Zu6gRXvKGR7`. |

### How the V2 versions fit the ledger

The ledger records the version a migration was applied at, not the file name: the repository's `20261123170000_contact_first_sms_sender.sql` is ledger entry `20261123231917`. The seven V2 files are numbered `20261124100000` to `20261124100600`, after both the newest repository file and the ledger's tail, so they keep their order whichever version each is recorded at. After applying, rename each file to its recorded version without changing its bytes, as AGENT_RULES requires. Check for V2 by the names `automation_v2_authoring` … `automation_v2_runtime` and with `supabase/ops/automation_v2_install_state.sql`, never by file version.

## What ships

| Part | Content |
| --- | --- |
| Seven migrations | `20261124100000` through `20261124100600` under `supabase/migrations/`, applied in order. |
| Frontend | The exact commit Chris approves, named in the approval request. |
| Worker package | `supabase/functions/_shared/automations/` as used by `workflow-resume-paused`. Only needed when execution is turned on. It asks `automation_message_check` before it reserves a text's provider request, and `automation_release_refused_dispatch` first, so a text an earlier lease had refused before its handoff can be reserved again. |

The files to approve, as committed at `ac64770` and unchanged after it:

| File | SHA-256 |
| --- | --- |
| `20261124100000_automation_v2_authoring.sql` | `4bcf1cd6dfd1410706621f8e478c3dcce205a4a2c6ec3a77fd647f123dd57c45` |
| `20261124100100_automation_v2_events.sql` | `f78fb8865d9e5d123b6f615ff302726ed478353d8390fe1da0cdbdb98a497b63` |
| `20261124100200_automation_v2_tasks.sql` | `248925fe30c3ecf93180764bdc83114b2bc803d8d9f23b8c76b3b3ce1e42c369` |
| `20261124100300_automation_v2_appointment_timing.sql` | `2db256b213c55da7e50111e5791c6e587b56a97307de6b44c09aa05a20d6fd3c` |
| `20261124100400_automation_v2_inbound_callbacks.sql` | `b078596a20e16a203d78ce9a82995479030bf6a0553f97d40f6cd6e2b675d795` |
| `20261124100500_automation_v2_policy_issuance.sql` | `b7a08101842025c475cbaec22425f45007201a39c62907b6980f85d5ba7c67f5` |
| `20261124100600_automation_v2_runtime.sql` | `d94c5bb940e726a5cf19c82bb218a7a949dc89e73263dcc89db17bf8a1eb0fc6` |
| `rollback/20261124100600_automation_v2.rollback.sql` (after a complete installation) | `9fdd119e0a544584242b53fe3e2d21be4c5292fbae4aeb53fffd5c97f0342980` |
| `rollback/20261124100600_automation_v2_stopped_install.rollback.sql` (after a stopped installation) | `cec5a1466d085299955caf2552a27d8d6c2cfb415a14d203553d60ea8f55b025` |
| `supabase/ops/automation_v2_install_state.sql` (read-only probe) | `69b2d87caba4dcb6e1bff7f0c25590649c77823faa4b24c24016f3c8b5e23f58` |
| `supabase/ops/automation_v2_dependency_check.sql` (read-only) | `3edf79522bc04869007f82fa1319f2c69d138464a95762a0b05a3a38636946f4` |

### New tables and access rules to approve

No existing table's row-level security policy changes. `public.calls` gets no policy.

| Object | Access |
| --- | --- |
| `public.inbound_callbacks` (new) | Row-level security on, no policy, no browser grant. Read and changed only through `inbound_callback_queue`, `claim_inbound_callback`, `release_inbound_callback` and `complete_inbound_callback`, which check the caller's agency, the pilot flag, Inbounds access, contact visibility and View As. `closed_reason` records a callback dismissed because the call was answered. |
| `public.policy_issuance_confirmations` (new) | Row-level security on. One SELECT policy, `policy_issuance_read`: same agency and a client the reader can already see. Written only through `confirm_policy_issuance`, which refuses an agency outside the pilot. Updates and deletes are refused by a trigger. |
| `private.automation_sms_purposes`, `private.automation_task_receipts`, `private.automation_answer_settlements` (new) | Row-level security on, no policy, no browser or service grant. The last records a late-answer cleanup a busy row held up, for the worker to finish. |
| `public.tasks` | Adds `all_day` (default true) and `automation_run_id`. `created_by` becomes nullable only for a row that names an automation run (CHECK). A trigger refuses any browser write that sets or clears `automation_run_id`. |
| New triggers on existing tables | `public.calls` (after a status update for inbound terminal calls; after an update of `agent_id`, `outcome` or `answered_by_agent_id` that proves an answer), `public.inbound_route_attempts` (after `mobile_bridge_evidence` becomes `dial_bridged`), `public.wins` (after insert), `private.dialer_disposition_receipts` (after insert), `private.appointment_occurrences` (after insert or close), `private.appointment_outcome_events` (after insert), `private.appointment_evidence_observations` (after an update record that reopens a cancelled appointment). Each waits at most 200 ms for a lock and never raises into the CRM write. The event observers do nothing when the agency is not enrolling; the answered-call observer acts only on V2's own callbacks and tasks. |
| Altered first-release tables | `private.automation_events` (seven more event types, an optional contact, `contact_type`, `subject`, `scope_key`), `private.automation_intake_recovery` (an optional contact, `contact_type`, `subject`, `scope_key`, `available_at`) and `private.automation_runs` (an optional contact, `scope_key`, `anchor_id`, `anchor_at`, `held_since`, `reminded_for`, `leased_for`, `paced_from`). Existing event and run rows get their `scope_key` filled in the same file. |
| New indexes on existing tables | `private.automation_events(organization_id, (subject->>'appointment_id')) WHERE subject ? 'appointment_id'`; `private.automation_runs(organization_id, workflow_id, scope_key, ended_at)`; `private.automation_runs(organization_id, event_id)`; `private.appointment_occurrences(organization_id, contact_id) WHERE seq = 1`. |
| Replaced first-release functions | Seventeen, each restored byte for byte by the rollbacks. `public.automation_authorize_handoff` share-locks the appointment, waiting at most half a second for a save in progress. It refuses a text whose run would stop, whose appointment moved or has started, or whose reminder was for another time. |
| New functions | None is executable by `PUBLIC` or `anon`. Worker functions are `service_role` only. Among them are `automation_message_check`, the worker's early check, and `automation_release_refused_dispatch`. That one deletes only the step's own SMS reservation, and only when it was cancelled before any handoff, no provider saw it and its intent was never handed off. The private helpers `automation_following_since` and `automation_contact_stop` have no grant. Signed-in users may execute thirteen: `automation_sms_requirements`, `automation_disposition_options` and `automation_saved_messages` (the builder), `inbound_callback_queue`, `claim_inbound_callback`, `release_inbound_callback` and `complete_inbound_callback` (Inbounds), `confirm_policy_issuance`, `get_policy_issuance`, `can_confirm_policy_issuance` and `policy_issuance_available` (Confirm issuance), and the helpers `private.automation_viewing_as` and `private.automation_mode_unverified`. Each checks the caller's agency and role itself. |
| Pilot scope | Issuance confirmation, the Inbounds callback list and the phone contact-screen pan are available only to an agency with the builder visible, the same flag as the builder. Opening them to other agencies is Chris's decision. |

## Release order: database first, then frontend

1. **Preflight (read-only).**
   - Rerun the checks above: the ledger tail and that no `automation_v2_…` entry exists, the 17 first-release fingerprints, the checksums above, enrollment and message delivery off for every agency, and `supabase/ops/automation_v2_install_state.sql` reporting `not_installed`.
   - Run `supabase/ops/automation_v2_dependency_check.sql` and compare it with the recorded result. It now also digests `automation_authorize_handoff` and `automation_begin_message`.
   - Confirm the pilot is CG Financial alone, because issuance confirmation, the callback list and the phone contact pan follow the builder flag. Stop if this returns anything but one row for `a0000000-0000-0000-0000-000000000001` with only `builder_visible` on:

     ```sql
     select organization_id, builder_visible, enrollment_enabled, dispatch_enabled
     from private.automation_release_controls where builder_visible or enrollment_enabled or dispatch_enabled;
     ```

   - Read the deployment production serves and record it as the frontend rollback target. Confirm a restorable backup.
2. **Hide the builder for every agency** with `supabase/ops/automations_builder_visibility.sql` (`action=hide`, once for each agency recorded in step 1; today one), and read it back. This also hides issuance confirmation and the callback list for the pilot. While it is hidden no author can publish, so nothing V2 records can start during the installation, and a stopped installation can still be backed out.
3. **Apply the seven migrations in order, outside calling hours.** Each file is one transaction with a 5-second lock wait and changes nothing if it fails. Run the probe after each file. The install creates no definition, version, enrollment, task, callback or message. Run the Supabase advisors before and after. Expect brief locks while each file commits:
   - Creating a trigger locks writes to its table: calls, inbound route attempts, sales, disposition receipts and the three appointment tables.
   - Altering `private.automation_events`, `private.automation_intake_recovery` and `private.automation_runs` locks them until the events file commits, and building the four new indexes on existing tables locks writes to those and to `private.appointment_occurrences`.
   - Adding the two `public.tasks` columns locks the tasks table briefly. The new check is added without scanning existing rows.
   - On Supabase, `CREATE POLICY` (the issuance migration) also locks the sign-in and storage tables until that file commits.
4. **If the installation stops part way** (a file did not get its locks, or anything else): the files already applied stay, and the CRM keeps working (rehearsed for every stopping point). The probe names the next file. Either resume by applying the remaining files in order, or, with its own approval, back out with `rollback/20261124100600_automation_v2_stopped_install.rollback.sql` (below). Keep the builder hidden until one of the two is done.
5. **Check the installed frontend still works.** The first-release frontend and worker passed their own acceptance script unchanged on the V2 database in the local rehearsal.
6. **Frontend.** Git deployments are off for this branch in `vercel.json`, so stage the approved commit with the Vercel CLI and `--skip-domain`, as the first release was staged. Confirm Vercel marks it READY with that commit recorded, then promote it. Agents refresh after their current call.
7. **Show the builder again** for the agencies recorded in step 1 (`action=show`), and read it back.
8. **Verify signed in.** Open Automations, create and leave a blank canvas with zero writes, open the existing draft, confirm Agency enrollment and Agency message delivery both read Off.

No worker is released with this. Production has no Automations worker today, and the first one ever released must be this V2 package: the first-release worker does not enforce a pinned SMS requirement and cannot run V2 steps (it fails them without sending). The worker, its schedule and the receipt endpoint stay under the separate approvals listed under Live dependencies.

Two effects start once the seven files are in and do not wait for the frontend:

- A version published afterwards, from either editor, gets its SMS consent requirement pinned by the server. Custom wording requires marketing consent even when the first-release editor shows the author an informational choice. Versions published before keep their stored purpose.
- A stale draft save, publish or session change now answers HTTP 409 at once. Before, the request never answered because PostgREST retries SQLSTATE 40001 without limit.

Turning enrollment on is not part of this release. When it is later turned on for an agency, V2 tasks and callbacks are created as soon as a published automation is active. Message delivery stays behind its own switch.

## Backing out a stopped installation

Run `rollback/20261124100600_automation_v2_stopped_install.rollback.sql` as one transaction, outside calling hours:

```bash
psql -X -1 -v ON_ERROR_STOP=1 -f supabase/migrations/rollback/20261124100600_automation_v2_stopped_install.rollback.sql
```

It refuses outside a transaction; when the installed files are not exactly the first k of the seven, or none or all seven are in; while any agency has enrollment, message delivery or the builder on; when V2 has recorded anything (a pinned SMS purpose, an event only V2 records, a task receipt, a callback, a recorded late-answer cleanup or an issuance confirmation) or any published version uses something only V2 runs; when a function it replaces differs from what the installed files give it; and when it already ran. It restores the first-release body of every function the installed files replaced, byte for byte, turns the observers they added into no-ops whose triggers stay attached, changes no row, and records itself in `private.automation_v2_backed_out()`. The probe then reports `backed_out` with no next file, and every V2 file refuses to install, because the files after the ones backed out would run beside restored first-release functions. Take the V2 files that were not applied out of the branch's `supabase/migrations/` afterwards, so a later ordered migration run does not stop on their guard. Installing V2 later is a new migration.

## Rollback order after a complete installation: fence first, then frontend

1. **Fence.** Set `enrollment_enabled=false` and `dispatch_enabled=false` for every agency and read both back. From this moment no automation creates a task or callback, and no message is handed to a provider. Runs already under way hold until the fence is lifted; while the V2 functions are installed, a run on hold for seven days ends.
2. **Hand over open callbacks.** The previous frontend has no callback list. Before restoring it, list each agency's open and claimed callbacks and give them to the agency for manual follow-up:

   ```sql
   select b.organization_id, b.status, b.caller_phone, b.claimed_by, b.created_at, b.title
   from public.inbound_callbacks b where b.status in ('open','claimed')
     and private.automation_inbound_evidence(b.organization_id, b.call_id) is distinct from 'answered'
   order by b.organization_id, b.created_at;
   ```

   A callback whose call was proven answered but whose cleanup is still waiting is left out, as the callback list already leaves it out.

   Tasks automations created stay on the contacts, with their time of day.
3. **Frontend.** Promote the deployment recorded at preflight as the rollback target. A draft that uses V2 content opens for inspection only in the first-release editor. A first-release draft stays editable.
4. **Worker.** There is no earlier Automations worker to restore. If the V2 worker was released, keep it, or turn its schedule off. Against the restored functions it runs first-release versions exactly as the first release defines them. After step 5, while the fence is still on, turn the schedule off: the restored first-release functions retry a held step every five minutes with no end.
5. **Database, only if the V2 functions themselves are at fault.** Run [`rollback/20261124100600_automation_v2.rollback.sql`](../../../supabase/migrations/rollback/20261124100600_automation_v2.rollback.sql) as one transaction, outside calling hours:

   ```bash
   psql -X -1 -v ON_ERROR_STOP=1 -f supabase/migrations/rollback/20261124100600_automation_v2.rollback.sql
   ```

What the rollback file does:

| It does | It never does |
| --- | --- |
| Refuses outside a transaction, while any agency is not fenced, and when any of the 25 functions it replaces (the 17 V2 bodies and the 8 observers) has drifted from the V2 definition. It turns psql's ON_ERROR_STOP on itself, so a refusal stops psql even when the documented flags are left out. It holds the release controls until it commits, so the fence cannot be lifted half way. | Remove a task, callback, issuance confirmation, pinned SMS requirement, event, run, version, draft or history row, or change what one says. It only sets status and timing fields: it stops runs, closes activations, pauses automations, marks pending V2 events handled and parks their intake repairs and deferred admissions. |
| Restores the 17 first-release function bodies byte for byte and checks each fingerprint afterwards. | Drop a table, column, constraint, index, policy, grant or trigger. A recorded late-answer cleanup stays as it is; it is retried once V2 is installed again. |
| Turns the eight V2 observers into no-ops: seven that record events and the one that closes a callback or task when a call turns out to have been answered. Their triggers stay attached, because on Supabase dropping a trigger also locks every sign-in and storage table. | Lock calls, sales, dispositions, appointments, policies or the sign-in tables. It locks `public.automation_intervals` from its data phase until it commits, so publishing, pausing and resuming wait. It locks `public.workflows` and `private.automation_runs` only from creating their guards until the commit right after. With 100,000 unfinished runs the whole file took about 1 second locally. |
| Pauses every automation whose published version needs V2: a V2 step, a V2 re-entry or stop rule, or an SMS consent requirement stricter than the step's stored purpose. The decision reads only stored data, so it never changes for a version. | Change release controls. |
| Stops every unfinished run on those automations, and any other run only V2 can execute, with the reason "Stopped when Automations V2 was rolled back". | Touch contacts. |
| Adds three guards, on `private.automation_runs`, `public.automation_intervals` and `public.workflows`, so no run is enrolled on a version that needs V2 and such a version can neither be made current nor resumed. The probe then reports `rolled_back`, and every V2 file refuses to install again. | |

After the rollback, a stale save, publish or session change again never answers (the inherited 40001 behaviour). Installing V2 again is a new migration that reinstalls the V2 function bodies (the eight observers included), drops the three guard triggers and their functions, releases the intake repairs and deferred admissions the rollback parked, and fills `scope_key` and `paced_from` for runs created while V2 was absent.

## Rehearsal evidence

All of this ran on a disposable local PostgreSQL 17.6, GoTrue and PostgREST stack with synthetic contacts and in-memory transports. The browser could reach loopback only. Results for the final candidate are in the [context snapshot](context-snapshot.md#verification).

| Rehearsal | Command | What it showed |
| --- | --- | --- |
| Database first | `bash e2e/automations-local/run.sh backend-first` | Two first-release runs that were waiting and queued when the seven migrations were applied kept their state and completed. The first release's own acceptance script passed unchanged with the first-release frontend and worker on the V2 database. The V2 editor then opened, saved and republished those automations with every step ID, wording and stored purpose kept. |
| Rollback seen from the browser | same command | After fencing and the rollback file, the first-release frontend kept its automation active and editable. The automation republished under V2 was paused, a resume request answered HTTP 409 with a plain reason, and its draft opened for inspection only. |
| Rollback on real V2 work | `supabase/tests/automation_v2_rollback.sql` through `e2e/automations-local/rollback-rehearsal.sh` | Refused while a control was on and when run outside a transaction, with or without psql's flags, changing nothing. Applied once. Refused a second run. Stopped four runs, paused five automations, kept two first-release automations running, and kept every V2 record. The six first-release SQL suites passed on the rolled-back database. |
| Install from a pre-feature database | `bash e2e/automations-local/run.sh release` | Twelve migrations in order (the first release, the first-text sender and the seven V2 files) with zero install deltas and an unchanged legacy graph hash, old sessions fenced, the four enrollment and delivery combinations, and a data-preserving hide. |
| Installation that stops part way | `bash e2e/automations-local/run.sh install-stops` | For each stopping point after 0 to 6 files: the CRM's own saves (a lead joining a campaign, a disposition, an appointment booked, moved, cancelled, moved and reopened, a missed call answered late, a sale, a task) worked with automations on and off; a failure inside the next file left nothing; applying the last file again changed nothing; resuming reached exactly the catalog of a clean installation, and the full rollback then exactly the catalog of a clean rollback; the back-out restored the 17 first-release functions byte for byte with every added observer inert, while the full rollback refused the partial state and a second back-out was refused. After the back-out the probe reported `backed_out` with no next file and the next file refused to install; after the full rollback the probe reported `rolled_back` and files 1 and 7 refused. Each of the 35 databases the files and rollbacks were applied to was a faithful copy that matched its source in all 34 schema fingerprint families first. |
| Texts after the worker picked them up | `bash e2e/automations-local/run.sh builder` (native step) | The worker leased five reminder texts. Two appointments were moved or cancelled before the worker started on their texts; two more just before the final authorization, through an injected request on the synthetic transport. None of the four reached the synthetic provider and none was recorded as handed off. The two caught early reserved no SMS request. The next lease ended the cancelled runs and left the moved ones waiting for the new time. The unchanged reminder was sent once with its time. |
| A text refused at its final authorization | same command (native step) | With the agency's sending window moved later, a sixth reminder was refused at the final authorization (outside sending hours), in the pilot's sticky SMS mode. Its reservation was cancelled before any handoff and nothing reached the provider. Once the window opened, the next lease released that reservation, reserved again and sent the reminder exactly once. |
| Two-connection races | `python3 e2e/automations-local/concurrency_v2.py` | Eleven checks with real row locks held by another session. A call answered while its task or callback was locked was saved in under 3 seconds; the cleanup was recorded and finished by the worker once the row was free. A phone bridge confirmed while the call row was behind was hidden from the list and refused for claiming at once. Two workers seeing a reopening at once started one run. An appointment move in flight refused a reminder's handoff after half a second, and a handoff in progress held a save only until it committed. A short unrelated save (notes) was waited out and the reminder handed off. A longer one refused the handoff without recording anything, and the next lease handed the reminder off once. |
| Complete-schema path, synthetic | `bash e2e/automations-local/release-full-synthetic.sh` | A stand-in source (production's migrations up to today) supplied the bundle, made by `make-schema-bundle.sh` through PostgreSQL 17 tools, and receipts read separately through another connection. Twelve wrong inputs were refused, among them the bundle's own reading reformatted, a receipt read through the bundle's connection, and an archive with one policy regrouped after its readings. The full run then matched every target against the receipt, 33 families exactly and constraints on PostgreSQL's precedence-aware printing, and passed the interrupted-install and rollback rehearsals. A plain template copy failed the target check. |
| Complete production schema | `bash e2e/automations-local/run.sh release-full ARCHIVE RECEIPTS` | Not run: it needs Chris's bundle and receipts from the same window ([handoff](complete-schema-handoff.md)). |

## The complete current production schema

Chris asked for the seven migrations and both rollbacks to be rehearsed on an isolated copy of the complete current schema, with that copy verified against an independent reading of production.

- **What changed in this round.** `release-full` used to apply the files to a filtered `pg_dump` copy that nobody fingerprinted (no cron schema, no GraphQL wrapper privileges, no database privileges or settings). It compared the restored database only with the bundle's own reading, and took its receipts from this checkout by default (the November 21 reading, now stale). Now:
  - the receipts are a separate directory read through the Management API within two hours of the dump. Each reading names its connection, and a receipt read through the bundle's connection, at the moment of one of its readings, or as a reformatted copy of a bundle file is refused;
  - the fingerprint is format 2 (34 families, including the managed schemas, catalog-object and parameter privileges, partition keys, replica identity and the session it ran under);
  - every database the files and rollbacks touch is a faithful copy checked against that receipt or against the database it was copied from;
  - the comparison is exact in every family except the seven holding parsed expressions, which may match on PostgreSQL's precedence-aware printing instead. The earlier comparison removed every parenthesis, so a regrouped policy could pass; the synthetic rehearsal now proves one is refused;
  - twelve wrong inputs are refused.

  The [README](../../../e2e/automations-local/README.md#release-and-cutover-rehearsal) has the details.
- **Who can produce the bundle.** Chris, on his own computer. He holds the production database password. Claude has read-only SQL and no database login, and no protected workflow can produce a PostgreSQL 17 archive without a change on `main` (which also redeploys production).
- **What is needed from Chris.** It takes about 45 minutes, and the [handoff](complete-schema-handoff.md) has every step.
  1. A trusted computer (Linux, or macOS 13 or newer) with Docker, bash 4.4 or newer, Node 20, Python 3.11 and PostgreSQL 17 client tools. On a Mac: `brew install bash postgresql@17`.
  2. This repository at the approved commit.
  3. Three values that stay on his computer: the database password in `~/.pgpass`, a Supabase personal access token for the read-only receipts, and the project's public client key.
  4. Run three commands: `capture-receipts.sh`, `make-schema-bundle.sh` and `run.sh release-full`.
  5. Send back the final pass lines and the two evidence files, which hold counts, digests and timings only. The bundle never leaves his computer.
- **A difference the rehearsal names, not a failure.** A restore parses stored expressions again, and PostgreSQL then flattens nested AND and OR chains (a `BETWEEN` followed by `AND`). It can also store the same privileges in another order. Three such constraints exist in production: `dashboard_milestone_reviews_year_check` and the two `rate_percent` checks on the policy commission tables. So in the seven expression families a restored copy may match on PostgreSQL's precedence-aware printing (`pg_get_constraintdef(oid, true)` and the like). That printing reads the same for a flattened chain and its nested original, and differs for any regrouping. Privileges are compared sorted. Every other family, and every reading of production itself, is compared exactly. The evidence file lists the families that matched on the printing.
- **What was compared instead, until it runs.**
  - `supabase/ops/automation_v2_dependency_check.sql` reads every relation and function the seven files and both rollbacks depend on, from production and from the fixture ([result](production-dependency-check-2026-11-24.json), read again on November 24 at 22:00 UTC, read-only and digests only). All 39 functions are identical, among them `automation_authorize_handoff`, `automation_begin_message` and `affinity_lock`, which this round's code uses.
  - Of 39 relations, 17 are identical and 18 differ only in how an owner-only grant is stored (identical effective privileges). That includes `public.sms_dispatches` and `private.automation_messages`, which the release function reads. The other 4 have objects production has and the fixture lacks, none of which V2 creates, alters or reads.
  - None of the 68 names V2 creates exists in production. The check's production rerun is part of the preflight.

## Live dependencies, each needing its own approval

These gate execution. None is part of the release above.

| Dependency | State today | Needed before it is turned on |
| --- | --- | --- |
| Scheduler | None of the 14 active database cron jobs names a workflow or Automations endpoint (read November 24). A job that reaches the worker through a wrapper, or a scheduler outside the database, was not ruled out. V2 installs none. | One bounded, owned schedule for `workflow-resume-paused`, with its owner and interval recorded. |
| Worker | No Automations worker is released. | The V2 package, retrieved and compared against the live function immediately before release. Its early message check (`automation_message_check`) needs the V2 database. |
| Enrollment | Off for every agency. | A per-agency decision. Tasks and callbacks start with it. |
| Message delivery | Off for every agency. | A per-agency decision after the three rows below are in place. |
| Email sender | `private.automation_email_senders` holds zero rows (read November 24). A connected Google mailbox does not count. | A verified agency sender with a connected reply inbox. |
| Receipts | `automation-provider-receipt` is not released. | The endpoint with signed callbacks. Its `verify_jwt=false` setting needs explicit approval. |
| Recipient eligibility | `private.automation_channel_policies` and `private.automation_recipient_facts` hold zero rows (read November 24). | Agency sending limits and hours, a verified recipient time zone, SMS consent for the pinned purpose, sticky-number readiness and A2P registration. Missing evidence holds the step with a visible reason. |

## Decisions for Chris

- **Wider rollout.** Issuance confirmation, the Inbounds callback list and the phone contact-screen pan are scoped to the pilot. Opening any of them to other agencies, before or after this release, is a separate decision.
- **Complete-schema rehearsal.** Whether to produce the archive bundle and run `run.sh release-full` before approving the migrations, or to accept the dependency comparison above as was done for the first release.
- **Stop rules across a reschedule.** When a reply, a conversation or another booking has ended an automation's reminders and the appointment is then moved while it stood, the automation starts again for the new time, counted from the move. This round keeps that, because it predates the round and the builder describes stop rules per run. A booking taken up after its appointment was reopened is different: it is judged as the run that followed the appointment would have been, so the same facts give the same answer whatever the worker saw first. Whether stop rules should also outlive an ordinary reschedule is a product decision; the tests pin today's behavior.
- **Tablet widths.** At 768 to 1023 px the contact screen clips Schedule and the conversation column. That predates V2 and is unchanged; fixing it changes every agency's contact screen. Tracked in cgarness/agentflow-life-insure#538.
- **Timers that outlive their component** (the intermittent Reports check failures). They are the same on `main` and not part of V2. Each fix is separate, with its reproduction and proposed patch in [docs/plans/2026-11-24-test-teardown-timers](../2026-11-24-test-teardown-timers/README.md):
  - the Dialer page stats refresh, cgarness/agentflow-life-insure#539;
  - the floating dialer search, cgarness/agentflow-life-insure#540;
  - the Twilio call-duration interval, cgarness/agentflow-life-insure#541.
