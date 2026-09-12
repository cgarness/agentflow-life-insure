# Inbound Calling v2 + Agent Voicemail — Release readiness

**Source commit for the release artefacts:** branch `claude/agentflow-inbound-plan-fkl6zi`, base `main` `1b93f89f990b1482d90bf935633594c2851b8da8`. The M4 file approved below is identified by its **SHA-256 content hash**, not only by the commit, so the reviewed bytes are the applied bytes:

```
fe846c43a91e9aaf81e112edcf0cfb320414047e0e15de149f75160232fe8e29  supabase/migrations/20260911000100_inbound_agent_settings_and_registrations.sql
```

**Prepared:** 2026-09-12 (rev 4, corrective pass 12) · **Status: PREPARATION ONLY.** Nothing in this document has been executed. Every step needs its own approval.
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

**Targeting must come from the call or the connection — never from row content.** A database can hold any text at all, including a `cron.job` command that names `jncvvsvckxhqgqvkppmj`. Finding that string proves nothing about which database is answering. Corrective pass 12 demonstrated the failure: the previous script passed its "fingerprint" step against a **different project's** connection whose cron and history content had been made to match. Both procedures below therefore bind the target by an identifier that is part of the request itself.

---

#### PRIMARY — P1: MCP `apply_migration`, explicitly targeted

This is the procedure **this session can actually execute**, and the one the approval request in §7 asks for. `apply_migration` takes `project_id` as a required argument, so the target is named in the call; there is no connection to mis-resolve and no content to be spoofed.

**Before the write — establish the starting state (read-only).** Run `scripts/verify_m4_state.sql` through `execute_sql` and require **`state = NEITHER`**:

```
execute_sql(project_id = "jncvvsvckxhqgqvkppmj", query = <contents of scripts/verify_m4_state.sql>)
```

*Executed 2026-09-12, read-only:* `NEITHER | settings_tbl=false | registrations_tbl=false | m4_functions=0 | history_rows=0 | m5_m7_rows=0 | history_head=20260823222926`. Anything other than `NEITHER` means stop and re-inspect — do not write.

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
sha256sum supabase/migrations/20260911000100_inbound_agent_settings_and_registrations.sql
# must print fe846c43a91e9aaf81e112edcf0cfb320414047e0e15de149f75160232fe8e29
```

**The recorded version is assigned by the service.** `apply_migration` has only `project_id`, `name` and `query` — there is no version argument, so **`20260911000100` must not be assumed.** Production history already contains both shapes: `20260823222528 / inbound_identity_foundation` (a CLI push, filename preserved) and `20260303233510 / 5927fb1c-…` (an API apply, service-generated). Read what actually landed:

```
execute_sql(project_id = "jncvvsvckxhqgqvkppmj",
            query = "select version, name from supabase_migrations.schema_migrations order by version desc limit 3;")
```

**Verification — §2.2.** Only after both verifiers pass is M4 applied.

**Filename reconciliation.** If the recorded version is not `20260911000100`, `git mv` the repository file to `<recorded_version>_inbound_agent_settings_and_registrations.sql`, recompute and update the hash in this document, and commit the rename, so filename and history agree. **Never hand-write a row into `supabase_migrations.schema_migrations`.**

#### P1 — uncertain outcome

If the `apply_migration` call errors, times out, or its response is lost, **that does not establish that nothing was written.** Do not call it again. Run `scripts/verify_m4_state.sql` through `execute_sql` and act on `state` only:

| `state` | Meaning | Action |
|---|---|---|
| `NEITHER` | nothing landed | diagnose the error, then re-run the single `apply_migration` call under the same approval |
| `SCHEMA_ONLY` | the SQL landed, the service recorded no history row | **stop.** Do not re-apply and do not insert a history row. The history operation alone is reconciled by someone with a direct connection: `supabase migration repair --status applied <version> --db-url …`. Escalate; M5 does not start |
| `BOTH` | the write landed despite the failed response | nothing more to write — run §2.2 and stop |
| `PARTIAL` | some objects or an unexpected history shape | **stop and investigate read-only.** Write nothing: not the SQL, not a history row, not M5 |

If `execute_sql` itself cannot be reached, the state is **UNKNOWN**: write nothing at all until it can be read.

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
| 4 | Corroboration against independently verified project facts (§1): PostgreSQL major **17**, history head **`20260823222926`**, `20260911000100` not recorded, both M4 tables absent. The count of `cron.job` rows naming the ref is printed but **explicitly labelled supporting evidence, not proof of identity** | stops |
| 5 | Before-image of the pre-existing tables (`scripts/verify_m4_untouched.sql`) | stops |
| 6 | preflight summary; `DRY_RUN=1` exits here | — |
| 7 | `psql --single-transaction -v ON_ERROR_STOP=1 -f <M4>` — **only M4** | see *uncertain outcome* below |
| 8 | `supabase migration repair --status applied 20260911000100 --db-url "$SUPABASE_DB_URL"` — the **same connection** verified and applied with | see *uncertain outcome* below |
| 9 | `scripts/verify_m4_schema.sql`, `scripts/verify_m4_history.sql`, and an after-image diffed against step 5 | stops; the success line is never printed |

> **`--project-ref` does not exist on `migration repair`.** Verified against the pinned CLI (2.84.5): the flags are `--db-url`, `--linked`, `--local`, `--password`, `--status`. An earlier revision of this document proposed `--project-ref` and was wrong.

#### P2 — uncertain outcome

**A failed `psql` invocation is not a confirmed rollback,** and a failed `migration repair` response does not prove its write did not land: a connection can drop after the server has committed. The script therefore never claims a rollback. On any non-zero exit from step 7 or step 8 it runs `scripts/verify_m4_state.sql` read-only and prints the branch for the state it finds — the same four-way table as P1, with `SCHEMA_ONLY` pointing at `migration repair` alone rather than at a replay. If the reconciliation query itself fails, it reports **UNKNOWN** and exits 2 with nothing suggested.

**Do not switch procedures mid-apply.** Decide P1 or P2 before the approval is exercised; a partial P1 followed by a P2 retry would apply the SQL twice.

### 2.1 Where the GitHub integration prerequisite actually applies

The unverified Supabase "Deploy to production" setting (§1.5) **gates MERGING, not the direct application of M4.** Applying M4 by P1 or P2 does not involve GitHub and is unaffected by that setting. What the setting could do is cause a later merge to apply **M4–M7 together, unreviewed** — and a merge separately triggers the production frontend deploy (§1.5).

> **Merging this branch stays BLOCKED until both hold:** (a) the Supabase GitHub integration setting is read in the dashboard and confirmed, and (b) the backend release steps that must precede the frontend (M4–M7 and the four Edge Functions) are complete and verified. **The setting remains UNVERIFIED — the dashboard required an interactive sign-in during inspection, which is outside this session's access.**

### Step 1 — M4 `20260911000100_inbound_agent_settings_and_registrations.sql`
- **Effect.** Creates `agent_inbound_settings` (per-agent mobile forward number, greeting, DND) and `agent_phone_registrations` (browser presence), with RLS and the §7.7 policies; adds `heartbeat_phone_registration` (`SECURITY DEFINER`, it writes the caller's own row under RLS) and `is_phone_connected` (`SECURITY INVOKER`, so an authenticated caller is bound by the org-scoped policies). Purely additive: **no existing table, column, function, policy or grant is modified.**
- **Privileges (corrective pass 11).** This project's default privileges hand every table created by `postgres` in `public` the full `arwdDxtm` set to `anon`, `authenticated` **and** `service_role` (verified read-only against `pg_default_acl`), and a `GRANT` only ADDS. M4 therefore **REVOKEs ALL from every grantee first** and then grants exactly: `agent_inbound_settings` → `authenticated` SELECT, INSERT, UPDATE; `agent_phone_registrations` → `authenticated` SELECT only; `service_role` → ALL on both; `anon` → nothing. Without the reset, `authenticated` would have retained DELETE, **TRUNCATE**, REFERENCES, TRIGGER and MAINTAIN — and TRUNCATE is not restrained by row-level security.
- **Effect on legacy calls: none.** No deployed code reads or writes either table.
- **Prerequisites.** Applied by the P1 (MCP) procedure in §2.0, from the reviewed file whose hash matches. The §1.5 integration setting is **not** a prerequisite for a direct apply — it gates merging (§2.1). A restore point noted beforehand. No lock on `calls` is taken, so no call-traffic window is required.
- **Success checks (read-only) — asserted, not printed.** Run the machine-checked verifiers in §2.2; a mismatch fails the step.
- **Recovery.** `supabase/migrations/rollback/20260911000100_inbound_agent_settings_and_registrations.rollback.sql` drops both functions, both tables and the settings guard trigger. Nothing else references them at this point, so the rollback is unconditional. Exercised end to end by `scripts/run_inbound_rollback_test.sh`, which now rolls M7→M6→M5→M4 back and reapplies M4–M7.

### 2.2 M4 post-apply verification (read-only, MACHINE CHECKED)

**Verification asserts; it does not print.** The previous `verify_m4_applied.sql` only `SELECT`ed catalog rows, so the procedure reported "M4 APPLIED AND VERIFIED" whenever those statements *executed*. A local database with RLS disabled, `TRUNCATE` granted to `authenticated` and no history row still passed it. That file has been **deleted** and replaced by three payloads that raise on any mismatch, plus one before/after comparison. All four are **plain SQL** — no `\echo`, no other psql meta-command — so the same bytes run under `psql -f` and through MCP `execute_sql`.

| File | What it asserts | Success output |
|---|---|---|
| `scripts/verify_m4_schema.sql` | both tables and both functions exist, the private guard function and its trigger exist; RLS **enabled**, force-RLS **not** set, owner equal to `public.profiles`' owner; the **exact effective privilege matrix** for `authenticated` / `anon` / `service_role` over SELECT, INSERT, UPDATE, DELETE, **TRUNCATE**, REFERENCES, TRIGGER and **MAINTAIN**; every policy's **name, command, roles and expression** (each must contain `get_org_id()`), 4 on the settings table and 2 SELECT-only on the registrations table; `is_phone_connected` `SECURITY INVOKER` + STABLE + executable by `authenticated`/`service_role` and **not** by `anon`; `heartbeat_phone_registration` `SECURITY DEFINER`; the private guard **not** executable by `authenticated`; and that M4 created no policy on a pre-existing table | one row `M4_SCHEMA_CONTRACT_VERIFIED` |
| `scripts/verify_m4_history.sql` | **exactly one** history row for the expected version, its name, that its tables really exist, that **none of M5–M7** is recorded, and that no second M4-named row exists under another version | one row `M4_HISTORY_VERIFIED` |
| `scripts/verify_m4_state.sql` | nothing — it **classifies**: `NEITHER` / `SCHEMA_ONLY` / `BOTH` / `PARTIAL`. Used before the write and after any uncertain outcome | one classification row |
| `scripts/verify_m4_untouched.sql` | nothing — it reports RLS, force-RLS, policy count and role-grant count for `calls`, `profiles`, `inbound_routing_settings`, `notifications`, `phone_numbers`. Run **before and after**; the two outputs must be identical | five rows, compared |

Any mismatch raises `M4 SCHEMA CONTRACT FAILED (n problem(s)): …` / `M4 HISTORY CONTRACT FAILED (…)` listing **every** problem found, `psql` exits 3, and `execute_sql` returns an error rather than a result set. **There is no path that prints success without the assertions having passed.**

**Schema and history are verified separately on purpose.** Recovery from a failed history repair leaves a *correct* schema with a *missing* history row; that state has to be diagnosable and fixable on its own.

**Under P1 the recorded version is service-assigned,** so pass it to the history verifier instead of editing the file — the expected version is read from a GUC with `20260911000100` as its default:

```sql
SET m4.expected_version = '<the version read back from schema_migrations>';
-- …then the entire contents of scripts/verify_m4_history.sql in the same execute_sql payload
```

Under P2 the default is already correct and nothing needs passing.

**How to run them**

- **P1 (MCP):** `execute_sql(project_id = "jncvvsvckxhqgqvkppmj", query = <file contents>)`, once per file. *Proven against this project on 2026-09-12, read-only:* the state classifier returned `NEITHER`; the untouched payload returned its five rows; a DO-block verifier of exactly this shape returned the MCP **error** `M4 SCHEMA CONTRACT FAILED (2 problem(s)): MISSING TABLE public.agent_inbound_settings || MISSING TABLE public.agent_phone_registrations` — the correct answer while M4 is unapplied, and proof that a mismatch surfaces as a failure and not as a printed row; a probe exercising every remaining construct the files use (`FOR … IN SELECT`, `regclass` casts, `string_agg` over `unnest(polroles)`, `has_function_privilege`, `RAISE NOTICE`, a trailing `SELECT`) returned `CONSTRUCT_PROBE_OK | 17.6 | maintain_checked = true`; and `SET m4.expected_version = …` followed by further statements in one payload was accepted and read back. **`maintain_checked = true` means the MAINTAIN rows of the privilege matrix will really be checked on this server** — locally they are skipped, because PostgreSQL 16 has no such privilege.
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

**Release tooling — new in corrective pass 12.** `scripts/test_release_tooling.sh` covers the procedure itself, and every case says which kind of test it is:

- **`[fake-tool]`** (28 cases) drives `scripts/apply_m4_only.sh` against **stub** `psql` / `supabase` binaries with canned responses. It exercises control flow only — target binding, failure handling, the wording of the recovery advice — and proves nothing about SQL. Covered: a wrong project ref is refused; a bare IP, a lookalike domain and a ref-less pooler host are refused as **ambiguous**; **matching cron and history content does not rescue a wrong target** (the reported defect); the intended direct and pooler connections pass; a wrong PostgreSQL major, a moved history head, an already-recorded version, a pre-existing M4 table and a tampered file are each refused; each of the four states after a failed apply and after a failed repair reaches its own branch; an unreachable reconciliation reports UNKNOWN; no branch claims a rollback, tells the operator to replay after a landed write, or permits continuing to M5; and a failing verifier suppresses the success line.
- **`[real-postgres]`** (28 cases) runs real SQL against a disposable database built from the harness + M1–M3 + the v2 harness + M4. Seventeen **mutations** — RLS disabled, `authenticated` granted TRUNCATE or INSERT, `anon` granted SELECT, a revoked `service_role` grant, a dropped table / policy / trigger, FORCE RLS, an unscoped policy expression, a widened policy role, `is_phone_connected` turned `SECURITY DEFINER`, `heartbeat_phone_registration` turned `SECURITY INVOKER`, `anon` granted EXECUTE, `authenticated` EXECUTE revoked, the private guard exposed, a write policy added to the registrations table — must each **fail** the schema verifier, and each is checked for the *right* reason, not merely for failing. History: a missing row fails, the exact expected entry verifies, an M5 row fails the M4-only contract, a wrongly named row fails, and a service-assigned version verifies only when passed in. The classifier is exercised in `NEITHER`, `SCHEMA_ONLY` and `BOTH`.

`PGURL='postgresql://…' ./scripts/test_release_tooling.sh` → **56 passed, 0 failed** (2026-09-12). Without `PGURL` the real-PostgreSQL half is skipped and says so.

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
| A direct database connection (`SUPABASE_DB_URL`) | Only needed for **P2** (§2.0) and for a `migration repair` if a P1 apply ever lands as `SCHEMA_ONLY`. This session has MCP access only, which is why **P1 is the primary path** | Chris |

---

## 7. The M4-only approval being requested

**Scope of this request: apply migration M4 and nothing else.** Not M5, M6 or M7. No Edge deployment, no merge, no frontend deploy, no v2 activation, no Twilio change, no production row write, no integration-setting change.

**Procedure:** P1 (§2.0) — MCP `apply_migration`, explicitly targeted by `project_id = jncvvsvckxhqgqvkppmj`. This is the only apply channel this session has.

**Exact steps, in order.**

1. **Read-only precheck.** `execute_sql` ← `scripts/verify_m4_state.sql`. Require `state = NEITHER`. *(Already true as of 2026-09-12; re-checked immediately before the write.)*
2. **Before-image.** `execute_sql` ← `scripts/verify_m4_untouched.sql`. Keep the five rows.
3. **Hash gate.** `sha256sum supabase/migrations/20260911000100_inbound_agent_settings_and_registrations.sql` must equal `fe846c43a91e9aaf81e112edcf0cfb320414047e0e15de149f75160232fe8e29`.
4. **The write.** One `apply_migration` call: `project_id = "jncvvsvckxhqgqvkppmj"`, `name = "inbound_agent_settings_and_registrations"`, `query` = the entire unmodified file. Nothing else in that call.
5. **Read back the recorded version.** `select version, name from supabase_migrations.schema_migrations order by version desc limit 3;`
6. **Schema verification.** `execute_sql` ← `scripts/verify_m4_schema.sql`. Must return `M4_SCHEMA_CONTRACT_VERIFIED`; any mismatch comes back as an error naming every problem.
7. **History verification.** `execute_sql` ← `SET m4.expected_version = '<version from step 5>';` followed by `scripts/verify_m4_history.sql`. Must return `M4_HISTORY_VERIFIED`.
8. **After-image.** `execute_sql` ← `scripts/verify_m4_untouched.sql`; the five rows must be identical to step 2.
9. **Filename reconciliation** if step 5 returned a version other than `20260911000100`: `git mv`, update the hash here, commit. **Never** hand-write a history row.
10. **Stop.** Report the results. M5 is a separate approval.

**Recovery, if any step is uncertain.** Do not retry blind. Run `scripts/verify_m4_state.sql` and follow the four-way table in §2.0 (*P1 — uncertain outcome*): `NEITHER` → re-run the single call; `SCHEMA_ONLY` → escalate for a `migration repair` on a direct connection, write nothing here; `BOTH` → verify and stop; `PARTIAL` → investigate read-only, write nothing. If `execute_sql` is unreachable the state is UNKNOWN and nothing is written at all.

**Rollback.** `supabase/migrations/rollback/20260911000100_….rollback.sql` drops both functions, both tables and the guard trigger. Nothing deployed references them at this point, so it is unconditional; it is exercised end to end by `scripts/run_inbound_rollback_test.sh`.

**Blast radius.** M4 is purely additive: two new tables, two new functions, one private guard function and its trigger. No existing table, column, function, policy or grant is modified — asserted before and after by `scripts/verify_m4_untouched.sql`. No deployed code reads or writes the new tables, so legacy calling is unaffected either way.
