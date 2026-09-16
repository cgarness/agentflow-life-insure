# Inbound Calling v2 + Agent Voicemail — Release readiness

**Source commit for the release artefacts:** branch `claude/agentflow-inbound-plan-fkl6zi`, base `main` `1b93f89f990b1482d90bf935633594c2851b8da8`. The M4 file approved below is identified by its **SHA-256 content hash**, not only by the commit, so the reviewed bytes are the applied bytes:

```
fe846c43a91e9aaf81e112edcf0cfb320414047e0e15de149f75160232fe8e29  supabase/migrations/20260914000530_inbound_agent_settings_and_registrations.sql
```

**Prepared:** 2026-09-13 (rev 6) · **Updated:** 2026-09-16 (rev 16) · **Status: ALL FOUR MIGRATIONS M4–M7 ARE APPLIED, `twilio-voice-status` IS DEPLOYED AND FULLY VERIFIED AT v42, and `twilio-recording-status` IS DEPLOYED AND FULLY VERIFIED AT v35** — the v41 byte-for-byte failure (one dropped leading newline) was corrected forward under a separate approval and v42 now matches the approved package digest exactly (see §2 Step 5); `twilio-recording-status` v35 passed every verification criterion on the first deployment (see §2 Step 6). **Everything else is still PREPARATION ONLY** and needs its own approval.
**Executed under Chris's four separate approvals of 2026-09-14 (M4) and 2026-09-15 (M5, M6, M7), and nothing else:** applied to `jncvvsvckxhqgqvkppmj` by the §2.0 P1 MCP procedure — M4 recorded as **`20260914000530 / inbound_agent_settings_and_registrations`**, M5 as **`20260915025931 / inbound_routing_v2_settings`**, M6 as **`20260915035141 / inbound_route_attempts_d13_and_recovery`**, M7 as **`20260915053646 / inbound_voicemails`**; every contract verified; the pre-existing tables proven unchanged; the repository filenames reconciled after each. **Every organization remains on `routing_engine = 'legacy'` with an empty inbound group. No Edge deployment, no merge, no frontend deploy, no v2 activation, no Twilio or integration change, no application data written or seeded, no rollback run.**
**M7 armed two live pg_cron jobs, both every two minutes, the moment it committed** — `inbound-notify-sweep` and `inbound-route-attempt-sweep`. Chris approved this explicitly and understood they start before v2 activation. Their no-op was verified **separately from the run log**: ten scheduled executions succeeded (five per job, zero failures), and `max(calls.updated_at)` remained **2026-09-14 21:30:10**, i.e. earlier than the migration, so not one `calls` row was written.
**M6 made ONE immediate change to shared legacy behaviour, explicitly approved by Chris:** its replacement `finalize_inbound_call_terminal` **no longer clears an existing `is_missed` flag when it records an external answer** (D13 monotonicity). It applies while every organization is still on legacy routing. **It did not reclassify history** — M6 contains no `UPDATE` and no backfill, and none was run; the 1 862 `calls` rows and the 268 already flagged missed are numerically unchanged.
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

### 1.1 Migrations — M4 APPLIED 2026-09-14; M5, M6 AND M7 APPLIED 2026-09-15

**M4 is applied.** Recorded as **`20260914000530 / inbound_agent_settings_and_registrations`** — the version was assigned by the service, and the repository file was renamed to it (M5–M7 renamed to `…531/532/533` so the M4→M7 order is preserved). The stored statement is byte-identical to the approved file: `md5(statements[1]) = 65d1f9a176c53dd7008a0901899e8c4a`, which is the md5 of `fe846c43…32fe8e29` without its trailing newline (16 736 of 16 737 bytes; the service strips the final newline).

**M5 is applied**, recorded as **`20260915025931 / inbound_routing_v2_settings`**; its stored statement is byte-identical to `0c67bc1f…dbb99fdd` (`md5(statements[1]) = 3f2cc40801094a8d649b5d24b503eefe`, 12 733 of 12 734 bytes).

**M6 is applied**, recorded as **`20260915035141 / inbound_route_attempts_d13_and_recovery`** — again a service-assigned version, and again the repository file was renamed to it (M7 moved to `20260915035142` so M4→M5→M6→M7 ordering survives). Its stored statement is byte-identical to `94b55e92…0b3c2165`: `md5(statements[1]) = b9534e8699320a3d769871a3862ccc05` is the md5 of the file **without** its trailing newline and `md5(statements[1] || E'\n') = c5360e5c96cccff5767029b3ac896bfe` is the md5 of the file **exactly** (76 994 of 76 995 bytes — the service strips the final newline). M7 was moved to `20260915035142` at that point and moved again to `20260915053646` when it was itself applied.

**M7 is applied**, recorded as **`20260915053646 / inbound_voicemails`**, exactly one history row, zero near-miss names, `stmt_count = 1`. Its stored statement is byte-identical to `9267b56f…4ca7cf73` — and here the service kept the file **whole**, unlike M4–M6: `md5(statements[1]) = ec34d58a6685acf59cf281c4fd534531` is the md5 of the approved file **exactly**, and `octet_length(statements[1]) = 32 715` equals the file's own byte count, trailing newline included. No trailing-newline normalisation occurred for this migration, so M4–M6's "stored bytes = file bytes − 1" does **not** describe M7. The table below is the state as inspected on 2026-09-12, with all four migrations' objects now present:

| Object | Production state |
|---|---|
| `agent_inbound_settings`, `agent_phone_registrations` | **present (M4, 2026-09-14)** — RLS on, 4 + 2 policies, contract verified |
| `inbound_route_attempts` | **present (M6, 2026-09-15)** — 27 columns, PK, `UNIQUE(call_id)`, FK to `calls` `ON DELETE CASCADE`, 6 CHECKs, 2 indexes, RLS **on with ZERO policies**, `service_role` only (no `anon`/`authenticated`/`PUBLIC` privilege of any kind, `TRUNCATE` and `MAINTAIN` included). **0 rows.** |
| `voicemails` | **present (M7, 2026-09-15)** — 25 columns, PK, `UNIQUE(recording_sid)`, `UNIQUE(storage_path)`, 3 FKs, 4 CHECKs, 8 indexes, RLS on with **exactly the two approved policies**. `authenticated` holds **SELECT plus column-scoped `UPDATE(listened_at)` and nothing else**; `anon` and `PUBLIC` hold nothing at all; `service_role` holds the full set incl. `TRUNCATE` and `MAINTAIN`. **0 rows.** |
| storage bucket `voicemails` | **present (M7, 2026-09-15)** — **private**, `file_size_limit = 26 214 400`, `allowed_mime_types = {audio/mpeg}`, **0 objects**. Distinct from the pre-existing **public** bucket `voicemail-assets`, which M7 does not touch and which has no `storage.objects` policy |
| `storage.objects` | 17 pre-existing policies **unchanged** (digest `f439a29e…e5aecdfb`) + M7's `voicemail_objects_select` = 18. Every pre-existing policy is bucket-scoped to another bucket; **none granted access to the new bucket before or after** |
| `calls.routing_engine`, `.answered_by_agent_id`, `.missed_reason`, `.missed_for_agent_id`, `.missed_recipient_ids`, `.missed_notified_at`, `.missed_notify_*` | **present (M6, 2026-09-15)** — all nine additive, with their types, defaults, nullability, the two FKs to `profiles(id) ON DELETE SET NULL`, `calls_routing_engine_check`, `calls_missed_reason_check` and the three `idx_calls_missed*` indexes. **`routing_engine` is NULL on every existing row — no backfill.** |
| `calls.voicemail_id` | **present (M7, 2026-09-15)** — `uuid`, nullable, `calls_voicemail_id_fkey → public.voicemails(id) ON DELETE SET NULL`. **NULL on every one of the 1 862 rows.** Note it inherits `public.calls`' pre-existing table-wide grants to `anon`/`authenticated` (M7 adds and removes no grant on `calls`); access is governed by that table's five RLS policies |
| `calls.routed_agent_ids`, `calls.recording_source_sid` | present (M1–M3) |
| `heartbeat_phone_registration`, `is_phone_connected`, `private.agent_inbound_settings_guard` | **present (M4, 2026-09-14)** — body digests, security attributes and `search_path` pins verified |
| `plan_inbound_route`, `record_inbound_engine_decision`, `abandon_inbound_routing`, `sweep_inbound_route_attempts`, `is_agent_busy`, `mark_inbound_missed`, `private.intended_recipients_for_call` + the acceptance/bridge/leg-end/CAS/`private.commit_owner_mobile` set | **present (M6, 2026-09-15)** — 16 new functions, each verified on signature, return type, `md5(prosrc)`, security attribute, volatility, `search_path` pin and **effective** EXECUTE (private helpers executable by nobody but the owner; public RPCs by `service_role` only, never `anon`/`authenticated`). **Defined, not scheduled and not invoked** — scheduling is M7. |
| `converge_inbound_notifications`, `sweep_inbound_notifications`, `upsert_voicemail_from_recording`, `can_access_voicemail`, `mark_voicemail_source_deleted`, `record_voicemail_cleanup_failure`, `voicemails_cleanup_batch`, `voicemails_expired_batch`, `mark_voicemails_purged`, `private.resolve_snapshot_recipients`, `private.missed_call_label` | **present (M7, 2026-09-15)** — all **eleven**, each verified on signature, return type, `md5(prosrc)`, security attribute, volatility, `search_path` setting and effective EXECUTE. `can_access_voicemail` is executable by `authenticated` + `service_role`; the seven other public functions by `service_role` only; the two `private.` helpers by nobody but the owner — and `anon`, `authenticated` and `service_role` hold **no USAGE on schema `private`** at all |
| `finalize_inbound_call_terminal` | **REPLACED by M6, 2026-09-15** — `md5(prosrc)` moved from `a0c2ac59eb2f2eabf23c6a628211691f` to `a862334f208820a44a8467cef4bd726b`; still `SECURITY DEFINER`, `search_path`-pinned, **`service_role`-only EXECUTE**. The executable difference is exactly the approved one (see Step 3). |
| `ingest_inbound_call` | present (M1–M3 body, untouched) |
| `inbound_routing_settings` | **exists** (earlier migration), RLS on, 3 policies (unchanged), 14 pre-existing columns **plus M5's five**: `routing_engine='legacy'`, `inbound_group_agent_ids='{}'`, `browser_ring_seconds=20`, `mobile_ring_seconds=20`, `voicemail_retention_days=30`; 10 constraints (4 + M5's 6); 1 trigger (M5's validator) |
| `profiles` | unchanged except M5's `profiles_availability_status_check` (8 → 9 constraints). Live values remain `Available` / `Offline` only. **M6 changed nothing here** — policies, RLS, grants, triggers and all 9 constraint definitions digest identically before and after |
| `calls` (existing shape) | policies (5), RLS, grants (32) and the trigger digest **identically** before and after M6; the **11 pre-M6 constraints still digest to `8ce427ce09bcc24f566744c558c51e7d`** and the only additions are M6's two FKs and two CHECKs (11 → 15) |

### 1.2 Edge Functions — the four affected

| Function | Live version | `verify_jwt` | Changed by this branch |
|---|---|---|---|
| `twilio-voice-status` | **40** | false | yes (projections + snapshot routing + `routing_engine`) |
| `twilio-recording-status` | **34** | false | yes (voicemail branch) |
| `recording-retention-purge` | **29** | false | yes (voicemail retention pass) |
| `twilio-voice-inbound` | **44** | false | yes (v2 engine, deadline, decision, failure path) |
| `inbound-call-claim` | 38 | false | no |

These match the plan's §1 inspection basis exactly — **no drift**.

**Live now (2026-09-15), after Steps 5 and 6:** `twilio-voice-status` **42** and `twilio-recording-status` **35**, both ACTIVE with `verify_jwt = false`. `recording-retention-purge` **29**, `twilio-voice-inbound` **44** and `inbound-call-claim` **38** are unchanged. The table above is retained as the 2026-09-12 inspection basis, not as current state.

### 1.3 Extensions, jobs, buckets, RLS

- **`pg_cron` 1.6.4 and `pg_net` 0.19.5 ARE installed.** Consequence: **M7 scheduled both sweeps the moment it was applied** — `inbound-notify-sweep` and `inbound-route-attempt-sweep`, every 2 minutes, both `active`, both running as `postgres` on database `postgres`. `cron.job` now holds **9** rows.
- Pre-existing cron jobs: **SEVEN**, not six — an earlier revision of this line said "6" while listing seven names, and the count was wrong, not the list. All seven are unrelated to M7 and were verified **unchanged** after the apply (digest `0c624ca33d4c92ee0ef917dc85edf43e` over name/schedule/command/username/active/database): `cleanup-old-notifications` (`0 3 * * *`), `daily-call-limit-reset` (`0 0 * * *`), `email-sync-incremental-every-5m` (`*/5 * * * *`), `google-calendar-inbound-sync-every-5m` (`*/5 * * * *`), `recording-retention-purge-daily` (`15 8 * * *`), `reset-daily-call-counts` (`0 0 * * *`), `spam-check-daily` (`0 3 * * *`).
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

**Targeting must come from the call or the connection — never from row content.** A database can hold any text at all, including a `cron.job` command that names `jncvvsvckxhqgqvkppmj`. Finding that string proves nothing about which database is answering. Corrective pass 12 demonstrated the failure: the previous script passed its "fingerprint" step against a **different project's** connection whose cron and history content had been made to match. Both procedures below therefore bind the target by an identifier that is part of the request itself.

---

#### PRIMARY — P1: MCP `apply_migration`, explicitly targeted

This is the procedure **this session can actually execute**, and the one the approval request in §7 asks for. `apply_migration` takes `project_id` as a required argument, so the target is named in the call; there is no connection to mis-resolve and no content to be spoofed.

**Before the write — establish the starting state (read-only), in PREFLIGHT mode.** The classifier reads the same facts before and after, but the *conclusion* it is allowed to draw differs (see *P1 — uncertain outcome*), so the mode is explicit:

```
execute_sql(project_id = "jncvvsvckxhqgqvkppmj",
            query = "SET m4.mode = 'preflight';" + <contents of scripts/verify_m4_state.sql>)
```

Require **`next_action = PROCEED_WITH_APPLY`**. *Executed 2026-09-13, read-only:* `NEITHER | preflight | PROCEED_WITH_APPLY | m4_objects=0 | m4_history_rows=0 | m5_m7_rows=0 | history_head=20260823222926 | other_open_transactions=0 | prepared_xacts=0`. Anything else — including `PARTIAL` from a duplicate or conflicting history row — means stop and re-inspect; do not write.

> **How M4 is recognised in the history.** Not by the authored version alone. `apply_migration` records a **service-assigned** version under the **submitted name**, so matching on `version = '20260914000530'` would miss a perfectly good MCP apply and wrongly report `SCHEMA_ONLY` — sending the operator to repair a history row that is already there. A row is M4 if its `name` is exactly `inbound_agent_settings_and_registrations`, or its `version` is the authored version (what `migration repair` writes under P2 — verified on a disposable database, where the CLI records that same exact name). Every match is returned in `m4_history_versions`, so the identity is read rather than guessed, and **duplicates, conflicting identities and partial object sets are `PARTIAL`**, never a clean state.

Also capture the **before-image** of the objects M4 must not touch, by running `scripts/verify_m4_untouched.sql` through `execute_sql`. *Executed 2026-09-12:* `calls 5/21 · inbound_routing_settings 3/21 · notifications 4/21 · phone_numbers 4/21 · profiles 3/8` (policies / role grants), all `rls_enabled=true`, `force_rls=false`.

**The write — one call, nothing else in it:**

```
apply_migration(
  project_id = "jncvvsvckxhqgqvkppmj",
  name       = "inbound_agent_settings_and_registrations",
  query      = <the ENTIRE, UNMODIFIED contents of the reviewed file, sha256 fe846c43…32fe8e29>
)
```

Verify the hash locally immediately before the call:

```bash
sha256sum supabase/migrations/20260914000530_inbound_agent_settings_and_registrations.sql
# must print fe846c43a91e9aaf81e112edcf0cfb320414047e0e15de149f75160232fe8e29
```

**The recorded version is assigned by the service.** `apply_migration` has only `project_id`, `name` and `query` — there is no version argument, so **`20260914000530` must not be assumed.** Production history already contains both shapes: `20260823222528 / inbound_identity_foundation` (a CLI push, filename preserved) and `20260303233510 / 5927fb1c-…` (an API apply, service-generated). Read what actually landed:

```
execute_sql(project_id = "jncvvsvckxhqgqvkppmj",
            query = "select version, name from supabase_migrations.schema_migrations order by version desc limit 3;")
```

**Verification — §2.2.** Only after both verifiers pass is M4 applied.

**Filename reconciliation.** If the recorded version is not `20260914000530`, `git mv` the repository file to `<recorded_version>_inbound_agent_settings_and_registrations.sql`, recompute and update the hash in this document, and commit the rename, so filename and history agree. **Never hand-write a row into `supabase_migrations.schema_migrations`.**

#### P1 — uncertain outcome

If the `apply_migration` call errors, times out, or its response is lost, **that does not establish that nothing was written.** Do not call it again. Run `scripts/verify_m4_state.sql` through `execute_sql` **in recovery mode** and act on `next_action` only:

```
SET m4.mode = 'recovery';   <the whole of scripts/verify_m4_state.sql after it>
```

`recovery` is the classifier's default when the mode is unset, so a forgotten `SET` gives the conservative reading rather than the permissive one.

| `state` → `next_action` | Meaning | Action |
|---|---|---|
| `NEITHER` → `OUTCOME_UNRESOLVED_DO_NOT_REPLAY` | **no committed M4 state was observed at this read** — which is *not* the same as "nothing landed" | **stop; do not submit the migration again.** See the rule below |
| `SCHEMA_ONLY` → `RECONCILE_HISTORY_ONLY` | the SQL committed, no M4 history row | do not re-apply and do not insert a row by hand. The history operation alone is reconciled by someone with a direct connection: `supabase migration repair --status applied 20260914000530 --db-url …`. First establish that a history repair is not itself still in flight — a repeated repair that later lands would create a duplicate row. Escalate; M5 does not start |
| `BOTH` → `COMPLETE_VERIFY_AND_STOP` | the write landed despite the failed response | nothing more to write — run §2.2 and stop |
| `PARTIAL` → `INVESTIGATE_WRITE_NOTHING` | some objects present, **duplicate** history rows, or **conflicting** migration identities | **stop and investigate read-only.** Write nothing: not the SQL, not a history row, not M5 |

If `execute_sql` itself cannot be reached, the state is **UNKNOWN**: write nothing at all until it can be read.

> **`NEITHER` after an uncertain outcome never authorises a replay.**
>
> This is a snapshot of *committed* state. Under PostgreSQL's default READ COMMITTED isolation a statement sees only what was committed before it began, so an apply that is **still running** in another session is completely invisible to this read and commits a moment later ([PostgreSQL 17, Read Committed](https://www.postgresql.org/docs/17/transaction-iso.html#XACT-READ-COMMITTED)). Submitting again in that window applies M4 twice.
>
> Replay is permitted only once the **original** operation is authoritatively known to have ended **without committing** — for example the server returned a definitive SQLSTATE for that statement (a PostgreSQL error, not a connection reset, a timeout, a proxy 5xx or a lost response), or the backend that ran it is provably gone and no prepared transaction holds its work. **Elapsed time does not establish it. Repeated empty reads do not establish it.** If it cannot be established, stop and report the outcome to the approver as **UNRESOLVED**.
>
> The classifier's `other_open_transactions`, `backends_naming_m4_objects` and `prepared_xacts` columns exist to make an in-flight operation *visible*; they can only ever show that something **is** running. Zeroes prove nothing — a pooled connection, a backend between statements, or a snapshot taken at the wrong instant all read as quiet.

**Never**, on any branch: automatically replay the SQL, fabricate a history row, switch from P1 to P2 (or back) mid-operation, or continue to M5.

---

#### ALTERNATIVE — P2: `scripts/apply_m4_only.sh`, for an operator with a direct connection

**This session has no direct database connection to the project.** P2 is documented for whoever does. It is a single executable script that refuses to write unless every precondition holds:

```bash
SUPABASE_DB_URL='postgresql://…'  DRY_RUN=1 ./scripts/apply_m4_only.sh   # preflight only, no write
SUPABASE_DB_URL='postgresql://…'            ./scripts/apply_m4_only.sh   # preflight, then apply
```

| Step | What it does | Failure behaviour |
|---|---|---|
| 1 | SHA-256 of the migration file vs. the reviewed hash | **stops before touching anything** |
| 2 | `psql` present; pinned CLI present; `migration repair` really accepts `--db-url` | stops |
| 3 | **Target binding from the connection string itself** — the project ref is parsed out of the Supabase-issued hostname (`db.<ref>.supabase.co`) or the pooler username (`postgres.<ref>`) and must equal `jncvvsvckxhqgqvkppmj`. A host that yields no ref (a bare IP, a lookalike domain, a pooler host with no ref in the username) is **AMBIGUOUS** and refused. Neither the host nor the derived ref reveals any credential | stops before any write |
| 4 | Corroboration against independently verified project facts (§1): PostgreSQL major **17** and history head **`20260823222926`**; then `scripts/verify_m4_state.sql` in **preflight** mode, which must return `next_action = PROCEED_WITH_APPLY`. The count of `cron.job` rows naming the ref is printed but **explicitly labelled supporting evidence, not proof of identity** | stops |
| 5 | Before-image of the pre-existing tables (`scripts/verify_m4_untouched.sql`) | stops |
| 6 | preflight summary; `DRY_RUN=1` exits here | — |
| 7 | `psql --single-transaction -v ON_ERROR_STOP=1 -f <M4>` — **only M4** | see *uncertain outcome* below |
| 8 | `supabase migration repair --status applied 20260914000530 --db-url "$SUPABASE_DB_URL"` — the **same connection** verified and applied with | see *uncertain outcome* below |
| 9 | `scripts/verify_m4_schema.sql`, `scripts/verify_m4_history.sql`, and an after-image diffed against step 5 | stops; the success line is never printed |

> **`--project-ref` does not exist on `migration repair`.** Verified against the pinned CLI (2.84.5): the flags are `--db-url`, `--linked`, `--local`, `--password`, `--status`. An earlier revision of this document proposed `--project-ref` and was wrong.

#### P2 — uncertain outcome

**A failed `psql` invocation is not a confirmed rollback,** and a failed `migration repair` response does not prove its write did not land: a connection can drop after the server has committed. The script therefore never claims a rollback. On any non-zero exit from step 7 or step 8 it runs `scripts/verify_m4_state.sql` **in recovery mode** and prints the branch for the `next_action` it finds — the same four-way table as P1, under the same rule: `OUTCOME_UNRESOLVED_DO_NOT_REPLAY` **stops the operator** (exit 3) with the read-committed explanation and the two conditions that would authorise a replay, rather than inviting one; `RECONCILE_HISTORY_ONLY` points at `migration repair` alone and warns that a repeated repair which later lands would duplicate the history row. If the reconciliation query itself fails, it reports **UNKNOWN** and exits 2 with nothing suggested.

**Do not switch procedures mid-apply.** Decide P1 or P2 before the approval is exercised; a partial P1 followed by a P2 retry would apply the SQL twice.

### 2.1 Where the GitHub integration prerequisite actually applies

The unverified Supabase "Deploy to production" setting (§1.5) **gates MERGING, not the direct application of M4.** Applying M4 by P1 or P2 does not involve GitHub and is unaffected by that setting. What the setting could do is cause a later merge to apply **M4–M7 together, unreviewed** — and a merge separately triggers the production frontend deploy (§1.5).

> **Merging this branch stays BLOCKED until both hold:** (a) the Supabase GitHub integration setting is read in the dashboard and confirmed, and (b) the backend release steps that must precede the frontend (M4–M7 and the four Edge Functions) are complete and verified. **The setting remains UNVERIFIED — the dashboard required an interactive sign-in during inspection, which is outside this session's access.**

### Step 1 — M4 `20260914000530_inbound_agent_settings_and_registrations.sql`
- **Effect.** Creates `agent_inbound_settings` (per-agent mobile forward number, greeting, DND) and `agent_phone_registrations` (browser presence), with RLS and the §7.7 policies; adds `heartbeat_phone_registration` (`SECURITY DEFINER`, it writes the caller's own row under RLS) and `is_phone_connected` (`SECURITY INVOKER`, so an authenticated caller is bound by the org-scoped policies). Purely additive: **no existing table, column, function, policy or grant is modified.**
- **Privileges (corrective pass 11).** This project's default privileges hand every table created by `postgres` in `public` the full `arwdDxtm` set to `anon`, `authenticated` **and** `service_role` (verified read-only against `pg_default_acl`), and a `GRANT` only ADDS. M4 therefore **REVOKEs ALL from every grantee first** and then grants exactly: `agent_inbound_settings` → `authenticated` SELECT, INSERT, UPDATE; `agent_phone_registrations` → `authenticated` SELECT only; `service_role` → ALL on both; `anon` → nothing. Without the reset, `authenticated` would have retained DELETE, **TRUNCATE**, REFERENCES, TRIGGER and MAINTAIN — and TRUNCATE is not restrained by row-level security.
- **Effect on legacy calls: none.** No deployed code reads or writes either table.
- **Prerequisites.** Applied by the P1 (MCP) procedure in §2.0, from the reviewed file whose hash matches. The §1.5 integration setting is **not** a prerequisite for a direct apply — it gates merging (§2.1). A restore point noted beforehand. No lock on `calls` is taken, so no call-traffic window is required.
- **Success checks (read-only) — asserted, not printed.** Run the machine-checked verifiers in §2.2; a mismatch fails the step.
- **Recovery.** `supabase/migrations/rollback/20260914000530_inbound_agent_settings_and_registrations.rollback.sql` drops both functions, both tables and the settings guard trigger. Nothing else references them at this point, so the rollback is unconditional. Exercised end to end by `scripts/run_inbound_rollback_test.sh`, which now rolls M7→M6→M5→M4 back and reapplies M4–M7.

### 2.2 M4 post-apply verification (read-only, MACHINE CHECKED)

**Verification asserts; it does not print.** The previous `verify_m4_applied.sql` only `SELECT`ed catalog rows, so the procedure reported "M4 APPLIED AND VERIFIED" whenever those statements *executed*. A local database with RLS disabled, `TRUNCATE` granted to `authenticated` and no history row still passed it. That file has been **deleted** and replaced by three payloads that raise on any mismatch, plus one before/after comparison. All four are **plain SQL** — no `\echo`, no other psql meta-command — so the same bytes run under `psql -f` and through MCP `execute_sql`.

| File | What it asserts | Success output |
|---|---|---|
| `scripts/verify_m4_schema.sql` | **pins `search_path` to `pg_catalog`** for the whole check (see below), then asserts: both tables exist and there is **exactly one function per name** (an IN-list count would accept two overloads of one name and none of the other); RLS **enabled**, force-RLS **not** set, owner equal to `public.profiles`' owner; the **exact effective privilege matrix** for `authenticated` / `anon` / `service_role` over SELECT, INSERT, UPDATE, DELETE, **TRUNCATE**, REFERENCES, TRIGGER and **MAINTAIN**; **the COMPLETE definition of each of M4's six policies** and that no seventh exists; for each of the three functions its **exact signature, security attribute, volatility, `SET search_path` pin and `md5(prosrc)` BODY DIGEST**, plus EXECUTE permissions; the guard **trigger's `tgenabled`, its timing/event mask (`tgtype = 23`) and the function it fires**, and that the table carries exactly one user trigger; and that M4 created no policy on a pre-existing table | one row `M4_SCHEMA_CONTRACT_VERIFIED` |
| `scripts/verify_m4_history.sql` | **exactly one** history row carrying the *exact* submitted name `inbound_agent_settings_and_registrations`; its recorded version, **resolved from that row** and optionally pinned; that no near-miss name (a substring match) exists; that the authored version is not claimed under a different or absent name; that its tables really exist; and that **none of M5–M7** is recorded, by version **or** by name | one row `M4_HISTORY_VERIFIED` with the resolved version |
| `scripts/verify_m4_state.sql` | nothing — it **classifies**: `NEITHER` / `SCHEMA_ONLY` / `BOTH` / `PARTIAL`, plus the `mode` it ran in and the `next_action` that follows. Object completeness requires **each** component in its own right, so a compensating error cannot reach a complete state. `m5_m7_rows > 0` overrides everything in either mode: this approval covers M4 alone | one classification row |
| `scripts/verify_m4_untouched.sql` | nothing — for `calls`, `profiles`, `inbound_routing_settings`, `notifications`, `phone_numbers` it captures RLS and force-RLS, **each policy's full definition** (command, permissiveness, roles including PUBLIC, USING and WITH CHECK separately) in a stable order, and **every table- and column-level privilege** as `grantee:PRIVILEGE` pairs from the catalog ACL, with an md5 of each set, and reports the `search_path` it was read under as its first column. Run **before and after**; every field must be identical | five rows, compared |

Any mismatch raises `M4 SCHEMA CONTRACT FAILED (n problem(s)): …` / `M4 HISTORY CONTRACT FAILED (…)` listing **every** problem found with its expected and actual value, `psql` exits 3, and `execute_sql` returns an error rather than a result set. **There is no path that prints success without the assertions having passed.**

**Policies are compared as complete definitions, not as fragments.** Searching the combined `USING`/`WITH CHECK` text for `get_org_id()` accepted policies that had been widened: deleting `agent_id = auth.uid()` from the settings self-insert policy leaves the fragment intact while letting an agent create *another agent's* settings row, and concatenating the two clauses lets one correct clause conceal a wrong one. The verifier now compares, per policy, the **target table, command, roles (PUBLIC included), permissiveness, and `USING` and `WITH CHECK` separately**, against M4's reviewed text — and rejects any seventh policy.

**The deparse is pinned, so the caller cannot change the verdict.** `pg_get_expr` qualifies a name only when the bare name does *not* resolve to that object under the session's `search_path`, so whether `public.` appears is a property of the caller, not of the policy. An earlier revision normalised that away by deleting every `public.` prefix — which collapsed "the function in `public`" and "whatever the session resolves the bare name to" into one string. Under `SET search_path = evil, public`, a policy rewritten to call `evil.get_org_id()` deparsed as `get_org_id()` and **verified clean**. The verifier now pins `search_path` to `pg_catalog` (transaction-local, inside its own `DO` block) so every non-`pg_catalog` name is fully qualified, compares against fully qualified expected strings, and normalises nothing but runs of whitespace. *Verified read-only on the target's PostgreSQL 17.6, deliberately invoked from a hostile session path:* the pinned comparison run against three pre-existing production policies — including `inbound_routing_settings_update`, whose `USING` deparses to precisely the shape M4's `agent_inbound_settings_admin_select` uses, and a cross-schema `profile_authz.can_update_profile(id)` — returned `PINNED_POLICY_COMPARISON_MATCHES_ON_PG17 | 17.6`.

**Existence is not identity, for functions or for triggers.** A guard whose body is replaced by `RETURN NEW` keeps its name, signature, `SECURITY DEFINER` flag and revoked EXECUTE while silently dropping the loop check M4 exists to enforce; `ALTER TABLE … DISABLE TRIGGER` leaves the `pg_trigger` row in place; re-creating the trigger as `BEFORE INSERT` only drops the `UPDATE` half; and `RESET search_path` on a definer function makes it resolve through the caller's path. Each of those is now a contract failure: the verifier pins `md5(prosrc)`, `prosecdef`, `provolatile` and `proconfig` for all three functions, and `tgenabled`, `tgtype` and `tgfoid` for the trigger. The digests are of M4 at `fe846c43…32fe8e29` and change only if that file changes.

**Counts are not a comparison, so the untouched image no longer uses them.** Revoking `UPDATE` and granting `TRUNCATE`, rewriting a policy's expression, or turning a policy `RESTRICTIVE` all leave every total unchanged; each is caught by the definition and ACL digests instead.

**Schema and history are verified separately on purpose.** Recovery from a failed history repair leaves a *correct* schema with a *missing* history row; that state has to be diagnosable and fixable on its own.

**Under P1 the recorded version is service-assigned.** The history verifier **resolves** it from the row carrying the exact name, so nothing needs editing or pinning. Pin it only to assert a specific value — for instance the version the apply response reported:

```sql
SET m4.expected_version = '<the version read back from schema_migrations>';
-- …then the entire contents of scripts/verify_m4_history.sql in the same execute_sql payload
```

**How to run them**

- **P1 (MCP):** `execute_sql(project_id = "jncvvsvckxhqgqvkppmj", query = <file contents>)`, once per file — prefixed by `SET m4.mode = '…';` for the classifier. *Proven against this project, read-only:* the classifier returned `NEITHER | preflight | PROCEED_WITH_APPLY` with `pg_stat_activity`, `pg_prepared_xacts` and the history all readable (2026-09-13); the untouched payload returned its five rows, including `profiles` with 35 **column-level** grants that a count-only image would have flattened away; the policy-canonicalisation probe returned `POLICY_CANONICALISATION_MATCHES_ON_PG17 | 17.6`; a DO-block verifier of exactly this shape returned the MCP **error** `M4 SCHEMA CONTRACT FAILED (2 problem(s)): MISSING TABLE public.agent_inbound_settings || MISSING TABLE public.agent_phone_registrations` — the correct answer while M4 is unapplied, and proof that a mismatch surfaces as a failure and not as a printed row; a probe of every remaining construct returned `CONSTRUCT_PROBE_OK | 17.6 | maintain_checked = true`; and `SET …;` followed by further statements in one payload was accepted and read back. **`maintain_checked = true` means the MAINTAIN rows of the privilege matrix will really be checked on this server** — locally they are skipped, because PostgreSQL 16 has no such privilege.
- **P2 (psql):** run automatically as step 9. Standalone: `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/verify_m4_schema.sql`.

**Cross-organization isolation — proven on an isolated database; INCONCLUSIVE on the hosted one.** Immediately after M4, `public.agent_phone_registrations` is empty, so a hosted read returning `false` means "no rows", not "isolated". **Do not seed production registrations to make the check look meaningful.** Isolation is proven instead by `supabase/tests/inbound_registrations.sql` R7/R9/R10 on a disposable database with real rows in two organizations, run as one transaction so `SET LOCAL ROLE authenticated` is still in force when the function is called:

```sql
begin;
  select set_config('request.jwt.claims',
                    json_build_object('sub','<ORG_B_USER_UUID>','role','authenticated')::text, true);
  set local role authenticated;
  select (select count(*) from public.agent_phone_registrations)          as rows_visible,  -- expect 0
         public.is_phone_connected('<ORG_A_AGENT_UUID>')                  as leaked;        -- expect FALSE
rollback;
```

Record the hosted result as **inconclusive (table empty)** until real registrations exist; re-run it during the §5 live checks, when the first agent has registered, and only then does the hosted `false` carry information.

### Step 2 — M5 `20260915025931_inbound_routing_v2_settings.sql` — **APPLIED 2026-09-15**

> **Outcome.** Approved by Chris on 2026-09-15 for source `810ef79655b9d65ad023553f0bf781611b7fcab9` and file hash `0c67bc1f…dbb99fdd`. One `apply_migration` call, **recorded as `20260915025931 / inbound_routing_v2_settings`**, one history row, stored SQL byte-identical to the approved file. `M5_CONTRACT_VERIFIED` on PostgreSQL 17.6. Every organization is still on `routing_engine = 'legacy'` with an empty group. Repository filenames reconciled (M5 → `20260915025931`, M6/M7 → `…32`/`…33`; **M4 keeps `20260914000530`**).

- **Effect.** **ALTERs the existing `inbound_routing_settings`** table: adds `routing_engine` (default `'legacy'`), `inbound_group_agent_ids` (default `'{}'`), `browser_ring_seconds` (20), `mobile_ring_seconds` (20), `voicemail_retention_days` (30), all `NOT NULL`; adds **six** CHECK constraints on that table (`…_engine_check`, `…_browser_ring_check`, `…_mobile_ring_check`, `…_vm_retention_check`, `inbound_group_size`, `inbound_v2_requires_group`); adds the group-validation trigger `trg_inbound_routing_settings_validate`; adds **three private helpers** (`private.validate_inbound_group`, `private.inbound_routing_settings_validate`, `private.assert_inbound_settings_admin`) and the two public admin RPCs (`set_inbound_group`, `set_inbound_routing_engine`).
- **It also constrains `public.profiles` (scope correction).** M5 adds a **seventh** CHECK, `profiles_availability_status_check`, permitting `Available`, `On Break`, `Do Not Disturb`, `Offline` (P14). Earlier revisions of this section omitted it and described M5 as touching only `inbound_routing_settings`; that was wrong. Pre-apply the live values were only `Available | Offline` across 11 profiles, with **0 violations and 0 NULLs**, so the constraint validated without touching a row. No availability value was changed.
- **Existence guards match `conname` GLOBALLY.** Each constraint is created inside `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = …)`, and `conname` is not unique across tables — a same-named constraint on **any** table would silently skip creation. Pre-apply check: **none of the seven names existed anywhere**. All seven are present and `convalidated` after the apply.
- **Effect on legacy calls: none while `routing_engine` stays `'legacy'`** — the column default, so the one existing organization reads legacy immediately after apply. The deployed `twilio-voice-inbound` v44 does not read the new columns at all.
- **Prerequisites.** M4 applied (it is, as `20260914000530`, contract re-verified immediately before this apply). The existing row survives untouched — proven, not assumed: the md5 of that row's **pre-existing 14 columns** (`to_jsonb(row)` minus the five new keys) is `b737ffde…be66ec3` both before and after.
- **Success checks (all executed).** Five columns with their exact types, `NOT NULL` and defaults; all seven CHECKs with their exact `pg_get_constraintdef` text, on the right table, `convalidated`; the trigger's complete `pg_get_triggerdef` plus `tgenabled = 'O'`; all five functions' signatures, `md5(prosrc)` body digests, security attributes, `SET search_path = pg_catalog, pg_temp` pins and effective EXECUTE (the three private helpers executable by **nobody** but the owner; the two RPCs by `authenticated` and `service_role`, never `anon`); every settings row `legacy` with an empty group and 20/20/30; policies, RLS and grants **identical** on all seven affected/adjacent tables; M4 intact; M6–M7 absent.
- **Recovery.** M5 rollback drops the added columns, the constraints, the trigger and the functions. It does not touch the pre-existing columns or policies. **Not run** — this approval forbids it.

### Step 3 — M6 `20260915035141_inbound_route_attempts_d13_and_recovery.sql` — **APPLIED 2026-09-15**

> **Outcome.** Approved by Chris on 2026-09-15 for source `0357bff4dfa6eefa527cca2be285dac5c800c2a9` and file hash `94b55e92…0b3c2165`, **including the immediate shared behaviour change below and explicitly excluding any historical reclassification**. One `apply_migration` call, **recorded as `20260915035141 / inbound_route_attempts_d13_and_recovery`**, one history row, no near-miss name, stored SQL byte-identical to the approved file. `M6_CONTRACT_VERIFIED` on PostgreSQL 17.6. Verification was **catalog-only** — no planning, finalization, abandonment, missed-call, acceptance, bridge or sweep function was invoked as a health check. Every organization is still on `routing_engine = 'legacy'` with an empty group; M7 is unapplied and no cron job was added. Repository filenames reconciled (M6 → `20260915035141`, M7 → `20260915035142`, later moved again to `20260915053646` at M7's own apply; **M4 keeps `20260914000530` and M5 keeps `20260915025931`**).
- **Effect.** Creates `inbound_route_attempts` (RLS on, zero policies) and adds the D13 columns to `calls` (`routing_engine`, `answered_by_agent_id`, `missed_*`). Creates the routing, acceptance, bridge, abandon, recovery and decision functions. **REPLACES `finalize_inbound_call_terminal`.**
- **⚠ Effect on legacy calls — the one step that changes shared behaviour before v2 exists, and it is NOW LIVE.** `finalize_inbound_call_terminal` is called by `twilio-voice-status` v40 and `twilio-voice-inbound` v44 on **every** inbound call. The M6 body differs from the previously applied one in exactly two ways: (a) its `p_external_answer` branch **no longer clears `is_missed`** (D13 monotonicity — a call forwarded to mobile stays "Missed in AgentFlow"); (b) it closes the call's open ring stages in the same transaction, dynamically and guarded by `to_regclass('public.inbound_route_attempts')` — but that block only ever touches rows of the call it was given, and legacy calls have no attempts, so it is a no-op for them. Everything else is verbatim. **From 2026-09-15, a legacy call that is externally answered keeps `is_missed = true` where it previously had it cleared.** That is the intended D13 correction, approved for this legacy window, and it is visible in the missed-call surfaces now, before any v2 activation. **It is forward-facing only: no existing row was re-classified** — M6 runs no `UPDATE` and no backfill, and the missed count stayed at 268 of 1 862 across the apply.
- **Confirmed against the deployed body before the apply.** The live `finalize_inbound_call_terminal` digested `a0c2ac59eb2f2eabf23c6a628211691f`, as recorded in the approval. Comment-stripped, the executable diff to M6's body (`a862334f208820a44a8467cef4bd726b`) is **only**: one added `v_open uuid[]` declaration, the removal of `is_missed = false` from the `p_external_answer` branch, and the `to_regclass('public.inbound_route_attempts')`-guarded attempt-closure block that preserves `missed_recipient_ids` / `missed_for_agent_id`. Tenant checks, claim protections, terminal-state handling and duration authority are **verbatim**.
- **Prerequisites.** M4 and M5 applied — both were, and both contracts were re-verified immediately before this apply. Chris approved the D13 change for the legacy window explicitly.
- **Success checks (all executed, catalog reads only).** The table's complete column, key, constraint, index, RLS and privilege contract, `TRUNCATE` and `MAINTAIN` included — RLS on, **zero** policies, `service_role` only; all nine `calls` columns with types, defaults, nullability, both FKs, both CHECKs and the three indexes; **all seventeen** functions' signatures, return types, `md5(prosrc)`, security attributes, volatility, `search_path` pins and effective EXECUTE, the replaced finalizer included; policies, RLS, grants and triggers **identical** on all seven existing tables, with `calls`'s 11 pre-M6 constraints still digesting `8ce427ce…c558c51e7d`; M4 and M5 contracts intact; the settings row still md5 `3bfd8969…9638cce3f1` with every row `legacy` and an empty group; **0 seeded attempt rows and 0 `routing_engine` backfill**; `calls` still 1 862 rows / 268 missed; **the 5 stale legacy `ringing` rows in §1.4 unchanged** (md5 `9e553bba…d537f67`, `routing_engine IS NULL`, no attempt rows); `voicemails` absent, M7 unrecorded, `cron.job` still 7 rows with no inbound job.
- **Recovery.** M6 rollback is **deliberately partial and must never be described as restoring the complete pre-M6 behaviour**: it drops the table, the D13 columns, the decision RPC, `private.intended_recipients_for_call` and the routing functions, but **deliberately KEEPS the corrected `finalize_inbound_call_terminal`**, because the previous body clears `is_missed` (safeguard 4 / D13). Restoring a writer that clears `is_missed` is prohibited. Proven end to end by `scripts/run_inbound_rollback_test.sh`. **Not run** — this approval forbids it.

### Step 4 — M7 `20260915053646_inbound_voicemails.sql` — **APPLIED 2026-09-15**

> **Outcome.** Approved by Chris on 2026-09-15 for source `cb4fe6779a6dbe3c851e572e583bac451d83c79c` and file hash `9267b56f…4ca7cf73`, **including the two live cron jobs, which he understood start at commit and before v2 activation**. One `apply_migration` call, **recorded as `20260915053646 / inbound_voicemails`**, one history row, no near-miss name, stored SQL byte-identical to the approved file (whole file, no newline normalisation). `M7_CONTRACT_VERIFIED` and `M7_STATE_VERIFIED` on PostgreSQL 17.6. Repository filenames reconciled (M7 → `20260915053646`; **M4–M6 keep their recorded versions**). Every organization is still on `routing_engine = 'legacy'` with an empty group, and **no application row was seeded, backfilled or written**.
- **Effect.** Creates `voicemails` + the private `voicemails` bucket + `calls.voicemail_id`, the mailbox-authorization function and its two policies plus the `storage.objects` policy, the voicemail RPCs, `converge_inbound_notifications`, `sweep_inbound_notifications`, and adds `'voicemail'` to `notifications_type_check`. **Schedules both pg_cron jobs** (see §1.3 — pg_cron is present, so they start immediately).
- **Effect on legacy calls — measured, not predicted.** Both sweeps now run every 2 minutes. `sweep_inbound_route_attempts` owns only `routing_engine='v2' OR an attempt exists`; `sweep_inbound_notifications` selects missed calls with `missed_notified_at IS NULL` **and** (a non-empty snapshot **or** `routing_engine='v2'`). Pre-apply, **34** inbound calls were missed-and-unnotified, but all had `cardinality(missed_recipient_ids) = 0` and `routing_engine IS NULL`, so the due-set was empty; the 5 stale `ringing` rows matched every conjunct of the route sweep's branch (b) **except** the `(v2 OR attempt-exists)` guard — and it held. Both facts were re-confirmed immediately before the write and again after it.
- **That guard is stronger than "no organization is on v2 yet", and the distinction matters.** `calls.routing_engine` is stamped **per call, at call time**, by `record_inbound_engine_decision` — verified in production to be the only function that writes that column, to take the engine as a parameter, to write only when the column is still NULL, and to never read `inbound_routing_settings` at all. The org flag lives in a different table and column, written by M5's `set_inbound_routing_engine`. **Activating v2 for an organization therefore does not stamp, and cannot stamp, the five months-old stale rows** — they stay NULL. Reaching them would take a deliberate manual `UPDATE` of `calls.routing_engine` on those rows, or a manual `INSERT` of a route attempt against them. No code path in M6 or M7 does either. If it ever happened the blast radius would exceed those five rows: they would be finalized `no-answer`, marked missed with a resolved recipient snapshot, and would then become due in the notify sweep on the next tick, producing real user-visible `missed_call` notifications.
- **⚠ This safety is data-dependent, not structural.** Neither sweep has an age floor, a `created_at` cutoff or an activation gate. If a legacy call ever acquired a non-empty `missed_recipient_ids`, it would become due and be notified with `metadata.source = 'inbound_v2'`. Nothing writes that column under legacy today (only M6's v2 paths do), but this is worth knowing before v2 is switched on for anyone.
- **Prerequisites.** M4–M6 applied — all three were, with their contracts re-verified immediately before this apply. Storage schema present. All eleven function names, the table, both unique index names, the five CHECK names, the three policy names, the bucket id **and** name, and both cron job names were confirmed free database-wide first.
- **Success checks (all executed).** The complete table, column, constraint, foreign-key and index contract; RLS on with **exactly** the two approved policies; `authenticated` = SELECT + column-scoped `UPDATE(listened_at)` with **no** table-wide UPDATE, INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER or MAINTAIN; `PUBLIC` and `anon` with nothing; `service_role` with the approved full set; the bucket private at exactly 26 214 400 bytes / `audio/mpeg`; `voicemail_objects_select` matching the approved definition with all 17 pre-existing storage policies and all 40 storage grants unchanged; all **eleven** functions on signature, body digest, security attribute, volatility, configuration and effective EXECUTE; `notifications_type_check` adding **only** `'voicemail'` and preserving all eight previous types (asserted individually); M4–M6 intact including the corrected finalizer at `a862334f…bd726b`; every routing settings row still `legacy` with an empty group; and **no seeded or backfilled data** — 0 voicemails, 0 attempts, 1 862 calls / 268 missed, 98 notifications with an unchanged row set, 0 `calls.voicemail_id`, 0 `routing_engine`.
- **Cron verification — what the run log does and does not prove.** `cron.job_run_details` recorded **ten** `succeeded` runs — five per job, 05:38 to 05:46 UTC, **zero failures**, `username = postgres`, `database = postgres`, both jobs `active`. Its `return_message` of **`1 row` describes the shape of the `SELECT` result, not the number of records the function processed** — each sweep returns exactly one JSON row whatever it did. Zero work was therefore established **separately**: both due-set queries re-ran empty, and `max(calls.updated_at)` was still **2026-09-14 21:30:10**, earlier than the migration itself, so across all ten executions **not one `calls` row was written**; `notifications` stayed at 98 with row-set digest `380f661b…d4fe7690` and nothing created after the apply; `voicemails` and `inbound_route_attempts` stayed empty; the five stale legacy calls stayed byte-identical at `653c1cf3…53889ee9`, all still `ringing` with `ended_at IS NULL`.
- **Recovery — and two honest limits.** M7 rollback unschedules exactly the two jobs it created, drops the table, the bucket metadata policy, the RPCs and the `calls.voicemail_id` column, and restores the pre-M7 `notifications_type_check`. **Gated on zero stored voicemails or an approved export.** **Not run.** Two things must not be overstated:
  1. **The pg_cron-present rollback path remains UNPROVEN.** `scripts/run_inbound_rollback_test.sh` exercises the rollback on a stack **without** the extension, so the `ELSE` branch is what has been tested. Production has pg_cron, so M7's apply was the **first** execution of the extension-present branch anywhere, and the rollback's extension-present branch has still never run. Forward execution does not prove rollback. It needs a disposable stack that has pg_cron before it would ever be relied on.
  2. **The rollback retains the storage bucket and any media in it.** It is not a complete removal of every artifact M7 created.

### Step 5 — `twilio-voice-status` — **DEPLOYED AND VERIFIED 2026-09-15 at v42** (v41 corrected forward)

> **Final state: version 42, ACTIVE, FULLY VERIFIED.** `verify_jwt = false`, entrypoint `functions/twilio-voice-status/index.ts`, `import_map = false`, `ezbr_sha256 = d9bbe55cc30e58e33e61644537bf5e43b6c33a5bdeff256f24a1972754953b27`. An independent readback confirms **all five files byte-identical** to the approved source and the package manifest equal to the approved **`9d8540cb…d8aa174f`**. `functions/_shared/notifications.ts` is **7 702 bytes with first byte `0x0A`** and sha256 `c853f682…3d3c172c`.
>
> **How it got there — two deployments, recorded honestly.**
> - **v41 (first attempt).** Approved from `95dcc46e…`, deployed ACTIVE with `ezbr 16715618…`. Four of five files were byte-identical, but the deploy payload I composed **dropped the leading blank line of `notifications.ts`** (7 701 bytes against 7 702), so the manifest came out `d527b53f…` instead of `9d8540cb…`. **Recorded as a FAILED verification, not a pass.** Bundling both packages and normalising only esbuild's path-banner comments produced byte-identical output (`20cc1876…c6196a`), so v41's executable behaviour was already exactly the approved behaviour — but that does not satisfy "byte for byte" or "manifest matches". Per the approval, deployment writes stopped: no redeploy, no rollback, no secret or authentication change.
> - **v42 (corrective forward deployment).** Separately approved from head `3221265223d0f4ee6fc1f39d3914f2841fcc610d`, **retaining the original approved source and manifest**; the sole correction was restoring that leading LF. Before submitting, the payload was rebuilt from the repository and validated on first byte, last byte, length and sha256 per file, and the manifest was re-derived **from the payload object itself** and matched `9d8540cb…`. One `deploy_edge_function` call. Precedent followed: `twilio-voice-inbound` v43's 81-byte comment-only defect was likewise corrected **forward** to v44 rather than by restoring baselines.
>
> **What was newly executed for v42, and what was not.** Newly executed: the payload construction and its per-file validation, the single corrective deploy call, and the full post-deploy readback verification. **Not re-executed:** the 118 focused regressions and the esbuild dependency-closure/bundle checks — those ran against the **same approved application source**, which is unchanged between v41 and v42 (only a comment-region newline differs), so they remain applicable but are earlier results, not fresh v42 evidence.

**Verified at deployment time.** M4–M7 all applied (`20260914000530` / `20260915025931` / `20260915035141` / `20260915053646`); all eight `calls` columns the new projection selects exist; `converge_inbound_notifications(p_call_row_id uuid)` present, `SECURITY DEFINER`, body `24db4e0f…`, **`service_role` EXECUTE only** (the handler runs on the service-role key); `uq_notifications_user_event_key` present; every organization still `legacy` with an empty group (`3bfd8969…`). The other three release functions are **unchanged across both deployments** at `twilio-recording-status` 34, `recording-retention-purge` 29, `twilio-voice-inbound` 44 (`inbound-call-claim` likewise still 38). No application data changed: `calls` 1 862 with `max(updated_at)` still 2026-09-14 21:30:10, notifications 98 (`380f661b…`), voicemails 0, attempts 0, and the M7 sweeps still 308/308 succeeded with zero failures.

**Why the blast radius is currently nil.** **0** calls carry `routing_engine` and **0** carry a recipient snapshot, so every existing row takes the unchanged legacy tier chain; the new convergence branch is unreachable until the v2 engine (`twilio-voice-inbound`) is deployed and activated.

**Checks that could not be run, stated plainly.** **Deno is not installed** in this environment, so no `deno check` of the entrypoint was possible; the Supabase CLI is absent, so no local `functions serve` smoke test. Substitutes actually run: an esbuild bundle proving the module graph resolves with the dependency closure equal to exactly the five approved files and `https://esm.sh/@supabase/supabase-js@2` as the only external, `tsc --strict` clean on the four Deno-free modules, and 8 focused test files / **118 tests all passing** (legacy recipients, D13 snapshots, unresolved v2 recipients, retryable DB failures → 503, callback convergence, terminal-state freezing, duration monotonicity). **No runtime evidence of v41 or v42 exists:** `function_edge_logs` holds 7 invocations for this function, all on 2026-09-14 between 18:09 and 21:30 UTC — before either deployment — so no natural callback has reached the new code, and none was generated (no synthetic callback, no live call). That is a gap in observation, entirely separate from the package verification above, which is complete. Live routing, ringing and callback behaviour remain unproven until the controlled tests.

### Step 6 — `twilio-recording-status` — **DEPLOYED AND VERIFIED 2026-09-15 at v35**

> **Final state: version 35, ACTIVE, verification PASSED on every criterion, first attempt.** `verify_jwt = false`, entrypoint `functions/twilio-recording-status/index.ts`, `import_map = false`, `ezbr_sha256 = 640aadefd311ab5181ed6c9b89d5c987ccee5a53b15a88188c58a6764e9489b1` (baseline v34 was `a56a0620…`). Deployed under Chris's approval of 2026-09-15 for head `a675f89d8101b500250d13bb44302201becdbfb8`, from the baseline **v34, ACTIVE, `verify_jwt = false`**, in **one** `deploy_edge_function` call.
>
> **Byte-for-byte readback — the deploy response was not treated as verification.** An independent `get_edge_function` read returned exactly the two expected files, both byte-identical to the approved source:
>
> ```
> e478bcd2599a3070a03986a9cb776fa5a8ad441f86e61e6a9333b1ce5d36bbe3  functions/twilio-recording-status/index.ts       26 845 bytes
> c22b77198389bc4c7028fcca62ec5fc0492255ac1604cb4d366b959046e56645  functions/twilio-recording-status/idempotency.ts  14 049 bytes
> ```
>
> The package manifest re-derived **from the deployed bytes** is `6abaa784d34309724493e82feb094194523473712a5a78c24ffc90533fa0fe97` — **equal to the approved manifest**. Before submitting, the payload had also been validated per file on first byte, last byte, byte length and sha256, and its manifest re-derived **from the payload object itself**; that pre-submission check is the practice adopted after the v41 defect, and here it held end to end.
>
> **One naming detail, reported rather than glossed.** The readback lists the files as `twilio-recording-status/index.ts` and `twilio-recording-status/idempotency.ts` — **without** the `functions/` prefix the approval specifies and the payload submitted. The prefix is not lost: `entrypoint_path` resolves to `…/source/functions/twilio-recording-status/index.ts`, and the v34 baseline listed its files the same stripped way. It is a platform display normalisation of the `files[].name` field, so the manifest is computed over the **approved submitted paths**; over the stripped names it would read `0e56475f…` instead, which is why the form matters and is stated here explicitly.

**Verified at deployment time.** Head `a675f89d` == origin, tree clean. M4–M7 all applied. The four voicemail RPCs the new branch calls — `upsert_voicemail_from_recording`, `mark_voicemail_source_deleted`, `record_voicemail_cleanup_failure`, `converge_inbound_notifications` — are present with the exact expected signatures, `SECURITY DEFINER`, `search_path` pinned, **`service_role` EXECUTE only**. The `voicemails` bucket is **private**, `26 214 400` bytes, `audio/mpeg`, **0 objects**. `voicemails` **0 rows**, 0 cleanup owed, 0 notifications owed, `inbound_route_attempts` **0 rows**, `notifications` of type `voicemail` **0**.

**Unchanged after the deployment, checked explicitly.** `twilio-voice-status` **42**, `recording-retention-purge` **29**, `twilio-voice-inbound` **44**, `inbound-call-claim` **38** — all ACTIVE, all `verify_jwt = false`. Routing is still **legacy**: the single `inbound_routing_settings` row reads `routing_engine = 'legacy'` and was last written **2026-08-26**, long before this work; the second organization still has no row, which reads as legacy. **Zero** organizations are non-legacy.

**Why the blast radius is currently nil.** The diff against the deployed baseline is **273 insertions, 0 deletions** — purely additive — so the conversation-recording pipeline is unchanged line for line. The new code is reached only when the callback URL carries `source=voicemail`, and the only producer of that URL is `twilio-voice-inbound`'s v2 path, which is **not deployed** (still v44) and would be gated by `routing_engine` anyway. Nothing in production can currently generate such a callback.

**Live traffic during the window, characterised rather than assumed.** One real inbound call arrived **before** the deployment and was handled end to end by **v34**: call row `c828ae2a-7ea9-48b3-aa7e-35e455c63273`, 20:02:02–20:02:52 UTC, completed, answered, not missed; the recording callback at 20:02:56 downloaded 246 595 bytes, uploaded, logged `Verified metadata persist`, deleted the Twilio source, and returned **200**. `calls` moved 1 862 → 1 863 because of it.

**Checks that could not be run, stated plainly.** **Deno is not installed**, so no `deno check`; the **Supabase CLI is absent**, so no local `functions serve` smoke test. Substitutes actually run for this package: an esbuild bundle proving the dependency closure is exactly the two approved files with `https://esm.sh/@supabase/supabase-js@2` as the only external, `tsc --strict` clean on `idempotency.ts`, and 4 test files / **56 tests all passing**.

**Runtime behaviour of v35 is UNPROVEN, and that is separate from the package verification above, which is complete.** `function_edge_logs` holds exactly **one** invocation of this function in the last 24 hours — the 20:02 call above, which ran on **v34**, before v35 became ACTIVE at **20:11:48 UTC**. **No natural callback has reached v35**, and none was generated: no live call, no synthetic callback, no recording upload, no manual cleanup request. `max(calls.updated_at)` is **2026-09-15 20:02:57**, earlier than the deployment, so no application data was written after it either. Live voicemail storage, source deletion and notification convergence remain unverified until the controlled tests.

### Step 6b — `twilio-recording-status` — **A SECOND PACKAGE NOW AWAITS REVIEW (2026-09-16)**

> **Production still runs v35.** A narrow, development-only correction to its **voicemail branch only** was authorised: the branch defaulted the recording's owning account to the platform credential (`params["AccountSid"] ?? creds.accountSid`), used that for the DELETE, and persisted it through `p_account_sid` as authoritative. Ownership is now **established** — from the signature-validated callback, or from an already-stored matching owner on a retry — with an explicit `ownership_conflict` when the two disagree and an `ownership_unresolved` 503 (source preserved, nothing guessed, nothing persisted) when neither can establish it. **The ordinary conversation-recording branch is byte-identical to deployed v35** from `Deno.serve` onward.
>
> ```
> f5cfcbe2c33555c308fa7a58f5a0512d935bfd017f98a3b52d3e41f3dc5014de  functions/twilio-recording-status/idempotency.ts  16,722 bytes
> e1a12e78048fe75d36686d653bc97ed97e4a94746c17498ef02b6d59d845459c  functions/twilio-recording-status/index.ts        29,099 bytes
> ```
> **manifest `fefb8ef97d2a008315a4d4df87b06b8cb5bf9563be192375a93e1904e73cb2e8`**, entrypoint `functions/twilio-recording-status/index.ts`, `verify_jwt = false`, no import map. **Not deployed.**

### Step 7 — `recording-retention-purge` — **CORRECTED PACKAGE AWAITING REVIEW; DEPLOYMENT ON HOLD (2026-09-16)**

> **Production still runs v29, and the earlier approval is superseded.** An independent reviewer reproduced four defects against the approved 411faf4 source, so the deployment approval was put on hold and a bounded corrective pass was authorised instead. **Nothing was deployed.**
>
> **The corrected package is TWO files** — the voicemail phases moved into a Deno-free helper so they are unit-testable (the house pattern already used by `twilio-recording-status/idempotency.ts`):
>
> ```
> 7db40c798d15f1a903ef1c862148897433dfa0cfb6a523ef246e7ffddeb688e2  functions/recording-retention-purge/index.ts        7,935 bytes
> 2a0cbaa1417cbe7c122772ad45ef1d3a027bfd3fa0ad47f3f2e96e64f9646ad3  functions/recording-retention-purge/voicemail.ts  48,637 bytes
> ```
> **manifest `8612c4b6d0d5705f9da7bfefa5960ba517596fb8f01071b13afb5cbe27a84b6b`**, entrypoint `functions/recording-retention-purge/index.ts`, `verify_jwt = false`, no import map. The **old 9,002-byte source and manifest `c42c4006…d7c9e164` are SUPERSEDED** and authorize only the old package.
>
> **The four reproduced defects, and what changed.**
> | | Reproduced against 411faf4 | Corrected behaviour |
> |---|---|---|
> | **D1** | provider DELETE succeeds, metadata RPC errors → one deletion reported, cleanup pending, nothing logged | counted `unresolved`; `reconciled` only when the database confirms; explicit error log |
> | **D2** | provider DELETE fails and recording the failure errors → attempts unchanged, silently | `unresolved`, attempts never claimed to have advanced, logged with the 50-attempt caveat |
> | **D3** | 101 eligible rows → only 100 processed | loops further batches while budget and capacity remain; 101 processed across 3 batches |
> | **D4** | stalled first DELETE blocks every later row | cancellable 10 s timeout + concurrency 5; later rows progress |
>
> **Documented execution limits** (constants, not settings): provider request **10 s** (cancellable `AbortController`, plus a 2 s helper-side guard), database call **8 s**, retention pass **30 s**, cleanup pass **45 s**, and an **invocation cap of 110 s** from the handler's start so a slow conversation-recording pass shortens the voicemail phases rather than overrunning the platform ceiling. Cleanup batch **100** (inside the SQL's 1..500 clamp), **10** batches max per invocation, concurrency **5**. Budgets bind when work **starts**, so a phase can overrun its own budget by at most one unit of work. A timed-out database call is **UNKNOWN, never a proven rollback**. Budget exhaustion stops *starting* work and leaves the remainder recoverable. A batch with nothing new stops the pass rather than re-issuing DELETEs.
>
> **Outcomes are now explicit.** Each phase reports `completed` (including the healthy empty run), `skipped` (`missing_credentials` / `schema_unavailable` / `db_timeout`), `partial` or `failed`, under `voicemail_retention` and `voicemail_source_cleanup`. **This retires the caveat recorded in rev 14** that an all-zero run was indistinguishable from a broken one — for the voicemail phases. It remains true that **pg_cron discards the response body**, so cron success still proves only that the SQL invocation completed.
>
> **Preserved and proved:** the authentication block and the whole conversation-recording purge sequence are **byte-identical to the DEPLOYED v29** — the preserved *region* hashes to `0de994f1…50cf1f77` on both sides (the v29 *file* is `96a21140…1ddc19eb`, 3 647 bytes). A test in the focused suite diffs against `origin/main` on every run; **it is a test, not a CI gate** — this repository's only workflow is `s1-plan-verify`, which does not run vitest. Migrations, RLS, RPC definitions, retention periods, the `15 8 * * *` schedule, secrets, routing settings, `twilio-recording-status` and every other Edge Function are untouched.

**Evidence.** **152 focused tests pass across 7 files.** Measured reproductions, each shown failing against the source it corrects: the four 411faf4 cleanup defects (via a fixture extracted mechanically from that commit, its fidelity re-proved on every run); the account-aware ownership hole, with correct-owner 204/404 positive controls alongside NULL, malformed and conflicting owners; the 5,001-row retention capacity probe and budget-only exhaustion; and **the real handler executed end to end** — `index.ts` and `voicemail.ts` bundled with the esbuild binary and run under Node with the Deno registration/environment, database and fetch supplied as adapters — where a 120 s first read now issues **zero** DELETEs while **the same harness against 0707038 still issues one**. Retained in full: the existing cleanup, retention and recording-callback coverage, plus M7's **46-assertion SQL suite V1–V10** on a disposable PostgreSQL 16.13. `tsc --noEmit` and `eslint` clean; **both** dependency closures built from the real entrypoints, each exactly its two package files plus `https://esm.sh/@supabase/supabase-js@2`. **Deno and the Supabase CLI remain absent**, so `deno check` and a local `functions serve` still could not run — the handler harness is the substitute, and it executes the genuine source.

**Adversarial review of the correction** (11 agents, file-reading only): **35 findings, 0 surviving, 0 blocking, nothing newly broken**; all four defects confirmed fixed at the mechanism level. **Caveat: the reviewers read the working tree live and I fixed findings as they surfaced**, so this is a clean result after iteration, not a first-pass clean bill.

**Remaining limitations.** No production runtime evidence (nothing was deployed or invoked). Capacity is a ceiling of 1 000 rows per invocation, and reaching it reports `partial` even if the queue emptied on the last batch. A reconciliation whose readback also fails stays `unresolved` and is retried later. The conversation-recording purge remains unbounded (pre-existing, out of scope); the new 110 s invocation cap makes the voicemail phases yield to it rather than extend a slow run, but cannot bound the recording pass itself. `index.ts` itself is still not executed by a test — Deno is unavailable — so its wiring is asserted statically and by the bundle closure.

**Provenance correction (2026-09-16).** An earlier revision of this section said the 404/platform-account fallback was "pre-existing and identical in 411faf4 and deployed v29". **Deployed purge v29 contains no Twilio-source cleanup at all** — the fallback lived in the unreleased 411faf4 purge source and in `twilio-recording-status` v35's voicemail callback. **Both have now been corrected:** a deletion can only be confirmed against an **established** owning account, a 404 counts as idempotent completion only when the request targeted that account, and a row whose owner cannot be established issues no request, persists no guess and is reported `unresolved_ownership`. The invocation budget is also now anchored at actual handler entry (admission, not cancellation), retention reports capacity- and budget-limited work as `partial`, and schema absence is classified from structured database codes rather than message text.

**Two for a human to weigh, both deliberately left as documented rollout work.** (1) **The new outcome surface is operationally invisible**: pg_cron discards the response body, so only the Edge Function logs carry it; nothing in either package adds an alert or a body-reading consumer. (2) **Capacity and provider load**: up to 1 000 DELETEs per nightly run at concurrency 5, Twilio rate-limit behaviour unverified, and a backlog above 1 000 rows/day cannot drain on the unchanged daily schedule. **Monitoring integration and throughput tuning were not started in this pass**, by instruction.

---

#### Superseded record — the 2026-09-15 attempt (one-file package, never deployed)


> **Production still runs v29.** The deployment was approved from head `d03bcb4566ad006b2054c10724ec9fcf565a83b7` (source sha256 `c80e3a61…cdeffb83`, 9 002 bytes; one-file manifest `c42c4006…d7c9e164`), but the session's **Supabase MCP server failed to connect** (`503 … CLIENT_HTTP_NOT_IMPLEMENTED`), removing `deploy_edge_function`, `get_edge_function`, `execute_sql`, `list_edge_functions` and `query_logs`. That is the approved channel for the prerequisite reads and the deployment itself; **no substitute channel was used and no production write was attempted.**
>
> **What passed anyway.** Heads and tree verified (`origin/main` still `1b93f89f…`); the approved bytes verified (first `0x69`, last `0x0A`, no CR, no tabs); **both** manifest forms reproduced — `c42c4006…d7c9e164` over the approved path and `60ff2282…8af5532f` over the unprefixed readback path this tool reports. The deployed-to-approved diff is **+104 / −0 in a single hunk**, with lines 1–105 byte-identical, so the authentication, recording selection, storage removal and calls-update sequence are provably unchanged. The payload was built and validated **from the payload object** and is ready to submit unchanged.
>
> **What could not be done:** retrieving the deployed v29 package, the production prerequisite reads (M4–M7 versions, both buckets, the five RPC grants, `calls_expired_recording_batch`, routing settings, the cron definition, the due counts), the deployment, the readback, the unchanged-version checks and the runtime inspection. `origin/main`'s copy of the file matches the approval's stated v29 digest (`96a21140…`, 3 647 bytes), which supports the diff review but is **not** an independent retrieval.

**Local verification that did run** (disposable PostgreSQL 16.13, destroyed afterwards): the voicemail suite's **46 assertions, V1–V10, all pass**, with **positive controls** proving V8 and V10 are live rather than skipped; a 12-fixture cutoff matrix confirming strict `<`, listened-vs-`listened_at` at 30 days, unheard-vs-`created_at` at 90, equality keeping the row, and scope limited to `status='stored'` with an object; **eight executed failure-path proofs** (failed removal purges nothing; the purge counter reflects rows actually updated; an HTTP failure preserves the retry with backoff and re-offers it; a 2xx/404 leaves the batch untouched otherwise; purged media still owes the source deletion); all five RPC contracts matching exactly with `service_role`-only EXECUTE; an esbuild closure of **exactly one local input and one external**; and `tsc --strict` clean with Deno shimmed. **Deno is not installed and the Supabase CLI is absent**, so `deno check` and a local `functions serve` could not run.

**Adversarial pre-deployment review** (11 agents, file-reading only): **37 findings, 30 refuted, 7 surviving, 0 blocking** — every survivor future-behaviour once v2 is activated. Two are recorded as **gates on v2 activation, not on this deployment**: the discarded RPC results at `index.ts:204/:207/:211` (a silently failed `mark_voicemail_source_deleted` still counts as a cleanup and can never reach M7's 50-attempt cap, since only `record_voicemail_cleanup_failure` increments attempts), and the single un-looped 100-row cleanup batch at `:190` with untimed sequential Twilio DELETEs at `:200`.

**A caveat for whoever runs this next:** every degraded mode returns HTTP 200 with `ok: true` and zeroed counters, and pg_cron discards the response body — so **an all-zero first run proves nothing**. Verify M5/M7 object resolution by catalog readback, never from the function's own output.

### Steps 7–8 — the remaining Edge Functions, in this order
`recording-retention-purge` → `twilio-voice-inbound`.
- **Effect.** Steps 5–7 make the callback and retention paths v2-aware while remaining correct for legacy traffic (5 and 6 are **done**); step 8 introduces the v2 engine itself, still gated by `routing_engine` per organization (both read `legacy` at this point).
- **Why this order.** Every consumer of a v2 artefact is deployed **before** the producer. Deploying `twilio-voice-inbound` first would let a v2 call create voicemail and attempt rows that the older status/recording handlers would mis-project.
- **Effect on legacy calls.** `twilio-voice-status` gains `routing_engine` in its projections and routes snapshot rows through `converge_inbound_notifications`; a legacy row (no snapshot, no v2 decision) keeps the existing tier chain unchanged. `twilio-recording-status` only branches when the recording carries `source=voicemail`, which nothing produces yet. `recording-retention-purge` gains a voicemail pass over an empty table.
- **Prerequisites.** M4–M7 applied and verified. Deploy each remaining function from the head its own approval names — the stale `35f4e3f` reference is retired; Steps 5 and 6 shipped from `3221265`/`a675f89d`, and `recording-retention-purge` is approved from **`d03bcb4566ad006b2054c10724ec9fcf565a83b7`**. §1.5 answered if the deployment is done by merge rather than by CLI.
- **Success checks.** Each function reports a new version — `twilio-voice-status` reached **41** and then **42** on 2026-09-15, `twilio-recording-status` reached **35**; the two remaining are expected at **30** and **45**. Place **no** live call; watch the function logs for one legacy inbound call handled end to end with unchanged behaviour (identity resolution, ring, status callback, recording) and no reference to a v2 table; `recording-retention-purge` next scheduled run at 08:15 UTC (`recording-retention-purge-daily`, `15 8 * * *`) completes with the recording count unchanged apart from genuine expiries.
- **Recovery.** Redeploy the previous version of the single function (29 / 44 for the two remaining; 40 and 34 for the two already deployed) from `origin/main` at `1b93f89f`. Because every deployed version keeps serving `stage=` and `source=voicemail` callbacks, a partial rollback never strands in-flight work — but see the drain gate in §4 before removing compatibility.

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

**Release tooling — `scripts/test_release_tooling.sh`, rev 3: 116 passed, 0 failed.** Every case says which kind of test it is. Rev 3 is the state after an adversarial review of rev 2 (five independent reviewers, each finding then refuted by independent verifiers): **37 findings raised, 25 refuted, 12 confirmed and fixed** — see §3.1.

**`[fake-tool]` — 45 cases.** The apply script driven against **stub** `psql` / `supabase` binaries with canned responses. Control flow only; proves nothing about SQL.
- *Target binding:* a wrong project ref → WRONG TARGET; a bare IP, a lookalike domain and a ref-less pooler host → AMBIGUOUS; **matching cron and history content does not rescue a wrong target**; the intended direct and pooler connections pass; refusals print no credential.
- *Preflight gating:* a wrong PostgreSQL major, a moved history head, a `SCHEMA_ONLY` / `BOTH` / `PARTIAL` (duplicate-history) classification, an unreadable classification and a tampered migration file each stop the run before any write.
- *Uncertain outcomes:* `NEITHER` in recovery exits **3** with `The outcome is UNRESOLVED`, forbids re-submission, names the only two conditions that would authorise one, rules out both an elapsed-time assumption and repeated empty reads, and says plainly that this is *not* the same as "the apply did not land"; `BOTH` reports the write landed and never invites a re-run; `SCHEMA_ONLY` points at the history repair alone and states the *real* hazard (issuing a write while the previous one is unresolved) rather than an impossible duplicate row; `PARTIAL` names conflicting identities; an unreachable reconciliation is UNKNOWN; **each of the four branches is separately asserted to forbid continuing to M5 and to contain no affirmative mention of it**; no branch claims a rollback.
- *Post-apply block:* a green run reports `M4 APPLIED AND VERIFIED` and calls the hosted isolation read inconclusive; **a failing contract verifier and a CHANGED pre-existing-table after-image each abort the run and suppress that line.**

**`[real-postgres]` — 71 cases.** Real SQL on disposable databases built from the harness + M1–M3 + the v2 harness (+ M4 where relevant).
- *Schema contract:* the correct database verifies; 15 object, privilege and function mutations each fail for the right reason.
- *Policy scope:* **8 mutations that all keep `get_org_id()` in the expression** — self-insert losing `agent_id = auth.uid()`, self-update's `USING` widened to `true` while `WITH CHECK` stays correct, registrations self-select widened to the whole organization, admin-select dropping the Admin/Super-Admin test, roles widened to PUBLIC, PERMISSIVE turned RESTRICTIVE, a seventh plausibly org-scoped policy, and `get_org_id()` swapped for a same-named function in another schema.
- *Pinned deparse:* a correct database still verifies under `SET search_path = evil, public`, and a policy calling `evil.get_org_id()` **fails under that same hostile path**.
- *Function and trigger identity:* a removed `SET search_path` pin (on the heartbeat and on the guard), a disabled trigger, a trigger narrowed to `BEFORE INSERT`, a trigger re-pointed at another function, the guard's body replaced by `RETURN NEW`, the guard flipped to `SECURITY INVOKER`, and the presence predicate's body replaced by `select true` are each caught; a dropped function is **reported in the contract list** rather than aborting with a raw `undefined_function`.
- *Untouched image:* a swapped privilege, a rewritten policy expression and a policy turned RESTRICTIVE are each caught **with all counts equal**, and an unchanged database reproduces its before-image exactly.
- *Migration identity:* a **service-assigned** version is recognised (classifier `BOTH`, history verified); the authored version too; a NULL name no longer counts; duplicates and a conflicting identity are `PARTIAL` and fail history; a near-miss substring name fails; M5 recorded under its *name* fails the M4-only contract; pinning the right version verifies and the wrong one fails; incomplete objects are `PARTIAL`; **a compensating object error — two overloads of one function name and none of the other, so a naive sum still reaches 6 — is `PARTIAL`**; an unrecognised `m4.mode` falls back to the conservative reading and names itself. The pinned CLI's `migration repair` is **run** and shown to record the exact name.
- *Scope:* M5 recorded under a service version blocks preflight even with M4 absent, and recovery refuses to authorise a write there too.
- *Self-exclusion marker:* the classifier's marker is shown to reach `pg_stat_activity` under `psql` (it must sit **inside** the statement — psql discards comments preceding the first token).
- *Concurrency (READ COMMITTED):* an apply is held **uncommitted** in a second session past its DDL; its tables are invisible to another session; the classifier reads `NEITHER | recovery | OUTCOME_UNRESOLVED_DO_NOT_REPLAY` and reports the other open transaction; **that exact real reading is then fed to the real recovery path, which stops with UNRESOLVED and never recommends a replay**; after `COMMIT` the tables become visible and the classifier moves to `SCHEMA_ONLY | RECONCILE_HISTORY_ONLY`.

`PGURL='postgresql://…' ./scripts/test_release_tooling.sh` → **116 passed, 0 failed** (2026-09-13). Without `PGURL` the real-PostgreSQL half is skipped and says so.

### 3.1 What the adversarial review of rev 2 changed

Twelve findings survived independent refutation. The three that could have released a broken schema under a green verification:

1. **A hostile `search_path` made the policy comparison worthless** — `pg_get_expr` qualifies by session path, and the old normalisation deleted every `public.` prefix, so `evil.get_org_id()` deparsed as `get_org_id()` and verified clean. Fixed by pinning the path (above).
2. **The guard trigger and all three function bodies were unverified** — a disabled trigger, a `BEFORE INSERT`-only trigger, or a guard whose body is `RETURN NEW` all passed. Fixed by pinning `tgenabled`/`tgtype`/`tgfoid` and `md5(prosrc)`/`prosecdef`/`provolatile`/`proconfig`.
3. **Object completeness counted rows over a two-name `IN` list**, so two overloads of one name and none of the other read as complete — and that state maps to `SCHEMA_ONLY`, the one recovery branch that authorises a write. Fixed by requiring each name in its own right.

Also fixed: `m5_m7_rows` was collected but never gated on, so preflight said "clean target" with M5–M7 already recorded; the classifier's self-exclusion marker never reached `pg_stat_activity` because psql discards leading comments; the `SCHEMA_ONLY` branch justified its in-flight gate with an impossible duplicate row (`version` is the primary key of `supabase_migrations.schema_migrations`, confirmed on the target); a missing function aborted the verifier with a raw error instead of the contract report; the "forbids continuing to M5" assertion inspected one branch and matched either polarity; **the post-apply block had no test at all** (an earlier edit had dropped those cases, so the before/after diff and both contract gates were unexercised); and a failed build leaked its disposable database because the cleanup trap was installed after the first `CREATE DATABASE`.

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

**Also outstanding, not a live check:** the **extension-present ROLLBACK test** — `scripts/run_inbound_rollback_test.sh` proves the M7→M6→M5→M4→reapply sequence on a stack **without** pg_cron, so it exercises the `ELSE` branch only. M7's apply on 2026-09-15 ran the extension-present **forward** branch for the first time anywhere, successfully, and both jobs are confirmed scheduled and running — **but forward execution does not prove rollback**, and the rollback's pg_cron-present branch (jobs absent, jobs present, unrelated jobs preserved) has still never been executed. It stays **UNPROVEN** until it is independently exercised on a disposable stack that has the extension — a Supabase preview branch or an equivalent throwaway project — **before** the M7 rollback would ever be relied on. Note also that M7's rollback **retains the storage bucket and any media in it**; it is not a complete removal of every artifact.

---

## 6. Missing access identified

| Needed | Why | Who |
|---|---|---|
| Dashboard read of Project Settings → Integrations → GitHub | Confirm "Deploy to production" is still OFF, so a merge cannot auto-apply M4–M7 (§1.5, §2.1). The dashboard requires an interactive sign-in, so it is **unverified**; it blocks MERGING, not the direct M4 apply | Chris |
| Decision on the Vercel auto-deploy coupling | Merging deploys the frontend to `www.fflagent.com` automatically; the release order needs that to be intentional (§2 step 9) | Chris |
| A disposable stack with pg_cron | The extension-present half of the rollback proof (§5) | Chris / this session, given such an environment |
| A direct database connection (`SUPABASE_DB_URL`) | Only needed for **P2** (§2.0) and for a `migration repair` if a P1 apply ever lands as `SCHEMA_ONLY`. This session has MCP access only, which is why **P1 is the primary path** | Chris |

---

## 7. The M4-only approval — REQUESTED, APPROVED, AND EXECUTED 2026-09-14

> **Outcome.** Approved by Chris on 2026-09-14 for source `d5e40bc69e9ccf1e083c1267107c0f2a52ce45b8` and file hash `fe846c43…32fe8e29`. Executed exactly as written below via the P1 MCP procedure. **Recorded version `20260914000530`**, name `inbound_agent_settings_and_registrations`, one history row. `M4_SCHEMA_CONTRACT_VERIFIED` (PostgreSQL 17.6, `maintain_checked = true`) and `M4_HISTORY_VERIFIED` both returned; the five pre-existing tables compared field-for-field identical before and after; the stored statement is byte-identical to the approved file. Repository filenames reconciled. **M5 is a separate approval and has not been requested.**

**Scope of this request: apply migration M4 and nothing else.** Not M5, M6 or M7. No Edge deployment, no merge, no frontend deploy, no v2 activation, no Twilio change, no production row write, no integration-setting change.

**Procedure:** P1 (§2.0) — MCP `apply_migration`, explicitly targeted by `project_id = jncvvsvckxhqgqvkppmj`. This is the only apply channel this session has.

**Recorded results of the run (2026-09-14).** Step 1 `NEITHER | preflight | PROCEED_WITH_APPLY`, `m5_m7_rows = 0`, history head `20260823222926`. Step 4 returned `success: true`. Step 5 resolved `20260914000530` by the exact submitted name, one row. Steps 6–7 returned both verdicts. Step 8 matched step 2 on every field, `read_search_path = pg_catalog` on both. Step 9 renamed M4 to `20260914000530` and M5–M7 to `…531/532/533`.

**Exact steps, in order.**

1. **Read-only precheck, in preflight mode.** `execute_sql` ← `SET m4.mode = 'preflight';` + `scripts/verify_m4_state.sql`. Require **`next_action = PROCEED_WITH_APPLY`**, which also requires `m5_m7_rows = 0` — M5–M7 already recorded means the target is not the database this approval covers. *(Read as `NEITHER | preflight | PROCEED_WITH_APPLY` on 2026-09-13; re-checked immediately before the write.)*
2. **Before-image.** `execute_sql` ← `scripts/verify_m4_untouched.sql`. Keep all five rows verbatim — policy definitions, ACL pairs and both md5 columns.
3. **Hash gate.** `sha256sum supabase/migrations/20260914000530_inbound_agent_settings_and_registrations.sql` must equal `fe846c43a91e9aaf81e112edcf0cfb320414047e0e15de149f75160232fe8e29`.
4. **The write.** One `apply_migration` call: `project_id = "jncvvsvckxhqgqvkppmj"`, `name = "inbound_agent_settings_and_registrations"`, `query` = the entire unmodified file. Nothing else in that call. **Record whether the call returned a definitive server error, or no answer at all** — that distinction is what step R depends on.
5. **Read back the recorded version.** `execute_sql` ← `select version, name from supabase_migrations.schema_migrations where name = 'inbound_agent_settings_and_registrations';` — resolved by name, because the version is service-assigned.
6. **Schema verification.** `execute_sql` ← `scripts/verify_m4_schema.sql`. Must return `M4_SCHEMA_CONTRACT_VERIFIED`; any mismatch comes back as an error naming every problem with its expected and actual value. It pins its own `search_path`, so it does not matter what the calling session's is.
7. **History verification.** `execute_sql` ← `scripts/verify_m4_history.sql` (optionally prefixed by `SET m4.expected_version = '<version from step 5>';` to pin it). Must return `M4_HISTORY_VERIFIED` with the resolved version.
8. **After-image.** `execute_sql` ← `scripts/verify_m4_untouched.sql`; all five rows must be **field-for-field identical** to step 2 — including the `read_search_path` column, since the two images are only comparable when taken the same way.
9. **Filename reconciliation** if step 5 returned a version other than `20260914000530`: `git mv` the file to `<recorded_version>_inbound_agent_settings_and_registrations.sql`, update the hash in this document, commit. **Never** hand-write a history row.
10. **Stop.** Report the results. M5 is a separate approval.

**R. Recovery, if any step is uncertain.** Do not retry blind. Run `SET m4.mode = 'recovery';` + `scripts/verify_m4_state.sql` and follow `next_action`:

- **`OUTCOME_UNRESOLVED_DO_NOT_REPLAY`** (state `NEITHER`) — *no committed M4 state was observed at this read.* **Do not submit the migration again.** Under READ COMMITTED an apply still running elsewhere is invisible to this read and can commit afterwards, so replaying would apply M4 twice. Replay only once the original call is authoritatively known to have ended **without committing** — a definitive server SQLSTATE for that statement, or a provably gone backend with no prepared transaction holding its work. Elapsed time and repeated empty reads establish neither. Otherwise report **UNRESOLVED** and stop.
- **`RECONCILE_HISTORY_ONLY`** (`SCHEMA_ONLY`) — the SQL committed. Escalate for `supabase migration repair --status applied 20260914000530 --db-url …` on a direct connection; write nothing from here, and confirm first that a repair is not itself still in flight.
- **`COMPLETE_VERIFY_AND_STOP`** (`BOTH`) — the write landed; run steps 6–8 and stop.
- **`INVESTIGATE_WRITE_NOTHING`** (`PARTIAL`) — duplicate rows, conflicting identities or a partial object set; investigate read-only and write nothing.

If `execute_sql` is unreachable the state is **UNKNOWN** and nothing is written at all. On no branch: replay automatically, fabricate a history row, switch to P2 mid-operation, or continue to M5.

**Rollback.** `supabase/migrations/rollback/20260914000530_….rollback.sql` drops both functions, both tables and the guard trigger. Nothing deployed references them at this point, so it is unconditional; it is exercised end to end by `scripts/run_inbound_rollback_test.sh`.

**Blast radius.** M4 is purely additive: two new tables, two new functions, one private guard function and its trigger. No existing table, column, function, policy or grant is modified — asserted before and after by `scripts/verify_m4_untouched.sql`. No deployed code reads or writes the new tables, so legacy calling is unaffected either way.
