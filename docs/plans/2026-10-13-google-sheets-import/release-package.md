# Google Sheets V1 — production release package

**Current execution route (2026-10-17): cloud GitHub Actions, §10.3.** The Mac procedures below are historical alternatives. Runner PR #451 is prepared and its real PostgreSQL verification passed. Production remains unchanged for Sheets. PR #442 now reconciles main `91eabff` (#450); release artifacts remain pinned to and byte-identical with `eaf988b`. The current observed frontend is `dpl_BPvvQ9KWdNtcnpHTuSzHpWMkabdZ`; capture the rollback target again before each approved merge.

**Status: Phase B APPROVED (2026-10-15) and IN PROGRESS through the documented psql / CLI fallback (§10, §10.1). Nothing has been applied or deployed yet.** Every later phase needs Chris's approval of its exact actions.

So far:
- **No production migration and no Edge deployment.** Phase B attempt 1 through the Supabase MCP connector stopped at B2, with production unchanged (`verification.md` §14).
- **Secrets:** Chris entered the six B1 Edge secrets himself. Claude has not seen or changed any.
- **Not done:** no Google Cloud change by Claude, no cron job, no Vercel environment change, no live import, no privacy publication and no merge.

- **Branch:** `claude/keen-brown-e4u3ht`.
- **Reviewed application head:** `b66c44f4b336b3ee5cb385f54ee7920d41f9d7a6`.
- **Reconciled head (2026-10-16, third reconciliation):** merge commit `2f8b543`, which is the reviewed Sheets work merged with `main` `9a90552` (#447, the Commission Calculator release, and #449, its UI refresh). The earlier merges `bf6b644` and `94e9bc1` brought in `b5976e0` and `03ef0cb`. Later commits change documentation only.
  - Its diff against `main` is exactly the PR's 88 files.
  - The Sheets code, SQL, tests, scripts and workflow are byte-identical to `b66c44f`.
  - `AGENT_RULES.md`, `WORK_LOG.md`, `implementation_plan.md`, `supabase/config.toml`, `src/config/settingsConfig.ts` and `src/components/settings/SettingsRenderer.tsx` carry both sides.
  - Every other file is byte-identical to `main`.
- **Plan:** `implementation_plan.md` §0 in this folder.
- **Evidence:** `verification.md`:
  - §12: the read-only preflight;
  - §13, §15 and §18: the three reconciliations with `main`;
  - §14: Phase B attempt 1;
  - §16: the fallback preflight and the local dry run of the §10.1 commands;
  - §17: production changes from the commission release (not Sheets).

**Revision 2026-10-16 (third reconciliation; production moved, but not for Sheets).** Overnight, the Commission Calculator release (#447) and its UI refresh (#449) reached `main` (`9a90552`) and production. Its three migrations (`20261015211858`, `20261016035150`, `20261016035626`) were applied under Chris's account, so production now has 327 history rows. Chris approved reconciling the branch with that `main` (merge `2f8b543`; `verification.md` §17–§18). This revision:
- updates the stage 1 preflight value to the new latest version, `…|20261016035626`, and the history count after stage 3 to 328 rows (§3, §10.1);
- updates the Phase C rollback target to `dpl_7C68MvwQxhH43ExdVNLWprGvEKTf` at `9a90552` (§5.1, §9);
- removes the obsolete "rename commit" precondition from Phase C (§5.1). The history row keeps the authored version;
- adds the re-check (§0.D) and the lessons from the local dry run of the §10.1 commands: run them in `bash`, the stage 1 lock window and the Ctrl-C rule.

**Revision 2026-10-16, later (no production change).** Two additions:
- §3 gains a table-privilege read-back. Production's default privileges give new `public` tables to `anon` and `authenticated` until the migration revokes them, and the read-backs covered functions only.
- §10.2 runs §10.1 from a local Claude Code session on Chris's Mac, because the cloud session has no route to production. The commands are unchanged.

The migration, the four Edge bundles, the secrets, the origins and every approval boundary are unchanged. The commission objects do not interact with the Sheets migration (`verification.md` §17).

**Revision 2026-10-15 b (Phase B fallback; reconciled with `main` `b5976e0`).** Phase B attempt 1 stopped at B2: the Supabase MCP connector could not carry the 86 KB migration, and requests of 30 KB or more stalled before reaching the database (`verification.md` §14). Chris then approved:
- merging `main` `b5976e0` (#448, the Team Leader invitation hotfix) into the branch, with re-verification (`verification.md` §15);
- finishing Phase B through the documented recovery path, in place of further large MCP requests:
  - B2: the exact migration file through `psql --single-transaction`;
  - read-backs and the advisor delta;
  - only then, the history row for version `20261013120000` through `supabase migration repair`;
  - B3: the four functions through the Supabase CLI, one named function at a time.

This revision:
- rewrites §3 "How" and §4 "How" for that path. The recorded version is the authored `20261013120000`, so there is no restamp;
- adds the staged command procedure (§10.1);
- adds the read-only re-check (§0.C);
- updates the Phase C rollback target to the current production deployment (§5.1, §9).

The migration, the four Edge bundles, the secrets, the origins and every approval boundary are unchanged.

**Revision 2026-10-15 (reconciled with current `main` before Phase B).** `main` moved from `f91e4ba` to `03ef0cb` with #443 (ClearPath alerts), #445 (instant manual SMS, frontend only) and #446 (docs), and it was merged into the branch. This revision:
- adds the refreshed read-only state (§0.B);
- names the reconciled head as the Phase B source (§10). The migration and the four Edge bundles are unchanged;
- replaces the stale Phase C rollback target (§5.1, §9) with "the production deployment current immediately before the merge", which is `dpl_BoRbMNiVBBw3NCjLbcN7c8JQdQ3t` at `03ef0cb` on 2026-10-15;
- adds a read-only Conversations check to the Phase C health checks, because #445 changed that page;
- compares the Phase B advisors with a fresh capture taken immediately before B2 (§3), because the stats-based lints drift over time.

No phase, approval boundary, secret, origin or application behaviour changed.

**Revision 2026-10-13 (live-production test plan).** Chris approved testing directly in live production at `https://www.fflagent.com`, instead of on the protected Vercel preview. This revision:
- replaces the pilot plan with the release sequence below (Phases A–E);
- removes the preview from every step. Picker referrers and Sheets return origins are production-only, and no `*.vercel.app` origin is added anywhere;
- documents exactly what users see after the Phase C merge with the feature still disabled (§5.1);
- states the Phase D exposure, with a recommended way to limit the live test to Chris through the existing Permissions settings (§5.2);
- adds the pilot Google account and test-user step to the owner checklist (§1 G7).

The privacy copy stays pending until Phase E. Application code is unchanged.

Earlier revisions the same day added the read-only preflight (§0.A), the owner checklist (§1), the secret gates (§2), the expected read-backs and advisor delta (§3), the exact Edge bundles (§4), the real Google test (§6) and the privacy copy (§7). They also reflect the pre-release integrity corrections (§0.9 of the plan):
- stale-run finalization bound to the generation and the lease;
- generation- and snapshot-bound Review with explicit choices;
- accounting for excluded blank-ID rows;
- duplicate-ID comparison over all mapped values;
- the Picker re-check;
- a tested non-destructive shutdown;
- an accurate capacity statement.

The earlier "independently sufficient kill switches" claim stays withdrawn.

---

## Release sequence (each phase is a separate approval)

| Phase | What happens | Owner of the action | Details |
|---|---|---|---|
| **A — Google owner setup** | APIs, the AgentFlow Sheets OAuth client, Data Access, the Picker key, and the pilot account / test user | Chris, in Google Cloud and Supabase settings | §1 |
| **B — Backend deployed, disabled** | Install the Edge secrets; apply the foundation migration; deploy the four Edge Functions. `GOOGLE_SHEETS_ENABLED` stays unset, cron stays absent, no imports. | Chris enters the secrets; Claude applies and deploys after approval | §2, §3, §4, §10 |
| **C — Production code release, still disabled** | Merge PR #442 so Vercel deploys it to production. `VITE_GOOGLE_SHEETS_ENABLED` stays unset. Confirm production is healthy, including dialer, contacts, Gmail, Calendar and reporting. | after approval | §5.1 |
| **D — Live test activation** | Set `GOOGLE_SHEETS_ENABLED=true`; set the frontend flag and Picker variables in Vercel Production and redeploy. Cron stays OFF. Run the real Google-account test manually with Sync now, using synthetic data only. | after approval | §5.2, §5.4, §6 |
| **E — Normal operation** | Only after §6 passes: publish the privacy update; add the Vault token and apply the pending cron migration; verify the roughly five-minute automatic checks; run the final production verification. | after separate approvals | §5.3, §7, §8 |

**Production URLs used throughout:**
- **App:** `https://www.fflagent.com`; `https://fflagent.com` redirects there.
- **Backend:** Supabase `jncvvsvckxhqgqvkppmj`.
- **OAuth callback:** `https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/google-sheets-oauth-callback`. It changes only if Chris finds an active Supabase custom domain at G2; in that case he stops and reports the hostname first.

## 0. Pre-release checks (read-only; repeat at every phase)

1. **`main` and the deploy integration.**
   - Confirm `main` has not moved past the PR base, or merge `main` into the branch and re-run the suites.
   - Before Phase C, confirm GitHub → Supabase "Deploy to production" is still **OFF**, so the merge cannot deploy functions or migrations.
2. **Migrations and exact head.**
   - `list_migrations` shows no `google_sheets` entry before Phase B. Re-check every active preview branch.
   - The release deploys exactly the reviewed head recorded above.
   - The Sheets CI workflow (`.github/workflows/google-sheets.yml`) is green on that head.
3. **Permission helper preimage.** Before Phase B, the live MD5 must still equal `a199d5ddfb9a56070aeb7706d3e9a4b8`:
   ```sql
   SELECT md5(pg_get_functiondef('public._contacts_permission_default(text,text)'::regprocedure));
   ```
   The migration also refuses to run if it differs.
4. **Edge functions:** before Phase B, `list_edge_functions` shows no `google-sheets-*` function. Run `get_edge_function` on each name before deploying (invariant #4); for these new names it returns not-found.
5. **Callback hostname:** see §0.A and §1 G2.
6. **Google publishing status:** read it from the Console at each phase (§1 G1). The 2026-10-09 screenshots (External / Testing) are historical, not current evidence.
   - **In Testing:** only listed test users can connect, and every Sheets grant expires 7 days after consent. The basic-profile exemption does not cover `drive.file`.
   - Moving to **In production** is outside every approval so far. It also changes the Gmail/Calendar consent experience.

### 0.A Read-only preflight results (2026-10-13, about 07:40 UTC; details in `verification.md` §12)

| Check | Result |
|---|---|
| **Code and CI** | `main` = `f91e4ba`. Every check passed on `b66c44f` and on the docs head `66deefa`; Supabase Preview was skipped because the preview-branch limit is reached. No new overlapping PR; #378 (Google OAuth review, draft) is still unmerged and not relied on. |
| **Production database** `jncvvsvckxhqgqvkppmj` | Latest migration `20261010172702`. No Sheets migration, relation, function, cron job or Vault secret. Helper MD5 `a199d5dd…b8`. PostgreSQL 17.6.1.063 with pg_cron 1.6.4, pg_net 0.19.5, supabase_vault 0.3.1 and pgcrypto 1.3, the same versions the CI cron check uses. |
| **Production Edge Functions** | No `google-sheets-*` function. |
| **Production frontend** | Vercel project `agentflow` (`prj_vUIiwhdXPw4H9uxRZ1zTf28KIXbc`) serves `www.fflagent.com`; `fflagent.com` redirects to it. Production deployment `dpl_E7C5dN2ATUhWbTCfrupJfSamkQws` is READY at `main` `f91e4ba`, so no Sheets UI code is deployed. |
| **Vercel environment variables** | Not readable with this session's Vercel access (403). Chris confirms `VITE_GOOGLE_SHEETS_ENABLED` is absent in Production. |
| **Advisors (pre-apply baseline)** | Security: 224 findings in 7 lint types (fingerprint `6dad3ab9…f1ff`). Performance: 410 findings (fingerprint `9a1674ec…b9b7`). None is Sheets-related. |
| **Organizations and users** | **1 active organization** (`a0000000-0000-0000-0000-000000000001`, "Family First Life - Chris Garness") with **8 active users** (1 Admin, 1 Team Leader, 6 Agents). The 3 suspended organizations are ineligible. No `role_permissions` row stores the new key, so once applied all 8 users are eligible by default. |
| **Workflows** | **0 workflows** exist in production, in any organization. |
| **Google connections** | 1 Gmail connection (Chris's, connected); 0 Calendar integrations. |
| **Callback host** | `get_project_url` = `https://jncvvsvckxhqgqvkppmj.supabase.co`. Supabase logs for 2026-10-06/07 and 2026-10-11 to 2026-10-13 show every API-gateway and Edge Function request on that host and no other. The Custom Domains page and Management API are not reachable from this session, and public DNS lookups are blocked by egress policy. **No evidence of a custom or vanity domain.** |
| **Google Cloud** | **No authenticated access.** `gcloud` rejects the session token, no Google connector is connected, and no browser tool is available. Nothing in §1 has been performed by Claude. |

### 0.B Re-check after reconciling with `main` (2026-10-15, about 16:10 UTC; read-only; details in `verification.md` §13)

Where §0.B differs from §0.A, §0.B is current. Phase A is reported complete by Chris; Claude did not perform or observe it.

| Check | Result |
|---|---|
| **Code** | `main` = `03ef0cb`: #443 `dacd921`, #445 `26f9bc1`, #446 `03ef0cb`. It was merged into the branch as `94e9bc1`. The conflicts were `WORK_LOG.md` and `supabase/config.toml`; both sides were kept. The migration and the four Edge bundles are byte-identical to `b66c44f`. Exact-head CI: `verification.md` §13. |
| **Production database** | Unchanged. Latest migration `20261010172702`. No Sheets relation, function, cron job or Vault secret, and no `role_permissions` row with the new key. Helper MD5 is still `a199d5dd…b8`. |
| **Production Edge Functions** | No `google-sheets-*` function. `main`'s `clearpath-lead-alert` v2 is now deployed (`verify_jwt=false`). It is unrelated to Sheets and never reads `leads`. |
| **Production frontend** | `agentflow` deployment `dpl_BoRbMNiVBBw3NCjLbcN7c8JQdQ3t` is READY at `main` `03ef0cb`. The deployments before it are `dpl_4UtN9j5bbNemnXAeoVpFXyknUX3f` (`26f9bc1`), `dpl_AqcLLxULHBXWQ4zjP8jPkeXWBGk2` (`dacd921`) and `dpl_E7C5dN2ATUhWbTCfrupJfSamkQws` (`f91e4ba`). No Sheets UI code is deployed. |
| **Organizations, users and workflows** | Unchanged: 1 active organization with 8 active users (1 Admin, 1 Team Leader, 6 Agents), 3 suspended organizations, **0 workflows** and 0 Calendar integrations. |

### 0.C Re-check after Phase B attempt 1 and the second reconciliation (2026-10-15; read-only; details in `verification.md` §14–§15)

Where §0.C differs from §0.B, §0.C is current. The fresh preflight taken immediately before B2 is recorded in `verification.md` when B2 runs.

| Check | Result |
|---|---|
| **Code** | `main` = `b5976e0` (#448). It was merged into the branch as `bf6b644`, with one conflict (`WORK_LOG.md`), resolved byte-exactly. The migration and the four Edge bundles are byte-identical to `b66c44f`. |
| **Production database** | Unchanged by attempt 1. 324 history rows, latest `20261010172702`. No Sheets relation, function, cron job, Vault secret or history row. Helper MD5 still `a199d5dd…b8`. Advisors at 18:23 UTC identical to the pre-B2 baseline. |
| **Production Edge Functions** | No `google-sheets-*` function. #448 deployed `invite-user` v232 and `send-invite-email` v236 at 17:29–17:30 UTC. Phase B never touches them. |
| **Production frontend** | `agentflow` deployment `dpl_6LM8RRL2guFmeMzxjA7bhEVDv44B`, READY at `main` `b5976e0` (17:55 UTC). The deployment before it is `dpl_BoRbMNiVBBw3NCjLbcN7c8JQdQ3t` (`03ef0cb`). No Sheets UI code is deployed. |
| **Direct access from Claude's environment** | None. No database credential is configured, the egress policy blocks the Supabase hosts (`*.supabase.co`, `api.supabase.com`), and the Supabase CLI is not installed. So the psql and CLI steps run on Chris's Mac (§10.1), and Claude does every read-only verification in between. |

### 0.D Re-check after the commission release and the third reconciliation (2026-10-16, about 09:10 UTC; read-only; details in `verification.md` §16–§18)

Where §0.D differs from §0.C, §0.D is current.

| Check | Result |
|---|---|
| **Code** | `main` = `9a90552`: #447 (Commission Calculator, merged as `1ad0226`) and #449 (its UI refresh). Merged into the branch as `2f8b543`, with five conflicts, all additive. The migration and the four Edge bundles are byte-identical to `b66c44f`. |
| **Production database** | 327 history rows, latest `20261016035626`. The three new rows are the commission migrations (`20261015211858` commission_grids_schema, `20261016035150` commission_grids_operations, `20261016035626` commission_grids_reference_import), applied under Chris's account. They create only their own objects (nine `comp_*` and `organization_comp_*` tables, the `comp_authz` schema, functions in `comp_authz`, `private` and `public`) and reference nothing the Sheets migration uses. Still no Sheets relation, function, cron job, Vault secret or history row. Helper MD5 still `a199d5dd…b8`. |
| **Production Edge Functions** | 76, no `google-sheets-*`. Nothing changed after #448's two deploys on 2026-10-15 (17:29–17:30 UTC). |
| **Production frontend** | `dpl_7C68MvwQxhH43ExdVNLWprGvEKTf`, READY at `main` `9a90552` (#449). Before it: `dpl_8p1nHPt2s5gcE9CSTnYcYs7d7dES` (`1ad0226`, #447) and `dpl_6LM8RRL2guFmeMzxjA7bhEVDv44B` (`b5976e0`). No Sheets UI code is deployed. |
| **Direct access from Claude's environment** | Still none. Chris runs the §10.1 production commands. |

## 1. Phase A — Google owner checklist (Chris; Claude cannot access Google Cloud)

**Project:** number `87346168200`, ID `project-b7e9b5b4-d066-48c9-b36`.
- Reuse a matching resource instead of creating a duplicate.
- **Do not delete or modify the existing Gmail/Calendar configuration.** That covers its clients, scopes and branding.
- Do not change publishing status or branding.

| Step | Action | Exact values |
|---|---|---|
| **G0 — Confirm project** | In IAM & Admin → Settings, confirm you are in the right project. | Project number `87346168200`, project ID `project-b7e9b5b4-d066-48c9-b36` |
| **G1 — Record current state** (read-only) | Google Auth Platform → Audience, Branding, Clients and Data Access; APIs & Services → Enabled APIs. | Record: publishing status; user type; branding verification status; existing OAuth clients (names and types only); existing Data Access scopes; test users (if Testing); whether Google Sheets API, Google Drive API and Google Picker API are already enabled. |
| **G2 — Supabase custom domain** | Supabase → Project Settings → Custom Domains. | **None active** → continue with the standard callback. **One active** → stop and report its hostname before creating the OAuth client. |
| **G3 — Enable APIs** | APIs & Services → Library; enable only those not already enabled. | **Google Sheets API**, **Google Drive API**, **Google Picker API** |
| **G4 — OAuth client** | Google Auth Platform → Clients: create, or verify an existing match. | Type **Web application**; name **AgentFlow Sheets**; authorized redirect URI exactly `https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/google-sheets-oauth-callback`; no JavaScript origins. Do not edit the Gmail/Calendar client. Keep the client secret in your password manager until Phase B; **never paste it into chat**. Google may show a new client's secret only once. |
| **G5 — Data Access** | Google Auth Platform → Data Access → Add or remove scopes. | Ensure these are present: `openid`, `https://www.googleapis.com/auth/userinfo.email`, `https://www.googleapis.com/auth/drive.file`. Preserve every existing scope used by other AgentFlow Google integrations. Do **not** add `drive.readonly`, `spreadsheets.readonly` or any broad Drive scope. If the console asks for verification, stop and record the message. |
| **G6 — Picker API key** | APIs & Services → Credentials: create, or verify an existing match. | Name **AgentFlow Sheets Picker**.<br>Website restrictions, exactly: `https://www.fflagent.com/*`, `https://fflagent.com/*`, `https://docs.google.com/*`. The Picker runs in a docs.google.com frame, so that origin is required.<br>API restriction: **Google Picker API**.<br>No Vercel preview domain and no `*.vercel.app` wildcard. **Never paste the key into chat.** |
| **G7 — Pilot Google account** | Confirm the account to use: **`cgarness.ffl@gmail.com`**. | If publishing status is **Testing**, make sure this account is listed under Audience → Test users. |

**Report back only this non-secret information:**
1. Publishing status.
2. Branding verification status.
3. Confirmation that the Google Sheets, Google Drive and Google Picker APIs are enabled.
4. Confirmation that the **AgentFlow Sheets** OAuth client exists.
5. The **last 6 characters** of its OAuth Client ID, and nothing more.
6. Confirmation that its redirect URI is exactly the callback above.
7. Confirmation that the Picker key's restrictions match G6 exactly.
8. Confirmation that `cgarness.ffl@gmail.com` is the pilot account and, if Testing, a listed test user.
9. The G2 result (custom domain: none, or the hostname).
10. Screenshots if useful, with no secret visible.

**Never send:** the OAuth client secret, the Picker API key value, a refresh token, the worker token, or an authorization code.

**Revocation.** Sheets disconnect **never** calls Google `revoke`.
- Google documents revocation as removing access for the app, possibly for every client in the project.
- A user removing AgentFlow at myaccount.google.com/connections, or Calendar's existing disconnect (which calls revoke), can therefore also invalidate the Sheets grant.
- Sheets then shows **Reconnect**, guarded by the generation.
- Calendar's behaviour is unchanged by this feature.

## 2. Secrets and environment (names, destinations and phases; values are never shared)

**Handoff.**
- **Where Chris enters each value:** Supabase Dashboard → project `jncvvsvckxhqgqvkppmj` → Edge Functions → Secrets, or `supabase secrets set --project-ref jncvvsvckxhqgqvkppmj` on his own machine. Vercel values go in Vercel → project `agentflow` → Settings → Environment Variables → **Production**.
- **Generated values:** created locally, for example `openssl rand -base64 48`.
- **Never shared:** no value is pasted into chat, GitHub, logs or documents.
- **What Claude may set:** only the two non-secret values (`GOOGLE_SHEETS_REDIRECT_URI`, `GOOGLE_SHEETS_ALLOWED_RETURN_ORIGINS`), and only if Chris approves.
- **How presence is checked:** by name in the dashboard lists, never by reading a value.

| Name | Destination | Value / source | Phase |
|---|---|---|---|
| `GOOGLE_SHEETS_CLIENT_ID` | Supabase Edge secret | G4 client ID | B |
| `GOOGLE_SHEETS_CLIENT_SECRET` | Supabase Edge secret | G4 client secret | B |
| `GOOGLE_SHEETS_REDIRECT_URI` | Supabase Edge secret | `https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/google-sheets-oauth-callback` | B |
| `GOOGLE_SHEETS_ALLOWED_RETURN_ORIGINS` | Supabase Edge secret | `https://www.fflagent.com,https://fflagent.com` (production only; the first entry is the callback's fallback redirect) | B |
| `GOOGLE_SHEETS_STATE_KEY` | Supabase Edge secret | ≥ 32 random characters, generated locally (AES-256-GCM key material for PKCE verifiers) | B |
| `GOOGLE_SHEETS_WORKER_TOKEN` | Supabase Edge secret | ≥ 32 random characters, generated locally | B |
| `GOOGLE_SHEETS_ENABLED` | Supabase Edge secret | **leave unset** in B and C | D (`true`) |
| `VITE_GOOGLE_PICKER_API_KEY` | Vercel `agentflow`, Production | G6 key | D |
| `VITE_GOOGLE_CLOUD_PROJECT_NUMBER` | Vercel `agentflow`, Production | `87346168200` | D |
| `VITE_GOOGLE_SHEETS_ENABLED` | Vercel `agentflow`, Production | **leave unset** in B and C | D (`true`, then redeploy) |
| `google_sheets_worker_token` | Supabase Vault (`vault.create_secret`) | the same value as `GOOGLE_SHEETS_WORKER_TOKEN` | E (cron) |

The existing `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are used as already provisioned. The Gmail/Calendar `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are **not** used.

## 3. Phase B — Database migration (exact SQL = the committed file)

**Apply** `supabase/migrations/20261013120000_google_sheets_import_foundation.sql`
- **Checksums:** SHA-256 `fc68da86bfa972148b72302b3bc0daf8d227453b75fdadd6ef8578908d76efed`, MD5 `94c7be79a3a95b4a2b971f4b4513838b`, 86,193 bytes. It was amended in place before any application; it has never been applied anywhere.
- **How (approved 2026-10-15; replaces the earlier single `apply_migration` call, see `verification.md` §14):**
  - Chris runs the exact committed file from his Mac (§10.1 stage 1), after the checksum, connection-identity and zero-state checks there:
    ```bash
    psql "$SUPABASE_DB_URL" -X --set ON_ERROR_STOP=1 --single-transaction --file supabase/migrations/20261013120000_google_sheets_import_foundation.sql
    ```
  - The whole file runs as one transaction.
  - If psql exits non-zero: STOP. Do not run `migration repair`. Confirm read-only that nothing committed, and report the exact database error.
  - The SQL is never split, pasted into the Dashboard editor, sent through `execute_sql`, or applied with `supabase db push`.
- **History, only after every read-back below and the advisor delta pass** (§10.1 stage 3):
  ```bash
  supabase migration repair 20261013120000 --status applied --db-url "$SUPABASE_DB_URL"
  supabase migration list --db-url "$SUPABASE_DB_URL"
  ```
  - `migration repair` records history only. It never substitutes for running or verifying the SQL.
  - `--db-url` writes on the same connection that stage 1 verified and applied with, as the M4 precedent `scripts/apply_m4_only.sh` does.
  - The flags were checked against CLI 2.121.0 (`migration repair [<version...>] --status applied|reverted --db-url …`).
  - No other version is marked applied or reverted. Migration-history tables are never edited directly.
- **History read-back:** exactly one row with version `20261013120000` and name `google_sheets_import_foundation`; one more row than before stage 3 (328 in total on 2026-10-16).
- **No restamp.** The recorded version is the authored `20261013120000`, so the filename and every reference already match. A rename is needed only if `migration repair` records a different version, and that is a stop.

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

**Additional read-backs (before `migration repair`):**
- `service_role` can EXECUTE all 21 public wrappers. No private helper is executable by `anon`, `authenticated` or `service_role`.
- **Table privileges** (added 2026-10-16, because production's default privileges give every new `public` table to `anon` and `authenticated` until the migration revokes them). The query below returns 18 lines:
  - each of the three public tables gives `anon` nothing (`-`), `authenticated` only `SELECT`, and `service_role` `DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE`;
  - each of the three private tables gives all three roles nothing (`-`).
  This was reproduced locally with the harness that mirrors those default privileges (MD5 of the newline-terminated `psql -X -At` output: `cc3c7ea29bdaa0bc447ebf5f8c209b1b`).
  ```sql
  select concat_ws('|', n.nspname || '.' || c.relname, r.rolname,
         coalesce(string_agg(p.priv, ',' order by p.priv) filter (where has_table_privilege(r.rolname, c.oid, p.priv)), '-'))
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   cross join (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
   cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
   where c.relkind = 'r' and c.relname like 'google\_sheets\_%' and n.nspname in ('public', 'private')
   group by n.nspname, c.relname, r.rolname
   order by 1;
  ```
- Exactly three policies exist, the own-user SELECT policies on the three public tables. There are none on the private tables.
- `_contacts_permission_default` returns its previous value for every other key and role, and Team Leader `contacts.leads.import` is still true.
- There are zero connections, sources, receipts, sync runs, Sheets leads, Sheets cron jobs and `google_sheets%` Vault secrets.
- No history row exists yet for `20261013120000`, because psql does not write one.

**Advisor comparison.**
- Run `get_advisors` (security and performance) immediately before B2 and again after it, and compare the two. The §0.A values are the 2026-10-13 reference. `unused_index` and `table_bloat` follow usage statistics and can drift between days without any schema change; a difference between the fresh pre-apply capture and §0.A is reported, not attributed to Sheets.
- **Expected security delta:** exactly **+3 INFO `rls_enabled_no_policy`**, on `private.google_sheets_oauth_states`, `private.google_sheets_receipts` and `private.google_sheets_source_rows`. These are deliberately policy-less private tables.
- **Expected performance delta:** +7 INFO `unindexed_foreign_keys`, +4 INFO `unused_index`, +3 WARN `auth_rls_initplan` (the three select-own policies), all on Sheets objects.
- Nothing is expected to be removed. **Any other change stops Phase B** before the functions are deployed.
- **How the expectation was derived:** Supabase's open-source linter (splinter, SHA-256 `d8d558ba…9349`) was run before and after the migration in the production image. The GraphQL exposure lints it also reported locally do not apply, because `pg_graphql` is not installed in production.

**Cron (Phase E):** `supabase/migrations/pending/20261013120100_google_sheets_sync_schedule.sql` (SHA-256 `6116f414faf8313b3d09fa2b721eee79ac43d57f16e9de29ef143b92c54f9665`).
- It runs every minute, posts only while a source is due, and authenticates with the Vault token.
- Its guards refuse to run unless the foundation, `pg_cron`, `pg_net` and a Vault token of at least 32 characters exist.

**Rollback file:** `supabase/migrations/rollback/20261013120000_google_sheets_import_foundation.rollback.sql` (SHA-256 `d9f36c350c2e02f9004ffe20a029762bd078e67c184ec06f71496e93ebaf0e93`). It is locally proven to remove every object and restore the exact helper preimage.

## 4. Phase B — Edge Functions (four new names; exact bundles; deploy order)

**All four:**
- deploy with `verify_jwt=false`, as declared in `supabase/config.toml`, with authorization enforced in code (invariant #2);
- deploy while `GOOGLE_SHEETS_ENABLED` is unset;
- import `https://esm.sh/@supabase/supabase-js@2`, the same specifier as the existing functions; the repository `deno.lock` pins it to 2.98.0.

**How (approved 2026-10-15; §10.1 stage 5).**
- Chris runs the Supabase CLI from his Mac, at the exact reviewed head, with one named function per command and in the order below:
  ```bash
  supabase functions deploy google-sheets-sync-worker --project-ref jncvvsvckxhqgqvkppmj --no-verify-jwt --use-api
  ```
  He then repeats it for `google-sheets-api`, `google-sheets-oauth-callback` and `google-sheets-oauth-start`.
- `--use-api` bundles on the server and uploads each function's import graph (the function plus its `_shared` modules) straight from disk. That is the 2026-08-01 house precedent, and it avoids the hand-transcribed MCP payload, which lost characters before (invariant #30's v43 incident).
- `--no-verify-jwt` matches `config.toml`. The flags were checked against CLI 2.121.0.
- **Never** run `supabase functions deploy` without names: it deploys every function. Never use `--prune`.
- No other function is deployed: not `invite-user`, `send-invite-email`, Gmail, Calendar, SMS, ClearPath or anything else.

**Bundle digest:** run `sha256sum <files> | sha256sum` from the repository root, listing the files in C-locale sorted order. Per-file SHA-256 values are in `verification.md` §10. `_shared` means `supabase/functions/_shared/googleSheets/`.

| Order | Function (entry `index.ts`) | Exact files | Bundle digest |
|---|---|---|---|
| 1 | `google-sheets-sync-worker` | `_shared/{auth,config,crypto,db,engine,errors,google,http,identity,mapping,oauth}.ts` + `google-sheets-sync-worker/index.ts` (12 files) | `3097c65fdd8106407f3bcddbc12386eb88e20b593c23045a5d3fa8a2c0f3c3d0` |
| 2 | `google-sheets-api` | `_shared/{auth,config,db,engine,errors,google,http,identity,mapping,oauth}.ts` + `google-sheets-api/{actions,index}.ts` (12 files) | `6ab61569c8d53c7347a737214330768db04a4bdb5ae0c550004c53332d8b6308` |
| 3 | `google-sheets-oauth-callback` | `_shared/{auth,config,crypto,errors,http,oauth}.ts` + `google-sheets-oauth-callback/{deps,index}.ts` (8 files) | `0fe3970b9896952fe2d940ff5387daa5b868a83689e4a41acf2d6fa492848a60` |
| 4 | `google-sheets-oauth-start` | `_shared/{auth,config,crypto,errors,http,oauth}.ts` + `google-sheets-oauth-start/{deps,index}.ts` (8 files) | `7105438ef4d2d33f0cc62a45eb208c0338a618758b9aa2212569d67950a91591` |

**Why this order:** the worker and API go first, both inert while the flag is unset. The callback is deployed before the start function, so no consent screen can be reached before its redirect target exists.

**Read-back after deploy (Claude, through the Supabase connector; read-only):**
1. `list_edge_functions` shows the four names `ACTIVE`, with `verify_jwt=false`, a version, the expected entry path and an `ezbr_sha256` digest.
   - Every other function's version is unchanged from the inventory captured just before B3, including the #448 versions.
2. `get_edge_function` for each name returns exactly that function's file set from the table below. Each file's SHA-256 equals `verification.md` §10; path prefixes may differ.
   - A missing, extra or different file, a non-ACTIVE status or `verify_jwt=true` is a stop.
3. Unauthenticated HTTP checks while the flag is unset. None of them needs a credential. Claude sends them through `pg_net` from the database, because this environment's egress policy blocks the functions host:

| Request | Expected |
|---|---|
| `POST /functions/v1/google-sheets-api` with body `{"action":"inspect"}` | 503 `{"error":"disabled"}`, returned before authentication |
| `POST /functions/v1/google-sheets-api` with body `{"action":"status"}` and no JWT | 401 `{"error":"unauthorized"}` |
| `POST /functions/v1/google-sheets-oauth-start` | 503 `{"error":"disabled"}` |
| `GET /functions/v1/google-sheets-oauth-callback?state=x&code=y` | 302 to `https://www.fflagent.com/settings?section=google-sheets&sheets=error` |
| `POST /functions/v1/google-sheets-sync-worker` without `Authorization` | 403 `{"error":"unauthorized"}` |
| Optional, run by Chris locally with his worker token (never shared): `POST …/google-sheets-sync-worker` with `Authorization: Bearer <token>` | 200 `{"ok":true,"disabled":true,"processed":0}` |

## 5. Phases C, D and E, test data, and operating controls

### 5.1 Phase C — production code release, still disabled (separate approval)

**Preconditions:**
- Phase B is complete, with every read-back matching.
- The history row is `20261013120000`, matching the file name (no rename; §3).
- Sheets CI and the repository workflows are green on the exact head.
- `main` is merged into the branch if it has moved.
- GitHub → Supabase "Deploy to production" is **OFF** (owner check).
- `VITE_GOOGLE_SHEETS_ENABLED` is absent in Vercel Production (owner check).

**Action:** merge PR #442 into `main`. Vercel then deploys `main` to `www.fflagent.com`. The backend flag stays unset; no Google, cron or Vercel environment change.

**What users will see while it stays disabled** (from the merged code):
- **Settings menu:** Settings → Automation & API gains a **"Google Sheets"** entry. New settings sections default to visible for Agents and Team Leaders (Admins see all), so all 8 active users see it. Chris can hide it per role in Settings → Permissions.
- **The page:** opening it shows only **"Google Sheets is not available yet."**
- **Requests while open:** the page still makes two read-only requests, so it is not hidden at the network level:
  - the `google-sheets-api` `status` action, which answers `enabled: false` because the backend flag is unset;
  - an RLS-limited read of the user's own `google_sheets_sources`, which is empty and refreshes every 60 s while the page stays open.

  Neither makes a Google call or a write.
- **Permissions page:** Settings → Permissions → Contacts → Leads gains **"Import from own Google Sheets"**, on by default for Agents and Team Leaders.
- **Nothing else changes:** no new route, and no change to dialer, contacts, Gmail, Calendar, reporting, SMS, DNC or consent code.

**Health checks after the release (read-only):**
1. Vercel's production deployment is READY at the merge commit, and `www.fflagent.com` serves it.
2. Chris's manual check:
   - sign in; the Dashboard loads;
   - the Contacts list loads and a lead opens;
   - the Dialer loads a campaign (no call needed);
   - Reports load;
   - Settings → Email Setup shows Gmail connected;
   - Settings → Calendar loads;
   - Conversations opens an existing thread. **Send nothing:** any send there is a live SMS;
   - Settings → Google Sheets shows "not available yet".
3. Claude, read-only, comparing with the hour before the merge:
   - Edge Function 5xx counts (`function_edge_logs`) and API-gateway 5xx counts (`edge_logs`);
   - Postgres error lines;
   - Chris's Gmail connection still `connected`, with `last_sync_at` advancing.
4. **If a regression appears,** the fastest recovery is Vercel's rollback to the production deployment that was current immediately before the merge. It changes no data, and the Phase B backend stays deployed and disabled.
   - Capture that deployment's ID in the Phase C preflight.
   - On 2026-10-16 (after about 09:00 UTC) it is `dpl_7C68MvwQxhH43ExdVNLWprGvEKTf` at `main` `9a90552` (#449).
   - Older production deployments (`dpl_8p1nHPt2s5gcE9CSTnYcYs7d7dES` at `1ad0226`, `dpl_6LM8RRL2guFmeMzxjA7bhEVDv44B` at `b5976e0`, `dpl_BoRbMNiVBBw3NCjLbcN7c8JQdQ3t` at `03ef0cb`) are no longer the target: rolling back to any of them would also remove later `main` work (#449, #447, #448).

### 5.2 Phase D — live test activation (separate approval; cron stays OFF)

**Preconditions:**
- Phase C is healthy.
- Phase A is reported: the pilot account `cgarness.ffl@gmail.com` is confirmed and, if Testing, a listed test user.
- The pre-test stop rule in §5.4 passes.

**Recommended access limit for the live test.** This is Chris's decision, and it is a production settings change he makes in the app.
- **Before** the flags are switched on, set **"Import from own Google Sheets" OFF for Agent and Team Leader** in Settings → Permissions. Optionally also hide the "Google Sheets" settings section for those roles.
- **Effect:** the server then refuses those users, because a stored denial wins in `google_sheets_owner_eligible`. They see "Your role can't import from Google Sheets." Admin (Chris) stays eligible.
- Turn it back on at Phase E, when the agency should use the feature.

**Steps:**
1. Set the Edge secret `GOOGLE_SHEETS_ENABLED=true`.
2. In Vercel project `agentflow`, **Production** environment:
   - set `VITE_GOOGLE_PICKER_API_KEY` (the G6 key, entered by Chris), `VITE_GOOGLE_CLOUD_PROJECT_NUMBER=87346168200` and `VITE_GOOGLE_SHEETS_ENABLED=true`;
   - redeploy production on the same commit.
3. At `https://www.fflagent.com` → Settings → Google Sheets, Chris sees **Connect Google**. Restricted roles see the "can't import" notice.
4. Run §6 manually with **Sync now**, using synthetic data only (§5.4).
   - Cron stays absent: no Vault token, and the pending migration is untouched.
   - Nothing runs in the background.

**Exposure while Phase D is active** (stated plainly; this is a live-production test, not a private pilot):
- **Backend flag:** project-wide. The reviewed code has no per-user allowlist.
- **Frontend flag:** shows the working page to every user whose role can see the section.
- **Without the recommended limit:** every active user in the organization (currently 8) can connect a Google account and import, as leads assigned to themselves, from sheets they pick. Google consent restricts this to listed test users only while the project is in Testing.
- **With the limit:** only Admin (Chris) can.
- **If G1 shows "In production" and the limit is not applied:** any Google account can consent. In that case, publish the privacy update before Phase D, or apply the limit (recommended).
- **Other organizations:** the 3 suspended organizations stay ineligible.

**To stop the test:**
- unset `GOOGLE_SHEETS_ENABLED` (the API and OAuth start return 503);
- optionally set the Vercel flag back off and redeploy;
- disconnect in Settings.

With cron absent, nothing continues in the background. The full shutdown procedure is below.

### 5.3 Phase E — normal operation (only after §6 passes; each item separately approved)

1. **Privacy:** approve the §7 text, then publish it through a small separate PR to `src/content/legal.ts` (including the effective date), deployed to production.
2. **Access:** if Phase D limited the permission, Chris turns "Import from own Google Sheets" back on for the roles that should use it.
3. **Cron:**
   - Chris creates the Vault secret `google_sheets_worker_token`, with the same value as the Edge secret `GOOGLE_SHEETS_WORKER_TOKEN`;
   - move the pending migration out of `pending/`, apply it with `apply_migration`, and rename it to the recorded version;
   - read back `cron.job`: one job, `google-sheets-sync-every-minute`, `* * * * *`.
4. **Verify the automatic checks:**
   - each enabled source gets scheduled `google_sheets_sync_runs` rows about every 5 minutes;
   - the worker logs `processed > 0` only when sources are due;
   - no errors.
5. Run §8, the final production verification, and record the drain-check marker baseline.
6. **If the Google project is still in Testing,** every Sheets connection expires 7 days after consent. Moving to In production is a separate Google decision, and it also affects the Gmail/Calendar consent experience.

### 5.4 Live-test account, data and side effects

**Pilot user (resolved read-only on 2026-10-13):**
- **Chris Garness:** profile `ecf2bb91-0350-4542-85ec-14d914311e99`, role Admin (also super admin and platform admin), status Active.
- **Organization:** `a0000000-0000-0000-0000-000000000001`, "Family First Life - Chris Garness", active.
- **Eligibility:** `google_sheets_owner_eligible` allows Admin unconditionally.

**Google account:** `cgarness.ffl@gmail.com`; Chris confirms it at G7.
- It is the Google account on his existing AgentFlow Gmail connection, so it has already authorized this project's Gmail client.
- Using it makes the disconnect-isolation proof (§6 step 10) meaningful.

**Environment:**
- **Frontend:** `https://www.fflagent.com`.
- **Backend:** `jncvvsvckxhqgqvkppmj`.
- No preview deployment is used.

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

### 5.5 Capacity statement (verified behaviour; no limit is changed)

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
- Google's quota (300 reads per minute per project) is not the binding constraint at this scale.

### 5.6 What each control actually does (Amendment C; nothing below is "independently sufficient" on its own)

| Control | Effect | Does NOT |
|---|---|---|
| UI flag `VITE_GOOGLE_SHEETS_ENABLED` unset + frontend redeploy | Replaces the Settings → Google Sheets page with "Google Sheets is not available yet." | Remove the menu entry. Stop the page's two read-only requests while it is open (§5.1). Stop scheduled syncs, queued requests, running invocations or direct API calls. |
| Future cron scheduling — `supabase/ops/google_sheets_unschedule.sql` | No new scheduled invocation | Remove a `net.http_post` already queued in `net.http_request_queue` (it can still be sent), or stop an invocation already running |
| Backend flag `GOOGLE_SHEETS_ENABLED` unset | The worker reads it **once, before its claim loop**, and is inert when unset. The API reads it per request and answers 503 except `status` and `disconnect`. OAuth start answers 503. | Stop an invocation that has already passed the check: it keeps claiming until its 10-claim / 45 s cooperative budget ends. A cooperative budget is not proof that outstanding Google or database calls have finished. Secret changes reach later invocations only as the platform picks them up. |
| Permission "Import from own Google Sheets" off for a role | `google_sheets_owner_eligible` refuses that role's users (a stored denial wins); the page shows "Your role can't import from Google Sheets." Admins are always eligible. | Affect Admins, or stop work already running for a connection |
| In-flight database operations | Every RPC is one transaction: one that has started finishes or rolls back on its own | — |
| Per-source **Pause** | Bumps `config_version` and clears the lease, so that source's next ingest batch and its finish are refused. Leads, receipts and baselines stay. | Affect other sources |
| Per-connection **Disconnect** | Bumps `auth_generation` and deletes the Vault secret, so that connection's next batch, finish, Review apply and Picker token are refused. It never calls Google revoke. | Revoke an access token Google already minted (it expires within an hour, and the server never returns it after the change) |
| **Admission gate** — `supabase/ops/google_sheets_admission_close.sql` | Revokes EXECUTE on every `public.google_sheets_*` wrapper from `service_role`, except `google_sheets_disconnect`. From then on, no invocation (scheduled, queued, already running, API, OAuth callback) can start another database operation: each new call fails with `42501`. | Interrupt an RPC that is already executing; it completes atomically and the drain check verifies it |

### 5.7 Non-destructive shutdown (tested locally and in CI; each SQL step needs approval at the time, and gate changes are applied as migrations per the `supabase/ops` convention)
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

## 6. Phase D — Real Google test on `https://www.fflagent.com` (PREPARED, NOT performed)

**Set-up:**
- Chris's account and the Google account `cgarness.ffl@gmail.com` (§5.4).
- The two synthetic spreadsheets, created by Chris in that Google account with exactly the "before Enable" rows.
- Both flags on, as in §5.2. Cron absent.

**Evidence rules:**
- **Allowed:** screenshots, Edge log metadata (timestamp, status, execution id), and read-only SQL that never selects a token column or a Vault value.
- **Not allowed:** any token, code, secret or key value.
- **Mocked Picker checks are not this test.**

| Step | Action | Evidence that proves it |
|---|---|---|
| 1 | **Real OAuth consent.** At `https://www.fflagent.com` → Settings → Google Sheets → **Connect Google**, as Chris. | The consent screen lists only identity/email and "See, edit, create and delete only the specific Google Drive files you use with this app". After returning to `https://www.fflagent.com/settings?section=google-sheets`, Settings shows **Connected**. Read-only SQL: Chris's `google_sheets_connections` row has `status = connected`, `granted_scopes` = {email, `…/auth/drive.file`, openid}, an `auth_generation` = *g* and a `connected_at` = *T0*. The Vault secret named `google_sheets_refresh_<connection id>` exists (metadata only: name, created/updated time). |
| 2 | **Picker selects spreadsheet A.** **Add sheet** → **Choose spreadsheet** → pick "AgentFlow Sheets Pilot A". | The real Google Picker opens on `https://www.fflagent.com` and returns the file (screenshot). |
| 3 | **The server reads A.** The tab list, headers and preview appear. | They come from the server's Drive `files.get` and Sheets reads (`inspect`, `headers`, `preview`). Each Edge invocation first exchanges the stored refresh token. `function_edge_logs` shows 200 responses for `google-sheets-api` at *T1*, with their execution ids. |
| 4 | **A second refresh-token exchange, then a successful read.** Map (Lead ID column = `Lead ID`), leave "Also import existing rows" unchecked, **Enable**, then click **Sync now** on A at *T2*. Sync now is a new Edge invocation. | **(a)** A new `google_sheets_sync_runs` row for A at *T2*, status ok. **(b)** A 200 for that invocation in `function_edge_logs`, with a distinct execution id. **(c)** `auth_generation` is still *g*, `connected_at` is still *T0*, and the Vault secret's `updated_at` is unchanged: no new consent or code exchange happened between the reads, so the only credential was the saved refresh token. **(d)** In the reviewed code, every server read obtains its access token by calling Google's token endpoint with that refresh token *in the same invocation* (`google-sheets-api/actions.ts` `access()`, `engine.ts` `runSource`). No access token is stored anywhere (no column, no Vault entry). So the read at *T2* necessarily used the access token from its own exchange. **(e)** Optional Google-side corroboration: Console → APIs & Services → Google Sheets API → Metrics, filtered to the AgentFlow Sheets client, shows requests at *T1* and *T2*. No one-hour wait is needed. Log-level token correlation, for example a logged hash of the token, does not exist in the reviewed code; adding it is a code change that needs approval. |
| 5 | **A second spreadsheet without replacing the first.** Add "AgentFlow Sheets Pilot B" (no Lead ID: row position) and Enable it. | Both sheets are listed. Read-only SQL: two `google_sheets_sources` rows for Chris with different `spreadsheet_id` values, both `state = enabled`. |
| 6 | **Existing rows are excluded by default.** | No lead with phone 702-555-0101…0104 exists. The baseline ledger holds 2 entries for A (`id:A-001`, `id:A-002`) and 2 for B (`pos:2`, `pos:3`). The first Sync now on each source shows 0 imported. |
| 7 | **One new eligible row per sheet creates the correct lead.** Add A-101 to A and Bo at the bottom of B, then Sync now on each. | Exactly two leads, Ava Pilot and Bo Pilot. For both, `assigned_agent_id = user_id = imported_by_user_id = ecf2bb91…`, `organization_id = a0000000-…-0001`, and `lead_source = 'Google Sheets'`. One receipt each, linking the correct source to its lead. Chris's assigned-lead count rises by 2. No notification. |
| 8 | **Repeated Sync now does not replay.** Run Sync now twice on each sheet. | Each run shows 0 imported. The lead and receipt counts are unchanged. |
| 9 | **Pause and resume work independently.** (i) Pause A; add A-102 to A and Bri to B; Sync now B → Bri imports, and A cannot sync and gets no A-102 lead. (ii) Resume A and pause B; Sync now A → A-102 imports. (iii) Resume B; Sync now B → 0 imported. | The lead and receipt counts after each phase match exactly. A's `config_version` changes on its pause and resume while B's does not, and the reverse in (ii). |
| 10 | **Gmail and Calendar are unaffected by Sheets disconnect.** Click **Disconnect** in Settings → Google Sheets. | Both sources show **Reconnect**. Chris's Sheets connection is `disconnected` with a new `auth_generation`, and its Vault secret is gone. His Gmail connection (same Google account) stays `connected` and its `last_sync_at` keeps advancing. If revoke had been called, Gmail would fail with `invalid_grant`. The Calendar integration count stays 0 (Chris has none), and no Gmail or Calendar code or table is touched. |

**After the test:**
- The synthetic leads remain. Deleting them needs separate approval (invariant #28).
- Chris may reconnect to keep using the feature.
- Phase E items stay pending until approved.

## 7. Privacy copy (proposed; exact text for approval; NOT published — Phase E)

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

**Publication:** only after Chris approves this exact text, in Phase E. If Phase D runs without the recommended permission limit while the Google project is In production, publish before Phase D (§5.2).

## 8. Production verification (Phase E)

- Run `supabase/ops/google_sheets_drain_check.sql` once after cron activation (read-only) to record a marker baseline for any later shutdown.
- Read-only SQL for the pilot organization:
  - the receipts count equals the imported test rows (4);
  - `contact_history_events` records each test lead's creation;
  - there is no `notifications` row for the self-imports;
  - `dnc_list` and `sms_suppressions` row counts are unchanged.
- Edge logs carry no tokens. Spot-check `google-sheets-*` logs for `ya29`, `1//` or `Bearer` values: expect none.
- Vercel: the production deployment is READY at the released commit, with the Phase D flag redeploy.
- Cron:
  - one job exists;
  - scheduled sync runs appear about every 5 minutes per enabled source;
  - no worker errors.

## 9. Rollback

1. **Phase C (frontend only):** use Vercel's rollback to the production deployment that was current immediately before the merge, as captured in the Phase C preflight. On 2026-10-16 (after about 09:00 UTC) that is `dpl_7C68MvwQxhH43ExdVNLWprGvEKTf` at `main` `9a90552`. It changes no data.
2. **Backend:**
   - Run the §5.7 **non-destructive shutdown**: unschedule → close admission → drain → verify quiescence.
   - Then unset `GOOGLE_SHEETS_ENABLED` and `VITE_GOOGLE_SHEETS_ENABLED`.
   - Report the feature as stopped only when the quiescence check passes; otherwise it is BLOCKED.
   - Existing leads, receipts and baselines are untouched.
3. **Optional, with separate approval:** delete the four functions, then run the rollback SQL. This also drops receipts, so re-adding a sheet afterwards could re-import rows.
4. **Google:** disable or delete the "AgentFlow Sheets" client. That does not affect Gmail/Calendar's client.

## 10. Phase B: backend foundation deployed, Sheets still disabled (APPROVED 2026-10-15)

**Status.**
- **Approved by Chris (2026-10-15)** as written below.
- **Attempt 1:** through the Supabase MCP connector; stopped at B2 with production unchanged (`verification.md` §14).
- **Same day:** Chris approved the second reconciliation (`bf6b644`, `main` `b5976e0`) and the documented fallback. B2 runs through `psql --single-transaction` plus `supabase migration repair`, and B3 through four named Supabase CLI deploys (§3, §4, §10.1). That replaces further large MCP requests.
- **2026-10-16:** `main` moved to `9a90552` (#447, #449) and the commission migrations reached production. With Chris's OK the branch was reconciled again (`2f8b543`). The stage 1 preflight value and the history count changed accordingly (§10.1).
- **Never used:** MCP `apply_migration` again, the migration split across `execute_sql`, the Dashboard SQL editor, `supabase db push`, an unscoped `supabase functions deploy`, `--prune`, direct migration-history edits and partial bundles.

**Precondition (owner):** Phase A (§1 G0–G7) is done and reported. That includes G2 (no custom domain) and G4 (the AgentFlow Sheets client exists).

**Approved, for production `jncvvsvckxhqgqvkppmj` from the reconciled head (merge commit `bf6b644`, reconciled again with Chris's OK on 2026-10-16 as `2f8b543`, plus documentation-only commits; its migration and four Edge bundles are byte-identical to reviewed head `b66c44f`), exactly the following:**
1. **Secrets (B1).** Chris enters the six §2 Edge secrets marked "B". Claude never sees a value.
   - The redirect URI is the standard callback.
   - The return origins are `https://www.fflagent.com,https://fflagent.com`.
   - `GOOGLE_SHEETS_ENABLED` stays **unset**.
   - No Vault secret and no Vercel change.
2. **Migration (B2).** Apply `supabase/migrations/20261013120000_google_sheets_import_foundation.sql` (SHA-256 `fc68da86bfa972148b72302b3bc0daf8d227453b75fdadd6ef8578908d76efed`) through `psql --single-transaction` (§3, §10.1 stage 1).
   - **Before:** the §0 checks and a fresh advisor baseline.
   - **After:** every §3 read-back value (including helper MD5 `bc6356dde683e628b88b631dd5f6d01e` and 0 cron jobs), plus the advisor comparison. **Any unexpected value or advisor change stops Phase B.** There is no automatic rollback, and the evidence is preserved.
   - **Then, only after those pass:** `supabase migration repair 20261013120000 --status applied`, and a check that exactly that one history row now exists. No restamp is needed, because the version is the authored one.
3. **Edge Functions (B3).** After the records commit's exact-head CI is green, deploy the four §4 bundles with the Supabase CLI. Use one named function per command, `verify_jwt=false`, in this order: sync-worker, api, oauth-callback, oauth-start.
   - **After:** the §4 read-backs and unauthenticated disabled-state checks.

**Stays off afterwards:**
- the backend flag (`GOOGLE_SHEETS_ENABLED`) and the frontend flag (`VITE_GOOGLE_SHEETS_ENABLED`) remain unset;
- production keeps serving current `main` (`9a90552` on 2026-10-16), so the Sheets UI is not deployed;
- the cron job is absent; the pending migration stays in `pending/`;
- no live import;
- PR #442 stays draft, and nothing is merged.

**Separate approvals that follow:**
- Phase C: merge with the feature still disabled, then the health checks;
- Phase D: live test activation and §6;
- Phase E: privacy publication, cron and final verification.

### 10.1 Staged procedure for the approved fallback (Chris runs the production commands; Claude verifies between stages)

Claude's environment has no route to production (§0.C), so Chris runs the three production-changing steps from his Mac. Claude runs every read-only check in between, through the Supabase connector, and says **GO** before the next stage.

**Rules for every stage:**
- **Never print or share** `SUPABASE_DB_URL`, the database password, an access token or the worker token, in chat, GitHub, logs or documents.
- **Run each block as written.** Each block is a subshell `( … )` with `set -euo pipefail`, so a failure stops only that block, never the terminal.
- **Output to send Claude:** everything the blocks print. None of it is secret: the connection identity line carries only host, port, database and user.
- **Stop on any STOP line or a non-zero exit.** Do not retry, do not switch method and do not roll back. Send Claude the output.
- **Shell:** type `bash` first and keep that window open for every stage. macOS's interactive zsh doesn't treat `#` as a comment, so pasted comments can break.
- **Connection:** the Session pooler (port 5432) works on networks without IPv6; the Direct connection needs IPv6.
- **Stage 1 lock window:** while the migration's transaction is open (a few seconds, because psql sends its 81 statements one at a time), writes to `public.profiles` and `public.organizations` wait; reads are unaffected. Run it at a quiet moment and never alongside another migration. If nothing prints for 60 seconds after the `preflight:` line, press Ctrl-C once: the single transaction rolls back and nothing is applied.

`<HEAD>` below is the exact reviewed commit named in Claude's GO message. Every command runs from the repository root at that commit.

**Stage 0: preparation (once; changes nothing).**
```bash
# A clean checkout at the exact commit, either a fresh clone or an existing one.
git clone https://github.com/cgarness/agentflow-life-insure.git ~/agentflow-phaseb   # skip if you already have a clone
cd ~/agentflow-phaseb && git fetch origin && git checkout --detach <HEAD> && git status --porcelain   # must print nothing
psql --version                                   # client 14 or newer
supabase --version                               # 2.84.5 or newer (Homebrew: brew upgrade supabase)
supabase migration repair --help | grep -e '--db-url'
supabase functions deploy --help | grep -E -e '--project-ref|--no-verify-jwt|--use-api'
supabase login                                   # browser sign-in; needed only for stage 5
# Database connection: Dashboard → AGENTFLOW CRM → Connect → "Direct connection", or "Session pooler" (port 5432).
# Never the 6543 transaction pooler. Use the URI with the database password percent-encoded.
# Paste it at the silent prompt below; it is not echoed and not written to shell history.
read -rs SUPABASE_DB_URL; export SUPABASE_DB_URL
```

**Stage 1: B2 apply (production change 1 of 3).** Before running it, tell Claude. Claude takes a fresh advisor baseline and preflight, and answers GO.
```bash
( set -euo pipefail; set +x
  cd ~/agentflow-phaseb
  F=supabase/migrations/20261013120000_google_sheets_import_foundation.sql
  [ "$(git rev-parse HEAD)" = "<HEAD>" ] || { echo "STOP: not at the reviewed commit"; exit 1; }
  [ -z "$(git status --porcelain)" ] || { echo "STOP: checkout is not clean"; exit 1; }
  [ "$(shasum -a 256 "$F" | awk '{print $1}')" = fc68da86bfa972148b72302b3bc0daf8d227453b75fdadd6ef8578908d76efed ] \
    || { echo "STOP: migration checksum differs"; exit 1; }
  ID="$(psql "$SUPABASE_DB_URL" -X -At -v ON_ERROR_STOP=1 -c '\echo :HOST :PORT :DBNAME :USER')"
  echo "connection: $ID"
  case "$ID" in
    "db.jncvvsvckxhqgqvkppmj.supabase.co 5432 postgres postgres") ;;
    *".pooler.supabase.com 5432 postgres postgres.jncvvsvckxhqgqvkppmj") ;;
    *) echo "STOP: this connection is not production jncvvsvckxhqgqvkppmj"; exit 1 ;;
  esac
  PRE="$(psql "$SUPABASE_DB_URL" -X -At -v ON_ERROR_STOP=1 -c "select concat_ws('|', current_database(),
      to_regclass('public.google_sheets_sources') is null,
      (select count(*) from pg_proc where proname like 'google\_sheets\_%'),
      (select count(*) from supabase_migrations.schema_migrations where version = '20261013120000' or name like '%google_sheets%'),
      md5(pg_get_functiondef('public._contacts_permission_default(text,text)'::regprocedure)),
      (select max(version) from supabase_migrations.schema_migrations))")"
  echo "preflight: $PRE"
  [ "$PRE" = "postgres|t|0|0|a199d5ddfb9a56070aeb7706d3e9a4b8|20261016035626" ] \
    || { echo "STOP: production preflight differs (send this output to Claude)"; exit 1; }
  if psql "$SUPABASE_DB_URL" -X --set ON_ERROR_STOP=1 --single-transaction --file "$F" > /tmp/gs_b2_psql.log 2>&1; then
    echo "B2 psql exit=0"; tail -5 /tmp/gs_b2_psql.log
  else
    echo "B2 psql FAILED: STOP. Do not run migration repair."; tail -20 /tmp/gs_b2_psql.log; exit 1
  fi
)
```

**Stage 2: Claude verifies (read-only).** Claude runs every §3 read-back and the additional read-backs, and compares the advisors with the stage 1 baseline.
- **If anything differs:** STOP, with no repair and no rollback.
- **Otherwise:** Claude answers GO for stage 3.

**Stage 3: history (production change 2 of 3).** Only after Claude's GO.
```bash
( set -euo pipefail; set +x
  cd ~/agentflow-phaseb
  supabase migration repair 20261013120000 --status applied --db-url "$SUPABASE_DB_URL"
  supabase migration list --db-url "$SUPABASE_DB_URL" | grep -E '20261013120000|20261016035626'
)
```

**Stage 4: Claude verifies and records (read-only plus a branch commit).**
- Claude confirms exactly one history row, `20261013120000` / `google_sheets_import_foundation` (328 rows in total on 2026-10-16).
- Claude commits the records, pushes the branch and waits for green exact-head CI.
- Claude captures the Edge inventory, then answers GO for stage 5.

**Stage 5: B3 deploy (production change 3 of 3).** Only after Claude's GO.
```bash
( set -euo pipefail; set +x
  cd ~/agentflow-phaseb
  [ "$(git rev-parse HEAD)" = "<HEAD>" ] || { echo "STOP: not at the reviewed commit"; exit 1; }
  for f in google-sheets-sync-worker google-sheets-api google-sheets-oauth-callback google-sheets-oauth-start; do
    echo "== deploying $f"
    supabase functions deploy "$f" --project-ref jncvvsvckxhqgqvkppmj --no-verify-jwt --use-api
  done
)
```

**Stage 6: Claude verifies (read-only).**
- Claude runs the §4 read-backs: ACTIVE, `verify_jwt=false`, version, entry path, digest, per-file SHA-256, and every other function unchanged.
- Claude runs the disabled-state checks through `pg_net`.
- Claude confirms zero connections, sources, receipts, sync runs, Sheets leads, cron jobs and worker Vault secret, and scans the Sheets function logs for any secret output.

**Optional (Chris, worker token never shared):**
```bash
read -rs GSW; curl -sS -X POST https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/google-sheets-sync-worker \
  -H "Authorization: Bearer $GSW" -w '\nHTTP %{http_code}\n'; unset GSW
# expect {"ok":true,"disabled":true,"processed":0} and HTTP 200
```

**Afterwards:** `unset SUPABASE_DB_URL`, and optionally `supabase logout`.

### 10.2 Running §10.1 from a local Claude Code session on Chris's Mac (2026-10-16)

On 2026-10-16 Chris asked that Phase B run from Claude Code on his Mac, because the cloud session has no route to production. Everything in §10 and §10.1 still applies unchanged: the scope, commands, order, read-backs and STOP rules. The only change is who types the commands: the local session runs each production-changing stage after Chris types **GO** for it.

**Setup (Chris, once).**
1. **Claude Code:** install it with `curl -fsSL https://claude.ai/install.sh | bash` (or `brew install --cask claude-code`). Open a new terminal and check `claude --version`.
2. **Tools:**
   - psql 14 or newer;
   - Supabase CLI 2.84.5 or newer (`brew upgrade supabase`);
   - Node 22 (CI uses 22.16.0), for `npm ci` and the type check;
   - Git push access to the repository; `gh auth login` also lets the session read CI.
3. **Checkout:** on the branch, not detached, because the session commits records.
   ```bash
   git clone https://github.com/cgarness/agentflow-life-insure.git ~/agentflow-phaseb   # skip if it exists
   cd ~/agentflow-phaseb && git fetch origin && git checkout claude/keen-brown-e4u3ht && git pull --ff-only
   npm ci && git status --porcelain                                                     # must print nothing
   ```
4. **`supabase login`.**
5. **Optional guard,** kept outside the repository so the checkout stays clean. Put this in `~/.claude/settings.json`:
   ```json
   { "permissions": { "deny": ["Bash(env *)", "Bash(printenv *)", "Bash(set)", "Bash(export -p)"] } }
   ```
   - Claude Code's documentation says such rules match command text only and are not a security boundary.
   - The real protection is the session rules below and Chris reading each command before approving it.
   - Keep the default permission mode, which asks before running commands outside a read-only set. That set includes `echo` and `cat`, so those run without asking.
6. **Database URL and launch.** In one terminal window, run `bash`, then `read -rs SUPABASE_DB_URL; export SUPABASE_DB_URL` and paste the URI at the silent prompt, as in §10.1 stage 0. Then run `cd ~/agentflow-phaseb && claude`.
   - Claude Code's commands inherit the exported variable.
   - Never put it in `~/.zshrc` or any file.
   - To resume later in a new terminal: export it again first, then run `claude --continue`.
7. **Supabase connector:**
   - In Claude Code, `/mcp` should list the Supabase connector. claude.ai connectors load automatically with a claude.ai login, but not while `ANTHROPIC_API_KEY` is set (check `/status`).
   - If it is missing, add the hosted server in read-only mode, then authenticate in `/mcp`:
     ```bash
     claude mcp add --transport http supabase-ro "https://mcp.supabase.com/mcp?project_ref=jncvvsvckxhqgqvkppmj&read_only=true"
     ```
   - The connector is used only for the advisors and the Edge read-backs.

**Session rules (in addition to §10.1's).**
- **GO gates:**
  - Before stages 1, 3 and 5, write the block, with `<HEAD>` substituted, to a file outside the repository (for example `~/agentflow-phaseb-evidence/`).
  - Show the file and the read-only evidence, and wait for Chris to type GO. Each GO covers one stage.
  - Run each block with `bash <file>`.
- **Stage 1 runs in the background with its output watched.**
  - If 60 seconds pass after the `preflight:` line without a `B2 psql` line, send SIGINT: `pkill -INT -f 'single-transaction --file [s]upabase/migrations/20261013120000'`. That is §10.1's Ctrl-C: psql sends a cancel request and the single transaction rolls back.
  - Keep the `[s]`. Without it the pattern also matches the shell that runs `pkill`, because that shell's own command line contains the text (checked locally). With it, only psql matches.
  - Tested locally on 2026-10-16 with a lock-waiting apply: exit 3, `canceling statement due to user request`, nothing committed, and no backend left waiting.
  - **Never** stop it with SIGTERM or SIGKILL, Esc, or a tool timeout. psql dies, but the server keeps waiting for its locks; the same test left one backend waiting after SIGTERM. Writes to `profiles` and `organizations` then queue behind it until the blocking transaction ends. Nothing commits.
- **Never list processes with their full command lines** (`ps aux`, `pgrep -fl`, `pgrep -a`): psql's arguments contain the URL and its password. `pkill` prints nothing.
- **Never print** the URL or any token, and never run `env`, `printenv`, `set`, `export -p` or `set -x`. To show the variable is present, print only its length: `printf '%s\n' "${#SUPABASE_DB_URL}"`.
- **Read-only checks:** psql (`-X -At`, read-only statements) or the connector's read tools, never its `apply_migration`, `deploy_edge_function` or a writing `execute_sql`. Check any CLI command or flag that §10.1 does not already use with `--help` first.
- **Disabled-state checks** (§4 table): use `curl` from the Mac, not `pg_net`, so nothing is written to the database.
- **History read-back:** inside Claude Code the CLI prints JSON instead of a table, so stage 3 is confirmed with SQL: one row `20261013120000` / `google_sheets_import_foundation` with 81 statements, and 328 rows in total.
- **Evidence files stay outside the repository.** The stage gates need a clean checkout.
- **If a secret is ever printed:** stop and tell Chris. The transcript keeps it under `~/.claude/projects/`, so the database password should be reset after Phase B.

### 10.3 Cloud-only execution through protected GitHub Actions (2026-10-17)

This is the current route while Chris has no Mac. It implements the root plan's 2026-10-16 cloud runner proposal. PR [#451](https://github.com/cgarness/agentflow-life-insure/pull/451), head `c7e1c56e94ae8cbde7cc42567c4e642ceb2b38de`, contains `.github/workflows/google-sheets-phase-b.yml`. A separate no-secret CI workflow and synthetic test driver validate its actual embedded program against disposable PostgreSQL 17.6. These two verification files are a refinement of the original single-workflow proposal; they grant no production access. Root plan and work log are the other two changed files. No application, migration or function code changes.

**Verified:** [run 38993502917](https://github.com/cgarness/agentflow-life-insure/actions/runs/38993502917), job `117280799328`, passes on that exact head. Real SQL apply and all SQL read-backs, real CLI history repair, replay/out-of-order refusal, lock-timeout rollback, watchdog SIGINT rollback and command-error redaction passed. The migration and four bundle hashes match §3–§4. This is a synthetic backend test, not Phase D's real Google-account test.

**Before merge:** verify Supabase GitHub “Deploy to production” is OFF. Create protected environment `google-sheets-production` with Chris (`cgarness`) as required reviewer, custom deployment branch limited to `main`, and admin bypass OFF. Chris securely enters only the three environment secrets: `SUPABASE_DB_PASSWORD`, `SUPABASE_POOLER_HOST` (session port 5432), `SUPABASE_ACCESS_TOKEN`. Never share values in chat or public logs. The connected GitHub tool cannot manage these settings; secure browser authentication is required. The agent handles browser navigation and coordination; Chris only authenticates/enters credentials and grants approvals. Do not approve an environment deployment on Chris's behalf.

**Separate consequential approval:** merge #451 only with explicit approval after these controls and CI are verified. A main commit rebuilds Vercel production even though application files are unchanged. Capture the resulting deployment as the subsequent rollback baseline. Do not merge #442 at this stage.

**Dispatch-only stages:** `check`, `apply-migration`, `record-history`, `deploy-functions`; `confirm` must repeat the stage. Main-only, `contents: read`, pinned checkout/actions/CLI, one run at a time, no cancel-in-progress. Source artifacts are pinned to `eaf988bc276a3922ee0ec6c3c6038665be9f1678`; do not substitute a moving branch. The agent may dispatch after Chris's stage-specific approval; Chris remains the protected-environment reviewer.

1. `check`: forced read-only connection, exact identity/state/count/helper checks, six B1 secret names present, enable flag and four functions absent. No values printed.
2. `apply-migration`: fresh independent advisor baseline and preflight first; explicit approval covers only the exact §3 file. One psql transaction, lock timeout 5 seconds, statement timeout 30 seconds, watchdog SIGINT at 120 seconds. Run every SQL read-back and independent advisor comparison before the next approval.
3. `record-history`: separate approval; exact version `20261013120000`, expected 81 statements and 328 history rows. Never rerun apply after a history error. Update records and require green exact-head #442 CI before deployment.
4. `deploy-functions`: separate approval; exactly the four §4 names in order, `verify_jwt=false`, no unrelated function deployment. Check function digest/content, unchanged unrelated inventory, disabled HTTP outcomes, logs and zero operational rows. `GOOGLE_SHEETS_ENABLED` stays absent; no cron/Vault worker token.

Any failure stops. No automatic retry, method switch, rollback or partial-deploy continuation. Production read-backs and advisor output stay out of public logs. Phase C, Phase D, privacy publication and Phase E scheduling retain their existing separate approvals. After Phase B, disable the runner and remove the temporary environment secrets/revoke the release token under the existing cleanup gate.
