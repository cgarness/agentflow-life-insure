# Implementation Plan — Calendar Pass 3
## Google Calendar Sync Reliability

**Status:** ✅ COMPLETE (deployed 2026-05-25). One operational blocker remaining: rotate/set `GOOGLE_SYNC_CRON_SECRET` Edge Function env var. Per Chris's directive, no `git push` and no merge initiated.

---

## A. Pre-edit inspection findings (verified 2026-05-25 via MCP + repo read)

### A1. Live deployment vs. repo

| Function | Deployed version | verify_jwt | Live vs. repo |
|---|---|---|---|
| `google-oauth-start` | v474 | false | matches repo (still tries to write `oauth_state` / `oauth_state_expires_at`) |
| `google-oauth-callback` | v474 | false | matches repo (still selects by `oauth_state`) |
| `google-calendar-status` | v469 | false | matches repo (selects `access_token` from DB; returns only boolean) |
| `google-calendar-list` | v469 | false | matches repo (stores raw access_token after refresh) |
| `google-calendar-configure` | v469 | false | matches repo (RLS-scoped upsert via user JWT) |
| `google-calendar-disconnect` | v474 | false | matches repo (revokes raw token + nulls integration) |
| `google-calendar-sync-appointment` | v473 | false | matches repo (uses naive `atob`, no token refresh) |
| `google-calendar-inbound-sync` | v474 | false | matches repo (Pass 1a deploy; uses shared `decodeToken`) |

No drift. All eight functions are `verify_jwt = false` and validate auth in-code (consistent with `AGENT_RULES.md §4.2` — ES256 gateway constraint).

### A2. Live `calendar_integrations` schema

Columns (live): `id, user_id, provider, calendar_id, access_token, refresh_token, token_expires_at, sync_mode, sync_enabled, last_sync_token, last_sync_at, created_at, updated_at`. All non-pk columns nullable except `user_id, provider, sync_mode (default 'outbound_only'), sync_enabled (default true), created_at, updated_at`.

**Missing columns (critical):** `oauth_state`, `oauth_state_expires_at`. The earliest migration `20260307090000_create_calendar_integrations.sql` declared them, but the later `20260308093000_create_calendar_integrations.sql` and `20260308120000_ensure_calendar_integrations.sql` redeclare the table without those columns via `create table if not exists` and apply only `alter column` statements — never `add column` for `oauth_state*`. The live table reflects the later shape.

Indexes (live): `calendar_integrations_pkey`, `calendar_integrations_user_id_provider_key` (unique on `(user_id, provider)`). No `idx_calendar_integrations_user_id` (migrations created this — appears not to have persisted).

RLS (live): one `FOR ALL` policy `"Users can manage their own calendar integrations"` with `auth.uid() = user_id` for both USING and CHECK. (Not the split 4-policy variant from 20260308120000.) Adequate — owner-only access.

Row count: **0 calendar_integrations rows**, **0 appointments rows**. No live data to migrate.

### A3. Token storage envelope mismatch (real bug)

Four code paths handle Google tokens differently:

1. **`google-oauth-callback`** stores tokens **raw** (`access_token: tokenJson.access_token`, `refresh_token: tokenJson.refresh_token`). No `encodeToken`.
2. **`google-calendar-list`** uses its own private `refreshGoogleAccessToken` and writes refreshed `access_token` **raw**. No `encodeToken`.
3. **`google-calendar-inbound-sync`** uses shared `decodeToken` (which tolerates both base64 and raw) and writes refreshed `access_token` **base64-encoded** (`encodeToken`).
4. **`google-calendar-sync-appointment`** uses naive `decodeBase64 = atob`, with no raw-fallback. **It does NOT refresh tokens.**

Concrete consequence: a freshly-connected user (token stored raw by callback) tries to schedule an appointment. `sync-appointment` calls `atob(rawToken)` → either throws and returns `"Google integration token is invalid"` (HTTP 400) or returns scrambled bytes which Google rejects with 401, returning `"Failed to create Google event"` (HTTP 502).

The path only "starts working" if inbound-sync's cron tick happens to refresh and re-encode the token. After expiry+refresh by inbound-sync, sync-appointment's atob will produce the original raw token (good). Until then, outbound sync is broken right after connect. Also `google-calendar-list`'s refresh path resets the token back to raw, re-breaking sync-appointment.

### A4. Inbound-sync auth gate (critical)

Code at `supabase/functions/google-calendar-inbound-sync/index.ts` lines 121–139:

```ts
if (authHeader?.startsWith("Bearer ") && anonKey) { ... user JWT path; userIdFilter = user.id }
else if (requiredCronSecret) { if (cronSecret !== requiredCronSecret) return 401; }
// fallthrough: userIdFilter = null → sync ALL integrations with service_role
```

**Fail-open hole:** if `GOOGLE_SYNC_CRON_SECRET` env var is unset/empty AND the caller sends no `Authorization` header, the `else if` is skipped, the function reaches `createClient(supabaseUrl, serviceRoleKey)` with `userIdFilter = null`, and syncs **every** integration. With `verify_jwt=false` at the gateway, this is publicly callable from anywhere.

I cannot verify the live value of `GOOGLE_SYNC_CRON_SECRET` env var via MCP. The DB has `private.google_sync_cron_secret` (1 row with non-empty secret) used by `cron.job google-calendar-inbound-sync-every-5m`, but that DB secret is only meaningful if it matches the Edge Function env var. **Treat as a hard gate failure** until the function fails closed in code regardless of env var presence.

### A5. Inbound-sync ignores `sync_mode`

The integrations query at line 143 filters by `provider='google'` + `sync_enabled=true` only. `sync_mode` is not consulted. A user with `sync_mode='outbound_only'` still has Google events imported into AgentFlow on every 5-minute cron tick. Today this isn't visible (0 rows), but it makes the "Outbound-only" UI button a lie.

### A6. `Sync Now` frontend behavior

`src/pages/CalendarPage.tsx:168` `handleSyncNow` calls `supabase.functions.invoke("google-calendar-inbound-sync", { body: {} })`. The Supabase client adds the user's `Authorization: Bearer <jwt>` header by default. Inbound-sync's first auth branch handles this path and filters by `user_id = user.id`. So Sync Now is **safe** for the user-JWT path — it imports only that user's events. Good.

But the UI presents the button whenever Google is connected, regardless of sync mode. If the user is on `outbound_only`, clicking Sync Now still pulls Google events into AgentFlow — which contradicts the mode label.

### A7. Sync-appointment org/user authorization

`sync-appointment` fetches the appointment via the user's RLS-scoped client (line 96), so RLS rejects access to other users' appointments that aren't visible (Pass 1a RLS: SELECT is user_id/created_by/Admin/TL-same-team/Super Admin same-org). A Team Leader could in principle sync a same-team agent's appointment to *their own* Google calendar. Out of Pass 3 scope to redesign — the integration is per-user, so this means TL syncs to TL's Google account, which is reasonable. Document and move on.

`sync-appointment` does not verify `organization_id` matches caller's org explicitly — it depends on Pass 1a RLS. Acceptable.

### A8. Disconnect behavior for imported appointments

`google-calendar-disconnect` only nulls token columns + `sync_enabled = false`. It does **not** delete imported appointments. Existing imported events (sync_source='external', external_provider='google') remain in AgentFlow as normal appointments. Disconnect also fires `https://oauth2.googleapis.com/revoke` with the **raw stored access_token** before nulling. If tokens are base64-encoded in storage, this revoke call is no-op-broken (it sends the b64 string to Google, which rejects). Disconnect succeeds anyway because it ignores the revoke response. Minor: this means Google-side authorization may remain valid until expiry.

### A9. Sync mode storage drift

UI writes `sync_mode` two places:
- `google-calendar-configure` Edge Function → `calendar_integrations.sync_mode` (DB source of truth for Edge Functions).
- `user_preferences.settings['calendar_google_sync_settings'].syncMode` (frontend mirror).

Edge Functions read sync_mode from `calendar_integrations` only — `google-calendar-status` returns it from that table. The mirror in `user_preferences` is dead weight (fallback only when status returns nothing). Not harmful but redundant; not in Pass 3 scope to remove.

### A10. Logging audit

No function logs tokens or full event bodies. `sync-appointment` returns `details: googleData` in error responses, which on a Google-side validation failure may include event summary/description back to the caller's frontend. That data is the user's own request payload echoed back, not other users' data — acceptable.

### A11. Security advisor (deferred — Pass 3 not a security pass)

Token encryption is base64 only (documented in `_shared/google-token.ts` as deferred Vault/pgsodium debt — consistent with email module). Per task scope, **do not** add token encryption this pass.

---

## B. Decisions for Chris approval

### B1. Inbound-sync auth — **fail closed**

Refactor the auth gate so the function refuses to run if no Authorization Bearer and no valid `x-cron-secret`. Specifically:

- If `Authorization: Bearer ...` present → validate user JWT via anon client; on missing/invalid user, 401; set `userIdFilter = user.id`.
- Else if `x-cron-secret` header present → require `GOOGLE_SYNC_CRON_SECRET` env var to be set AND match; otherwise 401. **If env var is unset, always 401.**
- Else → 401.

No more fall-through. Cron continues to work because the cron job already sends `x-cron-secret`. Sync Now continues to work because the frontend sends Bearer.

### B2. OAuth state columns — restore them

The deployed `google-oauth-start` and `google-oauth-callback` need `oauth_state` and `oauth_state_expires_at` to function. Live table is missing both — connect is broken today.

Migration `20260529150000_calendar_oauth_state_columns.sql`:

```sql
alter table public.calendar_integrations
  add column if not exists oauth_state text,
  add column if not exists oauth_state_expires_at timestamptz;

create index if not exists calendar_integrations_oauth_state_idx
  on public.calendar_integrations (oauth_state)
  where oauth_state is not null;
```

No data migration needed (0 rows). No RLS change needed (existing FOR ALL policy already covers the new columns; oauth-start/callback use service_role for the state lookup, so RLS doesn't gate it anyway).

### B3. Token envelope — **standardize on raw, document deferred encryption**

Three options considered:

| Option | Effort | Risk |
|---|---|---|
| Make everything use `encodeToken`/`decodeToken` (base64 envelope) | Touch 4 functions | Need to be careful with disconnect revoke + raw-fallback decode |
| Make everything raw (drop the base64 wrapper for Calendar) | Touch 1 function (inbound-sync) + helper note | Diverges from email module pattern |
| Touch only `sync-appointment` to use shared `decodeToken` | Smallest surface | Token envelope still inconsistent across writers |

**Recommendation: Option 1 — standardize on `encodeToken`/`decodeToken` everywhere for Calendar.**

Changes:
- `google-oauth-callback`: import + use `encodeToken` when writing `access_token` and `refresh_token` after token exchange.
- `google-calendar-list`: replace its private `refreshGoogleAccessToken` with the shared `refreshGoogleAccessToken` from `_shared/google-token.ts`; use `encodeToken` when persisting refreshed token; use `decodeToken` when reading. Pass the decoded token to Google API in Authorization header.
- `google-calendar-sync-appointment`: replace `decodeBase64` with shared `decodeToken` (handles raw fallback). Add token-refresh path identical to inbound-sync (so a near-expired token gets refreshed and re-encoded before each outbound call).
- `google-calendar-disconnect`: decode the stored token before sending to Google's revoke endpoint.
- 0 live rows → no risk of breaking existing data.

Token encryption (Vault/pgsodium) remains explicitly **deferred** to a dedicated security pass — same as email module per `_shared/google-token.ts` comment.

### B4. Inbound-sync respects `sync_mode`

Add `.in("sync_mode", ["two_way"])` to the integrations query so an `outbound_only` integration never gets Google events pulled in. This makes the "Outbound-only" UI button honest.

### B5. Sync mode UI — label two-way as Beta

Two-way sync technically works (inbound-sync filters by `sync_mode=two_way` after B4; outbound-sync writes external_event_id), but:
- There is no inbound conflict resolution beyond "Google wins".
- There is no recurrence handling (`singleEvents=true` forces expansion).
- There is no Outlook.
- Cancellation-after-import-only-via-cron means up to 5-minute lag.

Recommendation: label the "2-way Sync" button as `"2-way Sync (Beta)"` with help text under the button. Keep `outbound_only` as the default.

### B6. Sync Now — keep, but label honestly

`Sync Now` is safe (B1 confirms user-JWT path) and only imports the calling user's events. Keep the button visible when connected. Add `title="Import new Google events for your calendar"` and only show it when `syncMode === 'two_way'` (since inbound is now mode-gated per B4). For `outbound_only`, hide Sync Now and replace with a small inline copy: "Outbound-only: AgentFlow events sync to Google. Manual import is disabled."

### B7. Disconnect behavior — keep existing semantics, document

Confirmed launch decision (per task spec):

- Disconnect clears tokens + `sync_enabled=false`.
- Existing imported appointments (sync_source='external') remain in AgentFlow.
- They can be edited/deleted locally according to normal appointment rules.
- Google-side authorization revoke is attempted (best-effort, ignores response).
- Re-connecting re-uses the existing integration row via the unique (user_id, provider) constraint.

No code change needed here other than B3 making the revoke call actually work. Add explicit destructive-toast wording in the UI so the user knows imported events stay.

### B8. Sync failure visibility (already present, keep)

Pass 1b already added destructive toasts for failed outbound sync. No change needed.

---

## C. Files to touch

### C1. Migrations (1 new)

- `supabase/migrations/20260529150000_calendar_oauth_state_columns.sql` — add `oauth_state` + `oauth_state_expires_at` columns + partial index. (B2)

### C2. Edge Functions (5 deploys)

| Function | What changes |
|---|---|
| `supabase/functions/google-oauth-callback/index.ts` | Import `encodeToken`; wrap `access_token` + `refresh_token` writes. (B3) |
| `supabase/functions/google-calendar-list/index.ts` | Drop private `refreshGoogleAccessToken`; use shared helper + `encodeToken`/`decodeToken`. (B3) |
| `supabase/functions/google-calendar-disconnect/index.ts` | Decode token before calling Google revoke. (B3, B7) |
| `supabase/functions/google-calendar-sync-appointment/index.ts` | Use shared `decodeToken`; add token-refresh path identical to inbound-sync; keep org/user authorization via RLS (no change there). (B3) |
| `supabase/functions/google-calendar-inbound-sync/index.ts` | Tighten auth gate to fail closed (B1); add `sync_mode='two_way'` filter (B4). |

`google-oauth-start`, `google-calendar-status`, `google-calendar-configure` are **not** touched. `google-calendar-status` already returns no token to the frontend; selecting `access_token` from DB and discarding to a boolean is fine. `google-calendar-configure` already user-scoped via RLS. `google-oauth-start` will work after B2's migration.

### C3. Frontend (1 file)

- `src/pages/CalendarPage.tsx` — Sync Now visibility (B6): only show when `syncMode === 'two_way'`. Need to extend `checkGoogleStatus` to capture sync mode in state.

`src/components/settings/CalendarSettings.tsx` — Sync mode UI honesty (B5): relabel `"2-way Sync"` → `"2-way Sync (Beta)"`, add help text under the buttons. Update the Disconnect confirmation copy (B7) to mention imported events remain.

`src/contexts/CalendarContext.tsx` — no change. Already org-scoped per Pass 1b.
`src/integrations/supabase/types.ts` — hand-patch the `calendar_integrations` Row/Insert/Update blocks to add `oauth_state` + `oauth_state_expires_at` (optional `string | null`).

### C4. WORK_LOG / docs

- `WORK_LOG.md` — newest-first entry.
- `implementation_plan.md` — this file, with post-execution context snapshot.

### C5. Explicitly NOT touched

- `supabase/config.toml` — no verify_jwt change. Adding/removing functions out of scope.
- `_shared/google-token.ts` — no change. Helper already does what we need.
- All non-Google Edge Functions.
- `appointments` table, `appointment_types` table, RLS, helpers.
- Dialer / Twilio / workflow / goals / dispositions / pipeline_stages.
- Outlook anything.

---

## D. Hard gates checklist

| Gate | Status |
|---|---|
| Inbound-sync auth model identified | ✅ — fall-open hole confirmed at line 121–139 |
| Plan to fail-closed inbound-sync auth | ✅ — B1 |
| Sync Now safety confirmed | ✅ — user JWT path is safe; UI to be mode-gated |
| Disconnect behavior decided + documented | ✅ — B7 (tokens cleared, imported events remain) |
| Token logging | ✅ — none found |
| Token return to frontend | ✅ — status returns boolean only |
| Cross-org sync risk | ✅ — Pass 1a RLS + per-user integration prevents |
| Token encryption | ⚠️ deferred (base64, consistent with email) |
| verify_jwt changes | ❌ none — preserved across all 8 functions |
| OAuth scope changes | ❌ none — keep `calendar` + `calendar.events` |
| Deployed vs. repo drift | ✅ — no drift; all 8 match repo |

---

## E. Verification plan

1. `npx tsc --noEmit`.
2. `npm test -- --run` (expected: vitest not installed in remote env — report).
3. Live MCP audits after deploy:
   - `list_edge_functions` to confirm new versions on the 5 touched functions; `verify_jwt=false` preserved.
   - `execute_sql` to confirm new columns exist with the partial index.
   - 0 row count unchanged (no data migration involved).
4. No app-level smoke from this remote (no UI), so manual checklist remains Chris's domain.

---

## F. Manual smoke checklist (for Chris, post-deploy)

1. Open Calendar Settings → Card 5. Click "Sign in with Google".
2. Complete Google OAuth. Land back on `/settings?section=calendar-settings&google_connected=1`. Toast: connected.
3. Calendar list dropdown populates with at least Primary.
4. Sync mode buttons: `Outbound-only` (default selected), `2-way Sync (Beta)` (clickable). Choose `Outbound-only`.
5. Calendar page header: Sync Now button is **hidden** in outbound_only mode.
6. Create an AgentFlow appointment from CalendarPage. Verify Google event appears in the selected Google calendar.
7. Edit the appointment. Verify Google event updates.
8. Delete the appointment. Verify Google event is removed.
9. Switch sync mode to `2-way Sync (Beta)`. Sync Now appears.
10. Create an event directly in Google Calendar. Click Sync Now. Verify event appears in AgentFlow with `sync_source = external`, `external_provider = google`.
11. Wait 5+ minutes. Confirm cron tick (no errors in Edge Function logs; new event appears if not already imported).
12. Cancel the Google event. Click Sync Now or wait for cron. Verify AgentFlow appointment status becomes `Cancelled`.
13. Toggle back to `Outbound-only`. Create a new Google event. Confirm it does NOT import (cron logs should show `users_synced` count without imports).
14. Disconnect Google. Disconnect confirmation copy mentions imported events remain. Status: Disconnected. Previously imported Google events remain in AgentFlow and can be edited/deleted locally.
15. Re-connect. Tokens are stored encoded (verify via `select octet_length(access_token), substr(access_token, 1, 12) from calendar_integrations` — should be base64-shaped).
16. Verify no console errors anywhere.
17. Verify a second user/org cannot see this user's integration row (RLS test).
18. Verify unauthenticated POST to `/functions/v1/google-calendar-inbound-sync` returns 401.

---

## G. Risks

1. **Token envelope migration of any existing token data.** Zero rows live → zero risk.
2. **Cron secret mismatch.** If the `GOOGLE_SYNC_CRON_SECRET` env var on the Edge Function does not match `private.google_sync_cron_secret`, cron 401s after B1. **Need Chris to confirm the env var is configured.** I can verify post-deploy by reviewing logs.
3. **Two-way (Beta) ambiguity.** Even after B4+B5, inbound is cron-only with 5-minute lag. Sync Now is the only manual path. Users may still expect instant two-way. Beta label + help text mitigate but don't eliminate the expectation.
4. **OAuth state columns.** No backwards-compat concern (0 rows) — purely additive.

---

## H. Approval requested

Chris, please approve (or redline) before I touch any file:

- [ ] **B1** — Tighten inbound-sync auth gate to fail closed.
- [ ] **B2** — New migration `20260529150000_calendar_oauth_state_columns.sql` adding `oauth_state` + `oauth_state_expires_at` columns + partial index.
- [ ] **B3** — Standardize all Calendar Edge Functions on `encodeToken`/`decodeToken` (callback, list, sync-appointment, disconnect). Add token refresh to sync-appointment.
- [ ] **B4** — Inbound-sync filters by `sync_mode='two_way'`.
- [ ] **B5** — UI: relabel `"2-way Sync"` → `"2-way Sync (Beta)"` with help text.
- [ ] **B6** — UI: hide Sync Now when mode is outbound_only; keep when two_way.
- [ ] **B7** — Disconnect copy mentions imported events remain.
- [ ] **Deferred and documented** — token encryption (Vault/pgsodium), recurrence handling, conflict UI beyond "Google wins", inbound cancellation latency reduction, Outlook, public booking, advanced conflict detection, round-robin, working hours, reminder automation.

Confirm Edge Function secret `GOOGLE_SYNC_CRON_SECRET` is set and matches the row in `private.google_sync_cron_secret`. I cannot read Edge Function env vars via MCP.

---

## POST-EXECUTION CONTEXT SNAPSHOT (2026-05-25)

### Changes
- DB migration applied: `20260529150000_calendar_oauth_state_columns.sql` (oauth_state + oauth_state_expires_at columns + partial index on calendar_integrations).
- 5 Edge Functions deployed (`verify_jwt = false` preserved on all 8 Google Calendar functions):
  - `google-calendar-inbound-sync` → v475 (B1 fail-closed auth + B4 sync_mode='two_way' filter)
  - `google-oauth-callback` → v475 (B3 encodeToken on token persist)
  - `google-calendar-list` → v470 (B3 shared helpers; refresh writes encoded)
  - `google-calendar-disconnect` → v475 (B3 decodeToken before Google revoke)
  - `google-calendar-sync-appointment` → v474 (B3 decodeToken + refresh path + safer error details)
- Frontend honesty updates: `CalendarPage.tsx` mode-gates Sync Now to two_way only; `CalendarSettings.tsx` shows "2-way Sync (Beta)" + mode help copy; Disconnect toast documents that imported events remain.
- `src/integrations/supabase/types.ts` patched: `oauth_state` + `oauth_state_expires_at` on calendar_integrations Row/Insert/Update.

### Decisions (final)
- **Inbound-sync auth:** Three paths only. `Bearer ` user JWT (user-scoped sync). `x-cron-secret` matching env var (full sync). Else 401. No fall-through.
- **Outbound-only:** Fully supported and the default. Outbound_only integrations are never inbound-synced server-side (B4).
- **Two-way:** Labeled Beta. Cron import (5-min lag) + manual Sync Now via user JWT.
- **Sync Now:** Hidden in outbound_only mode. Visible + safe in two_way (user-JWT scoped).
- **Disconnect:** Tokens cleared, `sync_enabled=false`, `calendar_id='primary'`, oauth_state nulled. Imported Google appointments remain in AgentFlow. Google-side revoke best-effort. Toast copy reflects this.
- **Token envelope:** Standardized on shared `encodeToken`/`decodeToken` across all 5 functions (base64 with raw-fallback). Vault/pgsodium encryption deferred as security debt, consistent with email module.
- **No tokens exposed or logged** anywhere in the touched code paths.

### Files touched
- Migrations: `supabase/migrations/20260529150000_calendar_oauth_state_columns.sql` (new)
- Edge Functions: `google-calendar-inbound-sync/index.ts`, `google-oauth-callback/index.ts`, `google-calendar-list/index.ts`, `google-calendar-disconnect/index.ts`, `google-calendar-sync-appointment/index.ts`
- Frontend: `src/pages/CalendarPage.tsx`, `src/components/settings/CalendarSettings.tsx`, `src/integrations/supabase/types.ts`
- Docs: `WORK_LOG.md` (this pass), `implementation_plan.md` (this file)

### Migrations / deploys
- 1 migration applied (success).
- 5 Edge Function deploys (success); 3 Google Calendar functions intentionally untouched (`google-oauth-start`, `google-calendar-status`, `google-calendar-configure`).

### Verification
- `npx tsc --noEmit` → 0 errors.
- `npm test -- --run` → vitest not installed in remote execution environment.
- MCP `list_edge_functions` confirms versions + verify_jwt unchanged.
- MCP `execute_sql` confirms oauth_state columns + partial index exist; row counts unchanged (0).
- In-DB `pg_net` probes (14491/14492/14493) against inbound-sync: all 401. Confirms (a) fail-closed behavior is live, and (b) `GOOGLE_SYNC_CRON_SECRET` env var is currently unset on the Edge Function runtime.

### Manual check status
- Awaiting Chris. Manual smoke checklist (18 items) is in the WORK_LOG entry for this pass.

### Blockers / next steps
- **Operational blocker (not code):** Chris to rotate or set `GOOGLE_SYNC_CRON_SECRET` Edge Function secret to match `private.google_sync_cron_secret` (or pick a new value and update both in the same window). Until then, cron-driven inbound sync returns 401 by design. Sync Now (user JWT path) is unaffected.
- Per directive: no `git push`, no PR, no merge.
- Future passes: token encryption (Vault/pgsodium) alongside email tokens; recurrence import; inbound conflict UI beyond Google-wins; webhooks instead of 5-minute cron; Outlook; public booking. All out of Pass 3 scope.
