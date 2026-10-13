# Google Sheets V1 — production release package

**Status: PREPARED, NOT EXECUTED.** Every step below needs Chris's approval of its exact action.

Nothing in this package has been run:
- no production migration, Edge deployment or secret change;
- no Google Cloud change, cron job or Vercel environment change;
- no live import, privacy publication or merge.

- **Branch:** `claude/keen-brown-e4u3ht`.
- **Reviewed application head:** `b66c44f4b336b3ee5cb385f54ee7920d41f9d7a6`. The setup gate changed documentation only.
- **Plan:** `implementation_plan.md` §0 in this folder.
- **Evidence:** `verification.md`. §12 there holds the setup-gate preflight.

**Revision 2026-10-13 (setup gate: Google setup and controlled-pilot preparation).** It adds:
- §0.A, the read-only preflight results;
- §1, an owner checklist for the Google Cloud setup. **It was not performed:** this session has no authenticated Google access;
- §2, which gate needs each secret, and how values are handed over;
- §3, the expected post-apply read-backs, including the helper MD5 and the advisor delta;
- §4, the exact Edge bundles and the checks to run while disabled;
- §5.0, the controlled pilot plan;
- §6, the 10-step real Google test;
- §7, the exact privacy copy;
- §10, the next approval request (disabled-backend deployment).

**Revision 2026-10-13 (pre-release integrity corrections, §0.9 with amendments A–C).** This package reflects:
- stale-run finalization that is bound to the generation and the lease, and writes nothing when stale;
- Review that is bound to the generation and the snapshot, with explicit choices;
- accounting for excluded blank-ID rows;
- duplicate-ID comparison over all mapped values;
- a Picker re-check;
- a tested non-destructive shutdown (§5);
- an accurate capacity statement.

The previous "independently sufficient kill switches" claim is withdrawn.

---

## 0. Pre-release checks (read-only; repeat at every gate)

1. **`main` and the deploy integration.**
   - Confirm `main` has not moved past the PR base, or merge `main` into the branch and re-run the suites.
   - Confirm GitHub → Supabase "Deploy to production" is still **OFF**: merging must not deploy functions.
2. **Migrations and exact head.**
   - `list_migrations` shows no `google_sheets` entry in production. Re-check every active preview branch.
   - The release deploys exactly the reviewed head recorded above.
   - The Sheets CI workflow (`.github/workflows/google-sheets.yml`) is green on that head.
3. **Permission helper preimage.** The live MD5 must still equal `a199d5ddfb9a56070aeb7706d3e9a4b8`:
   ```sql
   SELECT md5(pg_get_functiondef('public._contacts_permission_default(text,text)'::regprocedure));
   ```
   The migration also refuses to run if it differs.
4. **Edge functions:** `list_edge_functions` shows no `google-sheets-*` function. Run `get_edge_function` on each name before deploying (invariant #4); for these new names it returns not-found.
5. **Callback hostname:** see §0.A. Chris must confirm the Custom Domains page (owner action, §1 G2).
6. **Google publishing status:** this must be read from the Console at each gate (§1 G1). The 2026-10-09 screenshots (External / Testing) are historical, not current evidence.
   - **In Testing:** only listed test users can connect, and every Sheets grant expires 7 days after consent. The basic-profile exemption does not cover `drive.file`.
   - Moving to **In production** is outside every approval so far. It also changes the Gmail/Calendar consent experience.

### 0.A Setup-gate preflight results (2026-10-13, about 07:40 UTC; details in `verification.md` §12)

| Check | Result |
|---|---|
| **Code and CI** | `main` = `f91e4ba`; PR #442 head = `b66c44f` (draft, no conflicts). On that head every check passed: the five Sheets jobs (run 38358513920) and every other workflow. Supabase Preview was skipped because the preview-branch limit is reached. No new overlapping PR; #378 (Google OAuth review, draft) is still unmerged and not relied on. |
| **Production database** `jncvvsvckxhqgqvkppmj` | Latest migration `20261010172702`. No Sheets migration, relation, function, cron job or Vault secret. Helper MD5 `a199d5dd…b8`. PostgreSQL 17.6.1.063 with pg_cron 1.6.4, pg_net 0.19.5, supabase_vault 0.3.1 and pgcrypto 1.3, the same versions the CI cron check uses. |
| **Production Edge Functions** | No `google-sheets-*` function. |
| **Production frontend** | Vercel project `agentflow` (`prj_vUIiwhdXPw4H9uxRZ1zTf28KIXbc`) serves `www.fflagent.com`; `fflagent.com` redirects to it. The production deployment `dpl_E7C5dN2ATUhWbTCfrupJfSamkQws` is READY at `main` `f91e4ba`, so no Sheets UI code is deployed. |
| **Vercel protection** | Vercel Authentication (SSO) is on for all deployments except custom domains, so preview URLs need a Vercel team login. |
| **Vercel environment variables** | Not readable with this session's Vercel access (403). Chris confirms `VITE_GOOGLE_SHEETS_ENABLED` is absent in Production and Preview. |
| **Advisors (pre-apply baseline)** | Security: 224 findings in 7 lint types (fingerprint `6dad3ab9…f1ff`). Performance: 410 findings (fingerprint `9a1674ec…b9b7`). None is Sheets-related. |
| **Organizations and users** | **1 active organization** (`a0000000-0000-0000-0000-000000000001`, "Family First Life - Chris Garness") with **8 active users** (1 Admin, 1 Team Leader, 6 Agents). The 3 suspended organizations are ineligible. No `role_permissions` row stores the new key, so once applied all 8 users are eligible by default. |
| **Workflows** | **0 workflows** exist in production, in any organization. |
| **Google connections** | 1 Gmail connection (Chris's, connected); 0 Calendar integrations. |
| **Callback host** | `get_project_url` = `https://jncvvsvckxhqgqvkppmj.supabase.co`. Supabase logs for 2026-10-06/07 and 2026-10-11 to 2026-10-13 show every API-gateway and Edge Function request on that host and no other. The Custom Domains page and the Management API are not reachable from this session; public DNS lookups are blocked by egress policy. **No evidence of a custom or vanity domain.** The specified callback stands (below). |
| **Google Cloud** | **No authenticated access.** `gcloud` rejects the session token (UNAUTHENTICATED), no Google connector is connected, and no browser tool is available. Nothing in §1 was performed. |

**Callback URI (for G4 and `GOOGLE_SHEETS_REDIRECT_URI`):** `https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/google-sheets-oauth-callback`
- Supabase keeps serving the standard host for Edge Functions even when a custom domain is active, so this URI stays valid either way.
- If G2 shows an active custom domain, stop. I will return the alternative exact URI for approval before the client is created.

## 1. Google Cloud setup — owner checklist (NOT performed in the setup gate)

Do this in project number `87346168200` / ID `project-b7e9b5b4-d066-48c9-b36`.
- Screenshots may show names, statuses and settings. They must never show a client secret, API key or token.
- Reuse a matching resource instead of creating a duplicate.
- Do not change publishing status, branding, test users, or the existing Gmail/Calendar clients and their permissions.

| # | Action | Exact value / what to record |
|---|---|---|
| G0 | Select the project | IAM & Admin → Settings shows project number `87346168200` and ID `project-b7e9b5b4-d066-48c9-b36`. |
| G1 | Record the current state (read-only) | **Audience:** user type, publishing status, test-user count, and whether the pilot Google account (§5.0) is listed. **Branding:** app name and verification status. **Clients:** names, types and created dates; do not open secrets. **Enabled APIs:** whether Google Sheets API, Google Drive API and Google Picker API are enabled. **Data Access:** the current scope list. |
| G2 | Confirm the callback host | Supabase Dashboard → Project Settings → Custom Domains (and Vanity subdomain): record "none active". If one is active, stop and send me the hostname. |
| G3 | Enable APIs (skip any already enabled) | **Google Sheets API** (`sheets.googleapis.com`), **Google Drive API** (`drive.googleapis.com`), **Google Picker API** (`picker.googleapis.com`). |
| G4 | OAuth client (create, or verify an existing one) | Google Auth Platform → Clients. Type **Web application**; name **AgentFlow Sheets**; **no** JavaScript origins. Authorized redirect URI is exactly the callback URI above. Do not edit any other client. **Client secret:** put it only into the Supabase secret field (§2) or your password manager, never chat, GitHub, logs or documents. Google may show a new client's secret only at creation time. |
| G5 | Data Access (Sheets requirements only) | Ensure these three scopes are present, keeping every existing scope: `openid`, `https://www.googleapis.com/auth/userinfo.email` (Google's canonical "email"), and `https://www.googleapis.com/auth/drive.file`. Do **not** add `drive`, `drive.readonly`, `spreadsheets` or `spreadsheets.readonly`. If the console asks for verification, stop and record the exact message. |
| G6 | Picker API key (create, or verify a dedicated one) | Name **AgentFlow Sheets Picker**.<br>**Application restriction → Websites:** exactly `https://www.fflagent.com/*`, `https://fflagent.com/*` and `https://docs.google.com/*`. The Picker runs in a docs.google.com iframe, so that origin is required. No Vercel wildcard; a pilot preview origin is a separate, exact addition at the pilot gate (§5.0).<br>**API restriction:** **Google Picker API** only. The server calls Drive and Sheets with OAuth tokens, not with this key. |
| G7 | Report back (non-secret) | The G1 values; for each of G2–G6, "done" or "already present"; the AgentFlow Sheets client ID's last 6 characters and its created date; the Picker key's name and a screenshot of its restrictions. Never send a secret, key or token. |

**Revocation.** Sheets disconnect **never** calls Google `revoke`.
- Google documents revocation as removing access for the app, possibly for every client in the project.
- A user removing AgentFlow at myaccount.google.com/connections, or Calendar's existing disconnect (which calls revoke), can therefore also invalidate the Sheets grant.
- Sheets then shows **Reconnect**, guarded by the generation.
- Calendar's behaviour is unchanged by this feature.

## 2. Secrets and environment (names, destinations and gates; values are never shared)

**Handoff.**
- **Where Chris enters each value:** Supabase Dashboard → project `jncvvsvckxhqgqvkppmj` → Edge Functions → Secrets, or `supabase secrets set --project-ref jncvvsvckxhqgqvkppmj` on his own machine.
- **Generated values:** created locally, for example `openssl rand -base64 48`.
- **Never shared:** no value is pasted into chat, GitHub, logs or documents.
- **What Claude may set:** only the two non-secret values (`GOOGLE_SHEETS_REDIRECT_URI`, `GOOGLE_SHEETS_ALLOWED_RETURN_ORIGINS`), and only if Chris approves.
- **How presence is checked:** by name in the dashboard's secret list, never by reading a value.

| Name | Destination | Value / source | Needed at |
|---|---|---|---|
| `GOOGLE_SHEETS_CLIENT_ID` | Supabase Edge secret | G4 client ID | disabled-backend deployment |
| `GOOGLE_SHEETS_CLIENT_SECRET` | Supabase Edge secret | G4 client secret | disabled-backend deployment |
| `GOOGLE_SHEETS_REDIRECT_URI` | Supabase Edge secret | exactly the callback URI (§0.A) | disabled-backend deployment |
| `GOOGLE_SHEETS_ALLOWED_RETURN_ORIGINS` | Supabase Edge secret | `https://www.fflagent.com,https://fflagent.com`. The pilot gate puts the exact preview origin first. | disabled-backend deployment; pilot gate |
| `GOOGLE_SHEETS_STATE_KEY` | Supabase Edge secret | ≥ 32 random characters, generated locally (AES-256-GCM key material for PKCE verifiers) | disabled-backend deployment |
| `GOOGLE_SHEETS_WORKER_TOKEN` | Supabase Edge secret | ≥ 32 random characters, generated locally | disabled-backend deployment |
| `GOOGLE_SHEETS_ENABLED` | Supabase Edge secret | **leave unset** | pilot gate (`true`) |
| `google_sheets_worker_token` | Supabase Vault (`vault.create_secret`) | the same value as `GOOGLE_SHEETS_WORKER_TOKEN` | cron gate only |
| `VITE_GOOGLE_PICKER_API_KEY` | Vercel project `agentflow` | G6 key | pilot gate (Preview, scoped to the branch) |
| `VITE_GOOGLE_CLOUD_PROJECT_NUMBER` | Vercel project `agentflow` | `87346168200` | pilot gate (Preview, scoped to the branch) |
| `VITE_GOOGLE_SHEETS_ENABLED` | Vercel project `agentflow` | **leave unset** | pilot gate (`true`, Preview scoped to the branch only) |

The existing `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are used as already provisioned. The Gmail/Calendar `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are **not** used.

## 3. Database migration (exact SQL = the committed file)

**Apply** `supabase/migrations/20261013120000_google_sheets_import_foundation.sql`
- **Checksums:** SHA-256 `fc68da86bfa972148b72302b3bc0daf8d227453b75fdadd6ef8578908d76efed`, MD5 `94c7be79a3a95b4a2b971f4b4513838b`, 86,193 bytes. It was amended in place before any application; it has never been applied anywhere.
- **How:** one `apply_migration` call with the file's exact bytes, after the §0 checks.
- **Rename afterwards (invariant #35):** `apply_migration` stamps its own version. Rename the file to the recorded version with identical bytes, and update every reference to it in a follow-up commit:
  - `.github/workflows/google-sheets.yml`;
  - `scripts/run_google_sheets_tests.sh`;
  - `scripts/run_google_sheets_cron_check.sh`;
  - `scripts/google_sheets_regression_evidence.sh`, candidate side only (it also reads the reviewed head's file under the old name);
  - `supabase/tests/google_sheets_harness.sql`, header comment;
  - `src/lib/google-sheets/__tests__/googleSheets.test.ts`, the `?raw` import;
  - the rollback file's header comment (this changes the rollback checksum);
  - the docs that cite the path.

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
  - **`google_sheets_finish(..., p_generation, ...)`:** returns `completed | released | not_owner | not_found`; locks the source and then the connection; evaluates validity on the real clock after the lock waits; a stale run only releases its own lease.
  - **Ledger and ingest:** the ledger kind `approved` (explicit Review decisions); `noid:<n>` missing-ID keys.
  - **Review:** `google_sheets_review` splits rows into established, content-matched and unmatched; it requires explicit choices and is bound to the generation and the snapshot.
  - **New functions:** `google_sheets_review_state`, `google_sheets_resolve_identity`, `google_sheets_connection_current`.
- Vault is used through `vault.create_secret` / `vault.update_secret` / `vault.secrets` (as the Twilio token functions do).

**Read-back after apply.** These values were reproduced in `supabase/postgres:17.6.1.063` with `--network none`, using the harness that reproduces the live helper preimage (`verification.md` §12).
```sql
SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE p.proname LIKE 'google\_sheets\_%' AND n.nspname IN ('public','private');            -- expect 52 (31 private + 21 public)
SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE 'google\_sheets\_%'
   AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')); -- expect 0
SELECT public._contacts_permission_default('Agent','contacts.leads.import_google_sheets'),
       public._contacts_permission_default('Agent','contacts.leads.import');                  -- expect true, false
SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'google\_sheets\_%' AND relkind = 'r'; -- 6 rows, all true
SELECT md5(pg_get_functiondef('public._contacts_permission_default(text,text)'::regprocedure)); -- expect bc6356dde683e628b88b631dd5f6d01e
SELECT count(*) FROM cron.job WHERE jobname = 'google-sheets-sync-every-minute';               -- expect 0
```

**Advisor comparison.**
- Run `get_advisors` (security and performance) and compare them with the §0.A baselines.
- **Expected security delta:** exactly **+3 INFO `rls_enabled_no_policy`**, on `private.google_sheets_oauth_states`, `private.google_sheets_receipts` and `private.google_sheets_source_rows`. These are deliberately policy-less private tables.
- **Expected performance delta:** +7 INFO `unindexed_foreign_keys`, +4 INFO `unused_index`, +3 WARN `auth_rls_initplan` (the three select-own policies), all on Sheets objects.
- Nothing is expected to be removed. **Any other change stops the deployment** before the functions are deployed.
- **How the expectation was derived:** Supabase's open-source linter (splinter, SHA-256 `d8d558ba…9349`) was run before and after the migration in the production image. The GraphQL exposure lints it also reported locally do not apply, because `pg_graphql` is not installed in production.

**Cron (later, cron gate):** `supabase/migrations/pending/20261013120100_google_sheets_sync_schedule.sql` (SHA-256 `6116f414faf8313b3d09fa2b721eee79ac43d57f16e9de29ef143b92c54f9665`).
- It runs every minute, posts only while a source is due, and authenticates with the Vault token.
- Its guards refuse to run unless the foundation, `pg_cron`, `pg_net` and a Vault token of at least 32 characters exist.

**Rollback file:** `supabase/migrations/rollback/20261013120000_google_sheets_import_foundation.rollback.sql` (SHA-256 `d9f36c350c2e02f9004ffe20a029762bd078e67c184ec06f71496e93ebaf0e93`). It is locally proven to remove every object and restore the exact helper preimage.

## 4. Edge Functions (four new names; exact bundles; deploy order)

**All four:**
- deploy with `verify_jwt=false`, as declared in `supabase/config.toml`, with authorization enforced in code (invariant #2);
- deploy while `GOOGLE_SHEETS_ENABLED` is unset;
- import `https://esm.sh/@supabase/supabase-js@2`, the same specifier as the existing functions; the repository `deno.lock` pins it to 2.98.0.

**Bundle digest:** run `sha256sum <files> | sha256sum` from the repository root, listing the files in C-locale sorted order. Per-file SHA-256 values are in `verification.md` §10. `_shared` means `supabase/functions/_shared/googleSheets/`.

| Order | Function (entry `index.ts`) | Exact files | Bundle digest |
|---|---|---|---|
| 1 | `google-sheets-sync-worker` | `_shared/{auth,config,crypto,db,engine,errors,google,http,identity,mapping,oauth}.ts` + `google-sheets-sync-worker/index.ts` (12 files) | `3097c65fdd8106407f3bcddbc12386eb88e20b593c23045a5d3fa8a2c0f3c3d0` |
| 2 | `google-sheets-api` | `_shared/{auth,config,db,engine,errors,google,http,identity,mapping,oauth}.ts` + `google-sheets-api/{actions,index}.ts` (12 files) | `6ab61569c8d53c7347a737214330768db04a4bdb5ae0c550004c53332d8b6308` |
| 3 | `google-sheets-oauth-callback` | `_shared/{auth,config,crypto,errors,http,oauth}.ts` + `google-sheets-oauth-callback/{deps,index}.ts` (8 files) | `0fe3970b9896952fe2d940ff5387daa5b868a83689e4a41acf2d6fa492848a60` |
| 4 | `google-sheets-oauth-start` | `_shared/{auth,config,crypto,errors,http,oauth}.ts` + `google-sheets-oauth-start/{deps,index}.ts` (8 files) | `7105438ef4d2d33f0cc62a45eb208c0338a618758b9aa2212569d67950a91591` |

**Why this order:** the worker and API go first, both inert while the flag is unset. The callback is deployed before the start function, so no consent screen can be reached before its redirect target exists.

**Read-back after deploy:**
1. `list_edge_functions` shows the four names `ACTIVE`, with `verify_jwt=false` and the expected entry paths.
2. Unauthenticated HTTP checks while the flag is unset. None of them needs a credential:

| Request | Expected |
|---|---|
| `POST /functions/v1/google-sheets-api` with body `{"action":"inspect"}` | 503 `{"error":"disabled"}`, returned before authentication |
| `POST /functions/v1/google-sheets-api` with body `{"action":"status"}` and no JWT | 401 `{"error":"unauthorized"}` |
| `POST /functions/v1/google-sheets-oauth-start` | 503 `{"error":"disabled"}` |
| `GET /functions/v1/google-sheets-oauth-callback?state=x&code=y` | 302 to `https://www.fflagent.com/settings?section=google-sheets&sheets=error` |
| `POST /functions/v1/google-sheets-sync-worker` without `Authorization` | 403 `{"error":"unauthorized"}` |
| Optional, run by Chris locally with his worker token (never shared): `POST …/google-sheets-sync-worker` with `Authorization: Bearer <token>` | 200 `{"ok":true,"disabled":true,"processed":0}` |

## 5. Pilot, activation, operating controls and shutdown

### 5.0 Controlled pilot plan (prepared; NOT activated)

**Pilot user (resolved read-only on 2026-10-13):**
- **Chris Garness:** profile `ecf2bb91-0350-4542-85ec-14d914311e99`, role Admin (also super admin and platform admin), status Active.
- **Organization:** `a0000000-0000-0000-0000-000000000001`, "Family First Life - Chris Garness", active.
- **Eligibility:** `google_sheets_owner_eligible` allows Admin unconditionally.

**Google account:**
- Chris must confirm which Google account he will authorize. It is **not** inferred from his AgentFlow login email.
- **Candidate:** the Google account already connected to his AgentFlow Gmail. It is the provider account on his `user_email_connections` row and the only Google account ever connected to AgentFlow.
- That address happens to match his AgentFlow login email (checked read-only as a boolean). The candidate comes from the live Google connection, not from the login.
- **Why that one:**
  - it has already authorized this Google Cloud project's Gmail client;
  - in Testing it must therefore already be a test user (G1 confirms);
  - using the same account makes the disconnect-isolation proof (§6 step 10) meaningful.

**Environment:**
- **Frontend origin:** `https://agentflow-git-claude-keen-brown-e4u3ht-cgarness-projects.vercel.app`. This is the branch alias of the `agentflow` preview; deployment `dpl_6ncQHEs8yxNBdGjU4TFRfvvzcRQM` is READY at `b66c44f`. It is protected by Vercel Authentication.
- **Backend:** production `jncvvsvckxhqgqvkppmj`, the only Supabase project.
- **Production frontend:** `www.fflagent.com` stays on `main` and has no Sheets code.
- **Owner check:** Vercel Preview's `VITE_SUPABASE_URL` must point to `jncvvsvckxhqgqvkppmj` (not readable here).

**Who can use it during the test, and what activation exposes:**
- **UI:** only people who pass Vercel Authentication on the preview *and* sign in as an eligible AgentFlow user. Chris confirms the Vercel team membership.
- **Backend:**
  - `GOOGLE_SHEETS_ENABLED` is project-wide, and the reviewed code has **no per-user pilot allowlist**.
  - With it set, each of the **8 active users of the only active organization** could call the Sheets API directly with their own AgentFlow session: `status`, `context`, `disconnect`, and OAuth start, which redirects only to allowlisted origins. After connecting, the remaining actions work too.
  - The 3 suspended organizations stay ineligible.
- **What limits this in practice (none of these is an AgentFlow-side allowlist):**
  - *Google consent:* in Testing, only listed test users can consent. In production status, any Google account can.
  - *Adding a sheet needs the Google Picker:* Google serves it only on the key's allowed referrers. Production has no Picker code until merge, and the preview is protected.
  - *`drive.file`:* the server can read only files that user picked.
  - *No background processing:* cron stays absent, so imports happen only on that user's own Enable or Sync now.
- **Worst case if a non-pilot user did this deliberately:** they could connect their own test-user Google account and import leads, assigned to themselves in the same organization, from a sheet they picked. Lead Created dispatch fires; no workflow exists. No other organization is affected.
- **This is a limited pilot, not a private one.** A strictly private pilot needs a server-side allowlist, which is a code change. It is **not proposed for implementation**; if wanted, its files are `_shared/googleSheets/config.ts`, `google-sheets-api/index.ts`, `google-sheets-oauth-start/index.ts` and their tests, and it needs approval first.

**Google publishing status:** no change. If it is Testing, the pilot must finish within 7 days of consent (or reconnect), and the pilot account must already be a test user. Adding a test user is a separate pilot-gate decision. If it is In production, the Google-side limit above disappears; record which applies at G1.

**Test rows (synthetic only; checked read-only on 2026-10-13):**
- No lead in the organization uses these phone numbers, any `example.test` email, or the lead source "Google Sheets".
- Phone numbers 702-555-0100 to 0199 are reserved for fiction.
- Chris currently has 3 assigned leads. Re-count right before the test.

*Spreadsheet A* — "AgentFlow Sheets Pilot A", tab `Leads`, identity by **Lead ID**:

| Lead ID | First Name | Last Name | Phone | Email | State | When |
|---|---|---|---|---|---|---|
| A-001 | Ada | Existing | (702) 555-0101 | ada.existing@example.test | NV | before Enable (must not import) |
| A-002 | Abe | Existing | (702) 555-0102 | abe.existing@example.test | NV | before Enable (must not import) |
| A-101 | Ava | Pilot | (702) 555-0111 | ava.pilot@example.test | NV | after Enable (step 7) |
| A-102 | Amy | Pilot | (702) 555-0113 | amy.pilot@example.test | NV | while A is paused (step 9) |

*Spreadsheet B* — "AgentFlow Sheets Pilot B", tab `Leads`, identity by **row position** (no Lead ID column; always append at the bottom):

| First Name | Last Name | Phone | Email | State | When |
|---|---|---|---|---|---|
| Ben | Existing | (702) 555-0103 | ben.existing@example.test | AZ | before Enable (must not import) |
| Bea | Existing | (702) 555-0104 | bea.existing@example.test | AZ | before Enable (must not import) |
| Bo | Pilot | (702) 555-0112 | bo.pilot@example.test | AZ | after Enable (step 7) |
| Bri | Pilot | (702) 555-0114 | bri.pilot@example.test | AZ | while A is paused (step 9) |

**Exactly 4 leads may be created:** A-101, A-102, Bo and Bri. The 4 rows marked "before Enable" must never import.

**Side effects of each imported lead (production state on 2026-10-13):**
- **`trg_workflow_lead_created`:** posts one request (pg_net) to `workflow-trigger-evaluator`. Production has **no workflows**, so nothing runs.
- **`notify_lead_assignments`:** skips self-imports (assignee = importer), so no notification.
- **`contact_history_capture`:** records the lead's creation.
- **`tr_sync_leads_user_id`:** aligns `user_id`.
- **Duplicate settings for the organization:** rule `phone_or_email`, scope `assigned_only`, import action `flag`. The test rows match nothing.
- **Never touched:** dialing, campaigns, SMS, DNC and consent.
- **Pre-test stop rule:** re-count workflows. If any Lead Created workflow exists in the organization, stop and report. Workflows are not disabled or edited for the test.
- **Afterwards:** the synthetic leads stay. Deleting them needs separate approval (invariant #28).

### Activation (pilot gate — separate approval; nothing here is approved yet)
1. Google: add the exact referrer `https://agentflow-git-claude-keen-brown-e4u3ht-cgarness-projects.vercel.app/*` to the G6 key.
2. Edge secret `GOOGLE_SHEETS_ALLOWED_RETURN_ORIGINS`: put that exact origin first.
3. Vercel project `agentflow`, **Preview environment scoped to branch `claude/keen-brown-e4u3ht` only**:
   - set `VITE_GOOGLE_SHEETS_ENABLED=true`, `VITE_GOOGLE_PICKER_API_KEY` and `VITE_GOOGLE_CLOUD_PROJECT_NUMBER=87346168200`;
   - redeploy that branch's preview;
   - leave Production untouched.
4. Edge secret `GOOGLE_SHEETS_ENABLED=true`.
5. Run §6. Cron stays absent, and no Vault token is created.
6. After the test, Chris chooses whether to keep the backend enabled for continued pilot use or unset `GOOGLE_SHEETS_ENABLED`.

**Agency rollout (later, separate approvals):**
- merge PR #442;
- set `VITE_GOOGLE_SHEETS_ENABLED` in Production, which shows the feature to every eligible user — currently all 8 active users;
- set the return origins to production only;
- add the Vault token and apply the cron migration;
- publish the privacy copy before any non-test user connects.

### Capacity statement (verified behaviour; no limit is changed)

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

### What each control actually does (Amendment C; nothing below is "independently sufficient" on its own)

| Control | Effect | Does NOT |
|---|---|---|
| UI flag `VITE_GOOGLE_SHEETS_ENABLED` unset + frontend redeploy | Hides Settings → Google Sheets | Stop scheduled syncs, queued requests, running invocations or direct API calls |
| Future cron scheduling — `supabase/ops/google_sheets_unschedule.sql` | No new scheduled invocation | Remove a `net.http_post` already queued in `net.http_request_queue` (it can still be sent), or stop an invocation already running |
| Backend flag `GOOGLE_SHEETS_ENABLED` unset | The worker reads it **once, before its claim loop**, and is inert when unset. The API reads it per request and answers 503 except `status` and `disconnect`. OAuth start answers 503. | Stop an invocation that has already passed the check: it keeps claiming until its 10-claim / 45 s cooperative budget ends. A cooperative budget is not proof that outstanding Google or database calls have finished. Secret changes reach later invocations only as the platform picks them up. |
| In-flight database operations | Every RPC is one transaction: one that has started finishes or rolls back on its own | — |
| Per-source **Pause** | Bumps `config_version` and clears the lease, so that source's next ingest batch and its finish are refused. Leads, receipts and baselines stay. | Affect other sources |
| Per-connection **Disconnect** | Bumps `auth_generation` and deletes the Vault secret, so that connection's next batch, finish, Review apply and Picker token are refused. It never calls Google revoke. | Revoke an access token Google already minted (it expires within an hour, and the server never returns it after the change) |
| **Admission gate** — `supabase/ops/google_sheets_admission_close.sql` | Revokes EXECUTE on every `public.google_sheets_*` wrapper from `service_role`, except `google_sheets_disconnect`. From then on, no invocation (scheduled, queued, already running, API, OAuth callback) can start another database operation: each new call fails with `42501`. | Interrupt an RPC that is already executing; it completes atomically and the drain check verifies it |

### Non-destructive shutdown (tested locally and in CI; each SQL step needs approval at the time, and gate changes are applied as migrations per the `supabase/ops` convention)
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

## 6. Real Google test (pilot gate; PREPARED, NOT performed)

**Set-up:**
- Chris's account and the pilot origin from §5.0.
- The Google account Chris confirmed.
- The two synthetic spreadsheets, created by Chris in that Google account with exactly the "before Enable" rows.

**Evidence rules:**
- **Allowed:** screenshots, Edge log metadata (timestamp, status, execution id), and read-only SQL that never selects a token column or a Vault value.
- **Not allowed:** any token, code, secret or key value.
- **Mocked Picker checks are not this test.**

| Step | Action | Evidence that proves it |
|---|---|---|
| 1 | **Real OAuth consent.** Settings → Google Sheets → **Connect Google**, as Chris. | The consent screen lists only identity/email and "See, edit, create and delete only the specific Google Drive files you use with this app". After returning, Settings shows **Connected**. Read-only SQL: Chris's `google_sheets_connections` row has `status = connected`, `granted_scopes` = {email, `…/auth/drive.file`, openid}, an `auth_generation` = *g* and a `connected_at` = *T0*. The Vault secret named `google_sheets_refresh_<connection id>` exists (metadata only: name, created/updated time). |
| 2 | **Picker selects spreadsheet A.** **Add sheet** → **Choose spreadsheet** → pick "AgentFlow Sheets Pilot A". | The real Google Picker opens on the pilot origin and returns the file (screenshot). |
| 3 | **The server reads A.** The tab list, headers and preview appear. | They come from the server's Drive `files.get` and Sheets reads (`inspect`, `headers`, `preview`). Each Edge invocation first exchanges the stored refresh token. `function_edge_logs` shows 200 responses for `google-sheets-api` at *T1*, with their execution ids. |
| 4 | **A second refresh-token exchange, then a successful read.** Map (Lead ID column = `Lead ID`), leave "Also import existing rows" unchecked, **Enable**, then click **Sync now** on A at *T2*. Sync now is a new Edge invocation. | **(a)** A new `google_sheets_sync_runs` row for A at *T2*, status ok. **(b)** A 200 for that invocation in `function_edge_logs`, with a distinct execution id. **(c)** `auth_generation` is still *g*, `connected_at` is still *T0*, and the Vault secret's `updated_at` is unchanged: no new consent or code exchange happened between the reads, so the only credential was the saved refresh token. **(d)** In the reviewed code, every server read obtains its access token by calling Google's token endpoint with that refresh token *in the same invocation* (`google-sheets-api/actions.ts` `access()`, `engine.ts` `runSource`). No access token is stored anywhere (no column, no Vault entry). So the read at *T2* necessarily used the access token from its own exchange. **(e)** Optional Google-side corroboration: Console → APIs & Services → Google Sheets API → Metrics, filtered to the AgentFlow Sheets client, shows requests at *T1* and *T2*. No one-hour wait is needed. Log-level token correlation, for example a logged hash of the token, does not exist in the reviewed code; adding it is a code change that needs approval. |
| 5 | **A second spreadsheet without replacing the first.** Add "AgentFlow Sheets Pilot B" (no Lead ID: row position) and Enable it. | Both sheets are listed. Read-only SQL: two `google_sheets_sources` rows for Chris with different `spreadsheet_id` values, both `state = enabled`. |
| 6 | **Existing rows are excluded by default.** | No lead with phone 702-555-0101…0104 exists. The baseline ledger holds 2 entries for A (`id:A-001`, `id:A-002`) and 2 for B (`pos:2`, `pos:3`). The first Sync now on each source shows 0 imported. |
| 7 | **One new eligible row per sheet creates the correct lead.** Add A-101 to A and Bo at the bottom of B, then Sync now on each. | Exactly two leads, Ava Pilot and Bo Pilot. For both, `assigned_agent_id = user_id = imported_by_user_id = ecf2bb91…`, `organization_id = a0000000-…-0001`, and `lead_source = 'Google Sheets'`. One receipt each, linking the correct source to its lead. Chris's assigned-lead count rises by 2. No notification. |
| 8 | **Repeated Sync now does not replay.** Run Sync now twice on each sheet. | Each run shows 0 imported. The lead and receipt counts are unchanged. |
| 9 | **Pause and resume work independently.** (i) Pause A; add A-102 to A and Bri to B; Sync now B → Bri imports, and A cannot sync and gets no A-102 lead. (ii) Resume A and pause B; Sync now A → A-102 imports. (iii) Resume B; Sync now B → 0 imported. | The lead and receipt counts after each phase match exactly. A's `config_version` changes on its pause and resume while B's does not, and the reverse in (ii). |
| 10 | **Gmail and Calendar are unaffected by Sheets disconnect.** Click **Disconnect** in Settings → Google Sheets. | Both sources show **Reconnect**. Chris's Sheets connection is `disconnected` with a new `auth_generation`, and its Vault secret is gone. His Gmail connection (same Google account, if confirmed) stays `connected` and its `last_sync_at` keeps advancing. If revoke had been called, Gmail would fail with `invalid_grant`. The Calendar integration count stays 0 (Chris has none), and no Gmail or Calendar code or table is touched. |

**After the test:** the synthetic leads remain. Deleting them needs separate approval (invariant #28). Chris may reconnect to continue the pilot.

## 7. Privacy copy (proposed; exact text for approval; not published)

**Add** this section to `src/content/legal.ts` (Privacy Policy) after the Google Calendar section, with id `sheets`. Record the approved text in `docs/plans/2026-10-09-google-verification/policy-review.md`.

> **Google Sheets information**
>
> If you connect Google Sheets, AgentFlow requests your Google account identity and email address and access only to the specific spreadsheet files you choose in Google's file picker. AgentFlow reads the spreadsheets you select; it does not change them.
>
> For each spreadsheet tab you enable, AgentFlow checks for new rows in the background about every five minutes, including while you are signed out, until you pause or remove that sheet or disconnect Google Sheets. By default, only rows added after you enable a sheet become leads; the rows already in the sheet at that time are recorded so they are not imported. When you enable a sheet, you can instead choose to also import the rows already in it.
>
> Each imported row becomes a lead in your agency workspace, assigned to you, using the columns you map, such as names, phone numbers, email addresses and other lead details. AgentFlow also keeps the selected file and tab details and a record of which rows it has handled, so that sorting, editing or re-adding a sheet does not import the same row twice. Imported leads are agency records: other authorized users, including agency leadership, may see them under your agency's access rules; your agency's duplicate rules apply; and agency automations such as Lead Created workflows may run for them.
>
> Imported leads remain after you pause or remove a sheet or disconnect Google Sheets, and they are retained and deleted under this policy like other agency records. Removing a sheet from AgentFlow does not delete the spreadsheet.

**Change** these existing sentences so the shared sections stay accurate:
- *Google data and Limited Use*, first sentence:
  - **from:** "…to provide the email, communication-history and calendar features that users choose."
  - **to:** "…to provide the email, communication-history, calendar and spreadsheet lead-import features that users choose."
- *Agency visibility and service providers*:
  - **from:** "Google processes Gmail and Calendar requests."
  - **to:** "Google processes Gmail, Calendar and Google Sheets requests."
- *Disconnecting and revoking Google access*:
  - **add after the Gmail paragraph:** "You can disconnect Google Sheets in AgentFlow's Google Sheets settings. Disconnecting deletes AgentFlow's saved Google Sheets authorization and stops checking all of your sheets; it does not revoke Google's authorization and does not disconnect Gmail or Calendar. Imported leads remain."
  - **and change** "Revocation can affect both Gmail and Calendar when they share a Google authorization." **to** "Revocation can affect Gmail, Calendar and Google Sheets together, because they may share AgentFlow's Google authorization."
- *Terms — Google and other integrations*, first paragraph:
  - **after** "optional Calendar access supports appointment synchronization."
  - **add:** "Optional Google Sheets access supports creating leads from new rows in spreadsheets you select."

Publication, and updating the policy's effective date, happens only after Chris approves this exact text, and before any non-test user connects.

## 8. Production verification

- Run `supabase/ops/google_sheets_drain_check.sql` once after activation (read-only) to record a marker baseline for any later shutdown.
- Run the §6 steps, then read-only SQL. For the pilot org:
  - the receipts count equals the imported test rows (4);
  - `contact_history_events` records each test lead's creation;
  - there is no `notifications` row for the self-imports;
  - `dnc_list` and `sms_suppressions` row counts are unchanged.
- Edge logs carry no tokens. Spot-check `google-sheets-*` logs for `ya29`, `1//` or `Bearer` values: expect none.
- Vercel: the pilot preview is READY. Production stays on `main` until the agency-rollout gate.

## 9. Rollback

1. Run the §5 **non-destructive shutdown**: unschedule → close admission → drain → verify quiescence. Then unset `GOOGLE_SHEETS_ENABLED` and `VITE_GOOGLE_SHEETS_ENABLED`.
   - Report the feature as stopped only when the quiescence check passes; otherwise it is BLOCKED.
   - Existing leads, receipts and baselines are untouched.
2. Optional, with separate approval: delete the four functions, then run the rollback SQL. This also drops receipts, so re-adding a sheet afterwards could re-import rows.
3. Google: disable or delete the "AgentFlow Sheets" client. That does not affect Gmail/Calendar's client.

## 10. Next approval request — disabled-backend deployment (not approved yet)

**Precondition (owner):** §1 G0–G7 are done and reported, including G2 (no custom domain) and G4 (the AgentFlow Sheets client exists).

**Approve, for production `jncvvsvckxhqgqvkppmj` from reviewed head `b66c44f`, exactly the following:**
1. **Secrets (D1).** Chris enters the six §2 Edge secrets marked "disabled-backend deployment". Claude never sees a value.
   - `GOOGLE_SHEETS_ENABLED` stays **unset**.
   - No Vault secret and no Vercel change.
2. **Migration (D2).** Apply `supabase/migrations/20261013120000_google_sheets_import_foundation.sql` (SHA-256 `fc68da86bfa972148b72302b3bc0daf8d227453b75fdadd6ef8578908d76efed`) with one `apply_migration` call.
   - **Before:** the §0 checks.
   - **After:** every §3 read-back value (including helper MD5 `bc6356dde683e628b88b631dd5f6d01e` and 0 cron jobs), plus the advisor comparison. **Any unexpected advisor change stops the deployment.**
   - **Then:** a follow-up branch commit renaming the file to the recorded version, with identical bytes.
3. **Edge Functions (D3).** Deploy the four §4 bundles, with `verify_jwt=false`, in order: sync-worker, api, oauth-callback, oauth-start.
   - **After:** the §4 read-backs and unauthenticated disabled-state checks.

**Stays off afterwards:**
- the backend flag (`GOOGLE_SHEETS_ENABLED`) and the frontend flag (`VITE_GOOGLE_SHEETS_ENABLED`) remain unset;
- production keeps serving `main` `f91e4ba`, with no Sheets UI;
- the cron job is absent; the pending migration stays in `pending/`;
- PR #442 stays draft; nothing is merged.

**Separate approvals that follow:**
- the pilot gate (§5.0 activation, then §6);
- the privacy text (§7);
- the cron gate;
- agency rollout.
