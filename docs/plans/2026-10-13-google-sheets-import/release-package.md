# Google Sheets V1 — production release package

**Status: PREPARED, NOT EXECUTED.** Every step below needs Chris's approval of its exact action.

Nothing in this package has been run:
- no production migration, Edge deployment or secret change;
- no Google Cloud change, cron job or Vercel environment change;
- no live import, privacy publication or merge.

Branch: `claude/keen-brown-e4u3ht`. Plan: `implementation_plan.md` §0 in this folder (§0.9 for the pre-release corrections). Local and CI evidence: `verification.md`.

**Revision 2026-10-13 (pre-release integrity corrections, §0.9 with amendments A–C).** This package now reflects:
- stale-run finalization that is bound to the generation and the lease, and writes nothing when stale;
- Review that is bound to the generation and the snapshot, with explicit choices;
- accounting for excluded blank-ID rows;
- duplicate-ID comparison over all mapped values;
- a Picker re-check;
- a tested non-destructive shutdown (§5);
- an accurate capacity statement.

The previous "independently sufficient kill switches" claim is withdrawn.

---

## 0. Pre-release checks (read-only)

1. **`main` and the deploy integration.**
   - Confirm `main` has not moved past the PR base, or merge `main` into the branch and re-run §6 locally.
   - Confirm GitHub → Supabase "Deploy to production" is still **OFF**: merging must not deploy functions.
2. **Migrations and exact head.**
   - `list_migrations` shows no `google_sheets` entry in production. Re-check every active preview branch too: on 2026-10-13, production `jncvvsvckxhqgqvkppmj` and PR #378's branch were checked, and PR #294's branch was inactive.
   - The release deploys exactly the reviewed candidate head recorded in `verification.md`.
   - The Sheets CI workflow (`.github/workflows/google-sheets.yml`) must be green on that head.
3. **Permission helper preimage.** The live MD5 must still equal `a199d5ddfb9a56070aeb7706d3e9a4b8`:
   ```sql
   SELECT md5(pg_get_functiondef('public._contacts_permission_default(text,text)'::regprocedure));
   ```
   The migration also refuses to run if it differs.
4. **Edge functions:** `list_edge_functions` shows no `google-sheets-*` function. These are new names, so no live bundle has to be retrieved first.
5. **Callback hostname.**
   - MCP `get_project_url` returned `https://jncvvsvckxhqgqvkppmj.supabase.co` on 2026-10-13.
   - No branded Supabase domain exists in the repository, its branches or the plans.
   - Re-confirm in Supabase → Project Settings → Custom Domains that none is active. If one is, use it in G2 and `GOOGLE_SHEETS_REDIRECT_URI` instead.
6. **Google publishing status (fresh check required).**
   - Google Auth Platform → Audience for project `87346168200` (`project-b7e9b5b4-d066-48c9-b36`).
   - The 2026-10-09 screenshots showed **External / Testing**. That is historical, not current evidence.
   - In Testing, only listed test users can connect, and every Sheets grant **expires 7 days after consent**. The basic-profile exemption does not cover `drive.file`.
   - **Pilot implication:** add the pilot accounts as test users and expect a weekly **Reconnect**.
   - Moving to **In production** is outside this approval. It also affects the Gmail/Calendar consent experience.

## 1. Google Cloud setup (Chris, in project `87346168200`)

| # | Action | Exact value |
|---|---|---|
| G1 | Enable APIs | **Google Sheets API**, **Google Drive API**, **Google Picker API** |
| G2 | New OAuth client | Type **Web application**, name **AgentFlow Sheets**. Authorized redirect URI: `https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/google-sheets-oauth-callback` (or the branded host from §0.5). No JavaScript origins are required. Do **not** edit "AgentFlow Web" or the older client. |
| G3 | Data Access | `openid`, `.../auth/userinfo.email`, `https://www.googleapis.com/auth/drive.file` (all non-sensitive). Do not add `spreadsheets.readonly` or `drive.readonly`. |
| G4 | Picker API key | Create an API key. **Application restriction:** HTTP referrers `https://www.fflagent.com/*`, `https://fflagent.com/*` and `https://docs.google.com/*`; add only a deliberately chosen preview origin if piloting there. **API restriction:** Google Picker API (and Google Drive API if Google's console requires it for Picker). |
| G5 | Test users (Testing status) | Add each pilot Google account. |

**Revocation.** Sheets disconnect **never** calls Google `revoke`. Google documents revocation as removing access for the app, and possibly for every client in the project. A user removing AgentFlow at myaccount.google.com/connections, or Calendar's existing disconnect (which calls revoke), can therefore also invalidate the Sheets grant. Sheets then shows **Reconnect**, generation-guarded. Calendar's behaviour is unchanged by this feature.

## 2. Secrets (names only; values are never committed or echoed)

| Name | Where | Value / source |
|---|---|---|
| `GOOGLE_SHEETS_CLIENT_ID` | Edge secret | from G2 |
| `GOOGLE_SHEETS_CLIENT_SECRET` | Edge secret | from G2 |
| `GOOGLE_SHEETS_REDIRECT_URI` | Edge secret | exactly the G2 redirect URI |
| `GOOGLE_SHEETS_ALLOWED_RETURN_ORIGINS` | Edge secret | `https://www.fflagent.com,https://fflagent.com` |
| `GOOGLE_SHEETS_STATE_KEY` | Edge secret | ≥ 32 random characters (AES-256-GCM key material for PKCE verifiers) |
| `GOOGLE_SHEETS_WORKER_TOKEN` | Edge secret | ≥ 32 random characters |
| `google_sheets_worker_token` | Vault (`vault.create_secret`) | the same value as `GOOGLE_SHEETS_WORKER_TOKEN` |
| `GOOGLE_SHEETS_ENABLED` | Edge secret | leave **unset** until §5 |
| `VITE_GOOGLE_PICKER_API_KEY` | Vercel env | from G4 |
| `VITE_GOOGLE_CLOUD_PROJECT_NUMBER` | Vercel env | `87346168200` |
| `VITE_GOOGLE_SHEETS_ENABLED` | Vercel env | leave **unset/false** until §5 |

The existing `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are used as already provisioned. The existing `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (Gmail/Calendar) are **not** used.

## 3. Database migration (exact SQL = the committed files)

**Apply** `supabase/migrations/20261013120000_google_sheets_import_foundation.sql`
- SHA-256 `fc68da86bfa972148b72302b3bc0daf8d227453b75fdadd6ef8578908d76efed` (amended in place before any application; it was never applied anywhere).
- Use one `apply_migration` call, with the file's exact bytes.
- Afterwards (invariant #35), rename the file to the recorded version with identical bytes, and update `scripts/run_google_sheets_tests.sh`, the harness header and the `?raw` import in `src/lib/google-sheets/__tests__/googleSheets.test.ts`.

**What it does**
- **Preflight:** refuses to replay; refuses if the `_contacts_permission_default` MD5 differs from `a199d5dd…`.
- **Permission helper:** the exact live body plus **one row**, `('contacts.leads.import_google_sheets', true, true)`.
  - Signature, IMMUTABLE, `search_path` and the ACL (postgres only) are preserved.
  - No other key changes. Explicit stored denials still win, because the callers read `role_permissions` first.
- **New tables:**
  - `public.google_sheets_connections`, `public.google_sheets_sources`, `public.google_sheets_sync_runs`: RLS SELECT own only; no client writes; `service_role` ALL.
  - `private.google_sheets_oauth_states`, `private.google_sheets_source_rows`, `private.google_sheets_receipts`: no grants to anyone but the owner.
- **Functions:**
  - 31 `private.google_sheets_*` helpers: no EXECUTE for PUBLIC, anon, authenticated or service_role.
  - 21 `public.google_sheets_*` wrappers: SECURITY DEFINER, `search_path` pinned, EXECUTE granted to **service_role only**. These are the PostgREST entry points the Edge code calls.
- **Corrections included:**
  - **`google_sheets_finish(..., p_generation, ...)`:**
    - returns `completed | released | not_owner | not_found`;
    - locks the source and then the connection, and evaluates validity on the real clock after the lock waits;
    - a stale run only releases its own lease.
  - **Ledger and ingest:** the ledger kind `approved` (explicit Review decisions); `noid:<n>` missing-ID keys.
  - **Review:**
    - `google_sheets_review` splits rows into established, content-matched and unmatched;
    - it requires explicit choices and is bound to the generation and the snapshot.
  - **New functions:** `google_sheets_review_state`, `google_sheets_resolve_identity`, `google_sheets_connection_current`.
- Vault is used through `vault.create_secret` / `vault.update_secret` / `vault.secrets` (as the Twilio token functions do).

**Read-back after apply**
```sql
SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE p.proname LIKE 'google\_sheets\_%' AND n.nspname IN ('public','private');            -- expect 52 (31 private + 21 public)
SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE 'google\_sheets\_%'
   AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')); -- expect 0
SELECT public._contacts_permission_default('Agent','contacts.leads.import_google_sheets'),
       public._contacts_permission_default('Agent','contacts.leads.import');                  -- expect true, false
SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'google\_sheets\_%' AND relkind = 'r'; -- all true
```
Also run `get_advisors` (security) and compare with the pre-apply baseline.

**Cron (later, §5):** `supabase/migrations/pending/20261013120100_google_sheets_sync_schedule.sql` (SHA-256 `6116f414faf8313b3d09fa2b721eee79ac43d57f16e9de29ef143b92c54f9665`).
- It runs every minute, posts only while a source is due, and authenticates with the Vault token.
- Its guards refuse to run unless the foundation, `pg_cron`, `pg_net` and a Vault token of at least 32 characters exist.

**Rollback file:** `supabase/migrations/rollback/20261013120000_google_sheets_import_foundation.rollback.sql` (SHA-256 `d9f36c350c2e02f9004ffe20a029762bd078e67c184ec06f71496e93ebaf0e93`). It is locally proven to remove every object and restore the exact helper preimage.

## 4. Edge Functions (four new names; deploy order)

**All four:**
- deploy with `verify_jwt=false`, as declared in `supabase/config.toml`, with authorization enforced in code (invariant #2);
- include the shared files `_shared/googleSheets/{auth,config,crypto,db,engine,errors,google,http,identity,mapping,oauth}.ts`;
- deploy while `GOOGLE_SHEETS_ENABLED` is unset.

| Order | Function | Entry and local files | SHA-256 (entry) |
|---|---|---|---|
| 1 | `google-sheets-sync-worker` | `index.ts` | see verification.md |
| 2 | `google-sheets-api` | `index.ts`, `actions.ts` | see verification.md |
| 3 | `google-sheets-oauth-callback` | `index.ts`, `deps.ts` | see verification.md |
| 4 | `google-sheets-oauth-start` | `index.ts`, `deps.ts` | see verification.md |

Full per-file SHA-256 values are in `verification.md`.

**Why this order:** the worker and API go first, both inert while the flag is unset. The callback is deployed before the start function, so no consent screen can be reached before its redirect target exists.

**Imports:** `https://esm.sh/@supabase/supabase-js@2`, the same specifier as existing functions; the repository `deno.lock` pins it to 2.98.0.

**After deploy,** read back each function's `verify_jwt=false` and its entry path. Then:
- POST the worker without a token → 403;
- POST the worker with the token while disabled → `{"disabled":true}`;
- POST `google-sheets-api` while disabled → 503 `disabled` for import actions, before authentication;
- POST `google-sheets-api` without a JWT, after enabling (§5) → 401.

## 5. Pilot activation, operating controls and shutdown (separate approval)

**Activation**
1. Set `GOOGLE_SHEETS_ENABLED=true` (Edge) and `VITE_GOOGLE_SHEETS_ENABLED=true` (Vercel Production), then redeploy the frontend.
2. Run the §6 real-account test with one pilot agent **before** enabling cron.
3. Apply the pending cron migration (move it out of `pending/`, `apply_migration`, re-stamp per #35). Read back `cron.job`.

**Capacity statement** (verified behaviour; no limit is changed)

*Per invocation*
- At most **10 claims**, one source each, within a cooperative **45 s** budget.
- No new claim is made when fewer than 8 s remain.
- Each run imports at most **500** new rows in atomic batches of 50, and stops starting batches when its budget is used.

*Order and repeats*
- The oldest `next_sync_at` goes first.
- A source with a backlog re-queues at `now()`, behind sources that are already due, and **may run again in the same invocation** when nothing older is due.
- **5,000 rows per invocation is a conditional arithmetic ceiling** (10 × 500, only when one source is alone and every Google read is fast). It is not verified throughput and not a guaranteed per-minute rate.

*Steady state*
- About `max(5, N/10)` minutes between checks of each source, for N active sources, when runs are fast. Slow Google reads lower this.
- A 10,000-row "import existing rows" backlog needs at least 20 runs.
- An invocation that overruns a cron tick can overlap the next one; leases keep them on different sources.
- Google's quota (300 reads per minute per project) is not the binding constraint at pilot scale.

**What each control actually does** (Amendment C; nothing below is "independently sufficient" on its own)

| Control | Effect | Does NOT |
|---|---|---|
| UI flag `VITE_GOOGLE_SHEETS_ENABLED` unset + frontend redeploy | Hides Settings → Google Sheets | Stop scheduled syncs, queued requests, running invocations or direct API calls |
| Future cron scheduling — `supabase/ops/google_sheets_unschedule.sql` | No new scheduled invocation | Remove a `net.http_post` already queued in `net.http_request_queue` (it can still be sent), or stop an invocation already running |
| Backend flag `GOOGLE_SHEETS_ENABLED` unset | The worker reads it **once, before its claim loop**, and is inert when unset. The API reads it per request and answers 503 except `status` and `disconnect`. OAuth start answers 503. | Stop an invocation that has already passed the check: it keeps claiming until its 10-claim / 45 s cooperative budget ends. A cooperative budget is not proof that outstanding Google or database calls have finished. Secret changes reach later invocations only as the platform picks them up. |
| In-flight database operations | Every RPC is one transaction: one that has started finishes or rolls back on its own | — |
| Per-source **Pause** | Bumps `config_version` and clears the lease, so that source's next ingest batch and its finish are refused. Leads, receipts and baselines stay. | Affect other sources |
| Per-connection **Disconnect** | Bumps `auth_generation` and deletes the Vault secret, so that connection's next batch, finish, Review apply and Picker token are refused. It never calls Google revoke. | Revoke an access token Google already minted (it expires within an hour, and the server never returns it after the change) |
| **Admission gate** — `supabase/ops/google_sheets_admission_close.sql` | Revokes EXECUTE on every `public.google_sheets_*` wrapper from `service_role`, except `google_sheets_disconnect`. From then on, no invocation (scheduled, queued, already running, API, OAuth callback) can start another database operation: each new call fails with `42501`. | Interrupt an RPC that is already executing; it completes atomically and the drain check verifies it |

**Non-destructive shutdown** (tested locally and in CI; each SQL step needs approval at the time, and gate changes are applied as migrations per the `supabase/ops` convention)
1. **Record the markers:** run `supabase/ops/google_sheets_drain_check.sql` (read-only) and keep the row.
2. **Stop future scheduling:** run `supabase/ops/google_sheets_unschedule.sql`. Confirm `cron_jobs = 0` in the drain check.
3. **Close admission:** run `supabase/ops/google_sheets_admission_close.sql`. Confirm `wrappers_executable = 0`.
4. **Drain:** repeat the drain check until `active_sheets_backends = 0` **and** `queued_worker_requests = 0`.
   - A request still queued when the gate is closed can only fail with `42501`.
   - Lease state (`unexpired_leases_informational`) is **not** proof that a process has terminated.
5. **Verify quiescence:** wait at least 2 minutes and run the drain check again.
   - Every column except `checked_at` and `unexpired_leases_informational` must be identical: receipts, Sheets leads, sync runs, ledger, and the source and connection digests. The lease count may fall as leases expire; that proves nothing either way.
   - **If anything moved, the shutdown is BLOCKED, not complete.** Investigate before reporting it stopped.
6. Optionally unset `GOOGLE_SHEETS_ENABLED` and `VITE_GOOGLE_SHEETS_ENABLED`, so that reopening the gate later does not immediately resume work.

**What it preserves:**
- every lead, receipt and baseline;
- each source's state and health (the agent's recoverable intent);
- each connection's Vault secret;
- disconnect, which stays available to agents.

**Resume:**
1. Run `supabase/ops/google_sheets_admission_open.sql`. It restores the exact wrapper ACL; the T1 assertions are re-run in the test.
2. Re-apply the schedule (the pending migration's `cron.schedule` statement, with approval).
3. Set the flags.

Leases interrupted by the gate expire within 3 minutes, after which those sources are claimed again. Receipts prevent any replay; this is tested.

| Ops file (NOT RUN) | SHA-256 |
|---|---|
| `supabase/ops/google_sheets_unschedule.sql` | `9af0e1331d8410a43909d377bc1f03334ad4c090b50099eb09f8143ad90ee46f` |
| `supabase/ops/google_sheets_admission_close.sql` | `4255a54f950a91ed0227f80caf62276b46b61a0dcdc82a7298ba207f0ba9c5c8` |
| `supabase/ops/google_sheets_admission_open.sql` | `265fca871aee8c9aa51ea46996f7c3a11b1f3e35f83733e2b7d715524c676135` |
| `supabase/ops/google_sheets_drain_check.sql` | `0465beed2466882564213029ec38b0c2beed02f1f3760ccd23cbaa04218d80ee` |

## 6. Controlled real-account test (required before release; NOT performed)

This uses one pilot agent account, a **test Google account listed as a test user**, and a synthetic spreadsheet. It has headers `Lead ID, First Name, Last Name, Phone, Email`, with obviously fake 555 numbers and `example.test` emails.

1. **Connect.**
   - Settings → Google Sheets → **Connect Google**.
   - The consent screen must list only the email address/identity and "see, edit, create and delete only the specific Google Drive files you use with this app".
   - Return shows **Connected** after the page re-reads status.
   - Read-only SQL: the connection row shows `granted_scopes = {email, https://www.googleapis.com/auth/drive.file, openid}`, and a Vault secret named `google_sheets_refresh_<connection id>` exists. Do not select its value.
2. **Picker → server read (proves item 1 of the test requirement).** **Add sheet** → **Choose spreadsheet** → pick the synthetic file. The tab list loads; it comes from the **server's** Drive `files.get` plus Sheets `spreadsheets.get`, using a token minted from the stored refresh token.
3. **Fresh token still reads (proves item 2).**
   - Wait more than 60 minutes, or force a new access token by calling **Sync now** after the first token has expired.
   - The server refreshes from the stored refresh token and must still read the file: headers, preview and the sync result appear.
   - Record the timestamps of the two successful reads at least one hour apart.
4. **New rows by default.**
   - Map the columns, choose `Lead ID` as the Lead ID column, preview, leave "Also import existing rows" **unchecked**, and **Enable**.
   - Confirm no lead was created for existing rows.
   - Add one new row → **Sync now** → exactly one lead appears, assigned to the agent; the run shows `1 imported`.
5. **Idempotency and sorting.** Sync again (no new lead); sort the sheet and sync (no new lead).
5b. **Excluded rows without a Lead ID** (recommended):
   - Before Enable, leave one existing row's Lead ID blank.
   - After Enable, sort the sheet and give that row a Lead ID.
   - **Sync now** → the sheet shows **Needs review** and nothing imports.
   - **Review** lists the row with "Same name, phone and email as a row that was left out" and no preselected choice.
   - Choose **Keep out** → **Resume** → sync: no lead. A row added afterwards imports normally.
6. **Duplicate policy.** Add a row repeating an existing lead's phone → it follows the agency's setting (CG Financial is currently `flag`), and the existing lead is unchanged.
7. **Pause and disconnect.** Pause, add a row, sync is unavailable, and nothing imports. Resume → it imports. Disconnect → Gmail/Calendar status is unchanged (read-only check), and the sheet shows Reconnect.
8. **Cleanup** of the test leads only with separate approval (invariant #28).

**Do not** create real customer leads. Lead Created workflows run for each imported test lead, so either use an agency with no active Lead Created workflow for the pilot, or accept their effect on the synthetic leads.

## 7. Privacy copy (proposed; publish only after Chris approves the exact text)

Add to `src/content/legal.ts` (Privacy Policy) after the Google Calendar section, and mirror it in `policy-review.md`:

> **Google Sheets information.** If you connect Google Sheets, AgentFlow requests your Google account identity and email address and access only to the specific spreadsheets you select in Google's file picker. AgentFlow reads the selected tab and creates a lead, assigned to you in your agency workspace, for each new row; it checks for new rows in the background about every five minutes until you pause or remove the sheet. Leads created this way are agency records: other authorized users, including agency leadership, may see them under your agency's access rules, and agency automations such as workflows may run for them. AgentFlow does not modify your spreadsheets. Imported leads remain after you remove a sheet or disconnect, and are retained and deleted under this policy like other agency records. Disconnecting Google Sheets in AgentFlow deletes AgentFlow's saved Sheets authorization and stops checking your sheets; it does not revoke Google's authorization. To revoke it, use your Google Account's third-party connections page — because AgentFlow's Google integrations may share one authorization, revoking there can also disconnect Gmail and Calendar.

The Limited Use paragraph already covers "information received from Google APIs", so no other paragraph changes.

## 8. Production verification

- Run `supabase/ops/google_sheets_drain_check.sql` once after activation (read-only) to record a marker baseline for any later shutdown.
- Run the §6 steps, then read-only SQL. For the pilot org:
  - receipts count equals imported plus skipped test rows;
  - `contact_history_events` shows action `imported` for each test lead;
  - no `notifications` row for the self-imports;
  - `dnc_list` and `sms_suppressions` row counts are unchanged.
- Edge logs carry no tokens. Spot-check `google-sheets-*` logs for `ya29`, `1//` or `Bearer` values: expect none.
- Vercel: the production deployment is READY, and the served bundle contains `google-sheets-api` only when the flag is set.

## 9. Rollback

1. Run the §5 **non-destructive shutdown**: unschedule → close admission → drain → verify quiescence. Then unset `GOOGLE_SHEETS_ENABLED` and `VITE_GOOGLE_SHEETS_ENABLED`.
   - Report the feature as stopped only when the quiescence check passes; otherwise it is BLOCKED.
   - Existing leads, receipts and baselines are untouched.
2. Optional, with separate approval: delete the four functions, then run the rollback SQL. This also drops receipts, so re-adding a sheet afterwards could re-import rows.
3. Google: disable or delete the "AgentFlow Sheets" client. That does not affect Gmail/Calendar's client.
