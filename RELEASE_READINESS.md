# Inbound Calling v2 + Agent Voicemail — Release readiness

**Source commit for the release artefacts:** branch `claude/agentflow-inbound-plan-fkl6zi`, base `main` `1b93f89f990b1482d90bf935633594c2851b8da8`. The M4 file approved below is identified by its **SHA-256 content hash**, not only by the commit, so the reviewed bytes are the applied bytes:

```
fe846c43a91e9aaf81e112edcf0cfb320414047e0e15de149f75160232fe8e29  supabase/migrations/20260911000100_inbound_agent_settings_and_registrations.sql
```

**Prepared:** 2026-09-12 (rev 3, corrective pass 11) · **Status: PREPARATION ONLY.** Nothing in this document has been executed. Every step needs its own approval.
**Authorization at the time of writing:** development-only. No merge, no deployment, no hosted migration, no production settings write, no v2 activation, no Twilio change, no live call.
**Alexa's incident (2026-09-09) remains UNVERIFIED** until the controlled live checks in §5 confirm audible ringing and correct routing.

---

## 1. Verified targets and current environment (read-only inspection, 2026-09-12)

| Target | Value | How established |
|---|---|---|
| Supabase project | **AGENTFLOW CRM** · ref `jncvvsvckxhqgqvkppmj` · us-east-1 · PostgreSQL 17.6.1.063 · ACTIVE_HEALTHY | `supabase/config.toml` `project_id`, confirmed by the Management API project list |
| Frontend (production) | Vercel project **`agentflow`** (`prj_vUIiwhdXPw4H9uxRZ1zTf28KIXbc`), domains `www.fflagent.com`, `fflagent.com` | Vercel project + deployment list |
| Frontend (secondary) | Vercel project **`agentflow-life-insure`** (`prj_PctERc2MEVcpKkYtBtQYc1ruunKb`), same GitHub repo, `*.vercel.app` only | Vercel project list |
| Repository | `cgarness/agentflow-life-insure` | git remote |
| Open PR for this branch | **None.** The only open PR is #294 (`claude/openai-realtime-s2s-testing-7XJ0T`, June, unrelated) | GitHub PR list |

### 1.1 Migrations — M4–M7 are UNAPPLIED

Newest applied version is **`20260823222926 recording_source_sid`**. None of `20260911000100` (M4), `20260911000200` (M5), `20260911000300` (M6), `20260911000400` (M7) appears in the applied history. Confirmed structurally on the database itself:

| Object | Production state |
|---|---|
| `agent_inbound_settings`, `agent_phone_registrations`, `inbound_route_attempts`, `voicemails` | **absent** |
| `calls.routing_engine`, `.answered_by_agent_id`, `.missed_reason`, `.missed_for_agent_id`, `.missed_recipient_ids`, `.missed_notified_at`, `.missed_notify_*`, `.voicemail_id` | **absent** |
| `calls.routed_agent_ids`, `calls.recording_source_sid` | present (M1–M3) |
| `plan_inbound_route`, `record_inbound_engine_decision`, `abandon_inbound_routing`, `sweep_inbound_route_attempts`, `converge_inbound_notifications`, `sweep_inbound_notifications`, `is_agent_busy`, `mark_inbound_missed`, `private.intended_recipients_for_call`, `upsert_voicemail_from_recording` | **absent** |
| `finalize_inbound_call_terminal`, `ingest_inbound_call` | present (M1–M3 bodies — M6 REPLACES the former) |
| `inbound_routing_settings` | **exists** (earlier migration), RLS on, 3 policies, columns: `routing_mode, fallback_action, inbound_fallback_chain, forwarding_number, voicemail_enabled, voicemail_greeting_text, voicemail_greeting_url, auto_create_lead, after_hours_sms*` — **no v2 columns yet** |

### 1.2 Edge Functions — the four affected

| Function | Live version | `verify_jwt` | Changed by this branch |
|---|---|---|---|
| `twilio-voice-status` | **40** | false | yes (projections + snapshot routing + `routing_engine`) |
| `twilio-recording-status` | **34** | false | yes (voicemail branch) |
| `recording-retention-purge` | **29** | false | yes (voicemail retention pass) |
| `twilio-voice-inbound` | **44** | false | yes (v2 engine, deadline, decision, failure path) |
| `inbound-call-claim` | 38 | false | no |

These match the plan's §1 inspection basis exactly — **no drift**.

### 1.3 Extensions, jobs, buckets, RLS

- **`pg_cron` 1.6.4 and `pg_net` 0.19.5 ARE installed.** Consequence: **M7 will schedule both sweeps the moment it is applied** — `inbound-notify-sweep` and `inbound-route-attempt-sweep`, every 2 minutes. Neither job exists today.
- Existing cron jobs (6, all unrelated and untouched by M7): `cleanup-old-notifications`, `daily-call-limit-reset`, `email-sync-incremental-every-5m`, `google-calendar-inbound-sync-every-5m`, `recording-retention-purge-daily` (15:08 UTC), `reset-daily-call-counts`, `spam-check-daily`.
- Buckets: `call-recordings` (private), `voicemail-assets` (public), `agency-group-resources`, `template-attachments` (private), `agency_materials`, `company-branding` (public). **No `voicemails` bucket** — M7 creates it (private, `audio/mpeg`, 25 MB).
- RLS today: `calls` on (5 policies), `notifications` on (4), `phone_numbers` on (4), `profiles` on (3), `inbound_routing_settings` on (3). **The §7.7 scope adds policies only to the four NEW tables plus one `storage.objects` policy; none of the above is modified.**
- `calls_status_check` = `ringing|connected|completed|failed|no-answer` (as assumed). `notifications_type_check` lacks `voicemail` (M7 adds it).

### 1.4 Routing configuration and drift

- **2 organizations.** Only one, **Family First Life – Chris Garness**, has an `inbound_routing_settings` row: `routing_mode='all-ring'`, `voicemail_enabled=false`, `fallback_action='voicemail'`, fallback chain length 2, `auto_create_lead=false`. The second organization has **no row** — under v2 that reads as "not configured ⇒ legacy", which is correct and needs no action.
- **16 phone numbers** in the home organization: **0 direct lines**, 3 assigned. **P1 (direct-line owner) cannot be exercised live until a direct line is configured** — a live-check prerequisite, not a blocker for M4.
- Profiles: **6 Active** (availability 6 Available / 5 Offline across all rows), 5 Deleted.
- `phone_settings.recording_retention_days = 7` (as assumed).
- **5 inbound calls are non-terminal right now** (`status='ringing'`, `ended_at IS NULL`), ages 3.7 / 8.1 / 24.8 / 35.9 / 106.9 days, none claimed, none `forwarded_answered`. These are stale **legacy** rows. After M6+M7 they will carry `routing_engine IS NULL` and have no route attempt, so **the v2 stale-call sweep will not touch them** (ownership is `routing_engine='v2' OR an attempt exists`). They are also why the drain query in §4 reports open calls scoped by ownership rather than by age.
- 45 inbound calls in the last 30 days; 23 of them missed.

### 1.5 Could a merge auto-apply migrations or deploy the frontend?

- **Frontend: YES.** The `agentflow` Vercel project auto-deploys `main` to production — its most recent production deployment is `main` at `1b93f89f`, the current `origin/main`; every push to this feature branch produced a preview (`target: null`). **Merging this branch to `main` IS the frontend deploy** to `www.fflagent.com`, and it also builds the secondary `agentflow-life-insure` project. The frontend step in the sequence below therefore cannot be ordered independently of the merge.
- **Migrations: NOT ESTABLISHED from here.** The Supabase GitHub integration is connected (a default `main` branch entry exists, `git_branch` unbound, last updated 2026-08-25 — the date WORK_LOG records Chris disabling "Deploy to production"; one stale preview branch remains from PR #294, `MIGRATIONS_FAILED`). **The integration's configuration flags cannot be read through the available tooling** (no MCP tool exposes them; the Management API integration endpoints are outside this session's access). **Missing access:** a dashboard read of Project Settings → Integrations → GitHub, confirming "Deploy to production" is still OFF. Independent inspection confirmed the dashboard requires an interactive sign-in, so **this setting remains UNVERIFIED** and a human must read it **before any merge** (§2.1). It does not gate applying M4 directly.

---

## 2. Release sequence

Order is fixed: **M4 → M5 → M6 → M7 → `twilio-voice-status` → `twilio-recording-status` → `recording-retention-purge` → `twilio-voice-inbound` → frontend → organization prerequisites → one-organization v2 activation → controlled live verification.**

Edge Functions are deployed with `supabase functions deploy <slug> --project-ref jncvvsvckxhqgqvkppmj` (or the MCP `deploy_edge_function`), from the approved commit. **How migrations are applied is specified exactly in §2.0 — `supabase db push` is NOT usable for a one-file approval.**

### 2.0 Applying exactly ONE reviewed migration

**`supabase db push` must not be used here.** It applies *every* migration in `supabase/migrations/` that the project's history does not already contain — on this branch M4, M5, M6 **and** M7. `supabase migration up` behaves the same way. Neither takes a single-file argument.

**Chosen procedure (P1) — `scripts/apply_m4_only.sh`.** One executable script, run by whoever holds a direct database connection. It refuses to write unless every precondition holds:

```bash
SUPABASE_DB_URL='postgresql://…'  DRY_RUN=1 ./scripts/apply_m4_only.sh   # preflight only, no write
SUPABASE_DB_URL='postgresql://…'            ./scripts/apply_m4_only.sh   # preflight, then apply
```

| Step | What it does | Failure behaviour |
|---|---|---|
| 1 | SHA-256 of the migration file vs. the reviewed hash | **stops before touching anything** |
| 2 | `psql` present; pinned CLI present; `migration repair` really accepts `--db-url` | stops |
| 3 | Read-only fingerprint proves the connection is project `jncvvsvckxhqgqvkppmj`: a `cron.job` command naming the ref, the history head, `20260911000100` not already recorded, and both M4 tables absent. **No URL or credential is printed.** | stops |
| 4 | preflight summary; `DRY_RUN=1` exits here | — |
| 5 | `psql --single-transaction -v ON_ERROR_STOP=1 -f <M4>` — **only M4** | the transaction rolls back; **step 6 is never reached, so nothing is recorded as applied** |
| 6 | `supabase migration repair --status applied 20260911000100 --db-url "$SUPABASE_DB_URL"` — the **same connection** verified and applied with | **stops and prints the recovery block below**; never re-runs the SQL, never continues to M5 |
| 7 | `scripts/verify_m4_applied.sql` — schema, exact privileges, function security, recorded version | stops |

> **`--project-ref` does not exist on `migration repair`.** Verified against the pinned CLI (2.84.5): the flags are `--db-url`, `--linked`, `--local`, `--password`, `--status`. An earlier revision of this document proposed `--project-ref` and was wrong.

**SQL succeeded, history repair failed.** The script stops and prints exactly this; do **not** re-run the script (it would re-run the SQL) and do **not** continue to M5:

1. Confirm read-only that the apply landed and the history row is genuinely missing:
   ```sql
   select to_regclass('public.agent_inbound_settings')    as settings_tbl,
          to_regclass('public.agent_phone_registrations') as registrations_tbl,
          (select count(*) from supabase_migrations.schema_migrations
            where version = '20260911000100')             as history_rows;
   ```
2. Only if both tables are non-null **and** `history_rows = 0`, reconcile the **missing history operation alone**:
   ```bash
   ./node_modules/.bin/supabase migration repair --status applied 20260911000100 --db-url "$SUPABASE_DB_URL"
   ```
3. Then run `scripts/verify_m4_applied.sql`.

**Guard rails demonstrated locally** (no production contact): a missing `SUPABASE_DB_URL` stops at step 0; a one-byte change to the migration stops at step 1 with both hashes shown; and a connection pointed at a database that is not the target project stops at step 3.

**Alternative (P2) — MCP `apply_migration`, when no direct connection is available.** **This session has no direct database connection to the project; the Supabase MCP is its only channel, so P1 must be run by someone who has one.** If P2 is used instead:

1. Call `apply_migration` with `project_id = jncvvsvckxhqgqvkppmj`, `name = inbound_agent_settings_and_registrations`, and `query` = the **entire, unmodified** contents of the reviewed file (hash above). Nothing else in the same call.
2. Its arguments are only `project_id`, `name` and `query` — **there is no version argument, so the recorded version is assigned by the service and must not be assumed to be `20260911000100`.** Production history contains both shapes: `20260823222528 / inbound_identity_foundation` (a CLI push, filename preserved) and `20260303233510 / 5927fb1c-…` (an API apply, service-generated).
3. **Read** what was actually recorded:
   ```sql
   select version, name from supabase_migrations.schema_migrations order by version desc limit 3;
   ```
4. If the recorded version is not `20260911000100`, `git mv` the repository file to `<recorded_version>_inbound_agent_settings_and_registrations.sql`, update the hash in this document, and commit the rename — so filename and history agree. **Never hand-write a row into `supabase_migrations.schema_migrations`.**
5. Run `scripts/verify_m4_applied.sql` through `execute_sql`.

**Do not switch procedures mid-apply.** Decide P1 or P2 before the approval is exercised; a partial P1 followed by a P2 retry would apply the SQL twice.

### 2.1 Where the GitHub integration prerequisite actually applies

The unverified Supabase "Deploy to production" setting (§1.5) **gates MERGING, not the direct application of M4.** Applying M4 by P1 or P2 does not involve GitHub and is unaffected by that setting. What the setting could do is cause a later merge to apply **M4–M7 together, unreviewed** — and a merge separately triggers the production frontend deploy (§1.5).

> **Merging this branch stays BLOCKED until both hold:** (a) the Supabase GitHub integration setting is read in the dashboard and confirmed, and (b) the backend release steps that must precede the frontend (M4–M7 and the four Edge Functions) are complete and verified. **The setting remains UNVERIFIED — the dashboard required an interactive sign-in during inspection, which is outside this session's access.**

### Step 1 — M4 `20260911000100_inbound_agent_settings_and_registrations.sql`
- **Effect.** Creates `agent_inbound_settings` (per-agent mobile forward number, greeting, DND) and `agent_phone_registrations` (browser presence), with RLS and the §7.7 policies; adds `heartbeat_phone_registration` (`SECURITY DEFINER`, it writes the caller's own row under RLS) and `is_phone_connected` (`SECURITY INVOKER`, so an authenticated caller is bound by the org-scoped policies). Purely additive: **no existing table, column, function, policy or grant is modified.**
- **Privileges (corrective pass 11).** This project's default privileges hand every table created by `postgres` in `public` the full `arwdDxtm` set to `anon`, `authenticated` **and** `service_role` (verified read-only against `pg_default_acl`), and a `GRANT` only ADDS. M4 therefore **REVOKEs ALL from every grantee first** and then grants exactly: `agent_inbound_settings` → `authenticated` SELECT, INSERT, UPDATE; `agent_phone_registrations` → `authenticated` SELECT only; `service_role` → ALL on both; `anon` → nothing. Without the reset, `authenticated` would have retained DELETE, **TRUNCATE**, REFERENCES, TRIGGER and MAINTAIN — and TRUNCATE is not restrained by row-level security.
- **Effect on legacy calls: none.** No deployed code reads or writes either table.
- **Prerequisites.** Applied by the P1 procedure in §2.0, from the reviewed file whose hash matches. The §1.5 integration setting is **not** a prerequisite for a direct apply — it gates merging (§2.1). A restore point noted beforehand. No lock on `calls` is taken, so no call-traffic window is required.
- **Success checks (read-only) — expressions and grants, not counts.** Run the verification block in §2.2.
- **Recovery.** `supabase/migrations/rollback/20260911000100_inbound_agent_settings_and_registrations.rollback.sql` drops both functions, both tables and the settings guard trigger. Nothing else references them at this point, so the rollback is unconditional. Exercised end to end by `scripts/run_inbound_rollback_test.sh`, which now rolls M7→M6→M5→M4 back and reapplies M4–M7.

### 2.2 M4 post-apply verification (read-only)

Run `scripts/verify_m4_applied.sql` (step 7 of P1 runs it automatically; under P2 run it through `execute_sql`). It checks, in this order:

1. **Tables** — RLS enabled, not force-RLS, owned by `postgres`.
2. **Policy EXPRESSIONS**, not counts — every `USING` / `WITH CHECK` clause printed, so each can be read as organization-scoped; `agent_phone_registrations` must show exactly two SELECT policies and no write policy.
3. **EFFECTIVE table privileges** for `authenticated`, `anon` and `service_role` across SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER — expected `authenticated` = SELECT/INSERT/UPDATE on the settings table and SELECT only on the registrations table, **TRUNCATE and DELETE false on both**, `anon` false everywhere, `service_role` true everywhere.
4. **Function security attributes and ACLs** — `is_phone_connected` `prosecdef = false` with `authenticated=X` and `service_role=X` and no `anon`; `heartbeat_phone_registration` `prosecdef = true`.
5. **Nothing else moved** — `calls` 5 policies, `profiles` 3, `inbound_routing_settings` 3.
6. **The recorded migration version.**

**Cross-organization isolation — self-contained, and only meaningful with data.** An empty registrations table proves nothing: `false` would mean "no rows", not "isolated". Seed a live registration for the org A agent first (through `heartbeat_phone_registration` as that agent), then run this as ONE transaction so the role is still set when the function is called:

```sql
begin;
  select set_config('request.jwt.claims',
                    json_build_object('sub','<ORG_B_USER_UUID>','role','authenticated')::text, true);
  set local role authenticated;
  select (select count(*) from public.agent_phone_registrations)          as rows_visible,  -- expect 0
         public.is_phone_connected('<ORG_A_AGENT_UUID>')                  as leaked;        -- expect FALSE
rollback;
```

Then confirm the same agent reads as connected for a caller in their **own** organization, so the `false` above is isolation rather than absence.

### Step 2 — M5 `20260911000200_inbound_routing_v2_settings.sql`
- **Effect.** **ALTERs the existing `inbound_routing_settings`** table: adds `routing_engine` (default `'legacy'`), `inbound_group_agent_ids`, `browser_ring_seconds` (20), `mobile_ring_seconds`, `voicemail_retention_days`; adds the group-validation trigger and the two admin RPCs (`set_inbound_group`, `set_inbound_routing_engine`).
- **Effect on legacy calls: none while `routing_engine` stays `'legacy'`** — which is the column default, so both organizations read legacy immediately after apply. The deployed `twilio-voice-inbound` v44 does not read the new columns at all.
- **Prerequisites.** M4 applied. The existing row for the home organization must survive untouched (it does — every added column has a default).
- **Success checks.** The five columns exist; the home organization's row reads `routing_engine='legacy'`; the trigger and both RPCs exist; the table's 3 pre-existing policies are unchanged (`pg_policy` count still 3).
- **Recovery.** M5 rollback drops the added columns, the trigger and the RPCs. It does not touch the pre-existing columns or policies.

### Step 3 — M6 `20260911000300_inbound_route_attempts_d13_and_recovery.sql`
- **Effect.** Creates `inbound_route_attempts` (RLS on, zero policies) and adds the D13 columns to `calls` (`routing_engine`, `answered_by_agent_id`, `missed_*`). Creates the routing, acceptance, bridge, abandon, recovery and decision functions. **REPLACES `finalize_inbound_call_terminal`.**
- **⚠ Effect on legacy calls — the one step that changes shared behaviour before v2 exists.** `finalize_inbound_call_terminal` is called today by `twilio-voice-status` v40 and `twilio-voice-inbound` v44 on **every** inbound call. The M6 body differs from the applied one in exactly two ways: (a) its `p_external_answer` branch **no longer clears `is_missed`** (D13 monotonicity — a call forwarded to mobile stays "Missed in AgentFlow"); (b) it closes the call's open ring stages in the same transaction, dynamically and guarded by `to_regclass('public.inbound_route_attempts')`, so on legacy calls (which have no attempts) that block is a no-op. Everything else is verbatim. **A legacy call that is externally answered will now keep `is_missed = true` where it previously had it cleared.** That is the intended D13 correction and it is visible in the missed-call surfaces from the moment M6 lands, before any v2 activation.
- **Prerequisites.** M4 and M5 applied. Agreement that the D13 change above is wanted before v2 activation; if not, M6 must wait until the same window as the function deployments.
- **Success checks.** `inbound_route_attempts` exists with RLS on and **zero** policies; the D13 columns exist on `calls`; `calls_missed_reason_check` and `calls_routing_engine_check` exist; every function in §7.5 of the plan exists with the expected signature; **the 5 stale legacy `ringing` rows in §1.4 are unchanged** (`routing_engine IS NULL`, no attempt rows).
- **Recovery.** M6 rollback (deliberately partial): drops the table, the D13 columns, the decision RPC, `private.intended_recipients_for_call` and the routing functions, but **deliberately does NOT restore the previous `finalize_inbound_call_terminal`**, because that body clears `is_missed` (safeguard 4 / D13). Proven end to end by `scripts/run_inbound_rollback_test.sh`.

### Step 4 — M7 `20260911000400_inbound_voicemails.sql`
- **Effect.** Creates `voicemails` + the private `voicemails` bucket + `calls.voicemail_id`, the mailbox-authorization function and its two policies plus the `storage.objects` policy, the voicemail RPCs, `converge_inbound_notifications`, `sweep_inbound_notifications`, and adds `'voicemail'` to `notifications_type_check`. **Schedules both pg_cron jobs** (see §1.3 — pg_cron is present, so they start immediately).
- **Effect on legacy calls.** The sweeps begin running every 2 minutes. `sweep_inbound_route_attempts` owns only `routing_engine='v2' OR an attempt exists`, so it will find nothing until v2 routes a call. `sweep_inbound_notifications` selects missed calls with `missed_notified_at IS NULL` **and** (a non-empty snapshot **or** `routing_engine='v2'`); the 23 legacy missed calls of the last 30 days have neither (no snapshot column value, no v2 decision), so they are not selected. Expect both jobs to run and do nothing.
- **Prerequisites.** M4–M6 applied. Storage schema present (it is).
- **Success checks.** `voicemails` exists with RLS on and 2 policies; the `voicemails` bucket exists and is **private**; `voicemail_objects_select` exists on `storage.objects`; `notifications_type_check` now includes `'voicemail'`; both cron jobs exist with schedule `*/2 * * * *` **and the 6 pre-existing jobs are unchanged**; after 5 minutes, `cron.job_run_details` shows both jobs succeeding with zero rows processed.
- **Recovery.** M7 rollback unschedules exactly the two jobs it created (pg_cron guard corrected in pass 9 and exercised on a stack without the extension), drops the table, bucket metadata policy, RPCs and the `calls.voicemail_id` column, and restores the pre-M7 `notifications_type_check`. **Gated on zero stored voicemails or an approved export.**

### Steps 5–8 — Edge Functions, in this order
`twilio-voice-status` → `twilio-recording-status` → `recording-retention-purge` → `twilio-voice-inbound`.
- **Effect.** Steps 5–7 make the callback and retention paths v2-aware while remaining correct for legacy traffic; step 8 introduces the v2 engine itself, still gated by `routing_engine` per organization (both read `legacy` at this point).
- **Why this order.** Every consumer of a v2 artefact is deployed **before** the producer. Deploying `twilio-voice-inbound` first would let a v2 call create voicemail and attempt rows that the older status/recording handlers would mis-project.
- **Effect on legacy calls.** `twilio-voice-status` gains `routing_engine` in its projections and routes snapshot rows through `converge_inbound_notifications`; a legacy row (no snapshot, no v2 decision) keeps the existing tier chain unchanged. `twilio-recording-status` only branches when the recording carries `source=voicemail`, which nothing produces yet. `recording-retention-purge` gains a voicemail pass over an empty table.
- **Prerequisites.** M4–M7 applied and verified. Deploy from `35f4e3f`. §1.5 answered if the deployment is done by merge rather than by CLI.
- **Success checks.** Each function reports a new version (41 / 35 / 30 / 45 respectively); place **no** live call; watch the function logs for one legacy inbound call handled end to end with unchanged behaviour (identity resolution, ring, status callback, recording) and no reference to a v2 table; `recording-retention-purge` next scheduled run at 15:08 UTC completes with the recording count unchanged apart from genuine expiries.
- **Recovery.** Redeploy the previous version of the single function (40 / 34 / 29 / 44) from `origin/main` at `1b93f89f`. Because every deployed version keeps serving `stage=` and `source=voicemail` callbacks, a partial rollback never strands in-flight work — but see the drain gate in §4 before removing compatibility.

### Step 9 — Frontend
- **Effect.** Ships the Device lifecycle coordinator, presence/availability, the inbound settings cards, missed-call surfaces and the voicemail player.
- **⚠ Prerequisite specific to this environment.** Per §1.5, a merge to `main` deploys the frontend automatically. Either (a) merge only when steps 1–8 are complete and the frontend is wanted, or (b) confirm the Supabase "Deploy to production" integration is OFF first, so the same merge does not also try to apply migrations. **Both facts must be settled before the merge, not after.**
- **Success checks.** `www.fflagent.com` serves the new build; an agent can sign in, sees the phone connection diagnostics card, and a browser registration row appears in `agent_phone_registrations`; no console errors from the Device coordinator; outbound dialling unaffected.
- **Recovery.** Vercel instant rollback to the previous production deployment.

### Step 10 — Organization prerequisites (NOT verifiable before steps 1–9)
Fresh v2 registrations, a validated inbound group, per-agent mobile numbers or an acknowledged voicemail-only configuration, mailbox access, and reviewed ring measurements. **None of these can be checked now:** the tables, the admin cards and the registration writer do not exist yet. Add for this environment: **configure at least one direct line** if P1 is to be verified live (§1.4 shows zero today).

### Step 11 — Activate v2 for ONE organization
- **Effect.** `set_inbound_routing_engine('v2')` for Family First Life – Chris Garness. A production settings write requiring its own approval under invariant #28. From this point new inbound calls of that organization record `routing_engine='v2'` and route through the v2 engine; calls already in flight keep the engine they were decided with (first decision wins).
- **Success checks.** The row reads `v2`; the next inbound call creates exactly one `inbound_route_attempts` row and one `calls.routing_engine='v2'`; the sweeps still report zero owed work.
- **Recovery.** `set_inbound_routing_engine('legacy')` stops NEW v2 calls only; then the drain gate in §4.

### Step 12 — Controlled live verification
See §5. Until it completes, **Alexa's incident is unverified.**

---

## 3. What the existing gate evidence already covers (do not repeat)

All of the following were re-executed after the corrective-pass-11 changes to M4, M7 and the test harness, and need no repetition unless the code changes again: the 10 SQL suites (including the new R7–R9 organization-isolation and security-attribute tests) plus both two-session proofs, all six three-session barrier proofs and the rollback proof — now **M7 → M6 → M5 → M4 → reapply M4–M7**; `scripts/verify_inbound_generated_types.sh`; `tsc --noEmit` exit 0; the app-config error set byte-identical to `main` (81); four Edge bundles; the full vitest suite (2510 passing, the same 11 environment-only baseline failures as `main`); `npm run build`. No TypeScript changed in this pass, so eslint has nothing new to cover.

**Re-run only where drift or preparation creates a concrete need.** Nothing found in §1 changes the code, so nothing needs re-running today.

---

## 4. Corrected drain gate (replaces the §14 wording)

Run **as one read-only script** before restoring any earlier function version, and again before running any rollback file. **Every row count must be zero.** Age and retry limits appear only as reported columns — never as filters — so nothing outstanding can be hidden by being old or by having exhausted its budget.

```sql
-- Inbound v2 drain gate — READ ONLY. Every count must be 0.
-- Ownership follows the durable per-call decision (calls.routing_engine) OR an existing route attempt;
-- owed work follows the implemented retry/error columns. No age or attempt cap filters the rows.
with v2_calls as (
  select c.* from public.calls c
   where c.direction = 'inbound'
     and (c.routing_engine = 'v2'
          or exists (select 1 from public.inbound_route_attempts a where a.call_id = c.id))
)
select 'a1 open route attempts (any age)'                as check, count(*) as owed from public.inbound_route_attempts where not terminal
union all
select 'a2 v2-owned calls not terminal',                 count(*) from v2_calls
  where ended_at is null and status not in ('completed','failed','no-answer')
union all
select 'a3 organizations still on v2',                   count(*) from public.inbound_routing_settings where routing_engine = 'v2'
union all
select 'b1 voicemails pending or failed',                count(*) from public.voicemails where status in ('pending','failed')
union all
select 'b2 voicemails stored but not notified',          count(*) from public.voicemails where status = 'stored' and notified_at is null
union all
-- purged rows still owe the Twilio-side deletion (voicemails_cleanup_batch selects stored AND purged)
select 'b3 source deletion still owed',                  count(*) from public.voicemails
  where status in ('stored','purged') and source_cleanup_state <> 'deleted'
union all
select 'c1 missed-call notifications owed (snapshot)',   count(*) from public.calls
  where direction = 'inbound' and is_missed and missed_notified_at is null
    and cardinality(coalesce(missed_recipient_ids, '{}'::uuid[])) > 0
union all
-- corrective pass 7: a v2 call whose intended recipient is UNRESOLVED carries an EMPTY snapshot and is
-- still owed. The pre-pass-7 gate required a non-empty snapshot and silently skipped exactly these rows.
select 'c2 missed-call notifications owed (unresolved v2)', count(*) from public.calls
  where direction = 'inbound' and is_missed and missed_notified_at is null
    and cardinality(coalesce(missed_recipient_ids, '{}'::uuid[])) = 0
    and routing_engine = 'v2'
union all
select 'd1 retry budget exhausted — notifications',      count(*) from public.calls
  where direction = 'inbound' and is_missed and missed_notified_at is null and missed_notify_attempts >= 50
union all
select 'd2 retry budget exhausted — voicemail notify',   count(*) from public.voicemails
  where status = 'stored' and notified_at is null and notify_attempts >= 50
union all
select 'd3 retry budget exhausted — source cleanup',     count(*) from public.voicemails
  where status in ('stored','purged') and source_cleanup_state <> 'deleted' and source_cleanup_attempts >= 50
order by 1;
```

Diagnostic companion (also read-only) for anything the gate reports — it shows the age and the recorded reason so the obligation can be settled rather than waited out:

```sql
select c.id, c.created_at, now() - c.created_at as age, c.status, c.routing_engine,
       c.missed_reason, cardinality(coalesce(c.missed_recipient_ids,'{}'::uuid[])) as recipients,
       c.missed_notify_attempts, c.missed_notify_next_at, c.missed_notify_error
  from public.calls c
 where c.direction = 'inbound' and c.is_missed and c.missed_notified_at is null
 order by c.created_at;

select v.id, v.call_id, v.created_at, now() - v.created_at as age, v.status,
       v.notified_at, v.notify_attempts, v.notify_error,
       v.source_cleanup_state, v.source_cleanup_attempts, v.source_cleanup_error
  from public.voicemails v
 where v.status in ('pending','failed')
    or (v.status = 'stored' and v.notified_at is null)
    or (v.status in ('stored','purged') and v.source_cleanup_state <> 'deleted')
 order by v.created_at;

select a.id, a.call_id, a.created_at, now() - a.created_at as age, a.stage,
       a.mobile_accept_result, a.mobile_leg_ended_at, a.final_outcome
  from public.inbound_route_attempts a where not a.terminal order by a.created_at;
```

**Verified on an isolated database (M1–M7 applied locally, 2026-09-12).** Both blocks above execute as written. Seeded with one v2 call that is missed and terminal with an EMPTY snapshot and `missed_notify_error='unresolved_recipient'`, plus one genuine legacy missed call with no snapshot:

| Check | Result |
|---|---|
| **Old §14 check (d)** (`cardinality(missed_recipient_ids) > 0`) | **0 — passes the gate with the obligation outstanding** |
| Corrected `c1` (snapshot owed) | 0 |
| Corrected `c2` (unresolved v2 owed) | **1 — the row the old wording skipped** |
| Corrected `d1` (retry budget exhausted) | 0 (3 attempts recorded, reported not filtered) |

The legacy row is correctly counted by neither `c1` nor `c2` (it carries no v2 decision) and still appears in the diagnostic listing for human review.

**Rules that survive unchanged.**
1. **Flag first.** `set_inbound_routing_engine('legacy')` stops new v2 calls only. **Every compatible handler stays deployed while the gate cannot be established** — removing callback compatibility with work outstanding is out of scope.
2. **The 30-minute quiet period is retained and is not a substitute.** It starts only *after* every count above is zero, and covers Twilio's override retries and late recording callbacks. A quiet period alone is never proof.
3. **An attempt whose parent ended and whose obligations are complete may be closed only by an approved ops SQL statement — never silently**, and never by relaxing the gate.
4. **D13 is absolute:** no rollback may restore a `finalize_inbound_call_terminal` body that clears `is_missed`. The M6 rollback is deliberately partial for exactly this reason.
5. Restoring earlier `twilio-voice-status` / `twilio-recording-status` versions would route recipients through the legacy tiers and store `source=voicemail` recordings into `calls.recording_*`; that is what the gate protects.

---

## 5. Controlled live verification checklist

**Every item below is UNPROVEN.** None has been executed; all require placing real calls, which is not authorized here. Run them against the single activated organization, with a named observer and the Edge logs open.

| # | Check | Pass condition |
|---|---|---|
| L1 | **Alexa's incident — background-tab audibility** | With the AgentFlow tab in the background and the browser minimised, an inbound call to her assigned number produces an **audible** ring on her machine |
| L2 | **Alexa's incident — correct assigned-agent routing** | That same call rings **Alexa** (the contact's assigned agent), not the group and not the number's owner |
| L3 | Measured computer ring duration | Agent-perceived ring (Device `incoming` → `cancel`) and the server span both land near the configured 20 s; record both and calibrate `browser_ring_seconds` from the data |
| L4 | Speakers and headset | Ringtone audible on the selected output device; switching output mid-ring keeps it audible |
| L5 | Mobile Press 1 and bridge evidence | Press 1 bridges the caller; the parent Dial action records `DialBridged=true`; `mobile_bridge_evidence` and `answered_by_agent_id` are set |
| L6 | Missed classification survives mobile acceptance | After a bridged mobile answer the call still reads "Missed in AgentFlow — forwarded to mobile" (D13), and the alert names the intended agent |
| L7 | Busy handling | A second call while the owner is on a call is refused as busy and follows the configured next step, with no double ring |
| L8 | DND / On Break | An owner on Do Not Disturb is skipped with `missed_reason='dnd'` |
| L9 | Group routing | With no owner, the configured group rings (≤10 members); the first to answer wins and the others are released immediately |
| L10 | Voicemail storage, playback, access | A voicemail is stored in the private bucket, playable by the recipient, and **not** readable by an unrelated agent; `listened_at` stamps on play |
| L11 | Presence across tabs and logout | Two tabs produce one coherent presence; closing one keeps presence; logout clears it and stops ringing |
| L12 | Callback recovery and cron | Kill a callback mid-flight: the sweeps settle the call within two cron ticks, with exactly one alert to the intended recipient |
| L13 | Outbound regression | Outbound dialling, recording and dispositions unchanged |
| L14 | Direct line (P1) | **Requires configuring a direct line first (§1.4: zero today).** A call to it rings only its owner |

**Also outstanding, not a live check:** the **extension-present rollback test** — `scripts/run_inbound_rollback_test.sh` proves the M7→M6→reapply sequence on a stack **without** pg_cron. Behaviour with pg_cron installed (jobs absent, jobs present, unrelated jobs preserved) is unproven and needs a disposable environment that has the extension. Production has pg_cron, so this should be exercised on a Supabase preview branch or an equivalent disposable project **before** the M7 rollback would ever be needed.

---

## 6. Missing access identified

| Needed | Why | Who |
|---|---|---|
| Dashboard read of Project Settings → Integrations → GitHub | Confirm "Deploy to production" is still OFF, so a merge cannot auto-apply M4–M7 (§1.5, §2.1). The dashboard requires an interactive sign-in, so it is **unverified**; it blocks MERGING, not the direct M4 apply | Chris |
| Decision on the Vercel auto-deploy coupling | Merging deploys the frontend to `www.fflagent.com` automatically; the release order needs that to be intentional (§2 step 9) | Chris |
| A disposable stack with pg_cron | The extension-present half of the rollback proof (§5) | Chris / this session, given such an environment |
