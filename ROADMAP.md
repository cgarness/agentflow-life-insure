# AgentFlow | Living Roadmap 🚀

**Owner:** Chris Garness | **Last Updated:** April 18, 2026
**Niche Focus:** Life Insurance Agencies (High-Velocity CRM & Power Dialer)

---

## 1. System Status & Module Health

### 🔐 Authentication & Tenant Isolation `[STABLE]`
- **State**: Supabase Auth triggers `profiles` mirroring. Multi-tenant isolation is enforced via custom JWT claims (`organization_id`, `role`) and hierarchical `ltree` logic for downline management.
- **Recent Update**: Standardized `leads.user_id` and implemented `standardize_leads_user_id.sql` to ensure perfect ownership tracking.
- **Next Up**: Finalize invitation logic for Managers to invite downline Agents with auto-assigned `upline_path`.

### 🏗️ Database Infrastructure `[AUDITED — REWORKING]`
- **State**: The core table audit (Step 2) identified critical missing root objects.
- **Gaps**: Missing physical `organizations` table, `tasks` (follow-ups), and `dial_sessions` (metrics blocks).
- **Next Up**: Execute **SaaS Core Migration Block** to create `organizations` (multi-tenancy root), `tasks`, and `dial_sessions`.

### 📞 Power Dialer & Telephony `[PRODUCTION-READY]`
- **State**: 1-Line WebRTC Dialer (Telnyx) with Auto-Dial support. State management is decentralized via Supabase Edge functions and real-time triggers. **Inbound** calls ring the registered WebRTC client; **Floating Dialer** only for answer/decline (green/red) — **`IncomingCallModal`** removed from **`AppLayout`** to avoid duplicate popups (`inbound-call-claim` + webhook org hint).
- **Features**: Smart Caller ID (local / same-state / LRU rotation, daily usage cap via RPC), Ring Timeout, mandatory dispositions, inbound answer/decline on Floating Dialer. **MVP inbound bridge:** `telnyx-webhook` on `call.initiated` (inbound) issues Telnyx **Dial** `POST /v2/calls` with `link_to` + `bridge_on_answer` to `sip:{sip_username}@sip.telnyx.com` (org/global `telnyx_settings`) — proves PSTN → WebRTC audio path without fork/voicemail routing. (Answering Machine Detection was removed — bridge on answer only.)
- **Next Up**: Optimize campaign refresh logic and integrate `dial_sessions` to track agent efficiency in real-time. Replace shared SIP target with **per-agent** credential lookup; optional richer inbound routing (settings UI), voicemail. **Inbound:** Webhook + Realtime populate **`calls.contact_id`**; floating dialer shows **`identifiedContact`**. **Inbound browser UX:** one-time **Enable alerts & ringtone** unlocks **Web Notifications** + **Web Audio**; see `src/lib/incomingCallAlerts.ts`.

### 💼 SaaS & Infrastructure `[PLANNED — CRITICAL]`
- **State**: Entirely missing billing and SaaS partitioning layer.
- **Features Required**: Stripe integration, subscription tiers (Starter, Pro, Agency), and plan-based limiting (User caps, Dialing limits).
- **Next Up**: Initialize Stripe SDK and construct the `billing` Edge Function for subscription lifecycle management.

---

## 2. Recent Database Migration History (April 2026)

| Migration ID | Topic | Outcome |
| :--- | :--- | :--- |
| `20260418160000` | `leaderboard_tv_banner_team_leader_update.sql` | Adds **`leaderboard_tv_banner_text`** on `company_settings` (optional TV ticker override). New RLS policy **`company_settings_team_leader_update`**: **Team Leader** / **Team Lead** may **UPDATE** their org’s `company_settings` row (Admins unchanged via existing **`company_settings_write`**). `NOTIFY pgrst, 'reload schema'`. |
| `20260417000001` | `company_settings_rls.sql` | Ensures **`organization_id`** (FK → `organizations`) + **`website_url`** columns on `company_settings`; adds `UNIQUE (organization_id)`; drops legacy "allow all" RLS; installs **`company_settings_select`** (org-read for authed users) and **`company_settings_write`** (Super Admin OR `role='Admin'` within the org) via `is_super_admin()` / `get_org_id()` / `get_user_role()`; `NOTIFY pgrst, 'reload schema'`. Locks Company Branding to org scope + Admin-only edits. |
| `20260417220000` | `align_christopher_profile_organization.sql` | **`profiles.organization_id`** for **`chris@fflagent.com`** set from **`cgarness.ffl@gmail.com`** when the latter has a non-null org (Christopher aligned with Chris / agency tenant). **Production (2026-04-17):** applied via **`npx supabase db push --yes`** to project **`jncvvsvckxhqgqvkppmj`**. |
| `20260417120000` | `carriers_logo_and_contacts.sql` | Adds **`logo_url`** (TEXT) and JSONB **`contact_phones`** / **`contact_emails`** on **`public.carriers`** (arrays of `{label, value}` for labeled phone lines and emails). **Production (2026-04-17):** CLI **`migration repair`** removed orphan remote-only version rows, marked **`20260405100000`–`20260414120000`** as **applied** (they were already live under old timestamps), then **`supabase db push --yes`** applied **`20260417000000`** + **`20260417120000`**. |
| `20260413200000` | `seed_area_code_mapping.sql` | Adds `UNIQUE (area_code)` constraint + seeds **324 US NANP area codes** across 51 jurisdictions (50 states + DC) into **`area_code_mapping`**. Activates the same-state fallback tier in `selectOutboundCallerId`. **Production:** applied to `jncvvsvckxhqgqvkppmj` (2026-04-13). |
| `20260413190000` | `calls_realtime_publication.sql` | Adds **`public.calls`** to **`supabase_realtime`** (if absent) so clients can subscribe to inbound **`contact_id`** updates. |
| `20260413230000` | `peek_inbound_call_identity.sql` | **`peek_inbound_call_identity`** (**`SECURITY DEFINER`**) returns ANI/CRM JSON for the signed-in org by **`telnyx_call_id`** or **`telnyx_call_control_id`** (client poll while ringing). |
| `20260413240000` | `peek_inbound_call_identity_control_id_flex.sql` | Same RPC — matches **`call_control_id`** with or without Telnyx **`vN:`** prefix so SDK vs webhook ids align. |
| `20260413250000` | `peek_inbound_fallback_latest_ringing.sql` | **`peek_inbound_call_identity`** — if session/control id still does not match the **`calls`** row (bridged WebRTC leg vs PSTN leg), fall back to latest **`status = ringing`** inbound for the org in the last **6 minutes**. |
| `20260404000000` | `standardize_leads_user_id.sql` | Aligned all lead ownership to unified `user_id` field for RLS performance. |
| `20260404000001` | `fix_leads_user_id_drift.sql` | Repaired historical lead data drift where ownership mapping was disconnected. |
| `20260404100000` | `dialer_rls_audit.sql` | Hardened Row-Level Security for campaigns and dialer state components. |
| `20260405000000` | `sync_leads_user_id_trigger.sql` | Added real-time trigger to sync master lead ownership with campaign states. |
| `20260405100000` | `smart_queue_lock_system.sql` | Atomic fetch-and-lock for Team/Open Pool campaigns. `dialer_lead_locks` table + 3 RPCs. |
| `20260406000000` | `hard_claim_engine.sql` | `claim_lead` RPC (SECURITY DEFINER) for permanent ownership transfer via `leads.assigned_agent_id`. Added `queue_filters` JSONB column to `campaigns`. |
| `20260406200000` | `add_leads_to_campaign_rpc.sql` | `add_leads_to_campaign` RPC (SECURITY DEFINER) enforcing Personal/Team/Open ownership rules before inserting into `campaign_leads`. |
| `20260406400000` | `dialer_lead_locks.sql` | `fetch_and_lock_next_lead` RPC (90s TTL, no leads JOIN) + `release_all_agent_locks` RPC + composite index on `(campaign_id, expires_at)`. |
| `20260406500000` | `fix_campaign_leads_user_id.sql` | Hotfix: ensures `user_id` column exists on `campaign_leads` (IF NOT EXISTS + backfill from `claimed_by`); recreates `add_leads_to_campaign` without `user_id` in INSERT (column DEFAULT handles it). Resolves "column user_id does not exist" runtime error. |
| `20260406600000` | `campaign_leads_scheduled_callback.sql` | Added `scheduled_callback_at` (TIMESTAMPTZ) to `campaign_leads` for native prioritization. |
| `20260406700000` | `enterprise_waterfall_rpc.sql` | `get_enterprise_queue_leads` RPC: full DB-level filtering (Timezones, Max Attempts, Retry Intervals). |
| `20260406800000` | `fix_enterprise_rpc_columns.sql` | Fixed column mismatch in `get_enterprise_queue_leads` RPC; ensured perfect `SETOF` alignment. |
| `20260406900000` | `patch_enterprise_rpc_nulls.sql` | Patched RPC with `COALESCE` guards for NULL states, statuses, and call_attempts. |
| `20260406950000` | `robust_rpc_signature.sql` | Aligned RPC signature with JS payload; cleared schema cache overloads. |
| `20260407000000` | `dialer_telemetry_hardening.sql` | `get_org_id()` graceful fallback to profiles table; re-applied `get_enterprise_queue_leads` with `SET search_path`; PostgREST cache reload. |
| `20260409120000` | `hierarchical_calls_rls.sql` | Replaced strict owner-only `calls` RLS with Admin (org) + Team Leader / `Team Lead` (downline via `is_ancestor_of`) + Agent (own); backfill `contact_activities.organization_id` from `leads` (`contact_id` = `leads.id`, UUID). **Production:** also recorded as `20260409205652_hierarchical_calls_rls` on project `jncvvsvckxhqgqvkppmj`. |
| `20260411190000` | `revert_inbound_calling_system.sql` | Rolls back inbound schema: drops `inbound_fork_legs`, `voicemails`, related trigger/function; removes inbound columns from `profiles`; resets `inbound_routing_settings` to the legacy single default row + `"Allow all for authenticated users"` RLS; drops voicemail-assets **policies** on `storage.objects` (Supabase disallows SQL `DELETE` on storage tables—delete the empty `voicemail-assets` bucket in Dashboard if you want it removed). Also drops prod policies `inbound_routing_select` / `inbound_routing_update` from the follow-up migration. **Production:** recorded as `20260411185718_revert_inbound_calling_system` on `jncvvsvckxhqgqvkppmj`. |

---

## 3. Work Log (Recent History)

- **2026-04-18 | [DONE] Twilio Migration Phase 2 — twilio-token Edge Function**
  *What:* Built Access Token generator with VoiceGrant for browser SDK auth. Generates and persists `twilio_client_identity` on `profiles`. JWT built manually using Web Crypto API (HMAC-SHA256) for Deno compatibility — the Node.js `twilio` npm package cannot be used in Supabase Edge Functions.
  *File created:* `supabase/functions/twilio-token/index.ts`
  *Env vars required (set as Edge Function secrets):* `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_TWIML_APP_SID`

  ### Context Snapshot — Twilio Migration Phase 2 (2026-04-18)

  | Piece | Detail |
  | :--- | :--- |
  | **Function built** | `supabase/functions/twilio-token/index.ts` |
  | **Token TTL** | 4 hours (14 400 s) — standard for Twilio browser SDK sessions |
  | **JWT header** | `{ alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' }` — `cty` is required; Twilio rejects tokens without it |
  | **VoiceGrant** | `incoming.allow = true` + `outgoing.application_sid = TWILIO_TWIML_APP_SID` |
  | **Identity format** | `agent_{userId.slice(0,8)}_{4 random hex chars}` — generated once, persisted to `profiles.twilio_client_identity` |
  | **Identity column** | `profiles.twilio_client_identity` (renamed from `sip_username` in Phase 1) |
  | **CORS** | Allows all origins; `POST` + `OPTIONS`; headers: `authorization, x-client-info, apikey, content-type` |
  | **Auth** | Requires valid Supabase JWT (`Authorization: Bearer …`); returns 401 if missing/invalid |
  | **Deployment status** | NOT YET DEPLOYED — will be deployed as a batch with other Twilio functions |
  | **Next phase** | Phase 3: `twilio-voice-webhook` (inbound/outbound call event handler) |

- **2026-04-18 | [DONE] Twilio Migration Phase 1 — DB Schema Migration**
  *What:* Renamed Telnyx columns to Twilio/provider-agnostic names on `calls`, `messages`, `profiles`. Added Twilio columns to `phone_numbers` and `phone_settings`. Created `call-recordings` storage bucket with org-scoped RLS. Updated `peek_inbound_call_identity` RPC.
  *Migrations created:*
  - `20260418170001_rename_calls_telnyx_columns.sql` — `telnyx_call_control_id` → `twilio_call_sid`, `telnyx_call_id` → `provider_session_id`, `telnyx_error_code` → `provider_error_code`; added `recording_storage_path TEXT`, `recording_duration INTEGER`
  - `20260418170002_rename_messages_telnyx_columns.sql` — `telnyx_message_id` → `provider_message_id`
  - `20260418170003_rename_profiles_sip_username.sql` — `sip_username` → `twilio_client_identity`
  - `20260418170004_add_twilio_columns_phone_numbers.sql` — added `twilio_sid TEXT`, `trust_hub_status TEXT DEFAULT 'pending'`, `shaken_stir_attestation TEXT`
  - `20260418170005_add_twilio_columns_phone_settings.sql` — added `trust_hub_profile_sid TEXT`, `shaken_stir_enabled BOOLEAN DEFAULT true`
  - `20260418170006_create_call_recordings_bucket.sql` — `call-recordings` bucket (private), RLS policies `call_recordings_insert_own_org` + `call_recordings_select_own_org` scoped by `{org_id}` first path segment
  - `20260418170007_update_peek_inbound_call_identity_rpc.sql` — DROP + CREATE `peek_inbound_call_identity(text,text)` with new column names; supersedes all three prior `20260413230000`/`240000`/`250000` versions

  ### Context Snapshot — Twilio Migration Phase 1 (2026-04-18)

  | Piece | Detail |
  | :--- | :--- |
  | **Renamed columns — calls** | `telnyx_call_control_id` → `twilio_call_sid`, `telnyx_call_id` → `provider_session_id`, `telnyx_error_code` → `provider_error_code` |
  | **New columns — calls** | `recording_storage_path TEXT`, `recording_duration INTEGER` |
  | **Renamed columns — messages** | `telnyx_message_id` → `provider_message_id` |
  | **Renamed columns — profiles** | `sip_username` → `twilio_client_identity` |
  | **New columns — phone_numbers** | `twilio_sid TEXT`, `trust_hub_status TEXT DEFAULT 'pending'`, `shaken_stir_attestation TEXT` |
  | **New columns — phone_settings** | `trust_hub_profile_sid TEXT`, `shaken_stir_enabled BOOLEAN DEFAULT true` |
  | **Storage bucket** | `call-recordings` (private); path `{org_id}/{date}/{filename}`; RLS via `profiles.organization_id` of caller |
  | **RPC updated** | `peek_inbound_call_identity(p_provider_session_id, p_twilio_call_sid)` — column refs updated; fallback to latest ringing inbound in last 6 min preserved |
  | **telnyx_settings table** | NOT dropped — deferred to Phase 13 (cleanup phase) |
  | **⚠ Downstream breakage until Phase 6-7 (frontend)** | `TelnyxContext.tsx` references `telnyx_call_id`, `telnyx_call_control_id` in selects/updates. `dialer-api.ts` and `FullScreenContactView.tsx` reference `telnyx_call_control_id`. `CallRecordingLibrary.tsx` also references it. These will produce runtime errors until frontend is updated. |
  | **⚠ Downstream breakage until Phase 11 (inbound-call-claim)** | `telnyx-webhook` edge function writes `telnyx_call_id` and `telnyx_call_control_id` — will fail on insert until Phase 11. |
  | **⚠ TypeScript errors until Phase 12 (types regen)** | `src/integrations/supabase/types.ts` still declares old column names. All files that import these types will show TS errors until `supabase gen types` is re-run. Affected files: `TelnyxContext.tsx`, `dialer-api.ts`, `FullScreenContactView.tsx`, `CallRecordingLibrary.tsx`. |

- **2026-04-18 | [DONE] Leaderboard TV: Full Rankings table parity + Recent wins right**
  *What:* **`TVMode.tsx`** — TV table wrapped like desktop (**“Full Rankings”** bar + card). Column order matches the main rankings grid: **Rank, Agent, Calls, Policies, Appts, Talk Time, Conv %**, with **Recent wins** as the **last (rightmost)** column. Podium block: **`border-b`**, **`pb-6`**, capped height (**`min(220px, 26vh)`**), **`max-w-5xl`** grid, ring-only highlight for #1 — reduces overlap with the table header. Horizontal scroll via **`min-w-[640px]`** on small widths. *No schema changes.* `tsc --noEmit` clean.

- **2026-04-18 | [DONE] Leaderboard TV: fix overlap + settings popover z-index**
  *What:* **`TVMode.tsx`** — replaced absolute fade chrome with a **fixed-height top toolbar** in normal flow so header/podium do not stack under each other; removed **center-card scale** (replaced with **ring** for #1). **Settings** popover: **`modal={false}`**, **`PopoverContent` `z-[10020]`** so it renders above the **`z-[9999]`** TV layer; **`side="bottom"`** + collision padding. **Escape** closes popover first, then exits TV. *No schema changes.* `tsc --noEmit` clean.

- **2026-04-18 | [DONE] Pipeline stages: remove `is_positive` / `isPositive` (soft removal)**
  *What:* Dropped the redundant “Positive” flag from app types, `pipelineSupabaseApi` create/update mapping, Contact Management pipeline UI (inline row + modal), and Master Admin pipeline table/edit fields. Removed “Closed Won” / “Licensed & Onboarding” positive-lock props and logic. **`pipeline_stages.is_positive` column left in the database** (inserts omit the field so the DB default applies). `convert_to_client` unchanged. `tsc --noEmit` clean.

- **2026-04-18 | [DONE] Leaderboard: remove goals from page**
  *What:* Removed `goals` table fetch, goal progress bars, and the “Goal” column from `Leaderboard.tsx`; removed the goal column from `TVMode.tsx`. Updated `computeBadges` in `useLeaderboardBadges.ts` (dropped unused `goalsMap` argument and the “Perfect Week” badge that depended on goal progress). `AgentScorecardModal` weekly goals UI unchanged. *No schema changes.* `tsc --noEmit` clean.

- **2026-04-18 | [DONE] Leaderboard TV mode: layout, ticker editor, stats controls, wins column, hide chat**
  *What:* **`TVMode.tsx`** — tighter vertical layout (header padding for chrome, podium `max-h-[min(260px,30vh)]`, table `flex-1 min-h-0` + sticky thead), removed duplicate calls/appts under podium stat. **Settings** (gear) popover: choose **viewing metric** (incl. Conversion Rate), **Auto-rotate stats** switch (30s, persisted in `localStorage`), optional **scrolling ticker** textarea for **Admin / Team Leader / Team Lead** (saved to **`company_settings.leaderboard_tv_banner_text`**; empty = live wins feed). **`Leaderboard.tsx`** sets **`document.body.dataset.tvMode`** while TV is on; **`FloatingChat`** observes it and **returns null** (hides draggable chat). Agents include **`recentWins7d`** (wins in last 7 days) for new **Recent wins** column. *Migration: `20260418160000_leaderboard_tv_banner_team_leader_update.sql`.* `src/integrations/supabase/types.ts` updated for new column. `tsc --noEmit` clean.

- **2026-04-18 | [DONE] Leaderboard: podium UX + default period + profile photos**
  *What:* Default period is **Today** (was This Month). Top-3 podium cards are **smaller** (`max-w-3xl` / `lg:max-w-4xl`, compact padding, smaller trophy/avatar/type), with **stronger gold/silver/bronze** gradients, borders, shadows, and rank pills; **1st place** scales up slightly on desktop. Removed duplicate **calls / appts** line under the main stat. **`LeaderboardAgentAvatar`** (`src/components/leaderboard/LeaderboardAgentAvatar.tsx`) renders **`profiles.avatar_url`** on the podium and full rankings table (Radix `Avatar` + initials fallback); **TV mode** uses the same. Loading skeletons match compact podium height. *No schema changes.* `tsc --noEmit` clean.

- **2026-04-17 | [DONE] Bugfix: Company Branding — admin-only gate, field cleanup (date format + color removed), org-scoped saves, favicon restricted to Super Admin, website URL field added**
  *What:* Replaced the open-access `SINGLETON_ID` branding model with an Admin-only, org-scoped one. (1) New migration `20260417000001_company_settings_rls.sql` — ensures `organization_id` (FK) + `website_url` columns, adds `UNIQUE(organization_id)`, drops legacy permissive RLS, installs `company_settings_select` (authed users in the org can read) and `company_settings_write` (Super Admin OR org Admin only). (2) `CompanyBranding.tsx` now reads `useAuth().profile` to derive `canEdit = is_super_admin || role === 'Admin'`; non-Admins see a read-only warning banner and all inputs are disabled + `opacity-50`. Favicon upload only renders for `email === 'cgarness.ffl@gmail.com'`. Date Format and Primary Color blocks (and `COLOR_PRESETS`, `DATE_FORMATS`, `isValidHex`, `hexInput`/`hexError` state, `Popover` import) deleted entirely. New `websiteUrl` field added after Company Phone (type=url, placeholder `https://youragency.com`). All queries use `.eq('organization_id', orgId).maybeSingle()`; upsert uses `onConflict: 'organization_id'`; save handler gated on `canEdit`. (3) Extracted to keep every file <200 lines: `BrandingUploadField.tsx` (logo/favicon drop zone + validation), `BrandingForm.tsx` (form body), `brandingConfig.ts` (constants/types). Final sizes: `CompanyBranding.tsx` 169, `BrandingForm.tsx` 108, `BrandingUploadField.tsx` 133, `brandingConfig.ts` 63. (4) `BrandingContext.tsx` — removed `dateFormat` + `primaryColor` from state/DEFAULTS/loaded mapping; `formatDateTime`/`formatDate` hardcoded to `MM/dd/yyyy`; `applyBrandingToDocument` no longer injects `--brand-primary`; `refreshBranding` now looks up the authed user's `organization_id` from `profiles` before querying `company_settings` (no more `SINGLETON_ID`). Added `websiteUrl` to state and loaded mapping. (5) Downstream callers updated so the build stays green: `src/components/shared/DateInput.tsx` — removed `useBranding()` + `dateFormat` switch, hardcoded `MM/dd/yyyy`; `src/components/layout/Sidebar.tsx` — swapped inline `style={{ backgroundColor: branding.primaryColor }}` for Tailwind `bg-primary`. `SINGLETON_ID` still referenced in unrelated files (`docs/SETTINGS_LAYOUT.md`, `InboundCallRouting.tsx`, `PhoneSettings.tsx`, `telnyx-search-numbers`, two older migrations) — flagged, not touched per task scope. `tsc --noEmit` clean. *Migration: `20260417000001_company_settings_rls.sql`.*

  ### Context Snapshot — Company Branding Access Control (2026-04-17)

  | Piece | Detail |
  | :--- | :--- |
  | **Migration** | `supabase/migrations/20260417000001_company_settings_rls.sql` — `organization_id` + `website_url` columns (IF NOT EXISTS), `UNIQUE(organization_id)`, RLS `company_settings_select` (org-read) + `company_settings_write` (Super Admin OR org Admin), `NOTIFY pgrst, 'reload schema'` |
  | **DB state pre-migration** | `company_settings.organization_id` column already present (from types.ts) w/ FK to `organizations`; `website_url` added by this migration; old RLS was "Allow authenticated users to read/update/insert" (permissive) |
  | **Helper functions used** | `public.is_super_admin()`, `public.get_org_id()`, `public.get_user_role()` — all pre-existing |
  | **Role gate** | `canEdit = profile.is_super_admin \|\| profile.role === 'Admin'` (from `useAuth()`) |
  | **Favicon restriction** | Renders only when `profile.email === 'cgarness.ffl@gmail.com'` — section omitted entirely for everyone else |
  | **Read-only UX** | Warning banner above form + `disabled={!canEdit}` on every input + `opacity-50` on form wrapper + save button hard-guarded (`if (!canEdit) return`) |
  | **Removed fields** | Date Format `<select>`, Primary Color picker + `COLOR_PRESETS` + hex input + `Popover`, `dateFormat`/`primaryColor` state everywhere |
  | **Added field** | `websiteUrl` (text/url) → column `website_url` |
  | **New files** | `BrandingUploadField.tsx` (logo + favicon drop zones), `BrandingForm.tsx` (form body), `brandingConfig.ts` (constants/types) |
  | **Component sizes** | `CompanyBranding.tsx` 169 / `BrandingForm.tsx` 108 / `BrandingUploadField.tsx` 133 / `brandingConfig.ts` 63 — all <200 |
  | **Org-scoped query** | `supabase.from('company_settings').select('*').eq('organization_id', orgId).maybeSingle()`; upsert conflict target `organization_id` |
  | **BrandingContext** | Removed `dateFormat`/`primaryColor`; added `websiteUrl`; `formatDateTime` fixed to `MM/dd/yyyy`; `applyBrandingToDocument` no longer injects `--brand-primary`; `refreshBranding` resolves `orgId` via `profiles` lookup before querying |
  | **Downstream fixes** | `DateInput.tsx` drops `useBranding()`, hardcodes `MM/dd/yyyy`; `Sidebar.tsx` logo square swaps inline `primaryColor` bg for Tailwind `bg-primary` |
  | **Flagged but untouched** | `SINGLETON_ID` = `00000000-0000-0000-0000-000000000000` still appears in `docs/SETTINGS_LAYOUT.md`, `src/components/settings/InboundCallRouting.tsx`, `src/components/settings/PhoneSettings.tsx`, `supabase/functions/telnyx-search-numbers/index.ts`, `supabase/migrations/20260308000000_create_phone_tables.sql`, `supabase/migrations/20260320152407_*.sql`, `supabase/migrations/20260411190000_revert_inbound_calling_system.sql` — out of task scope |
  | **tsc** | Clean (exit 0) |
  | **Branch** | `claude/fix-branding-access-control-t63uj` |

- **2026-04-17 | [DONE] Bugfix: Org chart connector lines — thickness and top-of-card anchor**
  *What:* Fixed `src/components/settings/HierarchyTree.tsx` — two issues in the Team Structure visual on the User Management settings page. (1) **Thickness**: SVG `strokeWidth` reduced from `2.5` → `1` with `vectorEffect="non-scaling-stroke"` so strokes render as 1px hairlines regardless of SVG scaling; div stems changed from `w-0.5` (2px) + `bg-primary` → `w-px` + `bg-primary/20`; SVG color class changed from `text-primary` → `text-primary/20` for a subtle hairline. (2) **Anchor point**: Root cause was the SVG overlay using `absolute inset-0` which caused it to span the full container height (connector zone + all child card heights), making `yDrop=40` in `viewBox="0 0 100 42"` land in the middle of the cards rather than at their tops. Fixed by changing the SVG container to `absolute top-0 left-0 right-0 h-8` so it occupies only the 32px connector zone; child row padding changed from `pt-11` → `pt-8` to match; SVG paths updated to draw horizontal bar at `y=0` and drops from `y=0` to `y=100` (full height of the 32px zone = exact top of child cards). Single-child connector changed from `absolute left-1/2 top-0 ... w-0.5 bg-primary` (overlapping card) → in-flow `h-6 w-px bg-primary/20 shrink-0` (stacked above card). `tsc --noEmit` clean. *No schema changes.*

  ### Context Snapshot — Org Chart Connector Fix (2026-04-17)

  | Piece | Detail |
  | :--- | :--- |
  | **File** | `src/components/settings/HierarchyTree.tsx` |
  | **SVG thickness** | `strokeWidth={2.5}` → `strokeWidth={1}` + `vectorEffect="non-scaling-stroke"` |
  | **SVG color** | `text-primary` → `text-primary/20` |
  | **Div stems** | `w-0.5 rounded-full bg-primary` → `w-px bg-primary/20` |
  | **SVG container** | `absolute inset-0` (full height) → `absolute top-0 left-0 right-0 h-8` (connector zone only) |
  | **SVG viewBox** | `0 0 100 42` with internal stem + yJoin=22/yDrop=40 → `0 0 100 100` horizontal at y=0, drops y=0→100 |
  | **Child row padding** | `pt-11` (multi) / `pt-2` (single) → `pt-8` (multi) / `pt-0` (single) |
  | **Single-child stub** | `absolute left-1/2 top-0 z-0 h-6 w-0.5 -translate-x-1/2 bg-primary` → `h-6 w-px shrink-0 bg-primary/20` (in-flow) |
  | **Branch** | `claude/fix-org-chart-connectors-fYim2` |

- **2026-04-17 | [DONE] Feature: CampaignHeatmap component on CampaignDetail Stats tab (Calls Made / Calls Answered)**
  *What:* Added `src/components/campaigns/CampaignHeatmap.tsx` — a reusable 7-day (Mon–Sun) × 14-hour (8am–9pm) heatmap wired directly to the `calls` table via TanStack Query (`queryKey: ["campaignHeatmap", campaignId, filter]`, `staleTime: 5min`). Each cell bucketizes call count (0, 1–2, 3–5, 6–10, 11+) and fades through an accent color scale; primary-blue for "Calls Made" (all calls with `started_at` not null), emerald-500 for "Calls Answered" (adds `.gt("duration", 45)` filter). Radix `Tooltip` on hover shows `Day Hour — N calls`. Loading state renders skeleton grid (all cells `bg-muted/20`); empty state shows the 0-intensity grid plus "No call data yet". Legend strip (Less → More) below grid. Cells `w-4 h-4 sm:w-5 sm:h-5` to prevent mobile horizontal scroll. Rendered as a 2-column grid in `CampaignDetail.tsx` Stats tab between Channel Activity and the (relocated) date range filter. Date range filter was moved from the top of the Stats tab down to sit directly above the Analytics Charts it actually gates — layout now flows stats cards → channel activity → heatmaps → date range filter → charts → status breakdown. `tsc --noEmit` clean. *No schema changes.*

  ### Context Snapshot — CampaignHeatmap (2026-04-17)

  | Piece | Detail |
  | :--- | :--- |
  | **New file** | `src/components/campaigns/CampaignHeatmap.tsx` |
  | **Props** | `{ title: string; campaignId: string; filter: "all" \| "answered" }` |
  | **Grid** | 7 columns (Mon–Sun, Mon-first via `(getDay(d) + 6) % 7`) × 14 rows (hours 8–21) |
  | **Buckets** | 0 → `bg-muted/40`; 1–2 → `/20`; 3–5 → `/40`; 6–10 → `/70`; 11+ → full |
  | **Scales** | `bg-primary` for `filter="all"`; `bg-emerald-500` for `filter="answered"` |
  | **Query** | `supabase.from("calls").select("started_at, duration").eq("campaign_id", campaignId).not("started_at", "is", null)` + `.gt("duration", 45)` when answered |
  | **Tooltip** | Radix `Tooltip` from `@/components/ui/tooltip` — shows `{Day} {Hour} — N call(s)` |
  | **Cell size** | `w-4 h-4 sm:w-5 sm:h-5 rounded-sm` to fit mobile without horizontal scroll |
  | **CampaignDetail wire-up** | Rendered in Stats tab as `<div className="grid grid-cols-1 md:grid-cols-2 gap-4">` with two instances — placed after Channel Activity, before the (relocated) date range filter |
  | **Date range filter** | Moved from top of Stats tab down to sit directly above the charts it filters |
  | **Branch** | `claude/add-campaign-heatmap-78hKl` |

- **2026-04-17 | [DONE] Bugfix: Scope Import History on CampaignDetail to campaign-only imports**
  *What:* The Import History tab in `CampaignDetail.tsx` was showing all imports made by the current user across the platform (filtered by `agent_id`) instead of only imports tied to the specific campaign. Fixed in three parts: (1) Migration `20260417000000_add_campaign_id_to_import_history.sql` adds `campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL` with `IF NOT EXISTS` guard. (2) `ImportCSVModal.doImport()` now inserts a row into `import_history` after a successful campaign import, including `campaign_id`, `agent_id`, `organization_id`, and all counts. Added `useAuth()` to the modal sub-component to access `user.id`. (3) `fetchImportHistory` in the main `CampaignDetail` component now filters `.eq("campaign_id", id)` instead of `.eq("agent_id", user.id)`, and its `useCallback` dep updated from `[user?.id]` to `[id]`. `src/integrations/supabase/types.ts` updated with `campaign_id` on all three `import_history` type shapes (Row/Insert/Update) plus a new FK Relationship entry. Contacts.tsx import flow untouched — it correctly omits `campaign_id`. *Migration: `20260417000000_add_campaign_id_to_import_history.sql`.*

  ### Context Snapshot — Import History Campaign Scope Fix (2026-04-17)

  | Piece | Detail |
  | :--- | :--- |
  | **Root cause** | `fetchImportHistory` filtered by `agent_id = user.id` — showed all platform imports, not campaign imports |
  | **Migration** | `supabase/migrations/20260417000000_add_campaign_id_to_import_history.sql` — adds `campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL` with `IF NOT EXISTS` |
  | **fetchImportHistory** | `.eq("agent_id", user.id)` → `.eq("campaign_id", id)`; `useCallback` dep `[user?.id]` → `[id]` |
  | **ImportCSVModal.doImport** | Added `useAuth()` inside sub-component; INSERT into `import_history` with `campaign_id`, `agent_id`, `organization_id`, `file_name`, `total_records`, `imported`, `duplicates`, `errors` after RPC succeeds |
  | **types.ts** | `campaign_id: string \| null` added to Row/Insert/Update; FK relationship entry added |
  | **Contacts.tsx** | Untouched — platform-level imports correctly omit `campaign_id` |
  | **Branch** | `claude/fix-import-history-filter-RRVCE` |

- **2026-04-17 | [DONE] Bugfix: Remove non-functional "Today" button from Calendar page header**
  *What:* Removed the inline `<button>` labeled "TODAY" (line 614 in `src/pages/CalendarPage.tsx`) that called `setCurrentDate(new Date())`. The button provided no perceptible feedback and created a confusing dead-end UX. The `setCurrentDate` state setter remains in use by the prev/next navigation controls — it was not removed. No shared components affected; button was inline JSX only. `tsc --noEmit` clean. *No schema changes.*

  ### Context Snapshot — Calendar "Today" Button Removal (2026-04-17)

  | Piece | Detail |
  | :--- | :--- |
  | **File changed** | `src/pages/CalendarPage.tsx` only |
  | **Removed** | Inline `<button onClick={() => setCurrentDate(new Date())} className="...bg-accent/50 border border-border...">Today</button>` (was line 614) |
  | **`setCurrentDate` state** | Untouched — still used by ChevronLeft/ChevronRight navigation buttons |
  | **Other controls** | View switcher, search input, Google Sync button, prev/next nav, Schedule button — all untouched |
  | **Shared components** | None — button was inline JSX, not a shared component |
  | **tsc** | Clean (no errors) |
  | **Branch** | `claude/remove-calendar-today-button-dx5t2` |

- **2026-04-17 | [DONE] Bugfix: Remove Dark Mode toggle and user profile section from left sidebar nav**
  *What:* Removed the Dark Mode toggle button (moon/sun icon + label) and the user profile/avatar display (initials + full name) from the bottom of `src/components/layout/Sidebar.tsx`. Both elements were cluttering the nav chrome. Cleaned up all now-unused imports (`AvatarSkeleton`, `NameSkeleton`, `Sun`, `Moon`, `useTheme`, `useAuth`) and removed the corresponding variable declarations (`theme`, `setTheme`, `profile`, `isLoading`). Removed the `space-y-3` class from the bottom `<div>` since only the collapse toggle button remains. Dark mode state logic (`ThemeProvider` in App.tsx) and auth context untouched — functionality preserved for use elsewhere. `tsc --noEmit` clean. *No schema changes.*

  ### Context Snapshot — Sidebar Nav Clutter Removal (2026-04-17)

  | Piece | Detail |
  | :--- | :--- |
  | **File changed** | `src/components/layout/Sidebar.tsx` only |
  | **Removed: Dark Mode toggle** | Lines 79–82 — `<button>` with `useTheme` toggle, `Sun`/`Moon` icons, "Light Mode"/"Dark Mode" label |
  | **Removed: User profile block** | Lines 83–101 — `{!collapsed && ...}` block with `AvatarSkeleton`/`NameSkeleton` loading states and initials + name display |
  | **Removed imports** | `AvatarSkeleton`, `NameSkeleton` (ProfileSkeleton); `Sun`, `Moon` (lucide-react); `useTheme` (next-themes); `useAuth` (AuthContext) |
  | **Removed vars** | `theme`, `setTheme` from `useTheme()`; `profile`, `isLoading` from `useAuth()` |
  | **Bottom div** | `space-y-3` class removed; collapse toggle button is now the sole child |
  | **Dark mode state** | Untouched — `ThemeProvider` in `App.tsx` still wraps the app; TopBar theme toggle still works |
  | **Auth/profile state** | Untouched — `useAuth` still provides profile to TopBar dropdown and AgentProfile page |
  | **Component size** | 127 → 91 lines (well under 200-line limit) |
  | **tsc** | Clean (no errors) |
  | **Branch** | `claude/remove-nav-sidebar-clutter-iIIoH` |

- **2026-04-16 | [DONE] Hotfix: structural JSX fix Contacts.tsx line 1520 — diagnosed and resolved root cause**
  *What:* Three tabs (Leads, Clients, Recruits) had two sibling `<div>` elements inside a ternary expression arm without a fragment wrapper, causing esbuild "Expected ) but found className" at the pagination footer div. Wrapped each pair in `<>...</>`. `tsc --noEmit` clean, `npm run build` successful. *No schema changes.*

- **2026-04-16 | [DONE] Hotfix: JSX syntax error in pagination footer (middot entity)**
  *What:* The `·` literal middle-dot character in all three pagination footer `<p>` tags (Leads, Clients, Recruits) was causing a JSX parse error at build time. Replaced with `&middot;` HTML entity in `src/pages/Contacts.tsx`. `tsc --noEmit` clean. *No schema changes.*

- **2026-04-16 | [DONE] Contacts page server-side pagination (50/page)**
  *What:* Replaced unbounded fetches on the Contacts page (Leads, Clients, Recruits tabs) with server-side pagination at 50 records per page. `leadsSupabaseApi.getAll`, `clientsSupabaseApi.getAll`, and `recruitsSupabaseApi.getAll` now return `{ data, totalCount }`. Added `page`/`pageSize` params to each API. Added `getById` to `clientsSupabaseApi` and `recruitsSupabaseApi` for deep-link fallback. Contacts.tsx gains page state, totalCount state, a filter-change reset effect, updated `fetchData` dependencies, and Previous/Next pagination footers for all three tables. Agents tab excluded (low-volume, separate users query). `tsc --noEmit` clean. *No schema changes.*

  ### Context Snapshot — Contacts Page Pagination (2026-04-16)

  | Piece | Detail |
  | :--- | :--- |
  | **supabase-contacts.ts** | `leadsSupabaseApi.getAll` — added `page`/`pageSize` params; two-pass fetch (batch `pageSize*5` at offset `page*pageSize*5`); separate count query; returns `{ data: Lead[]; totalCount: number }` |
  | **lastDisposition** | Stays **client-side** — derived from most-recent `calls` join row, not a stored column on `leads`. TODO comment added for when `last_disposition` column exists. |
  | **attemptCounts** | Stays **client-side** — requires computed count from related `calls` rows. |
  | **timezones** | Stays **client-side** — requires `getPrimaryTimezoneGroup` state→tz mapping logic. |
  | **callableNow** | Stays **client-side** — requires `isCallableNow` time-of-day logic. |
  | **supabase-clients.ts** | `clientsSupabaseApi.getAll` — no client-side filters, uses `.range()` directly; returns `{ data: Client[]; totalCount: number }`. Added `getById`. |
  | **supabase-recruits.ts** | `recruitsSupabaseApi.getAll` — no client-side filters, uses `.range()` directly; returns `{ data: Recruit[]; totalCount: number }`. Added `getById`. |
  | **Contacts.tsx — state** | `PAGE_SIZE=50`; `leadsPage`, `clientsPage`, `recruitsPage` (0-indexed); `leadsTotalCount`, `clientsTotalCount`, `recruitsTotalCount` |
  | **Contacts.tsx — filter reset** | `useEffect` watching all filter deps resets all three page states to 0 |
  | **Contacts.tsx — fetchData** | Passes `page`/`pageSize` to each API; destructures `{ data, totalCount }`; page states in dep array |
  | **Contacts.tsx — deep-link fallback** | After main fetch, if `pendingContactId` not found on current page, calls `getById` (leads → clients → recruits chain) and opens contact directly |
  | **Contacts.tsx — UI** | Previous/Next footer added below each table (Leads, Clients, Recruits); shows "N total · Page X of Y"; clears selection on page change |
  | **Two-pass note** | Over-fetch factor of 5 is a heuristic — pages with heavy client-side filtering may show fewer than 50 rows. Acceptable tradeoff until server-side disposition/timezone columns exist. |
  | **tsc** | Clean (no errors) |
  | **Branch** | `claude/add-contacts-pagination-fP1ya` |

- **2026-04-14 | [DONE] Dialer disposition actions — Supabase alignment (remove-from-campaign status)**
  *Verify:* Reviewed migrations + RLS vs `DialerPage` / `dialer-api` (no live DB run — Supabase CLI not available in this environment). *Bug:* **Remove from campaign** wrote `campaign_leads.status = 'removed'` while `getCampaignLeads` terminal filter used **`Removed`** only, so removed rows could reappear after reload. *Fix:* write **`Removed`**; check `{ error }` from update; add lowercase **`removed`** to `TERMINAL_STATUSES` in **`dialer-api.ts`** and **`DialerPage`** for legacy rows. Enterprise RPCs already excluded both spellings.

- **2026-04-14 | [DONE] Fix profile loading race — skeleton shimmer replaces FOFC fallbacks**
  *What:* On hard refresh, `profile` was `null` for ~300–800ms while `fetchProfile` resolved in `AuthContext`, causing avatar buttons and name fields to flash `"??"` / `"Guest"` before snapping to real data. Created `src/components/ui/ProfileSkeleton.tsx` with three exports: `AvatarSkeleton` (circle for sm/md, rounded-2xl for lg), `NameSkeleton` (~80px pill), and `RoleSkeleton` (~60px pill) — all Tailwind `animate-pulse bg-muted`. Applied `isLoading || !profile` guards to three components: `TopBar.tsx` (avatar button + dropdown name/email block), `Sidebar.tsx` (bottom-bar avatar + name), and `AgentProfile.tsx` (hero card avatar + name + role row). Auth fetch logic, Supabase queries, RLS, and dialer code untouched. `tsc --noEmit` clean. *No schema changes.*

  ### Context Snapshot — Profile Loading Race Fix (2026-04-14)

  | Piece | Detail |
  | :--- | :--- |
  | **New file** | `src/components/ui/ProfileSkeleton.tsx` — `AvatarSkeleton` (sm/md/lg), `NameSkeleton`, `RoleSkeleton` |
  | **Skeleton guard pattern** | `isLoading \|\| !profile` — covers both the `isLoading=true` window AND the brief race where `INITIAL_SESSION` fires before `fetchProfile` resolves |
  | **TopBar.tsx** | Avatar button → `<AvatarSkeleton size="sm" />` while loading; dropdown name/email → `<NameSkeleton>` pair while loading |
  | **Sidebar.tsx** | Bottom-bar avatar + name → skeleton pair while loading |
  | **AgentProfile.tsx** | Hero card avatar → `<AvatarSkeleton size="lg" />`, name/role → `<NameSkeleton>` + `<RoleSkeleton>` while loading |
  | **Not touched** | AuthContext fetch logic, `fetchProfile`, `setIsLoading` calls, Supabase queries, RLS, dialer code, data-heavy pages |
  | **tsc** | Clean (no errors) |
  | **Branch** | `claude/fix-profile-loading-race-1k4f4` |

- **2026-04-14 | [DONE] Fix useEffect onCall dependency — double Telnyx init bug**
  *What:* The `open` useEffect in `FloatingDialer.tsx` had `onCall` in its dependency array so that `telnyxDestroy()` could be guarded on close. This caused `telnyxInitialize()` to fire a second time whenever a call started, double-registering the Telnyx WebRTC client and breaking SIP registration. Fix: extracted a `onCallRef = useRef(false)` + a one-liner sync effect (`useEffect(() => { onCallRef.current = onCall; }, [onCall])`) so the `open` effect can read the current call state without `onCall` as a dependency. The `open` effect now only has `[open, telnyxInitialize, telnyxDestroy]` in its dep array, guaranteeing `telnyxInitialize()` fires exactly once per open toggle. The `dialer-call-state-change` dispatch effect is untouched. `tsc --noEmit` clean. *No schema changes.*

  ### Context Snapshot — Fix useEffect onCall dependency (2026-04-14)

  | Piece | Detail |
  | :--- | :--- |
  | **Root cause** | `onCall` was in the `open` useEffect dep array; any call-state change re-ran the effect and re-called `telnyxInitialize()` mid-call |
  | **Fix — new ref** | `const onCallRef = useRef(false)` declared alongside the `onCall` state (line 168) |
  | **Fix — sync effect** | `useEffect(() => { onCallRef.current = onCall; }, [onCall])` — keeps ref current without adding `onCall` to the open effect |
  | **Fix — open effect deps** | Changed from `[open, telnyxInitialize, telnyxDestroy, onCall]` → `[open, telnyxInitialize, telnyxDestroy]` |
  | **Guard preserved** | `if (!onCallRef.current) telnyxDestroy()` in the `else` branch — identical semantics, zero double-init risk |
  | **dialer-call-state-change** | Separate `useEffect([onCall])` untouched |
  | **tsc** | Clean (no errors) |
  | **Branch** | `claude/fix-useeffect-oncall-dependency-xj6IT` |

- **2026-04-14 | [DONE] Floating dialer minimize button + TopBar live-call indicator**
  *What:* Added a minimize button (Minus icon) to the FloatingDialer panel header, left of the existing close (X) button. When clicked, the full panel collapses to a 240px compact strip showing the contact name (or "Dialer"), a pulsing green dot and call timer when `onCall` is true, a ChevronUp restore button, and a close button — all while keeping the panel mounted in the DOM so the Telnyx WebRTC client and call state are fully preserved. Added `destroyClient: telnyxDestroy` to the `useTelnyx()` destructure and updated the open/close `useEffect` to only destroy the Telnyx client on panel close when not mid-call (`if (!onCall) telnyxDestroy()`). Added a `useEffect` that dispatches `dialer-call-state-change` (CustomEvent with `{ onCall }`) on every `onCall` state change. Added a `useEffect` that resets `minimized` to `false` whenever `open` becomes false. In TopBar, added `dialerOnCall` state, a `useEffect` that listens to `dialer-call-state-change`, and conditional button rendering: when `dialerOnCall` is true the button switches to `bg-red-500`, uses `PhoneCall` with `animate-pulse`, shows "On Call", and adds an absolute `bg-green-400 animate-ping` dot; when false it reverts to the original `bg-green-500 / Phone / "Dialer"` style. No React Context, Zustand store, or Supabase changes. `tsc --noEmit` clean. *No schema changes.*

  ### Context Snapshot — Dialer Minimize Button & TopBar Live-Call Indicator (2026-04-14)

  | Piece | Detail |
  | :--- | :--- |
  | **New state — `FloatingDialer`** | `minimized: boolean` (init `false`) — controls whether compact strip or full panel is rendered |
  | **New state — `TopBar`** | `dialerOnCall: boolean` (init `false`) — mirrors FloatingDialer's `onCall` via window event |
  | **Event fired** | `window.dispatchEvent(new CustomEvent('dialer-call-state-change', { detail: { onCall } }))` — fired from FloatingDialer on every `onCall` change |
  | **Event consumed** | TopBar `useEffect` adds/removes `dialer-call-state-change` listener; sets `dialerOnCall` from `detail.onCall` |
  | **Minimize button** | `Minus` icon, `w-7 h-7 rounded-md` style, left of close X in panel header; sets `minimized(true)`, does NOT close panel |
  | **Minimized strip** | `w-[240px]` panel, `px-3 py-2`, draggable; shows pulsing green dot + contact name / "Dialer" + call timer when on a call; ChevronUp restores, X closes |
  | **Close guard** | `useEffect([open])` resets `minimized → false` whenever panel closes; `useEffect([open, onCall])` calls `telnyxDestroy()` on close only when `!onCall` |
  | **TopBar Dialer button — idle** | `bg-green-500 hover:bg-green-600`, `Phone` icon, "Dialer" label, no dot |
  | **TopBar Dialer button — on call** | `bg-red-500 hover:bg-red-600`, `PhoneCall animate-pulse` icon, "On Call" label, absolute `bg-green-400 animate-ping` dot |
  | **What's next** | Voicemail drop button wiring; per-agent inbound SIP credential lookup; `dial_sessions` telemetry integration |
  | **tsc** | Clean (no errors) |
  | **Branch** | `claude/add-dialer-minimize-button-mUX6B` |

- **2026-04-13 | [DONE] Remove per-DID cooldown from caller ID selection**
  *What:* Deleted the 10-second `CALLER_ID_COOLDOWN_MS` cooldown gate from `isEligibleStrict` in `src/lib/caller-id-selection.ts`. Daily cap + LRU rotation are sufficient to prevent rapid-fire same-number dialing; the hard cooldown was unnecessarily restrictive. Removed `pastCooldown()` helper, `cooldownMs` field from `SelectCallerIdInput`, and replaced the constant with a comment. Updated `TelnyxContext.tsx` to drop the `CALLER_ID_COOLDOWN_MS` import and `cooldownMs` pass-through (keeping `didLastUsedAtRef` stamp intact for LRU ordering). Replaced stale cooldown-specific tests in `caller-id-selection.test.ts` with daily-cap tests. `tsc --noEmit` clean. *No schema changes.*

  ### Context Snapshot — Remove per-DID cooldown (2026-04-13)

  | Piece | Detail |
  | :--- | :--- |
  | **Primary file** | `src/lib/caller-id-selection.ts` — constant, `pastCooldown()`, `SelectCallerIdInput.cooldownMs`, `isEligibleStrict` signature + body |
  | **Context file** | `src/contexts/TelnyxContext.tsx` — `CALLER_ID_COOLDOWN_MS` import removed; `cooldownMs:` line removed from `selectOutboundCallerId` input; `didLastUsedAtRef` comment updated |
  | **Test file** | `src/lib/caller-id-selection.test.ts` — `CALLER_ID_COOLDOWN_MS` import removed; `cooldownMs` in `input()` helper removed; two cooldown tests replaced with two daily-cap tests |
  | **Removed** | `CALLER_ID_COOLDOWN_MS` constant; `pastCooldown()` function; `SelectCallerIdInput.cooldownMs`; cooldown guard in `isEligibleStrict` |
  | **Preserved** | `didLastUsedAtRef` stamp in `getSmartCallerId` (LRU ordering); `sortLru`; daily cap via `underDailyCap`; all selection tiers intact |
  | **Replacement comment** | `// Cooldown removed — daily cap + LRU handles rotation` where constant was |
  | **tsc** | Clean (no errors) |
  | **Branch** | `claude/remove-caller-id-cooldown-uesDU` |

- **2026-04-13 | [DONE] Remove spam_status filtering from caller ID selection — local presence unblocked**
  *What:* `selectOutboundCallerId` in `src/lib/caller-id-selection.ts` was silently blocking all local presence matching because `isEligibleStrict` and `isEligibleFallback` both gated on `isFlagged()` (checking `spam_status === "Flagged"`). Since no org numbers have `spam_status = "Clean"`, every DID was treated as ineligible for exact-area-code and same-state tiers. Fix: removed `isFlagged` helper, `spam_status` field from `CallerIdPhoneRow`, and all spam filter branches from `isEligibleStrict` (now: daily cap + cooldown only) and `isEligibleFallback` (now: unconditionally `true`). Hard fallback comment updated. TODO comment left in `isEligibleStrict` for future re-enable. Removed orphaned `spam_status: "Clean"` from `basePhone()` test helper. `tsc --noEmit` clean. *No schema changes.*

  ### Context Snapshot — Remove spam_status filtering (2026-04-13)

  | Piece | Detail |
  | :--- | :--- |
  | **Primary file** | `src/lib/caller-id-selection.ts` — `CallerIdPhoneRow` interface, `isFlagged` fn, `isEligibleStrict`, `isEligibleFallback`, hard-fallback comment |
  | **Test file** | `src/lib/caller-id-selection.test.ts` line 17 — `spam_status: "Clean"` removed from `basePhone()` literal (excess-property TypeScript error) |
  | **Removed** | `spam_status?: string | null` from `CallerIdPhoneRow`; `isFlagged()` helper; `if (isFlagged(p)) return false` guard in `isEligibleStrict`; `return !isFlagged(p)` in `isEligibleFallback`; "still skip flagged" from hard fallback comment |
  | **Preserved** | Daily cap (`underDailyCap`) + cooldown (`pastCooldown`) enforcement in `isEligibleStrict`; full tier order: sticky → exact area code → same-state → org default → any strict → hard fallback |
  | **TODO** | `// TODO: re-enable spam_status filtering once reputation system is fully configured` — placed above `isEligibleStrict` |
  | **Why not TelnyxContext** | `availableNumbers` typed as `any[]` — removing `spam_status` from interface has no TypeScript impact there |
  | **Why not FloatingDialer** | Accesses `.spam_status` on `any` element — no TypeScript impact |
  | **tsc** | Clean (no errors) |
  | **Branch** | `claude/remove-spam-filtering-7U0Hi` |

- **2026-04-13 | [DONE] Verify `getSmartCallerId` sticky threshold — no code changes required**
  *What:* Audited `src/contexts/TelnyxContext.tsx` (`getSmartCallerId`) against the reported bug: "inline step 2 query returns early for any prior call with `duration > 0`, bypassing `selectOutboundCallerId` entirely." The inline check (`callerIdByContactRef` cache + bare `SELECT caller_id_used` without a duration filter) was present in the pre-LRU code but was **fully removed** in commit `66dda73` ("feat(dialer): rotate caller ID with LRU, cooldown, daily cap RPC"). Current implementation is correct: (1) manual override → return; (2) delegate to `selectOutboundCallerId` with `contactId` passed through; (3) stamp `didLastUsedAtRef`. The ≥30s threshold lives exclusively in `caller-id-selection.ts` line 132 (`sticky.duration_sec >= input.stickyMinDurationSec`). `tsc --noEmit` clean. *No TypeScript changes.*

  ### Context Snapshot — `getSmartCallerId` sticky threshold (2026-04-13)

  | Piece | Detail |
  | :--- | :--- |
  | **File** | `src/contexts/TelnyxContext.tsx` — `getSmartCallerId` (lines 1561–1609) |
  | **Inline check removed** | `callerIdByContactRef` session-cache + bare `SELECT caller_id_used` (no duration) — deleted in `66dda73` |
  | **Current flow** | Step 1: `if (selectedCallerNumber)` → stamp + return. Step 2: `selectOutboundCallerId(...)` with `contactId: contactId ?? null`. Step 3: `stamp(chosen)` |
  | **Sticky threshold** | `caller-id-selection.ts:132` — `sticky.duration_sec >= input.stickyMinDurationSec` (30s). Only location in codebase |
  | **`queryStickyOutboundCaller`** | `TelnyxContext.tsx:1539` — data provider injected into `selectOutboundCallerId`; fetches `caller_id_used + duration`, returns `duration_sec`. Makes no threshold decision itself |
  | **`tsc --noEmit`** | Clean — no errors |

- **2026-04-13 | [DONE] Seed `area_code_mapping` — same-state caller ID fallback activated**
  *What:* `area_code_mapping` table was empty; same-state tier in `selectOutboundCallerId` (`src/lib/caller-id-selection.ts:150`) was completely skipped. Migration **`20260413200000_seed_area_code_mapping.sql`** adds a `UNIQUE (area_code)` constraint then inserts **324 US NANP area codes** across 51 jurisdictions (50 states + DC) using full state names (e.g. `"California"`) matching `getStateByAreaCode`'s return format. `supabase/seed.sql` created so fresh `supabase db reset` environments get the data automatically. Migration applied to prod `jncvvsvckxhqgqvkppmj`; verified: 51 states in table, California = 34 area codes. *No TypeScript changes.*

  ### Context Snapshot — area_code_mapping seed (2026-04-13)

  | Piece | Detail |
  | :--- | :--- |
  | **Migration** | `supabase/migrations/20260413200000_seed_area_code_mapping.sql` — UNIQUE constraint + 324-row INSERT |
  | **Seed file** | `supabase/seed.sql` (created fresh) — same INSERT block under `-- area_code_mapping seed (US area codes)` header |
  | **`area_code_mapping` schema** | `id` (uuid PK), `area_code` (text, now UNIQUE), `state` (text), `city` (text, NULL), `timezone` (text, NULL), `created_at` (timestamptz) |
  | **Lookup path** | `getStateByAreaCode` (`caller-id-selection.ts:183`) → `.from('area_code_mapping').select('state').eq('area_code', areaCode).maybeSingle()` — returns full state name |
  | **Same-state tier** | `selectOutboundCallerId` lines 150–163: looks up `leadState` for destination AC, then checks each DID's AC for matching state; picks LRU among matches |
  | **Coverage** | 324 codes, California 34 (≥ 25 ✓), Texas 28, Florida 19, New York 19 |
  | **Idempotent** | `ON CONFLICT (area_code) DO NOTHING` — safe to re-run |

- **2026-04-13 | [DONE] Retire `caller-id-selector.ts` — dead code removal**
  *What:* `getStateByAreaCode` moved verbatim from `src/lib/caller-id-selector.ts` into `src/lib/caller-id-selection.ts` (now the single caller-ID module). `supabase` client import added to `caller-id-selection.ts`. Import in `TelnyxContext.tsx` (line 28) updated from `@/lib/caller-id-selector` → `@/lib/caller-id-selection`. `src/lib/caller-id-selector.ts` deleted — zero remaining callers. `tsc --noEmit` clean. *No logic changes.*

  ### Context Snapshot — Caller ID Module (2026-04-13)

  | Piece | Role |
  | :--- | :--- |
  | **`src/lib/caller-id-selection.ts`** | Single authoritative module. Exports: constants (`CALLER_ID_COOLDOWN_MS`, `CALLER_ID_STICKY_MIN_DURATION_SEC`, `DEFAULT_DAILY_CALL_LIMIT`), interfaces (`CallerIdPhoneRow`, `SelectCallerIdInput`, `CallerIdSelectionDeps`), helpers (`isEligibleStrict`, `isEligibleFallback`, `extractDestinationAreaCode`), algorithm (`selectOutboundCallerId`), and DB lookup (`getStateByAreaCode`). |
  | **`src/lib/caller-id-selector.ts`** | **Deleted.** Was the pre-LRU legacy module; `selectCallerID` had no callers at time of deletion. |
  | **`TelnyxContext.tsx` — `getSmartCallerId`** | Delegates to `selectOutboundCallerId` from `caller-id-selection`; passes `getStateByAreaCode` (now also from `caller-id-selection`) as an injected dep. |
  | **`FloatingDialer.tsx`** | Imports `CALLER_ID_STICKY_MIN_DURATION_SEC` from `caller-id-selection` only. No changes needed. |

- **2026-04-17 | [DONE] Supabase migration history aligned + `db push` restored**
  *What:* **`supabase migration repair --status reverted`** on **23** remote-only version IDs (dashboard/hosted names not present in repo). **`migration repair --status applied`** for **`20260405100000`–`20260414120000`** so history matches schema already on **`jncvvsvckxhqgqvkppmj`**. **`supabase db push --yes`** then applied **`20260417000000`** and **`20260417120000`**. *Caution:* if prod schema ever drifted from those files, re-verify with **`migration list`** and spot-check critical objects (e.g. **`dialer_lead_locks`**).

- **2026-04-17 | [DONE] Settings — Carriers (logo + labeled phones & emails)**
  *What:* Migration **`20260417120000`** adds **`logo_url`**, **`contact_phones`**, and **`contact_emails`** on **`carriers`**. **`Carriers.tsx`** — upload or paste logo URL; dynamic **Add phone** / **Add email** rows with labels (e.g. new business, contracting); list shows logo thumbnail and **`tel:`** / **`mailto:`** links. Helpers: **`carrierContactUtils.ts`**, **`CarrierContactsEditor.tsx`**. Types updated in **`src/integrations/supabase/types.ts`**.

- **2026-04-17 | [DONE] Settings — User Management: Team hierarchy tab**
  *What:* **`UserManagement.tsx`** — third tab **Team hierarchy** embeds **`HierarchyTree`**. **`HierarchyTree.tsx`** — read-only **top-down org visualization** (gradient node cards, connector lines, glass-style panel); loads from **`profiles.upline_id`** + **`avatar_url`** on nodes; **TopBar** header button and profile menu header show **`profiles.avatar_url`** when set (else initials). Responsive three-column **`TabsList`** (**Team Members** / **Pending Invites** / **Team hierarchy**).

- **2026-04-17 | [DONE] Team hierarchy — tree build hardening**
  *What:* **`buildProfileOrgForest`** in **`src/lib/profile-org-tree.ts`** — dedupe rows by **`id`**, skip **self-`upline_id`**, and treat **cyclic upline chains** as extra top-level cards (avoids infinite React recursion and “missing” users when data is inconsistent). **`HierarchyTree`** — no stuck spinner when **`organization_id`** is briefly unset; member count uses **unique ids**; note when **multiple roots** or **duplicate rows**. Vitest: **`profile-org-tree.test.ts`**.

- **2026-04-17 | [DONE] Team hierarchy — Christopher / middle manager missing**
  *Cause:* **`HierarchyTree`** used **`.eq("organization_id", jwtOrg)`** while **User Management** uses **`usersApi.getAll()`** (RLS only). Anyone with **`organization_id` NULL** or not equal to the JWT org (still visible to super admin or legacy data) was **dropped** by the SQL filter, so their downline became a disconnected root. *Fix:* load **`profiles`** like **`getAll`** (**`.neq('Deleted')`**, no org equality filter), then **`profilesForOrgTree`**: seed rows whose **`organization_id`** matches the current org, expand **down** the upline graph (add reports of anyone already included), then **up** (add managers). Tree + counts use **`displayProfiles`**.

- **2026-04-17 | [DONE] Team hierarchy — connector line contrast**
  *What:* **`HierarchyTree.tsx`** — org chart stems and rails use **stronger primary** strokes (**`w-0.5` / `h-0.5`**, higher opacity gradients, light ring on the horizontal bar) so reporting lines read clearly on white backgrounds.

- **2026-04-17 | [DONE] Team hierarchy — connector layout (clip + misalignment)**
  *What:* Replaced **CSS grid + percentage** T-junction with an **overlay SVG** sized to the **child row** (`inline-flex` + `absolute inset-0`) so forks span the real column width; **overflow-visible** on tree wrappers and extra bottom padding on the panel so strokes are not cut off.

- **2026-04-17 | [DONE] Edge Function — `spam-check-cron`**
  *What:* Service-role cron-style function recalculates **`phone_numbers`** spam / carrier reputation fields from **`calls`** (7d / 30d). **`supabase/config.toml`** — **`verify_jwt = false`** for scheduled invocations. Deploy with **`supabase functions deploy spam-check-cron`** when ready to wire pg_cron or external scheduler.

- **2026-04-14 | [DONE] Settings — Dispositions Manager (locked rows + Appointment Set + No Answer/DNC edit)**
  *What:* **`DispositionsManager.tsx`** — (1) **Reorder:** every disposition row is draggable (including `is_locked`); grip handle no longer dimmed for locked rows. (2) **Appointment Set:** modal treats **Appointment Set** as fully editable (name, color, required notes, callback / appointment schedulers, automation) while other locked rows still use the restricted form (rename + those sections hidden). (3) **No Answer / DNC:** edit control is disabled with a tooltip; delete remains blocked for all locked rows.

- **2026-04-13 | [DONE] Outbound caller ID — rotation, sticky (≥30s talk), cooldown, daily cap**
  *What:* **`src/lib/caller-id-selection.ts`** — area-code → same-state (**`area_code_mapping`**) → default → any, with **LRU** among eligible DIDs, **10s cooldown** per number, **sticky** only when last outbound to the contact had **`duration ≥ 30`**. **`TelnyxContext`** — loads **`daily_call_count` / `daily_call_limit`**, org **local presence** from **`phone_settings.api_secret`**, passes campaign **`local_presence_enabled`** from **`DialerPage`**. After **`newCall`** succeeds, **`increment_phone_number_daily_usage`** (migration **`20260414120000`**) bumps count with **UTC day reset** via **`limit_reset_at`**. **`FloatingDialer`** uses the same **`getSmartCallerId`** path (no duplicate sticky); flagged-number warning uses **≥30s** prior call. Vitest: **`caller-id-selection.test.ts`**. *Next:* Apply migration on Supabase; optional cron to refresh **`phone_numbers`** counts from server truth if clients get stale.

- **2026-04-13 | [DONE] Dashboard — Calls Made & talk time outbound-only**
  *Issue:* **Calls Made** and **talk time** counted every **`calls`** row (including **inbound**), so stats looked inflated vs real power-dialer activity. *Fix:* **`OUTBOUND_CALL_DIRECTIONS`** + **`isCallsRowOutboundDirection`** in **`telnyxInboundCaller.ts`**. **`useDashboardStats`** — count + duration queries filter **`direction` ∈ `outbound` / `outgoing`**. **`DashboardDetailModal`** **calls_today** list matches. **`GoalProgressWidget`** fallback queries aligned. Vitest for **`isCallsRowOutboundDirection`**. No UI hint on the stat card (per Chris).

- **2026-04-13 | [DONE] Inbound CID still blank — PSTN row vs WebRTC leg Telnyx ids**
  *Cause:* **`telnyx-webhook`** stores **`call_control_id` / `call_session_id`** from the **PSTN inbound** leg. The browser SDK reports ids for the **bridged SIP / WebRTC** leg — they often **never match**, so **`peek_inbound_call_identity`** returned **null**, **`incomingCallerNumber`** stayed empty after DID strip, and the UI showed only **“Incoming call”**. *Fix:* Migration **`20260413250000`** — peek RPC **fallback**: latest org inbound with **`status = 'ringing'`** in the last **6 minutes** when strict id match fails. **`inbound-call-claim`** — same-window lookup with **prefix-normalized** control id match, or **exactly one** recent ringing row (single-call org). *Deploy:* migration applied + **`inbound-call-claim`** deployed to **`jncvvsvckxhqgqvkppmj`**.

- **2026-04-13 | [DONE] Inbound ring — “Incoming call” + wrong “Calling From” row**
  *Cause:* **`peek_inbound_call_identity`** burned poll attempts while **`telnyx_call_control_id`** was not set yet, so the RPC often never ran. **`applyInboundAni` / reconcile / Realtime** required **`direction === 'inbound'`** and exact **`call_control_id`** match, so legacy **`incoming`** rows and **`v3:`** SDK ids were ignored. **`InboundCallIdentity`** hid the phone row when the headline was the generic **“Incoming call”** even if digits existed. The idle dialer block (**“Calling From”** + keypad) still rendered during ring (**`onCall`** false), so the UI showed **your outbound line** (agency DID) under Answer/Decline. *Fix:* **`telnyxInboundCaller`** — **`isCallsRowInboundDirection`**, **`telnyxCallControlIdsEqual`**. **`TelnyxContext`** — peek ticks only after sid/cc exist; Realtime control match uses prefix-tolerant equality; hydrate queries **`.in('direction', ['inbound','incoming'])`** and **`peek_inbound_call_identity`** fallback when direct control id misses. **`InboundCallIdentity`** — show monospace phone when headline is generic and ≥10 digits. **`FloatingDialer`** — hide **Calling From** / search / keypad while **`callState === 'incoming'`**. **`buildInboundCallerLines`** — **`displayPhone`** fallback when a human headline exists. Vitest: **`telnyxCallControlIdsEqual`**, **`isCallsRowInboundDirection`**.

- **2026-04-13 | [DONE] Inbound ring headline — no “Unknown Caller”; phone-only + peek id match**
  *Cause:* After stripping the agency DID, **`buildInboundCallerLines`** still fell through to **“Unknown Caller”** when **`calls`** ANI had not landed yet, and **`InboundCallIdentity`** forced the same label even when a formatted number was available. **`peek_inbound_call_identity`** could miss the row when the SDK **`call_control_id`** used a **`v3:`** prefix but **`calls.telnyx_call_control_id`** did not (or the reverse). *Fix:* **`inboundCallerDisplay`** — ignore garbage labels (**`Outbound Call`**, **`Unknown`**, etc.) on CRM/Telnyx name slots; empty string fallback instead of **Unknown Caller**. **`InboundCallIdentity`** — headline is **name** (CRM + webhook) or **formatted phone** or **“Incoming call”**; second line shows the number only when the headline is a real name (avoids duplicate). **`IncomingCallModal`** aligned with **`useInboundCallerDisplayLines`** + **`InboundCallIdentity`**. *Migration:* repo files **`20260413220000`**, **`20260413230000`**, **`20260413240000`**. *Production:* applied to Supabase project **`jncvvsvckxhqgqvkppmj`** (2026-04-13) as hosted versions **`resolve_inbound_caller_phone_variants`**, **`peek_inbound_call_identity`**, **`peek_inbound_call_identity_control_id_flex`** (timestamps **`20260413170006`**, **`20260413170013`**, **`20260413170021`**).

- **2026-04-13 | [DONE] Incoming ring — “Unknown Caller” + CRM when `calls` had ANI only**
  *Cause:* **`reconcileIdentifiedContactFromCallsRow`** returned early when **`contact_id`** was null, so **`caller_id_used`** from the webhook never populated **`identifiedContact`**. The CRM **`useEffect`** required **`incomingCallerNumber`**, which stayed empty after stripping the agency DID. Realtime only ran reconcile when **`contact_id` / `contact_name`** changed, not when **`caller_id_used`** landed. *Fix:* Reconcile always applies PSTN from the row when not an org DID; Realtime calls reconcile on **ANI** updates; CRM RPC also uses **`identifiedContact.number`**; **`buildInboundCallerLines`** uses **`formatPhoneNumber`** for the headline when there is no name. **`isInboundNameSameAsPhoneNumber`** moved to **`telnyxInboundCaller.ts`**. *Migration:* **`20260413220000_resolve_inbound_caller_phone_variants.sql`** — RPC also matches stored phones as exact **`1` + last10** or **10-digit** forms.

- **2026-04-13 | [DONE] Incoming ring — WebRTC showed agency DID instead of PSTN caller**
  *Cause:* On inbound browser legs Telnyx often puts **your Telnyx DID** in **`remoteCallerNumber` / `remoteCallerName`**. The first SDK notifications sometimes ran **before** **`phone_numbers`** finished loading, so the org-DID exclude set was empty and the UI treated the DID as the customer. *Fix:* **`stripIfOrgOwnedPhoneLabel`** strips any label whose last-10 matches an org-owned DID (used on ANI + display names, skipping **`Outbound Call`**-style **`callerName`**). **`extractIncomingCallerDisplay`** applies it; a **`useEffect`** re-runs extraction when **`inboundCallerExcludeOrg`** gains the DID so state clears and **`calls.caller_id_used`** + CRM can fill **909…** and the contact name. **`buildInboundCallerLines`** also strips DID from **`incomingCallerNumber`**, WebRTC raw, and **`identifiedContact.number`** when building Floating Dialer lines.

- **2026-04-13 | [DONE] Incoming ring — CRM name not shown when webhook/Telnyx duplicated ANI as “name”**
  *Cause:* **`InboundCallIdentity`** preferred **`identifiedContact.name`** over **`fallbackName`**. The **`calls`** row / Telnyx often set **`contact_name`** / display name to the same digit string as the caller ID, so the headline showed the raw number and **`crmContactName`** (from **`resolve_inbound_caller_display_name`**) never appeared. *Fix:* **`isInboundNameSameAsPhoneNumber`** in **`inboundCallerDisplay.ts`** — treat digit-only / same-last-10 “names” as non-names so **`buildInboundCallerLines`** and **`InboundCallIdentity`** fall through to CRM + real fallbacks; phone stays on the second line.

- **2026-04-13 | [DONE] Floating Dialer — inbound caller ID always shows a phone line**
  *Cause:* **`incomingCallerNumber`** was sometimes set to the literal **"Unknown caller"** when the SDK had no digits yet; active inbound **`callDisplayName`** fell through to empty **`dialedNumber`**; **`InboundCallIdentity`** hid the number row when falsy. *Fix:* **`TelnyxContext`** stores **`""`** when ANI is unknown (no placeholder in the phone field). **`extractWebrtcInboundRemoteNumber`** reads the live WebRTC leg (**`resolveInboundCallerRawNumber`** + **`call.remote`** / **`options.remoteCallerIdNumber`**), excluding org DIDs. **`buildInboundCallerLines`** (**`inboundCallerDisplay.ts`**) merges **`identifiedContact`**, CRM / Telnyx display name, sanitized **`incomingCallerNumber`**, and WebRTC for headline + phone; headline never uses **"Connecting…"**; final title fallback **"Unknown Caller"**. **`InboundCallIdentity`** always renders a monospace phone row (**"—"** only if no digits anywhere). **Floating Dialer** passes **`currentCall`** into that pipeline for **incoming** and **active inbound**.

### Context snapshot (inbound CID display — Floating Dialer — 2026-04-13)

| Input | Use |
| :--- | :--- |
| **`identifiedContact`** | Webhook / Realtime **`calls`** row (name, number, type). |
| **`crmContactName` / `telnyxUsefulCallerName`** | Extra display-name sources before raw digits. |
| **`incomingCallerNumber`** | Context ANI (normalized from **`calls`** when possible); never the string **"Unknown caller"**. |
| **`currentCall` (WebRTC)** | **`extractWebrtcInboundRemoteNumber`** for immediate remote digits on ring/active inbound. |
| **UI** | **`InboundCallIdentity`**: bold headline (name or formatted phone) + phone subtitle only when the headline is a person’s name (not duplicate digits). |

- **2026-04-13 | [DONE] Inbound caller ID — Realtime + UI polish (`identifiedContact.type`, phase labels)**
  *What:* **`IdentifiedContact`** now includes optional **`type`** (from **`calls.contact_type`**). **`reconcileIdentifiedContactFromCallsRow`** sets display from **`contact_name` + phone** when the webhook fills name without **`contact_id`**; still org-checks every row. Realtime on **`calls`** (`organization_id=eq…`) runs identity reconcile on **INSERT/UPDATE** when **`contact_id`** or non-empty **`contact_name`**, after **`applyInboundAniFromCallsRow`**, still matching **Telnyx session/control id** + agent. **`hangUp`** clears **`identifiedContact`** immediately; **`clearIncomingDisplay`** also resets **`lastCallDirection`**. **`lastCallDirection`** state (mirrors inbound notification / outbound **`makeCall`**) drives **Floating Dialer** labels via **`DialerCallPhaseLabel`**: **Calling…** while dialing, **Inbound call** vs **Outbound call** when active; **`callDisplayName`** prefers **`identifiedContact.name`** for active inbound. **`InboundCallIdentity`** shows a small **type** line when present.

### Context snapshot (Telnyx inbound CID — 2026-04-13)

| Piece | Role |
| :--- | :--- |
| **`calls` row** | Webhook writes **`caller_id_used`**, **`contact_id`**, **`contact_name`**, **`contact_type`**, **`contact_phone`**; Realtime publication on **`public.calls`**. |
| **`TelnyxContext`** | Channel filter **`organization_id=eq.{org}`**; handler matches inbound leg (**`telnyx_call_id`** / **`telnyx_call_control_id`**) + **`agent_id`** or unassigned ring; **`identifiedContact`** + **`lastCallDirection`**; reset on hangup / clear. |
| **`FloatingDialer` + `InboundCallIdentity`** | Phase label + CRM name priority on active inbound; optional **lead/client** type chip. |

- **2026-04-13 | [DONE] Inbound ring — show PSTN caller (not agency DID)**
  *Cause:* WebRTC often sets **`remoteCallerNumber`** / **`remoteCallerName`** to **your Telnyx DID**; **`identifiedContact`** / hydrate only ran when **`contact_id`** was set, so **`caller_id_used`** (webhook **`payload.from`**) never corrected the UI. *Fix:* **`applyInboundAniFromCallsRow`** applies **`calls.caller_id_used` / `contact_phone`** when the SDK number is an org DID or differs; Realtime fires without requiring **`contact_id`**; hydrate **polls ~500ms / 4.5s**, prefers **`telnyx_call_id`** then control id; **`resolveInboundCallerRawNumber`** prefers **non–org-DID** candidates when multiple exist.

- **2026-04-13 | [DONE] Inbound dialer — CRM name + number from `calls.contact_id`**
  *What:* **`telnyx-webhook`** `handleCallInitiated` — for **inbound**, org-scoped lookup on **`payload.from`** (**`leads`** then **`clients`**, E.164 + last-10 **`ilike`**), writes **`contact_id`**, **`contact_name`**, **`contact_type`**, **`contact_phone`** on the **`calls`** row. **`TelnyxContext`** — **`identifiedContact`** state, **Realtime** on **`calls`** (`organization_id=eq…`, then match **`agent_id`** or unassigned inbound + Telnyx session/control id), hydrate **`useEffect`** for ring/active inbound, reset on **`clearIncomingDisplay`** / offline drop. **`FloatingDialer`** + **`InboundCallIdentity`** — show name + number prominently on **incoming** and **active**. *Migration:* **`20260413190000_calls_realtime_publication.sql`** adds **`calls`** to **`supabase_realtime`** when missing. *Deploy:* run migration; **`supabase functions deploy telnyx-webhook`**.

- **2026-04-13 | [DONE] Contacts — Source column matches Add Lead modal**
  *Cause:* The Lead Source dropdown could show one option while React state still held a default (e.g. **Facebook Ads**) that was not in the org’s **Settings → Lead sources** list, or state could be out of sync with the visible selection—so **`lead_source`** was omitted or wrong and the **Source** column looked empty or incorrect. *Fix:* **`AddLeadModal`** — sync **`leadSource`** to the loaded list for new leads, resolve the value on submit, and support legacy sources when editing; **`Contacts.tsx`** **`handleAddLead`** — fallback to **`allLeadSources[0]`** or **Other** and ensure **status** defaults to **New**.

- **2026-04-13 | [DONE] Inbound modal showed agency Telnyx DID instead of customer**
  *Cause:* On inbound WebRTC, **`call.options.callerNumber`** is usually **your** SIP / caller-ID leg, not the PSTN customer. It was used as an ANI candidate and as UI fallback. *Fix:* **`resolveInboundCallerRawNumber`** never uses **`callerNumber`**; fallback is **`remoteCallerNumber` only**. **`buildOrgDidLast10Set`** excludes org **`phone_numbers`** and default/selected caller ID. **`calls` row** overlay for CRM skips values whose last-10 matches an org DID.

- **2026-04-13 | [DONE] Inbound CID vs CRM formatting + authoritative `calls` row**
  *Cause:* CRM shows **`(809) 775-6963`** but stores digits (or `1` + 10 digits); matching already uses **last 10 digits**, so formatting is not the blocker. The WebRTC SDK often shows a **different digit string** than Telnyx **`call.initiated`** writes to **`calls.caller_id_used`**, so CRM lookup used the wrong ANI. *Fix:* After **`inbound-call-claim`**, read **`calls.caller_id_used` / `contact_phone`** and prefer that for **`resolve_inbound_caller_display_name`**; refresh **`incomingCallerNumber`** when it differs. **`resolveInboundCallerRawNumber()`** scans **`call.options`** + notification envelope for the best 10–15 digit candidate. **`normalizePhoneNumber()`** before RPC. Migration **`20260413183000`** — RPC also checks **`campaign_leads`** (queue row phone/name) between leads and clients. *Deploy:* migration applied to **`jncvvsvckxhqgqvkppmj`**; front-end on **`main`**.

- **2026-04-12 | [DONE] Inbound lead name — org-scoped RPC (RLS bypass for CID only)**
  *Cause:* Client **`leads`/`clients`** reads respect **hierarchical RLS** (agent only sees assigned rows), so inbound CID queries returned **no row** even when the lead existed in the same agency. *Fix:* Migration **`20260412210000_resolve_inbound_caller_display_name.sql`** — **`resolve_inbound_caller_display_name(p_caller_phone)`** (**`SECURITY DEFINER`**) matches **last 10 digits** in caller’s **`get_org_id()`** org (**`leads`** first, then **`clients`**); returns **display name text only**. **`TelnyxContext`** calls **`.rpc()`** instead of direct selects. *Deploy:* **Applied** to Supabase project **`jncvvsvckxhqgqvkppmj`** (AGENTFLOW CRM), 2026-04-12 — app on latest **`main`** should show inbound names after refresh.

- **2026-04-12 | [DONE] Inbound UX — single popup, ringtone path, CRM on dialer**
  *What:* Removed **`IncomingCallModal`** from **`AppLayout`** (left **`FloatingDialer`** as the only incoming UI). **`startIncomingRingtone`** no longer returns early when audio was not primed — it always calls **`play()`** and runs **`primeIncomingCallAudio()`** in parallel (fixes “silent first ring”). **`FloatingDialer`** — **`primeIncomingCallAudio`** when opening via TopBar toggle or quick-call; shows **`crmContactName`** and treats Telnyx **`remoteCallerName`** equal to the number as not a real name. **`TelnyxContext`** CRM match — **`.in("phone", variants)`** (E.164, raw digits, `+1` + last-10, `1` + last-10, last-10) before **`ilike`** fuzzy. *Note:* RLS still limits **`leads`/`clients`** to assigned agent (or upline/admin); unassigned or another agent’s lead will not resolve a name.

- **2026-04-12 | [DONE] Inbound modal + CRM name — strict pass**
  *Modal:* Bottom-right card, **no** **`DialogPrimitive.Overlay`**, **`modal={false}`**, slide from bottom (**no** zoom). *CRM:* **`crmContactName`** from **`leads`** (exact **`phone`** = E.164 then **`ilike '%last10%'`**), then **`clients`** same pattern; reset when not **`incoming`**. *UI:* **`displayName`** = CRM → Telnyx name → **"Unknown Caller"**; CRM hits use **`text-xl`**.

- **2026-04-12 | [DONE] Inbound alerts — tab-focused suppresses OS notification + inline ring WAV**
  *What:* **`TelnyxContext`** calls **`showIncomingDesktopNotification`** only when **`document.hidden`** (other tab / minimized); **`startIncomingRingtone()`** always runs. **`incomingCallAlerts`** uses **`data:audio/wav;base64,...`** from **`incomingRingWavBase64.ts`** (dual-tone clip, **`loop = true`**); **`play()`** rejection logs **`Autoplay blocked:`** then Web Audio fallback. Removed unused **`public/sounds/incoming-ring.wav`**.

- **2026-04-12 | [DONE] Inbound UI — corner card, CRM name, WAV ringtone**
  *What:* **`IncomingCallModal`** — removed full-screen overlay; **`modal={false}`**; card **`bottom-6 right-6`**, **`w-96`**, **`max-w-[calc(100vw-2rem)]`**, slide-in from bottom. **`TelnyxContext`** — **`crmContactName`** from **`public.leads`** (match **`phone`** E.164 then **`ilike` last-10-digits**), cleared when not **`incoming`**. **`incomingCallAlerts`** — looping **`HTMLAudioElement`** on **`/sounds/incoming-ring.wav`** with **`play().catch`** → Web Audio cadence fallback.

- **2026-04-12 | [DONE] WebRTC mic — explicit AEC/NS/AGC + 48 kHz mono**
  *What:* Replaced **`getUserMedia({ audio: true })`** with a **`MediaStreamConstraints`** object (**`echoCancellation`**, **`noiseSuppression`**, **`autoGainControl`**, **`sampleRate: 48000`**, **`channelCount: 1`**) in **`TelnyxContext.tsx`** (answer, initialize warm-up, outbound **`makeCall`**) and **`src/lib/telnyx.ts`** (**`initTelnyx`** permission prompt). Browsers may ignore unsupported keys.

- **2026-04-12 | [DONE] Inbound Answer — non-blocking claim + stop retries on 401/403**
  *Symptoms:* **Answer** felt frozen while **`claimInboundCall`** retried. *Fix:* **`answerIncomingCall`** fires **`void (async () => { await claimInboundCall(...) })()`** so **`call.answer()`** runs immediately; claim still updates **`activeCallIdRef`** when it completes. **`claimInboundCall`** returns **`null`** on **400 / 401 / 403** (no further retries on auth/forbidden).

- **2026-04-12 | [DONE] Inbound claim — stop refreshSession spam in retry loop**
  *Symptoms:* UI freeze / unexpected logout during inbound while **`claimInboundCall`** retried (~18×). *Cause:* Each iteration called **`supabase.auth.refreshSession()`**, hammering Auth’s refresh endpoint. *Fix:* Use **`getSession()`** inside the loop (read cached session + JWT for **`inbound-call-claim`**); leave other **`refreshSession()`** usages (e.g. hang up / outbound) unchanged.

- **2026-04-12 | [DONE] Inbound — no auto-answer before WebRTC Dial**
  *What:* Removed **`telnyxAnswerInboundLeg`** and its use in **`mvpBridgeInboundToWebRtcSip`** so the PSTN leg is **not** answered by the webhook immediately; callers keep normal ringback until the agent answers in the browser ( **`bridge_on_answer`** still links legs). *Risk:* Telnyx may require Answer before some Call Control actions — monitor **`telnyx-webhook`** logs if WebRTC leg stops ringing. *Deploy:* **`telnyx-webhook`**.

- **2026-04-12 | [DONE] Inbound bridge — Call Control App first on Dial**
  *What:* **`mvpBridgeInboundToWebRtcSip`** in **`telnyx-webhook`** now tries **`call_control_connection_id`** before **`credential_connection_id`** so **`POST /v2/calls`** avoids Telnyx **422 / 10015** (credential UUID is not a valid Call Control App id for that field). **`scratch/test_webrtc_ring.ts`** simplified to a single Dial using **`call_control_app_id`** for live browser ring tests. *Deployed:* **`supabase functions deploy telnyx-webhook`** to **`jncvvsvckxhqgqvkppmj`** (2026-04-12).

- **2026-04-12 | [DONE] Scratch diagnostic — `POST /v2/calls` connection id type**
  *What:* Added **`scratch/test_webrtc_ring.ts`** (Supabase read + Telnyx Dial). *Finding:* Using **`telnyx_settings.connection_id`** (WebRTC **Credential** UUID) in JSON **`connection_id`** returns **422** / Telnyx **`10015`** (“Invalid value for connection_id (Call Control App ID)”). Using **`call_control_app_id`** in that same JSON field returns **200** with a **`call_control_id`**. *Note:* **`telnyx-webhook`** already tries credential then app id in a loop; first attempt may always log a 422 before the second succeeds. Local `.env` uses **`SUPABASE_SERVICE_ROLE_KEY`** (script falls back if **`VITE_SUPABASE_SERVICE_ROLE_KEY`** is unset).

- **2026-04-12 | [DONE] Inbound — no Answer UI + endless ring: SDK states + webhook public key**
  *Symptoms:* PSTN kept ringing; **no Answer** in browser (especially after adding **`TELNYX_PUBLIC_KEY`**). *Causes:* (1) WebRTC **`telnyx.notification`** can use inbound states (e.g. **`parked`**) not listed in **`resolveTelnyxNotificationBranch`** → branch **`other`** → no **`incoming`** UI. (2) **`TELNYX_PUBLIC_KEY`** wrong format / verification fail → webhook returns 200 but **does not run** **`mvpBridgeInboundToWebRtcSip`** → no WebRTC leg. *Fix:* **`resolveTelnyxNotificationBranch`** — any **`inbound`/`incoming`** before **`active`**/`ended` → **`incoming`**. **`telnyx-webhook`** — decode public key as **64 hex** or **base32-ish base64 (32 bytes)**; trim / strip colons; tolerate header casing; if key **unparseable**, skip verify (loud log) so bridge is not bricked; **redeploy `telnyx-webhook`**.

- **2026-04-12 | [DONE] Inbound basic rollout — Edge redeploy + telnyx-token activity bump**
  *What:* Redeployed **`telnyx-webhook`**, **`inbound-call-claim`**, and **`telnyx-token`** to Supabase project **`jncvvsvckxhqgqvkppmj`**. **`telnyx-token`** now bumps **`profiles.updated_at`** on every successful WebRTC token response (not only when **`sip_username`** changes) so **`resolveInboundWebRtcSipTarget`** prefers whoever **last opened the dialer** in multi-agent orgs. *Chris (ops):* Telnyx voice webhook → your **`telnyx-webhook`** URL; set **`TELNYX_PUBLIC_KEY`** in Edge secrets; **`telnyx_settings.connection_id`** = WebRTC **Credential Connection** UUID (same as Phone Settings); inbound DID on the **Call Control** app that fires the webhook; confirm migration **`20260412140000_calls_rls_inbound_unassigned_visible`** applied; **`phone_numbers`** row for the agency DID; test with one agent, dialer open, mic + alerts enabled.

- **2026-04-12 | [DONE] Inbound — dial correct WebRTC SIP user + dual connection Dial**
  *Symptoms:* PSTN picked up once then silence; **no incoming UI** in browser. *Cause:* With **multiple `profiles.sip_username`** (or stale data), bridge dialed **`telnyx_settings.sip_username`** instead of the agent’s **telephony credential** (`gencred…`) from **`telnyx-token`** — INVITE never hit the logged-in browser. *Fix:* **`resolveInboundWebRtcSipTarget`** — order profiles by **`updated_at`**, prefer **settings hint** if it matches one credential, else **most recently updated** profile; clear logs. **`telnyxDialBridgeToSipUri`** returns success flag; try **`connection_id` then `call_control_app_id`**. **`telnyx-token`** sets **`updated_at`** when saving **`sip_username`** so “active agent” resolution works. *Deploy:* **`telnyx-webhook`** + **`telnyx-token`**.

- **2026-04-12 | [DONE] Production deploy — inbound fixes live**
  *Supabase (`jncvvsvckxhqgqvkppmj`):* **`telnyx-webhook`** redeployed via **`supabase functions deploy telnyx-webhook`** (includes **`connection_id`-first** WebRTC dial). *Vercel:* **`vercel deploy --prod`** — production alias **`https://agentflow-life-insure.vercel.app`** (includes **`enableMicrophone`**, **`incoming`/`inbound` direction**, **`localStream`** answer path, ringtone interval).

- **2026-04-12 | [DONE] Inbound silent audio — webhook used wrong `connection_id` for WebRTC dial**
  *Telnyx docs / architecture:* The browser registers to a **Credential SIP Connection** (`connection_id`). **`POST /v2/calls`** to `sip:{user}@sip.telnyx.com` must use **that** connection UUID. We previously preferred **`call_control_app_id`**, which can bridge as “answered” with **no RTP**. *Fix:* **`getTelnyxSipBridgeSettings`** now uses **`connection_id` first**, then app id fallback + warning. *Ops:* **`telnyx_settings.connection_id`** must match the connection **`telnyx-token`** uses (same as Phone Settings). *Client:* **`enableMicrophone()`** on **`telnyx.ready`** and before **`answer()`** per Telnyx “make a call to a web browser” guide.

- **2026-04-12 | [DONE] Inbound answer — bind microphone + late remote audio**
  *Symptoms:* Call “connected” but **silent** (no agent audio to caller / no caller audio in browser). *Cause:* `getUserMedia` ran before **`call.answer()`** but **`call.options.localStream`** was never set; Telnyx’s **`Call.answer()`** builds the Peer from **`this.options`**, so signaling could complete without a proper mic leg. Also stop the **eager warm-up** mic stream so only one capture is active. *Follow-up:* after **`answer()`**, **`attachRemoteAudio`** + **`unmuteAudio`**, and a one-time **`RTCPeerConnection` `track`** listener (30s) for bridged legs where remote media arrives after `active`.

- **2026-04-12 | [DONE] Inbound — Telnyx SDK uses `direction: "incoming"` (not `inbound`)**
  *Symptoms:* PSTN rang once then silence; **no incoming UI** in the browser. *Cause:* WebRTC `telnyx.notification` often sets **`call.direction === "incoming"`** while AgentFlow only treated **`inbound`**. Branch resolver fell through to **outbound ringback** (`dialing`); **`answerIncomingCall`** exited early; **inbound-call-claim** never ran from the notification path. *Fix:* **`isTelnyxSdkInboundDirection()`** in **`telnyxNotificationBranch.ts`** (`inbound` **or** `incoming`); applied in **`resolveTelnyxNotificationBranch`**, **`telnyx.ts`** pub/sub, **`TelnyxContext`**, **`DialerPage`**. Tests extended for **`incoming` + ringing/trying**.

- **2026-04-12 | [DONE] Inbound ringtone — repeat cadence fix**
  *Issue:* Custom ring played **once** then stopped. *Cause:* Next burst was scheduled **inside** `AudioContext.resume().then(...)`; after silence the context often **suspends**, and some environments never chained the next `setTimeout`. *Fix:* **`setInterval`** every **6s** + **`resume().then(play, play)`** so timing does not depend on the resume promise to schedule the following ring.

- **2026-04-12 | [DONE] Inbound Phase 0–1 — verify path + desktop alerts & ringtone**
  *Phase 0 (ops):* Confirm prod has migrations through **`20260412140000_calls_rls_inbound_unassigned_visible`**, Edge **`telnyx-webhook`** + **`inbound-call-claim`** deployed, Telnyx voice webhook → **`telnyx-webhook`**, agency DID on the same Call Control app as **`telnyx_settings`**, and **one** org profile with **`sip_username`** matching the browser credential (or bridge falls back to settings — see work log below). *Phase 1 (app):* **`incomingCallAlerts`** — `Notification` + repeating **440/480 Hz** ring (after click-to-enable), prefs in **`localStorage`**, audio primed flag in **`sessionStorage`**. **FloatingDialer** banner + **IncomingCallModal** button; **`TelnyxContext`** fires alerts on transition to **`callState === "incoming"`**. Tests: **`src/lib/incomingCallAlerts.test.ts`**.

- **2026-04-12 | [DONE] Inbound never rang browser — Answer before Dial (Telnyx API prerequisite)**
  *Diagnosis:* Inbound **`calls`** rows kept appearing (**`originator_cancel`**, **`agent_id` NULL**) — PSTN hit the webhook but the **WebRTC leg never rang**. Telnyx Call Control docs: **“You must issue [Answer] before executing subsequent commands on an incoming call.”** We were only **`POST /v2/calls` (Dial)** with **`link_to`** + **`bridge_on_answer`** on a still-**unanswered** inbound leg, so the bridge/SIP leg likely never completed. *Fix:* **`telnyxAnswerInboundLeg`** — **`POST /v2/calls/{id}/actions/answer`** then Dial to **`sip:{profile.sip_username}@sip.telnyx.com`**. Caller may hear silence/hold until the agent answers the WebRTC leg (**`bridge_on_answer`**). *Deploy:* **`telnyx-webhook`** to **`jncvvsvckxhqgqvkppmj`**.

- **2026-04-12 | [DONE] Inbound Answer UI not visible**
  *Cause:* **`IncomingCallModal`** used shadcn **Dialog** at **`z-50`** while **FloatingDialer** is **`z-[1000]`** and **FloatingChat** up to **`z-[10000]`** — modal rendered **under** floating UI. **FloatingDialer** also required **`!onCall`** for Answer/Decline; **`onCall`** could flip **true** early, hiding buttons. *Fix:* Incoming modal via **Radix primitives** at **`z-[10100]` / `z-[10101]`**; on **`callState === "incoming"`** force **`setOnCall(false)`** and show ring UI **without** `!onCall`; **`telnyxNotificationBranch`** adds **`recovering`**; **TelnyxContext** handles **`branch === "incoming"`** before **`active`**.

- **2026-04-12 | [DONE] Inbound calls invisible in UI (RLS + Recent query)**
  *Cause:* Webhook creates **`calls.agent_id` NULL** until answer/claim. **`Calls Hierarchical Access`** only allowed **`agent_id = auth.uid()`** for agents, so PostgREST returned **zero rows** for unclaimed inbound. **FloatingDialer → Recent** also used **`.eq("agent_id", user.id)`**, excluding those calls even if RLS had allowed them. *Fix:* Migration **`20260412140000_calls_rls_inbound_unassigned_visible.sql`** adds a **USING** branch: same org, **`direction = 'inbound'`**, **`agent_id IS NULL`** (WITH CHECK unchanged). **FloatingDialer** Recent query uses **`.or(own agent, unclaimed org inbound)`**. *Apply migration on any env not yet patched* (prod applied via Supabase MCP for `jncvvsvckxhqgqvkppmj`).

- **2026-04-12 | [DONE] Hotfix — inbound bridge rang wrong SIP (no AgentFlow popup)**
  *Diagnosis:* `telnyx-webhook` logged **`call.initiated` / `call.hangup`** and **`calls`** rows for **`+19097756963` → agency DID** (`+19098345211`), but **`agent_id` stayed NULL** and **`hangup_details: originator_cancel`** — caller waited then hung up. Edge logs showed **`telnyx-webhook` 200s**; DB proved the PSTN leg worked. Root cause: MVP bridge dialed **`sip:{telnyx_settings.sip_username}@sip.telnyx.com`** while the browser registers **`profiles.sip_username`** (different Telnyx credential). *Fix:* If exactly **one** profile in the org has **`sip_username`**, dial that user; if several, fall back to settings + log **TODO** (DID→agent). **`POST /v2/calls`** now prefers **`call_control_app_id`** over credential **`connection_id`**. *Deployed:* `telnyx-webhook` to **`jncvvsvckxhqgqvkppmj`**.

- **2026-04-12 | [DONE] MVP inbound WebRTC “Hello World” (notification pub/sub + modal + webhook Dial bridge)**
  *What:* **`src/lib/telnyx.ts`** — `wireTelnyxIncomingNotifications()` listens for **`telnyx.notification`** and **`notification`**, fans out inbound ringing to **`subscribeIncomingCall()`**; **`initTelnyx()`** wires the same. **`TelnyxContext`** calls `wireTelnyxIncomingNotifications(client)` so the live app gets subscribers without a second SDK path. **`IncomingCallModal`** in **`AppLayout`**: Answer (**`answerIncomingCall`**) / Reject (**`rejectIncomingCall`** or SDK **`reject`** if present). **`telnyx-webhook` `handleCallInitiated`:** for **inbound**, **`POST https://api.telnyx.com/v2/calls`** (Telnyx Call Control Dial) with **`link_to`** = inbound `call_control_id`, **`bridge_on_answer`**, **`to`** = `sip:{sip_username}@sip.telnyx.com` from **`telnyx_settings`** (org then global fallback); **`TODO`** for per-agent SIP. *Deploy:* **`telnyx-webhook`** deployed to project **`jncvvsvckxhqgqvkppmj`** via `npx supabase functions deploy telnyx-webhook` (2026-04-12).

- **2026-04-12 | [DONE] Inbound calls visible in app — full stack (RLS + claim + webhook + DB)**
  *Diagnosis:* Agents only pass **`calls` RLS** when **`agent_id = auth.uid()`**. Inbound rows are created by **`telnyx-webhook`** with **`agent_id` NULL** until **`inbound-call-claim`** runs. Calls “disappeared” when: (1) **claim raced** the webhook (few retries, row not inserted yet); (2) **Telnyx** sometimes sends **`direction: incoming`** while claim queried **`direction = inbound`** only; (3) **SDK vs webhook ID mismatch** — claim matched only **`telnyx_call_control_id`**; **`telnyx_call_id`** (session) is a stable fallback.
  *Fix:* **`telnyx-webhook`:** `normalizeStoredCallDirection()` → always store **`inbound`/`outbound`**; **`handleCallHangup`:** fallback update by **`telnyx_call_id`** when control id misses. **`inbound-call-claim`:** accept **`telnyx_call_id`** optional body; find row by control id **or** session id; match **`direction IN (inbound, incoming)`** for legacy rows; patch **`telnyx_call_control_id`** when claiming via session. **`TelnyxContext`:** claim on ring with **control and/or session id**; **~18 retries** with backoff (~2–15s total) for webhook lag; **answer** path passes session id too. **Migration `20260412120000_normalize_calls_direction_labels`:** backfill **`incoming`→`inbound`**, **`outgoing`→`outbound`**. *Apply migration on Supabase (prod)* after deploy. *Functions deployed:* `telnyx-webhook`, `inbound-call-claim`.

- **2026-04-11 | [DONE] Calls missing in UI — org filter, webhook org + `started_at`, Recent sort**
  *Cause:* (1) **`getLeadHistory`** used `.eq("organization_id", …)` so rows with **NULL** `organization_id` (common when Telnyx `connection_id` did not match `telnyx_settings.connection_id` alone) never appeared in the dialer conversation timeline even though RLS allowed them for the agent. (2) **Inbound `call.initiated`** did not set **`started_at`**, so **Floating Dialer → Recent** (previously ordered by `started_at`) and contact call lists behaved poorly. (3) Webhook org lookup only matched **`connection_id`**; many setups send the **Call Control Application** id, which we store as **`call_control_app_id`**.
  *Fix:* **`dialer-api` `getLeadHistory`:** `organization_id.eq.{org} OR organization_id.is.null` for the calls query (activities unchanged). **`telnyx-webhook`:** resolve org via `connection_id` **or** `call_control_app_id`; **fallback** inbound **`payload.to`** → **`phone_numbers.phone_number`**; set **`started_at`** on inbound from `payload.start_time` or now. **`FloatingDialer` Recent:** order by **`created_at`**, display timestamp `started_at ?? created_at`. **`FullScreenContactView`:** conversation calls ordered by **`created_at`**; merge sort key `started_at ?? created_at`. *Deploy:* redeploy **`telnyx-webhook`** after merge.

- **2026-04-11 | [DONE] Inbound PSTN → WebRTC — ring, Floating Dialer popup, answer/decline**
  *What:* Telnyx JS SDK `telnyx.notification` now distinguishes **inbound** `ringing` / `trying` / `early` from outbound ringback (`callState: "incoming"`). **Floating Dialer** auto-opens with **Answer** / **Decline**; **Decline** skips disposition. **`inbound-call-claim`** Edge Function (JWT + service role) sets `calls.agent_id` + `organization_id` by `telnyx_call_control_id` so hierarchical **RLS** allows the agent to read/finalize rows. **`telnyx-webhook` `call.initiated`:** sets `organization_id` from `payload.connection_id` → `telnyx_settings`, and `contact_phone` from `from` on inbound. **DialerPage** skips campaign auto-dispose/wrap-up and **claim timer** for inbound sessions. **Tests:** `src/lib/telnyxNotificationBranch.test.ts`. *Deploy:* add `inbound-call-claim` in Supabase Dashboard; `config.toml` includes `verify_jwt = false`. *Telnyx:* DID must terminate on the same **Credential Connection** as `telnyx_settings.connection_id`.

- **2026-04-11 | [DONE] Post-revert production alignment (Vercel + Supabase + DB rollback)**
  *What:* (1) **Vercel** — `npx vercel deploy --prod` to `agentflow-life-insure` (production alias updated). (2) **Edge Functions** — redeployed `telnyx-webhook` and `recording-proxy` from current `main`; **deleted** `inbound-route` and `telnyx-diagnose` from project `jncvvsvckxhqgqvkppmj`. (3) **`supabase/config.toml`** — `[functions.recording-proxy] verify_jwt = false` so redeploys match prior behavior (function validates JWT internally). (4) **Database** — applied `revert_inbound_calling_system` on production (see migration table). *Follow-up:* In **Telnyx Mission Control**, if any number’s voice webhook still pointed at the removed `inbound-route` URL, point it back to **`telnyx-webhook`** only.

- **2026-04-11 | [DONE] Git revert — inbound calling system removed from `main`**
  *What:* Reset `main` to `5702d0c` (last commit before the multi-phase inbound work) and force-pushed to `origin`, then a small docs commit. Outbound WebRTC dialer and prior features at that snapshot are restored in the repo.

- **2026-04-10 | [DONE] Phone settings — bulk AgentFlow routing on Telnyx (API)**
  *What:* `telnyx-sync-numbers` can `PATCH` every number on the account to **AgentFlow Call Control** + **AgentFlow** messaging profile (same IDs as `telnyx-buy-number`). Optional body `apply_agentflow_routing` runs during CRM sync; `routing_only: true` updates Telnyx only (no DB upsert). UI: checkbox on sync + **Apply AgentFlow on Telnyx** button. *Files:* `supabase/functions/telnyx-sync-numbers/index.ts`, `src/components/settings/PhoneSettings.tsx`

- **2026-04-10 | [DONE] Settings — Telnyx number purchase false “failure” toast**
  *Cause:* (1) `handlePurchase` treated any error after a successful Edge response as “Purchase failed,” including refresh issues, and bundled `fetchData()` into the same `try/catch`. (2) `telnyx-buy-number` used E.164 as a fallback Telnyx resource id, so voice `PATCH` often failed after the order had already succeeded; voice errors aborted the whole flow. (3) Duplicate DB rows surfaced as a hard database error after a successful Telnyx buy. *Fix:* Poll `GET /number_orders/{id}` and list-by-E.164 for a real resource id; never `PATCH` with `+1…`; voice/SMS `PATCH` failures are warnings, not fatal; org-scoped default-number count; duplicate key for same org returns success with `duplicate: true`; UI splits purchase vs refresh and shows `toast.info` for server `warning`. *Files:* `supabase/functions/telnyx-buy-number/index.ts`, `src/components/settings/PhoneSettings.tsx`

- **2026-04-10 | [DONE] Contact full view — smooth load, compact fields, status color fix**
  *Issues:* (1) Status badge started gray and popped to correct color once pipeline stages loaded. (2) Left column fields rendered choppily with multiple sequential re-renders. (3) Font too large (14px `font-semibold`) — phone numbers and values truncated / cut off. (4) Status dropdown had zero options until pipeline API returned.
  *Fixes:* (1) `getStatusColor` now resolves from `fallbackStatusStyles` immediately (added `Call Back`, `No Answer`, `Left Voicemail`, `Not Available`, `DNC`); uses pipeline stage color only when available. (2) `useLayoutEffect` sets `editForm` from contact prop before paint; all core state updates batched after single `Promise.all`; form-reset states (`editMode`, `errors`, etc.) moved before conversation load. (3) `CopyField` reduced to `text-xs font-medium break-all`; `renderField` inputs `h-8 text-xs`; grid gap `gap-3`; assigned agent field tighter; activity timeline `text-xs`. (4) `availableStatuses` falls back to `allStatuses` / `recruitStatuses` when pipeline stages not yet loaded.
  *File:* `src/components/contacts/FullScreenContactView.tsx`

- **2026-04-10 | [DONE] Contact full view — assigned agent label, stable left column, faster conversations**
  *Follow-up:* Assigned agent showed the **raw UUID** until the full org roster loaded; the left column **re-layed out** when `field_order_*` arrived (empty → saved order); conversation queries ran in the same `Promise.all` as everything else, so a **slow call/message history** blocked notes, activity, and details. **Fix:** (1) **Targeted `profiles` lookup** for `contact.assignedAgentId` in parallel with roster fetch; **merge** that row into `agents`; **immediate name** when the assignee is the signed-in user (`useAuth` profile). (2) **`getAgentDisplayName`** never returns a bare UUID — shows **Loading…** / **Unavailable** with `rosterLoaded`. (3) **Default `fieldOrder`** per type (`getDefaultFieldOrder`) so the dynamic grid is used from the first paint; server order only replaces when non-empty. (4) **Two-phase load:** core data first, then **calls + messages** (descending `limit(300)`, reversed for chronological UI). (5) **Supplemental grid** for `customFields` not listed in `field_order_*` (replaces removed legacy fallback block).
  *File:* `src/components/contacts/FullScreenContactView.tsx`

- **2026-04-10 | [DONE] Contact full view — fix wrong/stale data flash + faster load**
  *Issue:* Header used the `contact` prop while read-mode fields used `editForm`, which was only updated in an async effect — so opening another contact briefly showed the **new** name with the **previous** contact’s fields; notes, activity, campaigns, and messages stayed on the old contact until fetches finished; sequential API calls felt slow; in-flight requests could race when switching contacts quickly; after `fetchData()` the open row was not replaced with the fresh list object.
  *Fix:* (1) **`useLayoutEffect`** on `contact.id` + `type` resets `editForm`, `localStatus`, and clears per-contact lists before paint. (2) **Stable JSON snapshot** sync when the same contact’s data updates from the parent without clobbering edits (avoids re-sync every Dialer render from inline `map()` objects). (3) **`latestContactIdRef` + cancelled flag** so stale async results never call `setState` after switching contacts. (4) **Single `Promise.all`** for notes, activities, pipeline stages, settings, campaigns, phones, profiles, last-call caller ID, and conversation queries. (5) **`key={contact.id}`** on `FullScreenContactView` in Contacts, Dialer, and Calendar so state remounts cleanly per contact. (6) **`fetchData`** re-binds `selectedLead` / `selectedClient` / `selectedRecruit` / `selectedAgent` to the freshly fetched row when the detail panel is open.
  *Files:* `src/components/contacts/FullScreenContactView.tsx`, `src/pages/Contacts.tsx`, `src/pages/DialerPage.tsx`, `src/pages/CalendarPage.tsx`

- **2026-04-09 | [DONE] Fix — dialer campaign picker empty**
  *Cause:* (1) Selecting `dial_delay_seconds` on the campaign list query fails if that column is not migrated yet → no rows. (2) Client-side filter hid all non–Open-Pool campaigns for users not in `assigned_agent_ids` / not `created_by`, so **Admin / Manager / Team Leader** saw campaigns on the Campaigns page (RLS) but not on the dialer. *Fix:* Drop `dial_delay_seconds` from the list `select`; load delay in a separate small query when a campaign is selected (default 2s if missing/error). Elevated roles see every campaign the API returns; agents keep pool + assignment rules. Toast on fetch error. *File:* `src/pages/DialerPage.tsx`

- **2026-04-09 | [DONE] Dialer speed + auto-dial — campaign delay, auth, locks, caller ID cache**
  *What changed:* (1) **`useDialerStateMachine`** uses **`campaigns.dial_delay_seconds`** (clamped 0.5–10s) instead of a fixed 3s wait. (2) **`TelnyxContext.makeCall`** calls **`getSession()`** and only **`refreshSession()`** when the JWT expires within ~2 minutes — removes a full auth round trip on most dials. (3) **Smart caller ID** caches last `caller_id_used` per contact in-memory for the session (cleared when org numbers or manual caller ID changes). (4) **Lock-mode “Save & next”** now uses **`loadLockModeLead`** (same **`get_next_queue_lead`** + enrich path as skip/advance) instead of **`fetch_and_lock_next_lead`** + different UI filters — consistent queue behavior. (5) **`isAdvancing`** cooldown shortened (100ms after lifecycle / lock load). (6) **`releaseAllAgentLocksBeacon`** sends **anon key** in `apikey` and **JWT** in `Authorization` (PostgREST-correct). *Files:* `src/hooks/useDialerStateMachine.ts`, `src/pages/DialerPage.tsx`, `src/contexts/TelnyxContext.tsx`, `src/lib/dialer-queue.ts`

- **2026-04-09 | [DONE] Floating dialer — Telnyx readiness gate + faster warm-up**
  *Issue:* Opening the floating dialer and dialing immediately sometimes failed until refresh — WebRTC/SIP was not fully registered even when the UI looked usable; `makeCall` could also leave the in-call UI active when the SDK never started (`onCall` set without a call id), and `isDialingRef` was set before session/mic checks (stuck lock + silent `!clientRef` exit).
  *Fix:* (1) **`telnyxSipReadyRef`** — set only on `telnyx.ready`, cleared on disconnect/error/init teardown; `makeCall` requires this ref plus `clientRef` and only then acquires the dialing lock. (2) **Reuse shortcut** requires `telnyxSipReadyRef` (not only `client.connected`) so half-open sockets re-run full init. (3) **`initializeInFlightRef`** avoids overlapping inits from eager warm-up + panel open. (4) **Eager `initializeClient`** when `profile` + `organization_id` exist so Telnyx connects in the background before the user opens the floater. (5) **FloatingDialer** disables Call buttons until `isReady`, shows “Starting phone…” / “Wait for Ready” copy, and **`proceedWithCall`** only enters in-call UI when `makeCall` returns an id.
  *Files:* `src/contexts/TelnyxContext.tsx`, `src/components/layout/FloatingDialer.tsx`

- **2026-04-09 | [DONE] RecordingPlayer — download in compact mode + reliable download after fetch**
  *Issue:* Recording Library / timelines use `compact` mode, which had no download control (only full layout did). Download also failed when triggered before React applied `blobUrl` state. **Fix:** `blobUrlRef` mirrors the object URL; `fetchAudio` returns the URL and assigns `<audio src>` immediately; compact UI adds a download icon beside the scrubber, while duration is still loading, and next to “Click to load” (fetch + download in one action). *File:* `src/components/ui/RecordingPlayer.tsx`

- **2026-04-09 | [DONE] Fix — RecordingPlayer scrubber / duration display for WebM**
  *Issue:* Browser-recorded WebM often leaves `<audio>.duration` as `Infinity`, `NaN`, or `0`, so the UI showed `0:35 / 0:00` and the range thumb did not track playback. **Fix:** Decode the blob with `AudioContext.decodeAudioData` after download to get an accurate length; sync from `seekable` on `timeupdate` / `durationchange` / `canplay` as fallback; on `ended`, snap current time to duration; `preload="metadata"`; reset state when `callId` changes; download filename `.webm`. *File:* `src/components/ui/RecordingPlayer.tsx`

- **2026-04-09 | [DONE] Fix — remove SDK call_control_id dependency, lookup via Telnyx API**
  *Root Cause:* WebRTC SDK didn't expose `telnyxCallControlId` for credential-based connections. The frontend guard `if (sdkControlId && ...)` silently prevented `start-call-recording` from ever being invoked. The Recording Library only showed the player when `recording_url` was truthy (always null).
  *Fix:* (1) Frontend now invokes `start-call-recording` with just `call_id` (no SDK ID needed). (2) Edge Function (v2) resolves `call_control_id` via Telnyx `GET /v2/calls?filter[connection_id]=xxx` API, matching by destination phone. (3) Recording Library shows all calls with `duration > 0`, shows `RecordingPlayer` when `telnyx_call_control_id` is set.
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `src/components/settings/CallRecordingLibrary.tsx`, `supabase/functions/start-call-recording/index.ts`
  *Edge Function Redeployed:* `start-call-recording` v2

- **2026-04-09 | [DONE] Fix — recordings never started (webhooks don't fire for WebRTC SDK calls)**
  *Files Created:* `supabase/functions/start-call-recording/index.ts`
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `src/lib/dialer-api.ts`, `src/components/settings/CallRecordingLibrary.tsx`, `src/components/contacts/FullScreenContactView.tsx`, `ROADMAP.md`
  *Edge Function Deployed:* `start-call-recording` (project `jncvvsvckxhqgqvkppmj`, `verify_jwt: false` — function validates JWT internally)
  *Developer Note:* **Root cause:** After switching to one-legged WebRTC SDK `newCall()`, Telnyx Call Control webhooks stopped firing — the Connection type doesn't generate events for SDK-originated calls. Without `call.answered` webhook, `record_start` never ran and `telnyx_call_control_id` stayed null. **Fix:** (1) **`start-call-recording` Edge Function** — when the SDK detects "active" state, `TelnyxContext` reads `telnyxCallControlId` from the call object and POSTs to this function, which: saves `telnyx_call_control_id` to the DB, calls Telnyx `record_start` (mp3, dual, no beep), and marks `recording_url = '__recording_pending__'`. (2) **Recording Library** filter changed from `recording_url IS NOT NULL` to `telnyx_call_control_id IS NOT NULL AND duration > 0` — catches calls where recording was started but URL hasn't arrived yet. (3) **`getLeadHistory`** and **`FullScreenContactView`** now select `telnyx_call_control_id` and use it (along with duration) to decide whether to show `RecordingPlayer`. (4) `recording-proxy` fetches audio from Telnyx API on demand using the `call_control_id`.

- **2026-04-09 | [DONE] Fix — recordings unplayable (expired S3 URLs) + proxy + RecordingPlayer**
  *Files Created:* `supabase/functions/recording-proxy/index.ts`, `src/components/ui/RecordingPlayer.tsx`
  *Files Modified:* `src/components/settings/CallRecordingLibrary.tsx`, `src/components/dialer/ConversationHistory.tsx`, `src/components/contacts/FullScreenContactView.tsx`, `ROADMAP.md`
  *Edge Function Deployed:* `recording-proxy` (project `jncvvsvckxhqgqvkppmj`, `verify_jwt: false` — function performs its own JWT auth)
  *Developer Note:* **Root cause:** Telnyx's `call.recording.saved` webhook delivers **pre-signed S3 URLs** (`X-Amz-Expires=600`) that expire after **10 minutes**. The webhook stored these directly in `calls.recording_url`, so by the time a user opened the Recording Library, Conversation History, or Contact page, the URL was dead and `<audio>` showed 0:00/0:00. **Also:** Contacts page "Play Recording" button was a dead `<button>` with no player or click handler. **Fix:** (1) **`recording-proxy` Edge Function** — authenticates the caller (JWT), looks up the call's `telnyx_call_control_id` + org, fetches a **fresh download URL** from Telnyx's `GET /v2/recordings?filter[call_control_id]=xxx` API, downloads the MP3 binary, and streams it back to the browser. Org-level access check prevents cross-tenant leakage. (2) **`RecordingPlayer` component** — on click, `fetch`es the proxy with `Authorization` header, creates a local `blob:` URL, and renders a custom `<audio>` with play/pause, seek bar, and time display. Supports `compact` mode for inline timelines and full mode for the library. (3) All three views updated: **Recording Library**, **Dialer ConversationHistory**, **FullScreenContactView** (Contacts page).

- **2026-04-09 | [DONE] Fix — conversation history + recordings not showing for some dials**
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `src/lib/dialer-api.ts`, `src/pages/DialerPage.tsx`, `src/components/layout/FloatingDialer.tsx`, `ROADMAP.md`
  *Developer Note:* **(1)** `makeCall` used a **UUID v4-only** regex, so valid Postgres lead IDs (other UUID versions) were rejected and `calls.contact_id` stayed **null** until wrap-up — timeline queries keyed on `contact_id` missed the row and recordings looked “missing.” **Fix:** Accept any standard 8-4-4-4-12 UUID string. **(2)** **`getLeadHistory`** now optionally OR-matches **`campaign_lead_id`** (same row the dialer passes into `makeCall`) so in-flight or legacy rows still appear in the merged timeline. **(3)** **Session history cache** was not invalidated after **auto “No Answer”** save or manual save — UI kept an old timeline. **Fix:** Delete cache key after successful `saveCall` / auto-save; quiet refetch after no-answer save; pass campaign lead id into delayed recording refetches. **(4)** **“Call Anyway”** (flagged caller ID modal) called `proceedWithCall` **without** `contactId` — fixed in **DialerPage** and **FloatingDialer**.

- **2026-04-09 | [DONE] Fix — recordings still missing (DB never linked to Telnyx call leg)**
  *Files Modified:* `supabase/functions/telnyx-webhook/index.ts`, `src/contexts/TelnyxContext.tsx`, `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* **Root cause:** For one-legged WebRTC, `calls.telnyx_call_control_id` often stayed **NULL** when `call.initiated` was late or did not carry `client_state`, so `call.answered` could not find the row → **`record_start` never ran** → no `call.recording.saved` URL. **Fix:** (1) **`call.answered` / `call.hangup` / `call.recording.saved`** fall back to **`client_state`** decoded to our **`calls.id`** (UUID) to link or patch the row. (2) **`TelnyxContext`** reads **`call.telnyxIDs`** and **PATCHes** `calls.telnyx_call_control_id` + `telnyx_call_id` as soon as the SDK exposes them. (3) **`extractRecordingDownloadUrl`** handles **`public_recording_urls`** and nested URL maps. (4) Dialer history quiet-refetch adds **60s**. **`telnyx-webhook`** redeployed.

- **2026-04-09 | [DONE] Fix — recordings missing (settings row vs webhook + stale history UI)**
  *Files Modified:* `src/components/settings/CallRecordingSettings.tsx`, `supabase/functions/telnyx-webhook/index.ts`, `src/lib/dialer-api.ts`, `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* **Root cause A:** Recording Settings UI read/wrote the legacy singleton `phone_settings` row (`id` all zeros) while `telnyx-webhook` checks **`recording_enabled` on the org’s row** (`organization_id`). Toggling recording in Settings never updated the row the webhook uses, so `record_start` never ran. **Fix:** Org-scoped load/save with `onConflict: organization_id` (same pattern as Phone Settings). **Root cause B:** `isRecordingEnabled` required `=== true`; missing org rows meant recording stayed off. **Fix:** Treat missing row as on (matches DB default); only explicit `false` disables. **Root cause C:** `recording_url` is written when Telnyx fires `call.recording.saved`, often **after** wrap-up save — history cache/refetch showed no player. **Fix:** Delayed quiet refetches at 3s / 12s / 35s after save when `telnyxCallDuration > 0`. **`saveCall`:** use `.update()` by `id` instead of `upsert` so Telnyx-populated columns are not risked. **Webhook:** broader recording URL extraction from payload. **`telnyx-webhook`** redeployed. **Action for Chris:** Open **Settings → Recording Settings** once and click **Save** so the org row gets the intended toggle.

- **2026-04-09 | [DONE] Call recordings — hierarchy, library scope, webhook hardening, UI**
  *Files Modified:* `supabase/migrations/20260409120000_hierarchical_calls_rls.sql`, `supabase/functions/telnyx-webhook/index.ts`, `src/components/settings/CallRecordingLibrary.tsx`, `src/lib/dialer-api.ts`, `src/components/dialer/ConversationHistory.tsx`, `ROADMAP.md`
  *Developer Note:* **`calls` RLS** matched the leads model so managers/admins see downline recordings in Conversation History and can update coaching flags; agents still see only their own calls. Policy allows both JWT role strings **`Team Leader`** and **`Team Lead`** (same as `campaign_leads`). **Recording Library** filters `calls` and `dispositions` by current `organization_id` (via `useOrganization`); super-admins without an org still use RLS-only scope. **`telnyx-webhook`:** `call.recording.saved` tries `telnyx_call_control_id` first, then falls back to `telnyx_call_id` = `call_session_id`; hangup activity rows now use `activity_type` (was invalid `type`), plus `organization_id` and `agent_id` for org-scoped history. **`getLeadHistory`** loads disposition colors for call badges; **Conversation History** labels the inline player as “Call recording” and uses `preload="metadata"`. **Shipped (2026-04-09):** Migration `hierarchical_calls_rls` applied on project `jncvvsvckxhqgqvkppmj` (Supabase MCP); activity backfill uses `contact_id = leads.id` (UUID). **`telnyx-webhook`** redeployed via `npx supabase functions deploy`. **Git:** `main` pushed (`4b88350`, `26e1ee8`).

- **2026-04-09 | [DONE] Docs — VISION, agent rules, internal docs: single-leg dialer**
  *Files Modified:* `VISION.md`, `AGENT_RULES.md`, `docs/index.html`, `src/pages/DialerPage.tsx` (ring-timeout comment)
  *Developer Note:* Product copy and AI protocols now describe **single-leg WebRTC** (`newCall` in browser) as canonical. `AGENT_RULES` forbids reintroducing two-legged server dial + SIP bridge flows unless explicitly requested. `docs/index.html` telephony module and sequence diagram updated; stale two-legged comment in `DialerPage` removed.

- **2026-04-09 | [DONE] Architecture — Switch to One-Legged WebRTC Calling (eliminate SIP transfer)**
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `supabase/functions/telnyx-webhook/index.ts`, `supabase/functions/telnyx-token/index.ts`, `ROADMAP.md`
  *Edge Functions Deployed:* `telnyx-webhook` (project `jncvvsvckxhqgqvkppmj`, `verify_jwt: false`), `telnyx-token`
  *Developer Note:* **ROOT CAUSE** of no-audio-on-either-side: the two-legged architecture (REST API outbound call + SIP transfer back to agent WebRTC) required SIP URI Calling on the Connection and exact `sip_username` matching — both of which were broken. The SIP transfer was going to a `sip:{credential_name}@sip.telnyx.com` address that nobody was registered at, so the bridge never formed. With AMD removed, there is no reason for server-side call initiation.
  **Fix — One-legged WebRTC calling:** Replaced the entire call flow. `makeCall()` now uses the `@telnyx/webrtc` SDK's `client.newCall()` to dial the customer directly. Audio flows natively through the WebRTC channel — no SIP transfer, no bridge, no `handleHumanDetected`. The SDK handles all media negotiation (SDP, ICE, SRTP) automatically. `clientState: btoa(callRecord.id)` is passed so Telnyx webhooks (`call.initiated`, `call.answered`, `call.hangup`) still link back to our DB record. The `dialer-start-call` Edge Function is no longer invoked (kept in repo for reference).
  **Removed:** `telnyxTransfer()`, `handleHumanDetected()`, `bridgeAutoAnsweredRef`, auto-answer bridge logic. These were all part of the two-legged approach.
  **Kept:** `handleCallInitiated` (links `call_control_id` to DB), `handleCallAnswered` (updates status + starts recording if enabled), `handleCallHangup` (finalizes DB + activity log), `dialer-hangup` Edge Function (server-side PSTN teardown), ring timeout, call recording, smart caller ID.
  **Hangup detection now works:** With one-legged calling, when the customer hangs up, the WebRTC session itself ends. The SDK fires `telnyx.notification` with `state: "destroy"` and the `RTCPeerConnection` `connectionstatechange` also fires — both trigger `setCallState("ended")`.
  **telnyx-token:** Also fixed credential `sip_username` sync (saves real Telnyx `gencred*` username to profile). This is still needed for future inbound call support.

- **2026-04-09 | [DONE] Dialer — ring timeout vs two-legged answer + bridge auto-answer + dial payload**
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `src/pages/DialerPage.tsx`, `supabase/functions/dialer-start-call/index.ts`, `supabase/config.toml`, `ROADMAP.md`
  *Developer Note:* **Root cause:** `DialerPage` enforced a strict ring timer on `telnyxCallState === "dialing"` even when the PSTN leg was already answered — the webhook sets `calls.status` to `connected` before the agent WebRTC leg reaches `active`, so the UI hung up a live call at 15s. **Fix:** Before strict hangup, read `calls.status`; if `connected`, skip hangup and set `callWasAnswered`. Added optional Realtime subscription on `calls` for the same (requires `calls` in `supabase_realtime` publication to receive events; timeout check works regardless). **TelnyxContext:** Ring-timeout hangup now also skips when the call row is `connected`. Bridge auto-answer runs on `early` as well as `ringing`/`trying`, uses `bridgeAutoAnsweredRef`, and allows `activeCallIdRef` when React state lags. **dialer-start-call:** Removed `answering_machine_detection: 'premium'` to align with AMD removal and reduce answer delay.
  *Production (2026-04-09):* **Edge Function** `dialer-start-call` deployed to project `jncvvsvckxhqgqvkppmj`. **Migration** applied via Supabase MCP as `session_duration_increment_dialer_stats` (same SQL as `20260408010000_session_duration.sql`: `session_duration_seconds` column + `increment_dialer_stats` 8-arg signature + `GRANT` + `NOTIFY pgrst, 'reload schema'`).
  *Hotfix (2026-04-09):* `dialer-start-call` **v59** — set **`verify_jwt: false`** on the function (gateway was returning `401 Invalid JWT` before the handler; auth remains `anonClient.auth.getUser` inside the function, same pattern as `dialer-hangup`). `supabase/config.toml` updated with comment.

- **2026-04-09 | [DONE] Telephony — bidirectional audio (WebRTC + bridge)**
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `supabase/functions/telnyx-webhook/index.ts`, `ROADMAP.md`
  *Developer Note:* Per `@telnyx/webrtc` README, **`client.remoteElement`** must be set so the SDK attaches remote RTP to an `<audio>` element; manual `srcObject` alone is unreliable for bridged calls. **Auto-answer:** refresh `getUserMedia` if tracks are dead, set **`call.options.localStream`** before **`await call.answer()`** so the mic reaches the customer. Log when `active` has no `remoteStream` tracks. **telnyx-webhook:** `telnyxTransfer` sends optional **`from`** (E.164) for the new SIP leg; **`handleHumanDetected`** falls back to DB lookup by **`telnyx_call_control_id`** when `client_state` is missing on `call.answered`. **Deploy:** `telnyx-webhook` redeployed to `jncvvsvckxhqgqvkppmj` (CLI).

- **2026-04-09 | [DONE] Floating dialer — preserve WebRTC client + drag handle only on header**
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `src/components/layout/FloatingDialer.tsx`, `ROADMAP.md`
  *Developer Note:* Opening the floating panel called `initializeClient()`, which always disconnected the existing Telnyx client — dropping the live call object (`callRef`) while the UI still showed in-call, so mute/hold did nothing. Init is now skipped when `client.connected` and the same `organization_id` as last `telnyx.ready` (`telnyxConnectedOrgIdRef`). Floating dialer no longer calls `destroyClient` on panel close (shared client with campaign dialer). Drag listeners moved from the full panel to the header row only; `setPointerCapture` on the header still allows dragging outside the bar.

- **2026-04-09 | [DONE] Remove Answering Machine Detection (AMD)**
  *Files Modified:* `supabase/functions/telnyx-webhook/index.ts`, `supabase/config.toml`, `src/contexts/TelnyxContext.tsx`, `src/pages/DialerPage.tsx`, `src/components/dialer/DialerActions.tsx`, `src/components/dialer/CampaignSettingsModal.tsx`, `src/components/settings/PhoneSettings.tsx`, `src/hooks/useDialerStateMachine.ts`, `ROADMAP.md`
  *Files Removed:* `supabase/functions/telnyx-amd-start/index.ts` (unused; AMD was started inline from webhook)
  *Developer Note:* Outbound `call.answered` now always runs `handleHumanDetected` (SIP bridge + optional recording). Telnyx `call.machine.*` webhooks are logged and ignored so stray connection-level AMD does not double-bridge or auto-hangup. Frontend: removed AMD UI, realtime `calls` subscription, ring-timeout “human confirmed” guard, and campaign/phone settings toggles. Saving calling settings sets `phone_settings.amd_enabled` to `false`. DB columns (`amd_enabled`, `calls.amd_result`, `dialer_daily_stats.amd_skipped`) left in place for history; no migration. **Deploy:** redeploy `telnyx-webhook`. **Telnyx portal:** disable AMD on the Connection/App if it was enabled there.

- **2026-04-09 | [DONE] Feature — Wire Call Recording End-to-End**
  *Files Modified:* `supabase/functions/telnyx-webhook/index.ts`, `src/lib/dialer-api.ts`, `src/pages/DialerPage.tsx`, `src/components/dialer/ConversationHistory.tsx`, `ROADMAP.md`
  *Edge Function Deployed:* `telnyx-webhook` v339 (project `jncvvsvckxhqgqvkppmj`, `verify_jwt: false`)
  *Developer Note:* Wired automatic call recording end-to-end. Added `isRecordingEnabled()` helper and `telnyxRecordStart()` helper to the telnyx-webhook Edge Function. After `handleHumanDetected()` bridges the agent via `telnyxTransfer()`, the webhook now queries `phone_settings.recording_enabled` and issues `POST /v2/calls/{id}/actions/record_start` (mp3, dual channel, no beep) if enabled. Recording failure is wrapped in try/catch — never crashes the call. The existing `handleRecordingSaved()` handler already writes `recording_url` to the `calls` table (no changes needed). On the frontend, `getLeadHistory()` now fetches `recording_url` from the calls table and passes it through the `HistoryItem` interface. `ConversationHistory.tsx` renders an inline `<audio>` player (`preload="none"`) for call items with a recording URL. `CallRecordingLibrary.tsx` already had the correct `.not('recording_url', 'is', null)` filter and audio player column — no changes needed. Verified with `npx tsc --noEmit`.
  *Context Snapshot:* Recording toggle in Settings controls `phone_settings.recording_enabled`. When a human is detected and the agent is bridged, recording starts automatically. Telnyx fires `call.recording.saved` on hangup, which writes the URL to `calls.recording_url`. The Conversation History and Recording Library both surface recordings with inline audio players. Next: test with a live call with `recording_enabled = true`.

- **2026-04-09 | [DONE] Floating dialer — mute/hold, remote hangup, mid-call ring**
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `src/components/layout/FloatingDialer.tsx`, `ROADMAP.md`
  *Developer Note:* Hold button in `FloatingDialer` had no click handler; it now calls `toggleHold` with Resume/Hold UI from `isOnHold`. Mute uses `toggleAudioMute` when available, then `muteAudio`/`unmuteAudio`, then local `MediaStream` track fallback. When the call becomes `active`, the Telnyx SDK’s `stopRingback` / `stopRingtone` run so local ringback does not continue into the conversation. Remote party hang-up is also detected via `RTCPeerConnection` `connectionstatechange` (`failed` / `closed`) when Verto does not emit `destroy`/`hangup` or `-32002`. Fixed stale React `callState` in the Verto notification handler by using `callStateRef` for the bridge auto-answer guard. Hang-up-during-dial race uses `callStateRef` instead of a stale `[]`-closure `callState`. Finalize duration on remote hang-up uses `callDurationRef` for accurate seconds.

- **2026-04-09 | [DONE] Refactor — CreateCampaignModal & TagInput Extraction**
  *Files Created:* `src/components/campaigns/CreateCampaignModal.tsx`, `src/components/shared/TagInput.tsx`
  *Files Modified:* `src/pages/Campaigns.tsx`, `src/pages/CampaignDetail.tsx`, `src/components/contacts/ImportLeadsModal.tsx`, `ROADMAP.md`
  *Developer Note:* Refactored the monolithic `CreateCampaignModal` in `Campaigns.tsx` into a standalone, Zod-validated component. Streamlined the "Personal" campaign creation workflow by auto-assigning the current user and hiding redundant agent selection UI, replaced by a badge. Successfully extracted the inline `TagInput` component into a shared utility, reducing code duplication across `Campaigns.tsx`, `CampaignDetail.tsx`, and `ImportLeadsModal.tsx`. Fixed type errors in `CampaignDetail.tsx` related to missing Supabase RPC definitions for `add_leads_to_campaign`. Used Zod for form validation to ensure data integrity. Total code reduction in `Campaigns.tsx` and `CampaignDetail.tsx` is over 300 lines. Verified with `npx tsc --noEmit`.

- **2026-04-08 | [DONE] Fix Dialer Flickering — End-State Double-Fire + isAdvancing Ref Guard**
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `src/pages/DialerPage.tsx`, `src/components/dialer/DialerActions.tsx`, `ROADMAP.md`
  *Developer Note:* Dialer was flickering between leads on hangup and skip because the call-ended effect fired twice per call end. Root cause: TelnyxContext's `hangUp()` sets `callState("ended")`, then 200ms later resets to `"idle"` via a deferred timeout. When the WebRTC `"destroy"` notification arrived afterward and set `"ended"` again, `hasProcessedEndedState` had already been reset on the `"idle"` transition — so the call-ended effect processed the same hangup a second time, causing a double advance (lead A → B → C flicker).
  **Fix 1 — endStateProcessedRef (TelnyxContext):** Added `endStateProcessedRef` that is set by whichever handler processes the call end first (`hangUp()`, `telnyx.error -32002`, or `telnyx.notification destroy`). Subsequent handlers check the ref and skip re-triggering `setCallState("ended")` and deferred reset timers. Reset at the start of each new `makeCall()`.
  **Fix 2 — hasProcessedEndedState reset on dialing only (DialerPage):** Changed the reset condition from `telnyxCallState !== "ended"` (which fired on every `"idle"` transition) to `telnyxCallState === "dialing"` (only when a genuinely new call begins). Also clears `lastProcessedCallIdRef` in the same guard.
  **Fix 3 — isAdvancingRef (DialerPage):** Replaced stale-closure-prone `isAdvancing` state reads in `handleAdvance`, `handleSkip`, `handleLeadSelect`, and `fetchHistory` with a `useRef`-backed guard (`isAdvancingRef.current`). The ref is always current regardless of callback identity, eliminating the race where a stale closure reads `isAdvancing = false` when it's actually `true`.
  **Fix 4 — Skip button disabled during calls (DialerActions):** Skip button is now `disabled` when `telnyxCallState === "active" || "dialing"`, preventing agents from skipping mid-call.
  **Fix 5 — endResetRef cleanup (TelnyxContext):** All three deferred reset sites (`hangUp`, `telnyx.error`, `telnyx.notification`) now `clearTimeout(endResetRef.current)` before setting a new timeout, preventing overlapping timers from double-firing the idle reset.

- **2026-04-08 | [DONE] Auto-dial — stable next-contact transition (state machine + queue index)**
  *Files Modified:* `src/hooks/useDialerStateMachine.ts`, `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Auto-dial was resetting or firing with the wrong lead because `handleCall` lived in the effect dependency array (identity changes on every `dialerStats` bump), stale `setTimeout` closures read old Telnyx flags, and `isAdvancing` was never passed so timers could arm during queue/URL settling. The hook now uses refs for `onCall` / guards, keys the delay off `leadKey` only, clears or replaces pending timers when the lead changes, validates `leadKey` at fire time, and exposes `autoDialCountdownActive` + `cancelAutoDialCountdown` again. `applyQueueLifecycle` no longer uses `queueMicrotask` for `setCurrentLeadIndex` (one frame could show `leadQueue[i]` with a stale `i`); `pendingLifecycleIndexRef` + `useLayoutEffect` applies the new index before paint. `isAdvancing` clear delay set to ~320ms to cover URL/index sync.

- **2026-04-08 | [DONE] Orphan banner after refresh — silent recovery + hangup DB scoping**
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `supabase/functions/dialer-hangup/index.ts`, `ROADMAP.md`
  *Developer Note:* `dialer-hangup` no longer adds `.eq(organization_id, …)` on the `calls` update (NULL/mismatch could match **zero rows** without surfacing an error, leaving `connected` forever). Update is scoped by `id` + `agent_id`, with `.select('id')` to fail if no row changed. On orphan detection, the app now **silently** calls `dialer-hangup` then a **client RLS fallback** update before showing the orange banner — refresh self-heals ghost rows. `finalizeCallRecord` drops the redundant `organization_id` filter for the same reason.

- **2026-04-08 | [DONE] Hotfix — Orphan-call banner loop + Vercel build (`ended_at`, `getTodayCallCount`)**
  *Files Modified:* `src/lib/dialer-api.ts`, `src/contexts/TelnyxContext.tsx`, `supabase/functions/dialer-hangup/index.ts`, `ROADMAP.md`
  *Developer Note:* The `calls` table column is **`ended_at`** (see generated types). `dialer-hangup` and `finalizeCallRecord` were updating a non-existent **`end_at`** field, so Postgres rejected the update and rows stayed `ringing`/`connected`. The orphan-call detector then kept finding the same row after every hang-up / navigation. Fixed both writers to use `ended_at`; `dialer-hangup` now throws if the DB update fails so we do not return success with a stale row. Restored **`getTodayCallCount`** in `dialer-api.ts` (referenced by `DialerPage` but missing after the history refactor), which unblocked the Vite/Rollup production build on Vercel.

- **2026-04-08 | [DONE] Perf — Faster, smoother dialer conversation history**
  *Files Modified:* `src/lib/dialer-api.ts`, `src/pages/DialerPage.tsx`, `src/components/dialer/ConversationHistory.tsx`, `src/components/dialer/DialerSkeletons.tsx`, `ROADMAP.md`
  *Developer Note:* `getLeadHistory` now selects only columns needed for the timeline, orders + limits at the database (80 per source), and returns the last 100 merged events (smaller payloads). Lead transition drops the 150ms debounce (0ms tick), shows **cached** history immediately when revisiting a lead in the same session, and runs history + assigned-agent profile in **parallel** via `Promise.allSettled` so profile errors do not block history. Conversation list no longer animates every row on paint; skeleton drops the 200ms delay and uses a shorter fade.

- **2026-04-08 | [DONE] Bugfix — Dialer navigation glitch (arrows, queue, save & next vs `?contact=`) (DialerPage.tsx)**
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Two effects fought: (1) URL was not updated from `currentLead` while `isAdvancing` was true (advance/skip/selection), so `?contact=` stayed stale; (2) the contact→index effect listed `currentLeadIndex` in its dependency array, so it re-ran on every arrow/advance and reset the index to the **old** `?contact=` before the URL could update. Fix: always sync `?contact=` from `currentLead` whenever not `loadingLeads` (drop `isAdvancing` gate); drive contact→index only off `contactParam` + `leadQueue` and use a functional `setCurrentLeadIndex` to avoid redundant sets.

- **2026-04-08 | [DONE] Bugfix — Dialer queue clicks ignored when `?contact=` in URL (DialerPage.tsx)**
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* `handleLeadSelect` sets `isAdvancing` for 500ms, which blocked the effect that writes `contact` into the URL. A separate effect still read the **stale** `contact` param and called `setCurrentLeadIndex` to match it — snapping the index back to the old lead. Fix: update `?contact=` immediately inside `handleLeadSelect`, and skip the contact→index effect while `isAdvancing` or `loadingLeads`.

- **2026-04-08 | [DONE] Bugfix — Personal dialer: queue/contact gone + stuck navigation after hangup (DialerPage.tsx)**
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Root causes addressed: (1) `handleAdvance` / `handleSkip` used `Math.min(prev + 1, leadQueue.length - 1)`, which is **-1** when the queue is empty — `currentLeadIndex` became -1, `currentLead` null, and both chevrons stayed disabled until refresh. (2) `applyQueueLifecycle` read a **stale `leadQueue` closure** from the call-ended effect, so auto-disposition could run against an empty array and corrupt queue state. Fix: guard advance/skip when `length <= 0`; rewrite `applyQueueLifecycle` with functional `setLeadQueue` + `queueMicrotask` for index; clamp index in an effect when `leadQueue` changes; move `hasProcessedEndedState.current = true` to after duplicate-call-id early returns so guards cannot strand processing.

- **2026-04-08 | [DONE] Dialer Queue Hardening — 9-Change Build (Personal & Team Campaigns)**
  *Migration:* `20260408000000_add_queue_tier_columns.sql`
  *Files Modified:* `src/pages/DialerPage.tsx`, `src/components/dialer/QueuePanel.tsx`, `src/lib/dialer-api.ts`, `src/hooks/useDialerStateMachine.ts`, `ROADMAP.md`
  *Developer Note:* Comprehensive 9-change hardening pass for the dialer queue system to reach PhoneBurner/Five9 parity.
  **Change 1 — Pin Active Lead at Position 0**: Active lead always renders as a pinned first card with a pulsing "DIALING" badge, visually separated from the remaining queue. Queue count shows "X remaining" instead of "Showing X of Y".
  **Change 2 — Auto-Dial Countdown Animation**: When auto-dial is ON and idle on a new lead, a left-to-right CSS fill animation (primary color, 15% opacity, 3s duration via `clip-path` keyframes) sweeps across the active card during the auto-dial delay. Clicking the card during countdown cancels auto-dial instantly. Exposed `autoDialCountdownActive` and `cancelAutoDialCountdown` from `useDialerStateMachine` through to `QueuePanel`.
  **Change 3 — Hide Past (Dialed) Leads**: Leads with `originalIndex < currentLeadIndex` are filtered out of the display queue entirely. A muted "X dialed" label appears when `currentLeadIndex > 0`. Arrow buttons on the lead card header still allow navigating back.
  **Change 4 — Session Resume 60-Min Staleness Window**: `loadWithResume` now checks `updated_at` from `dialer_queue_state`. If older than 60 minutes, ignores the saved index and starts at `currentLeadIndex = 0` with a toast.
  **Change 5 — Calls Made from Live DB Count**: Added `getTodayCallCount(agentId, campaignId)` to `dialer-api.ts` — runs `SELECT COUNT(*)` from `calls` table filtered by today's UTC date. On session load, this grounds `calls_made` in `dialerStats` and `sessionStats` from reality; subsequent dials still optimistically increment.
  **Change 6 — Skip Persists to campaign_leads**: `handleSkip` now writes `retry_eligible_at = NOW() + retryIntervalHours` and `status = 'Called'` to `campaign_leads` via fire-and-forget `.update()`. Defaults to 24h if `retryIntervalHours` is 0/null. Local `_skipped` flag preserved for instant UI removal.
  **Change 7 — 4-Tier Smart Sort**: Added `'smart'` sort case to `displayQueue` useMemo implementing the 4-tier waterfall (Callback Due → New → Retry Eligible → Pending). Set as default `queueSort` value. Added "Smart Sort" as first option in dropdown, renamed old "Default" to "Queue Order". Migration adds `callback_due_at` and `retry_eligible_at` TIMESTAMPTZ NULL columns + partial indexes to `campaign_leads`.
  **Change 8 — Fix Stale call_attempts**: After `saveCallData()` success, both `handleSaveOnly` and `handleSaveAndNext` now update local `leadQueue` with `call_attempts + 1`, `last_called_at`, and `status`. The `handleSaveAndNext` non-lock path also passes the updated lead to `applyQueueLifecycle` so the re-sort uses fresh data.
  **Change 9 — Always-Visible Attempt Count + Last Disposition**: Every queue card (active and remaining) now renders a fixed bottom row with "X attempt(s)" and "Last Disp: status" (if not Queued/New), styled at 9px muted. This row is independent of the two configurable `queuePreviewFields` slots.
  Zero TypeScript errors. No new npm packages. All Supabase writes include `organization_id` where applicable. Migration file output only — not executed.

- **2026-04-08 | [DONE] Fix: left contact column blank after lead advance**
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* `handleAdvance`, `handleSkip`, and `handleAutoDispose` did not reset `isEditingContact` or `editForm`. When advancing mid-edit, the left contact info column stayed in edit mode but `editForm` was stale/empty for the incoming lead, rendering it blank. Fix: added `setIsEditingContact(false)` and `setEditForm({})` to all three advance handlers. `autoSaveNoAnswer` inherits the fix via its `handleAdvance()` call; `handleMachineDetectedAction` inherits via `handleAutoDispose`/`handleSkip`. No `useEffect` auto-sync for `editForm` exists (intentional — `startEditing()` is the sole initializer), so the on-advance reset is sufficient.

- **2026-04-08 | [DONE] Bugfix — Add setHistoryLeadId(null) to !currentLead branch in serialized fetch effect (DialerPage.tsx)**
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* One-line patch: `setHistoryLeadId(null)` added to the `!currentLead` early-return branch so the guard state is cleared when the queue empties, preventing stale history from flashing on next lead load.

- **2026-04-08 | [DONE] Fix Dialer Flickering — Serialize Fetches, historyLeadId Guard, Instant Scroll**
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Three surgical fixes targeting Supabase auth lock contention and stale-history flash on lead advance:
  **Fix 1 — Serialize Supabase Fetches (eliminates lock contention):** Replaced `Promise.allSettled` parallel execution in the orchestration `useEffect` with sequential `await` — history first, then agent name. Added `setLoadingHistory(true)` at the start of the history fetch so the skeleton appears immediately. On rapid lead changes, the `AbortController` cancels the in-flight history request before the profile fetch even begins, dropping simultaneous Supabase requests from 8+ to 1.
  **Fix 2 — historyLeadId Transition Guard (eliminates stale-history flash):** Added `historyLeadId` state (`useState<string | null>(null)`). Set in the `finally` block of the history fetch so it always clears regardless of success/error. In the JSX, `ConversationHistory` receives `history` only when `historyLeadId === (currentLead?.lead_id || currentLead?.id)` — otherwise an empty array is passed and `loadingHistory` is forced true, showing the skeleton. This prevents the previous lead's history from flashing while the next lead's history loads.
  **Fix 3 — Instant Scroll Anchor (already in place):** `historyEndRef` sentinel is the first child of the `flex-col-reverse` scroll container in `ConversationHistory.tsx`, anchoring to visual bottom. `scrollIntoView({ behavior: 'instant' })` fires via `requestAnimationFrame` on `history.length` or `currentLead` change. No smooth animation that could be mistaken for a render glitch.

- **2026-04-07 | [DONE] Hotfix — Dialer Lead Transition Stabilization & UI Restoration**
  *Files Modified:* `src/pages/DialerPage.tsx`, `src/components/dialer/DialerActions.tsx`, `src/hooks/useDialerStateMachine.ts`, `ROADMAP.md`
  *Developer Note:* Resolved critical UI "glitching" and state-thrashing during lead selection.
  **Pillar 1 — UI Restoration**: Restored missing `Queue` and `Scripts` tabs to the `DialerActions` right-hand panel. Updated the component to conditionally render `QueuePanel` and `Script` list based on the active tab, passing through all necessary state from the parent.
  **Pillar 2 — State Guard (Revolving Door)**: Implemented `isAdvancing` guard in `DialerPage` and `useDialerStateMachine`. Created `handleLeadSelect` to block rapid-fire state updates and prevent real-time database locks from triggering infinite re-render loops.
  **Pillar 3 — Timer Hardening**: Updated the auto-dialer state machine to be more resilient against rapid state changes by improving timer cleanup and post-delay precondition verification.
  **Pillar 4 — Technical Debt Roadmap**: Added a high-priority [TODO] item to decompose the 3,000+ line `DialerPage.tsx` into single-responsibility sub-components.

- **2026-04-07 | [DONE] Dialer Concurrency, Telemetry, State Machine & Bugfix Overhaul**
  *Migration:* `20260407000000_dialer_telemetry_hardening.sql`
  *Files Created:* `src/hooks/useDialerStateMachine.ts`
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `src/pages/DialerPage.tsx`, `src/components/layout/FloatingDialer.tsx`, `src/lib/auto-dialer.ts`, `src/lib/dialer-api.ts`, `ROADMAP.md`
  *Developer Note:* Comprehensive overhaul: 
  **Pillar 1 — WebRTC Concurrency & Auth**: Added `isDialingRef` execution lock to `TelnyxContext.makeCall` preventing rapid-fire call loops. Integrated `refreshSession()` for all Edge Function auth to avoid 401s. Explicit `setCallState("idle")` in cleanup to unblock auto-dial. `callWasAnswered` ref added to gate wrap-up vs. silent auto-disposition on timeout.
  **Pillar 2 — Backend Telemetry Hardening**: Created migration adding graceful fallback to `get_org_id()` (profile lookup when JWT claim is missing). Re-applied `get_enterprise_queue_leads` with `SET search_path = public`.
  **Pillar 3 — Two-Lane State Machine**: Created `useDialerStateMachine` hook formalizing Fast Path (timeout/AMD auto-advance) and Deliberate Path (Save & Next manual disposition). Replaced 63-line scattered `triggerAutoCall` `useEffect` in DialerPage with 14-line hook invocation. 
  **Pillar 4 — Maintenance**: Deprecated `AutoDialer.saveDispositionAndNext` (added warning). Consolidated `FloatingDialer` to use `TelnyxContext.makeCall` directly. Verified: `npx tsc --noEmit` = 0 errors.

- **2026-04-07 | [DONE] Auto-Dialer Stabilization & Circuit Breaker Implementation**
  *Files Created:* `src/lib/CircuitBreaker.ts`
  *Files Modified:* `src/pages/DialerPage.tsx`, `src/contexts/TelnyxContext.tsx`, `src/lib/dialer-api.ts`, `src/hooks/useDialerStateMachine.ts`
  *Developer Note:* Hardened the dialer against infinite loops and network flooding. 
  **Pillar 1 — Circuit Breaker**: Implemented `CircuitBreaker` utility to track rapid-fire call failures (>5 failures in 60s window). Toggles Auto-Dial OFF permanently when tripped to protect Supabase/WebRTC resources.
  **Pillar 2 — Network Throttling**: Integrated `AbortController` into all lead data fetching (history, activities, profile) to cancel stale requests during rapid "Skip" actions.
  **Pillar 3 — Lock Hardening**: Refactored `isDialingRef` in `TelnyxContext` to synchronize exclusively with `callState` (idle/ended), preventing concurrent call initiation race conditions.
  **Pillar 4 — Timing Stabilization**: Increased `AUTO_DIAL_DELAY_MS` to 3000ms and added `isAdvancing` guards to all async fetch/advance paths to ensure atomic lead transitions.

- **2026-04-07 | [DONE] Bugfix — Ring Timeout PSTN Leak + Queue Index Reset + Background Re-sort Disruption**
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `src/pages/DialerPage.tsx`, `src/lib/auto-dialer.ts`, `ROADMAP.md`
  *Developer Note:* (1) Async ring timeout with polling for `call_control_id`. (2) `applyQueueLifecycle` advances to next valid lead instead of resetting to 0. (3) Background re-sort preserves lead queue tail and guards active call state.

- **2026-04-07 | [DONE] Fix Auto-Dial — Telnyx Status Guard + resumeAutoDialer for Team/Open Campaigns**
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`

- **2026-04-07 | [DONE] Fix Dialer Leads Bug — Direct Query Rewrite + Status Filter + maxAttempts Safety**
  *Files Modified:* `src/lib/dialer-api.ts`, `ROADMAP.md`

- **2026-04-06 | [DONE] Campaign & Dialer Technical Architecture — Ultimate Source of Truth**
  *Files Created:* `docs/CAMPAIGN_AND_DIALER_ARCHITECTURE.md`
  *Files Modified:* `ROADMAP.md`
  *Developer Note:* Generated a comprehensive, deep-dive diagnostic document covering the entire campaign lifecycle, selector logic, behavioral settings, RBAC enforcement, and the Enterprise Waterfall Queue. This document serves as the authoritative source of truth for the dialer's technical implementation and state management patterns.

- **2026-04-06 | [DONE] Fix Dialer Queue PostgREST Routing — RPC Signature Realignment**
  *Migration:* `20260406950000_robust_rpc_signature.sql`
  *Files Modified:* `src/lib/dialer-api.ts`, `ROADMAP.md`
  *Developer Note:* Resolved the `Could not find the function ... in the schema cache` error. **Fix 1 — Signature Realignment**: Reordered SQL arguments to `(p_campaign_id, p_limit, p_offset, p_org_id)` to match the observed PostgREST preference in the error log. **Fix 2 — Strict JS Payload**: Modified `dialer-api.ts` to explicitly pass all 4 parameters, using `null` instead of `undefined` for `p_org_id`. This prevents PostgREST from falling back to a 3-argument signature during introspection. **Fix 3 — Overload Cleanup**: Added `DROP FUNCTION IF EXISTS` to the migration to ensure no stale signatures remained in the DB. Force-reloaded the PostgREST cache via `NOTIFY`. Verified with `npx tsc --noEmit`.

- **2026-04-06 | [DONE] Fix Dialer Queue NULL Handling — Fresh Lead Loading Patch**
  *Migration:* `20260406900000_patch_enterprise_rpc_nulls.sql`
  *Files Modified:* `ROADMAP.md`
  *Developer Note:* Resolved a critical bug where fresh/imported leads were not appearing in the dialer queue. **Fix — COALESCE Guards**: SQL comparisons like `call_attempts < max_attempts` fail (return NULL) if either side is NULL, causing Postgres to drop the row in a `WHERE` clause. Added `COALESCE(cl.call_attempts, 0)` and `COALESCE(v_max_att, 9999)` to ensure comparisons evaluate correctly even for first-time dials or unlimited campaigns. Also patched `cl.status` and `cl.state` with fallbacks ('Queued' and 'America/New_York' respectively) to prevent leads with incomplete data from being filtered out of the dashboard.

- **2026-04-06 | [DONE] Fix Dialer Queue Crash — RPC Column Alignment + Error Exposure**
  *Migration:* `20260406800000_fix_enterprise_rpc_columns.sql`
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Resolved a critical queue loading crash. **Fix 1 — RPC Column Alignment**: The `get_enterprise_queue_leads` RPC (v1) was missing the `user_id` column in its `SELECT` statement, violating its `RETURNS SETOF public.campaign_leads` contract and causing PostgREST to fail the associated `.select("*, lead:leads(*)")` join. Fixed by recreating the RPC using `SELECT cl.*` from the base table, ensuring perfect column order and membership matching. **Fix 2 — Error Exposure**: Updated `DialerPage.tsx` catch blocks in `fetchLeadsBatch` and `loadWithResume` to un-swallow PostgREST errors. Added `console.error` and appended `err.message` to the UI toast, enabling faster diagnostics for future schema or permission issues. Verified fix with `npx tsc --noEmit`.

- **2026-04-06 | [DONE] Enterprise Waterfall Queue — DB Refactor + Timezone Compliance + Auto-Dial Fix**
  *Migration:* `20260406700000_enterprise_waterfall_rpc.sql`, `20260406600000_campaign_leads_scheduled_callback.sql`
  *Files Modified:* `src/lib/dialer-api.ts`, `src/pages/DialerPage.tsx`, `src/integrations/supabase/types.ts`, `src/components/dialer/CampaignSettingsModal.tsx`, `ROADMAP.md`
  *Developer Note:* Massive architectural upgrade to the dialer queue. **Fix 1 — Enterprise Waterfall RPC**: Created `get_enterprise_queue_leads` RPC which moves all queue logic (Timezone-aware calling hours, Max Attempts, and Retry Intervals) to the database level. This fixes broken pagination where JS-level filtering caused "empty" batches. The RPC maps US states to IANA timezones and handles the US Daylight Savings transitions natively. **Fix 2 — Zero-Interval Support**: Explicitly bypasses time-checks if `retry_interval_hours` is set to 0, enabling high-velocity immediate retries. **Fix 3 — Auto-Dial Initiation**: Resolved a bug where auto-dial would stall after dispositioning. Added explicit `autoDialer.resumeAutoDialer()` calls to `handleSaveAndNext` and `handleAdvance`. Added detailed console instrumentation to the `triggerAutoCall` reactive trigger to trace initiation blocks. Verified zero TypeScript regressions.

- **2026-04-06 | [DONE] Ring Timeout Enforcement + Call Count UI + Auto-Dial Stall Fix**
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Three targeted fixes. **Fix 1 — Strict Ring Timeout**: New `useEffect` monitors `telnyxCallState === "dialing"` and fires a `setTimeout` at `ringTimeoutRef.current * 1000`ms. If still dialing when the timer fires (and AMD hasn't confirmed human), calls `telnyxHangUp()` + toast. This closes the gap where TelnyxContext's built-in ring timeout could be bypassed by early state transitions. **Fix 2 — Call Count UI**: `handleSaveOnly`, `handleSaveAndNext` (lock-mode path already correct), and `autoSaveNoAnswer` now inject `call_attempts: (l.call_attempts || 0) + 1` into the local `setLeadQueue` update alongside the status change. This ensures the queue panel and `displayQueue`'s max_attempts filter reflect the true attempt count without waiting for a DB round-trip. **Fix 3 — Auto-Dial Stall**: Added `showWrapUp` to the inner `setTimeout` guard inside the auto-dial reactive trigger. Previously, if the wrap-up modal opened during the 2000ms delay, the auto-dial would fire behind the modal. Now it aborts and re-triggers only when `showWrapUp` flips to `false` (already in the outer dependency array from the prior commit). Zero schema changes, zero TypeScript errors.

- **2026-04-06 | [DONE] Dialer Hangup Lag Fix — Wrap-Up Phase Enforcement**
  *Files Modified:* `src/contexts/TelnyxContext.tsx`, `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Root cause: TelnyxContext was dispatching `auto-dial-next-lead` CustomEvents from inside `hangUp`, `telnyx.error`, and `telnyx.notification` handlers. This caused the WebRTC layer to short-circuit the UI's wrap-up phase, skipping dispositions and triggering UI shift lag. Fix removes all three `window.dispatchEvent(new CustomEvent("auto-dial-next-lead"))` calls, deletes the `isAutoDialingRef` tracking ref (no longer needed), and collapses the delayed `setCallState("idle")` reset — `callState` now stays `"ended"` until DialerPage's wrap-up phase explicitly transitions it via `handleAdvance`. Also removed the matching event listener in DialerPage. Added a `useEffect` that syncs `autoDialEnabled` from the campaign's `auto_dial_enabled` column when a campaign is selected — ensures the auto-dial toggle obeys campaign settings. Added `max_attempts` filtering to `displayQueue` memo so over-attempted leads that slipped through initial fetch are excluded from the display queue. Zero schema changes, zero new dependencies, zero TypeScript errors.

- **2026-04-06 | [DONE] Fix campaign_leads user_id Column + RPC Hotfix**
  *Migration:* `20260406500000_fix_campaign_leads_user_id.sql`
  *Files Modified:* `ROADMAP.md`
  *Developer Note:* Root cause was a two-part failure: migration `20260403100000_campaigns_rls.sql` added `user_id` to `campaign_leads` on local but was not fully applied on the remote database, leaving the column absent. The previously deployed `add_leads_to_campaign` function body referenced `user_id` in its INSERT column list (an older version), causing the runtime error "column user_id does not exist." The hotfix migration (1) adds `user_id UUID REFERENCES auth.users(id)` to `campaign_leads` using `IF NOT EXISTS` (idempotent), (2) backfills from `claimed_by` for existing rows, (3) sets `DEFAULT auth.uid()`, and (4) `CREATE OR REPLACE`s the function with the correct body that omits `user_id` from the INSERT — the column DEFAULT handles assignment automatically. No frontend code was modified.

- **2026-04-06 | [DONE] Dialer Queue Routing by Campaign Type — Atomic Lock RPC + DialerPage Wiring**
  *Migration:* `20260406400000_dialer_lead_locks.sql`
  *Files Created:* `src/lib/dialer-queue.ts`, `src/components/dialer/LockTimerArc.tsx`
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Built `fetch_and_lock_next_lead` RPC (90-second TTL, SECURITY DEFINER) and `release_all_agent_locks` RPC for bulk cleanup. Added composite index `(campaign_id, expires_at)` on `dialer_lead_locks`. Extracted `fetchNextQueuedLead`, `buildFiltersFromQueueState`, `releaseAllAgentLocks`, and `releaseAllAgentLocksBeacon` into `src/lib/dialer-queue.ts` to keep DialerPage under 200-line-per-section limit. DialerPage `handleSaveAndNext` lock-mode path now calls `release_lead_lock` → `fetchNextQueuedLead` → enrich → set queue → `startHeartbeat`. Both End Session buttons (header + dialog) call `releaseAllAgentLocks`. `beforeunload` handler uses `releaseAllAgentLocksBeacon` with `fetch(..., { keepalive: true })` for reliable delivery during page unload; access token is cached in a ref via `onAuthStateChange` listener for synchronous access. Created `LockTimerArc` component (CSS `@property`-driven conic-gradient arc, 90s duration) displayed for Team/Open campaigns only. `fetch_and_lock_next_lead` filters only on `campaign_leads` columns (state, max_attempts) — no JOIN to `leads` table to avoid deadlock risk with `FOR UPDATE SKIP LOCKED`. The existing `get_next_queue_lead` RPC (5-min TTL, JOINs leads) is preserved for the `useLeadLock` hook; both RPCs are documented in the migration header.

- **2026-04-06 | [DONE] campaign_leads RLS Refinement — Personal Campaign Scoping**
  *Migration:* `20260406300000_campaign_leads_rls_personal_scope.sql`
  *Files Modified:* `ROADMAP.md`
  *Developer Note:* Replaced the overly permissive `campaign_leads_select` RLS policy (which allowed any org member to see all campaign leads) with a campaign-type-aware policy. Agents in Personal campaigns now see only leads where `claimed_by` or `user_id` matches their auth UID. Agents in Team/Open/Open Pool campaigns see all leads (required for queue display and lock-mode dialing). Admins and Team Leaders see all campaign leads org-wide. Also fixed the `'Team Lead'` vs `'Team Leader'` role string inconsistency in `campaigns_select`, `campaigns_update`, and `campaigns_delete` policies — all three now accept both variants via `IN ('Admin', 'Team Leader', 'Team Lead')`. No INSERT/UPDATE/DELETE policies on `campaign_leads` were touched. CampaignDetail.tsx reviewed: its frontend `filteredLeads` filter for agents (`claimed_by === currentUserId`) is complementary, not conflicting — no code change needed.

- **2026-04-06 | [DONE] add_leads_to_campaign RPC with Ownership Validation**
  *Migration:* `20260406200000_add_leads_to_campaign_rpc.sql`
  *Files Modified:* `src/components/contacts/AddToCampaignModal.tsx`, `src/pages/CampaignDetail.tsx`, `ROADMAP.md`
  *Developer Note:* Created a SECURITY DEFINER Postgres RPC `add_leads_to_campaign(p_campaign_id, p_lead_ids)` that enforces campaign-type ownership rules at the database layer. Personal campaigns require `lead.assigned_agent_id = campaign.user_id`; Team campaigns require the lead's agent to be in the campaign creator's downline (via `is_ancestor_of`); Open campaigns only check organization membership. Function performs dedup (skips leads already in campaign), batch-inserts valid leads with `status='Queued'`, and returns `{added, skipped, skipped_ids}` as JSONB. Refactored 3 frontend insert paths (AddToCampaignModal `handleAdd` + `handleCreateAndAdd`, CampaignDetail `handleAdd` + `doImport`) to call the RPC instead of direct `.insert()`. Toast notifications now show skip counts. `import-contacts` Edge Function was NOT touched — it has its own validation path. All columns are native UUID — no type casts needed.

- **2026-04-06 | [DONE] Total Leads Auto-Trigger**
  *Migration:* `20260406100000_campaign_leads_count_trigger.sql`
  *Files Modified:* `src/pages/CampaignDetail.tsx`, `src/components/contacts/AddToCampaignModal.tsx`, `ROADMAP.md`
  *Developer Note:* Replaced 6 manual `total_leads` count-and-update calls with a single Postgres trigger (`trg_sync_campaign_total_leads`) that fires AFTER INSERT/DELETE/UPDATE on `campaign_leads`. Returns `NEW` for INSERT/UPDATE, `OLD` for DELETE — per Postgres AFTER trigger contract. Trigger function uses `GREATEST(..., 0)` on decrements to prevent negative counts. One-time backfill `UPDATE` syncs all existing campaigns from live row counts. Also fixed `.single()` → `.maybeSingle()` on the campaign INSERT fetch in `AddToCampaignModal`. All `organization_id` scoping on `campaign_leads` rows is unchanged — trigger is count-only and does not touch org fields.

- **2026-04-06 | [DONE] Intelligent Queue Lifecycle Management**
  *Files Created:* `src/lib/queue-manager.ts`
  *Files Modified:* `src/pages/DialerPage.tsx`, `src/components/dialer/QueuePanel.tsx`, `ROADMAP.md`
  *No migrations required — all queue state is in-memory only.*
  *Developer Note:* Implemented fully managed queue lifecycle with priority-tiered ordering. Foundational to 300+ dials/day with zero manual queue management.
  **queue-manager.ts** — New library containing all queue logic: `CampaignLead` interface with in-memory `retry_eligible_at` / `callback_due_at` fields; `DISPOSITION_QUEUE_BEHAVIOR` map (No Answer/Not Available/Left Voicemail/Interested → retry, DNC/Not Interested/Appointment Set → permanent remove, Call Back → callback hold); `sortQueue()` (4 tiers: Callback Due Now → New Leads → Retry Eligible → Pending); `applyDispositionToQueue()` (removes + re-inserts + re-sorts after every save); `queueOrderChanged()` (position-by-position ID comparison); `formatTimeUntil()` (human countdown); `getLeadTier()` (tier 1–4 classifier for UI badges).
  **DialerPage.tsx** — `loadWithResume` now fetches `retry_interval_hours` from campaigns, pre-populates `retry_eligible_at` for any previously-called leads whose interval hasn't expired, then runs `sortQueue()` before `setLeadQueue`. `applyQueueLifecycle` callback centralizes disposition → queue change wiring. `handleAutoDispose` now calls `applyQueueLifecycle` instead of incrementing index. `handleSaveAndNext` (Personal/non-lock path) calls `applyQueueLifecycle` + resets to index 0 instead of calling `handleAdvance`; lock-mode path is unchanged. 60-second `setInterval` effect re-sorts the queue and toasts if order changed (clears on unmount and `selectedCampaignId → null`).
  **QueuePanel.tsx** — Lead rows now compute tier via `getLeadTier`. Tier 1 rows show amber "Callback Due" badge; Tier 3 rows show green "Ready" badge; Tier 4 rows show muted countdown ("Retry in Xh Ym" / "Callback in Xd Yh") and apply `opacity-50` to signal not-yet-callable status.

- **2026-04-06 | [DONE] Dialer Behavioral Bugfixes (Three-Fix Block)**
  *Files Modified:* `src/lib/auto-dialer.ts`, `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Three targeted fixes applied to the power dialer.
  **Fix 1 — Campaign Settings Enforcement**: `AutoDialer.startSession()` now fetches `calling_hours_start`/`calling_hours_end` from the `campaigns` table and `ring_timeout`/`amd_enabled` from `phone_settings`. Added `checkCallingHours(state)` public method with a full 50-state `STATE_TO_TZ` map using `Intl.DateTimeFormat` for timezone-aware comparison. Added `getRingTimeout()` getter. In `DialerPage`, `triggerAutoCall` (auto-dial path only) calls `checkCallingHours` before dialing; if outside hours it toasts a warning, calls `handleSkip()`, and returns. Ring timeout stored in `ringTimeoutRef` after async `startSession` resolves. Manual Call button is unaffected.
  **Fix 2 — No Auto-Dial on First Entry**: Added `hasDialedOnce` ref. `triggerAutoCall` returns immediately unless `hasDialedOnce.current === true`. `handleCall` (manual press) sets it to `true`. Ref resets to `false` in a `useEffect` that watches `selectedCampaignId`, so switching campaigns restores the guard.
  **Fix 3 — Session Timer + Session-Scoped Stats**: Session timer interval stored in `sessionTimerRef` so all three exit paths (unmount, `selectedCampaignId → null`, End Session button) reliably clear it and reset `sessionElapsed` to 0. Added `sessionStats` local state (`calls_made`, `calls_connected`, `total_talk_seconds`, `policies_sold`) reset on campaign entry. Incremented in `handleCall`, `handleHangUp` (≥7s), and both save handlers when disposition contains "sold". Stat cards in the header now read from `sessionStats` (session-scoped) instead of `dialerStats` (all-day cumulative). `dialer_daily_stats` persistence is unchanged — daily table remains the source of truth for reports.

- **2026-04-06 | [DONE] Campaign-Aware Dialer UI + Hard Claim Engine**
  *Migration:* `20260406000000_hard_claim_engine.sql`
  *Files Created:*
  - `src/hooks/useHardClaim.ts`
  - `src/components/dialer/LeadCard.tsx`
  - `src/components/dialer/LeadCardBlurred.tsx`
  - `src/components/dialer/QueuePanel.tsx`
  - `src/components/dialer/QueuePanelLocked.tsx`
  - `src/components/dialer/ClaimRing.tsx`
  *Files Modified:* `src/pages/DialerPage.tsx`, `ROADMAP.md`
  *Developer Note:* Built the campaign-aware dialer UI with full staged lead reveal, hidden queue for Team/Open, 30s claim ring animation, and campaign type visual identity stripe + badge. Also built the missing Hard Claim Engine (useHardClaim) that was a blocker for this task — the previous task left it incomplete. Schema gaps discovered and resolved: `claim_lead` RPC (SECURITY DEFINER, updates `leads.assigned_agent_id` ONLY — never `campaign_leads`) and `queue_filters` JSONB column on campaigns for manager-set filters. Lock-mode lead loading (Team/Open) uses atomic `getNextLead()` one lead at a time; Personal still uses batch queue. beforeunload listener cleans up lock + heartbeat + claim timer.

- **2026-04-06 | [DONE] Implement Coming Soon Placeholders**  
  *Developer Note:* Implemented a premium, animated "Coming Soon" experience across Conversations, AI Agents, and Training modules. Created a reusable `ComingSoon` component alignment with the platform's vision for high-velocity agency operations.

- **2026-04-06 | [DONE] Settings Layout Documentation Audit**  
  *Developer Note:* Completed a comprehensive field-level map of the AgentFlow Settings architecture. Audited all components in `src/components/settings/` and generated the authoritative `docs/SETTINGS_LAYOUT.md` reference for future development.

- **2026-04-06 | [DONE] Campaigns Architecture Diagnostic Audit**  
  *Developer Note:* Perform a comprehensive end-to-end audit of the Campaigns feature. Mapped RLS security, lead state transitions, and AutoDialer integration. Identified bottlenecks in CSV ingestion and campaign action automation. [See Campaigns_Diagnostic_Report.md for details].


- **2026-04-05 | [DONE] Permanent Dark Sidebar (Command Center)**  
  *Developer Note:* Enforced a constant dark theme for the Sidebar (Slate-900) to maintain a premium "Command Center" aesthetic across all global themes. Decoupled navigation elements from Light Mode styles to ensure 100% mission-critical visibility and consistency.
  
- **2026-04-04 | [DONE] Lead Ownership Standardization**  
  *Developer Note:* Massive schema refactor to ensure every lead record across all states (Master, Campaign, Dialer) is pinned to a correct, RLS-checked `user_id`. Optimized hierarchical reporting for agency managers.

- **2026-04-04 | [DONE] Agent Rule & Documentation Generalization**  
  *Developer Note:* Decoupled codebase from Lovable/Notion. Established **VISION.md** and **ROADMAP.md** as repository-native sources of truth. Updated **AGENT_RULES.md (v2.3.0)** to focus on the Antigravity (AI Orchestrator) workflow.

- **2026-04-02 | [DONE] Production Readiness Audit**  
  *Developer Note:* Verified security boundaries. Confirmed absolute RLS isolation for Leads, Clients, and Appointments. Verified Telnyx WebRTC stability for agent "Power Hours."

---

## 4. Phase 4 Deployment Strategy (Q2 2026)
1.  **SaaS Infrastructure**: Deploy `organizations` table and Stripe billing loops.
2.  **Follow-up Engine**: Deploy `tasks` and unified `notifications` for agent follow-ups.
3.  **Real-Time Metrics**: Connect `dial_sessions` to custom agent leaderboards based on live telnyx connects.
4.  **GO-LIVE**: Final production rollout for agency trial users.

---

## 5. Refactor & Technical Debt [TODO]
- `[TODO]` **Break down `DialerPage.tsx`**: (High Priority) Component is currently >3,000 lines. Refactor into `src/components/dialer/` sub-modules (e.g., `DialerHeader`, `DialerLeadSection`, `DialerHistory`, `DialerModals`) to meet the <200-line standard and improve maintainability.

---

## 19. Context Snapshot — Lead Transition Stabilization (2026-04-07)

### What Was Built
A "revolving door" state guard system to stabilize the Dialer during lead transitions, and restoration of the missing Queue/Scripts UI panels.

**Frontend layer (`src/pages/DialerPage.tsx`):**
- `isAdvancing` — Boolean state used as a global guard for all transitionary logic.
- `handleLeadSelect(idx)` — Debounced selection handler (500ms cooldown) that sets `isAdvancing` to `true` while the new lead's history and metadata are fetched.
- **UI Restoration**: Updated `DialerActions` to conditionally render `QueuePanel` and `Script` lists, ensuring agents can manage their workflow without leaving the dialer view.

**State Machine layer (`src/hooks/useDialerStateMachine.ts`):**
- Added `isAdvancing` as an external guard to the auto-dial trigger.
- **Timer Hardening**: Auto-dial timer now re-verifies `telnyxStatus` and `isAutoDialEnabled` AFTER the 3s delay but BEFORE the call fires, preventing race conditions where an agent disables auto-dial or switches leads during the countdown.

### Schema & UI Decisions Made
| Decision | Rationale |
|---|---|
| `QueuePanel` in `DialerActions` | Maximizes vertical space for conversation history by keeping controls in the right-hand column. |
| 500ms `isAdvancing` cooldown | Sufficient to allow Supabase Realtime and Telnyx context to settle before accepting the next user input. |
| Pass-through props to `DialerActions` | Maintains `DialerPage` as the single source of truth for dialer state, even if at high complexity. |
| `[TODO]` for `DialerPage` refactor | Acknowledges the >3,000 line technical debt while prioritizing an immediate stability hotfix. |

### What's Next
- **Refactor `DialerPage.tsx`**: Must be broken down into `<DialerHeader />`, `<LeadSection />`, `<HistorySection />`, and `<ActionPanel />` to meet the <200-line standard.
- **Persistent Filters**: Queue filters are currently transient in the UI; consider persisting them to `localStorage` or `dialer_queue_state`.

---

## 5. Context Snapshot — Smart Queue Lock System (2026-04-05)

### What Was Built
A zero-race-condition queue system for Team and Open Pool campaigns. Two agents can never be served the same lead simultaneously because fetching and locking happens in a single Postgres transaction using `SELECT … FOR UPDATE SKIP LOCKED`.

**Database layer:**
- `public.dialer_lead_locks` — lock registry with 5-minute TTL per lock
  - Unique partial index `(lead_id) WHERE expires_at > now()` → one active lock per lead, enforced at the DB constraint level
  - RLS: org-scoped; agents see/modify only their own locks; Admins/TLs see all org locks
- `public.get_next_queue_lead(p_campaign_id, p_filters)` — SECURITY DEFINER RPC
  - Deletes stale locks → reads campaign type → filters eligible pool → `SELECT … FOR UPDATE OF cl SKIP LOCKED` → inserts lock → returns `campaign_leads` row
- `public.renew_lead_lock(p_lead_id)` — heartbeat extension, returns boolean
- `public.release_lead_lock(p_lead_id)` — immediate lock release

**Frontend layer (`src/hooks/useLeadLock.ts`):**
- `getNextLead(campaignId, campaignType, filters)` — branches on campaign type; Personal = direct query, Team/Open Pool = RPC
- `releaseLock(leadId)` — call on skip, disposition save, session end, beforeunload
- `startHeartbeat(leadId, onLockLost?)` — setInterval at 30s, warns if lock is lost
- `stopHeartbeat()` — clears interval

### Schema Decisions Made
| Decision | Rationale |
|---|---|
| `lead_id` references `campaign_leads(id)` | No `contacts` table exists; `campaign_leads` is the dialer's queue entity |
| Team pool via `campaigns.assigned_agent_ids` | No `team_members` table; agent membership stored as JSONB array on the campaign |
| `SECURITY DEFINER` on `get_next_queue_lead` | Required to read the full campaign pool across all agents (RLS would block cross-agent reads) |
| Filters as flat JSONB object | Enables future plan-based count limiting (e.g. "Starter = 2 filters max") without changing the function signature |
| `FOR UPDATE OF cl SKIP LOCKED` with JOIN | Locks only the `campaign_leads` row; leaves `leads` row unlocked (not needed) |

### What Prompts 2 and 3 Depend On
- **Prompt 2 (Dialer Integration)**: Call `useLeadLock.getNextLead()` on campaign start and after each disposition. Wire `startHeartbeat` / `stopHeartbeat` around the active lead. Add `beforeunload` listener calling `releaseLock` on `DialerPage`.
- **Prompt 3 (Campaign Settings — Queue Filters UI)**: Managers need a filter editor on the Campaign Settings modal that saves `queue_filters` JSONB onto the `campaigns` table. The hook reads this from the campaign record and passes it to `getNextLead`. Fields: `status`, `state`, `lead_source`, `max_attempts`, `min_score`, `max_score`. Plan-tier enforcement hooks here (count active filter keys before calling RPC).

---

## 6. Context Snapshot — Campaign-Aware Dialer UI (2026-04-06)

### What Was Built

Full campaign-type-aware dialer UI with staged lead reveal, claim ring, queue visual identity, and hard claim ownership engine.

### Components Built

| Component | File | Props Contract |
|---|---|---|
| `LeadCard` | `src/components/dialer/LeadCard.tsx` | `lead, callStatus, callAttempts, maxAttempts, lastDisposition, isClaimed, isEditing, editForm, onEditChange` |
| `LeadCardBlurred` | `src/components/dialer/LeadCardBlurred.tsx` | `firstName, state, age, callAttempts, maxAttempts, lastDisposition` (internal, used by LeadCard) |
| `QueuePanel` | `src/components/dialer/QueuePanel.tsx` | `campaignType, campaignId, organizationId, userRole` + all Personal queue props |
| `QueuePanelLocked` | `src/components/dialer/QueuePanelLocked.tsx` | `campaignId, organizationId, userRole` (fetches its own counts, polls every 15s) |
| `ClaimRing` | `src/components/dialer/ClaimRing.tsx` | `active, onClaim, campaignType` |

### Hooks Built

| Hook | File | Exports |
|---|---|---|
| `useHardClaim` | `src/hooks/useHardClaim.ts` | `startClaimTimer, cancelClaimTimer, claimOnDisposition, claimedLeadIds` |

### Schema Decisions Made

| Decision | Rationale |
|---|---|
| `claim_lead` RPC — SECURITY DEFINER | Must write `leads.assigned_agent_id` across agent boundaries; agent-level RLS would block cross-agent writes |
| Writes to `leads.assigned_agent_id` ONLY | Per codebase invariant — `campaign_leads.assigned_agent_id` is read-only from dialer layer |
| `queue_filters` JSONB on `campaigns` | Manager-set filters persist per campaign, all agents share them; agents cannot see/override |
| `callStatus` derived from `telnyxCallState` + `showWrapUp` | Keeps wrap-up card fully revealed after call ends; no separate state needed |
| Lock-mode = one-lead-at-a-time queue | Team/Open campaigns serve one locked lead per agent; `leadQueue` is always a 1-element array in lock mode |
| `QueuePanelLocked` polls every 15s via `setInterval` | Counts are informational; no Realtime socket needed, avoids unnecessary connections |
| `ClaimRing.onClaim` is UI-only | The actual DB claim is handled by `useHardClaim.startClaimTimer` running in parallel; the ring fires a visual signal only |

### State Management Decisions

- `claimRingActive: boolean` — owned by DialerPage, driven by Telnyx `active` state for Team/Open only
- `lockMode: boolean` — derived from `campaignType`, memoized
- `callStatus: 'idle' | 'ringing' | 'connected'` — memoized from `telnyxCallState` + `lockMode` + `showWrapUp`
- `campaign stripe` — rendered via inline IIFE in JSX, no additional state needed
- `campaign badge` — replaces old static badge, type-aware with colored dot

### What the Next Developer Needs to Know

1. **Lock mode lead loading** (`loadLockModeLead`) fetches the campaign's `queue_filters` from DB on each call — this is intentional so manager filter changes take effect immediately without session restart.
2. **`handleAdvance` and `handleSkip`** both branch on `lockMode` — if lockMode, they call `releaseLock` + `loadLockModeLead` instead of incrementing `currentLeadIndex`.
3. **`claimedLeadIds`** is a session-scoped `Set<string>` of master `leads.id` values. It resets on page reload — this is intentional; the DB is the source of truth for permanent ownership.
4. **Campaign type string matching**: always `.toUpperCase()` before comparison. Values in DB: `'Personal'`, `'Team'`, `'Open Pool'`. Lock mode = `type === 'TEAM' || type.includes('OPEN')`.
5. **QueuePanelLocked** manager filter panel saves `queue_filters` JSONB to `campaigns` table. The dialer reads this on `loadLockModeLead`. No real-time sync — filters apply on the next lead load.
6. **`beforeunload` listener** only calls `releaseLock` if `lockMode && currentLead?.id`. Safe for Personal campaigns (no lock to release).

---

## 7. Context Snapshot — Dialer Behavioral Bugfixes (2026-04-06)

### What Was Changed

Three focused behavioral fixes applied to `src/lib/auto-dialer.ts` and `src/pages/DialerPage.tsx`. No new components, no schema migrations.

**Fix 1 — Campaign Settings Enforcement:**
- `AutoDialer` now stores `callingHoursStart`, `callingHoursEnd` (from `campaigns`), `ringTimeout` (from `phone_settings`). *(Historical: `amdEnabled` was removed 2026-04-09.)*
- `checkCallingHours(state)` uses a hardcoded `STATE_TO_TZ` record (all 50 states) + `Intl.DateTimeFormat.formatToParts` to determine local time. Returns `true` if within window.
- `getRingTimeout()` exposes the stored value; `ringTimeoutRef` in DialerPage caches it post-`startSession`.
- `triggerAutoCall` in DialerPage calls `checkCallingHours` on the auto-dial path only. Outside hours → toast + `handleSkip()` + early return. Manual Call button is unaffected.

**Fix 2 — No Auto-Fire on Entry:**
- `hasDialedOnce` ref starts `false` per campaign.
- `triggerAutoCall` returns immediately if `hasDialedOnce.current === false`.
- `handleCall` sets it `true` (manual press is the gate).
- A dedicated `useEffect` on `selectedCampaignId` resets the ref in its setup AND cleanup so campaign switches always re-engage the gate.

**Fix 3 — Session Timer + Stat Cards:**
- `sessionTimerRef` holds the interval ID, cleared in all three exit paths (unmount, `selectedCampaignId → null`, End Session click).
- `sessionStats` local state (calls_made, calls_connected, total_talk_seconds, policies_sold) is the source of truth for the header stat cards. Reset to zeros on campaign entry.
- `dialer_daily_stats` (Supabase) is still persisted unchanged for reports and dashboard.

### What's Next
- Consider wiring `ringTimeoutRef.current` into a setRingTimeout API on TelnyxContext if per-campaign ring timeout overrides are needed (currently TelnyxContext reads global `phone_settings` itself).
- Session stats are in-memory only; if `dial_sessions` table is implemented (see Roadmap Phase 4), `sessionStats` should persist there on `endSession`.

---

## 8. Context Snapshot — Intelligent Queue Lifecycle Management (2026-04-06)

### What Was Built

A fully managed in-memory queue lifecycle system that dynamically re-positions leads after every disposition. All logic is isolated in `src/lib/queue-manager.ts`.

### Architecture

| Function | Behavior |
|---|---|
| `sortQueue(leads, now)` | 4-tier priority sort: Callback Due → New → Retry Eligible → Pending |
| `applyDispositionToQueue(...)` | Removes disposed lead, applies behavior from `DISPOSITION_QUEUE_BEHAVIOR`, re-inserts with timestamps, re-sorts |
| `queueOrderChanged(a, b)` | Position-by-position ID comparison — drives 60s poll toast |
| `formatTimeUntil(ts, now)` | "Xh Ym" / "Xd Yh" / "Due now" countdown strings |
| `getLeadTier(lead, now)` | Returns 1–4 for QueuePanel badge rendering |

### Disposition Routing

| Disposition | Queue Action |
|---|---|
| No Answer, Not Available, Left Voicemail, Interested | `remove_until_retry` — re-enters after `retry_interval_hours` |
| Not Interested, DNC, Appointment Set, Appt Set | `remove_permanent` — gone from session queue |
| Call Back, Call Back Later | `remove_until_callback` — re-enters at scheduled callback time |
| (anything else) | `keep_at_bottom` — pushed to end of sorted queue |

### Advance Model Change

Previous model: `currentLeadIndex++` after every disposition.
New model: disposed lead is removed → queue re-sorted → `currentLeadIndex` reset to 0 (head of sorted queue is always the next-to-dial). The auto-dial reactive `useEffect` on `currentLead?.id` naturally fires on the new head.

Lock-mode (Team / Open Pool) is **unchanged** — these campaigns use atomic DB locks via `useLeadLock` and bypass all in-memory queue lifecycle.

### Deferred Edge Cases

- `callback_at` / `scheduled_callback_at` columns not confirmed present on `campaign_leads`; `callbackDueAt` is derived from the inline callback scheduler UI (`callbackDate` + `callbackTime` state) and falls back to 48h if null.
- `handleSaveOnly` (save without advance) intentionally does NOT apply queue lifecycle — the agent may save and continue reviewing the lead.
- `autoSaveNoAnswer` (rapid no-answer path) uses `handleAdvance` — consider migrating to `applyQueueLifecycle` in a future pass if you want no-answer leads to re-sort immediately.

### What's Next

- Connect `dial_sessions` persistence so re-insertion timing is visible in agency reports.
- Expose retry interval in the queue UI so agents can see "when this lead re-enters" at a glance from the Queue tab.
- Consider persisting `retry_eligible_at` / `callback_due_at` as actual DB columns if multi-session lifecycle continuity is required (currently in-memory only, resets on page reload).

---

## 9. Context Snapshot — Total Leads Auto-Trigger (2026-04-06)

### What Was Built

A Postgres trigger that makes `campaigns.total_leads` a fully DB-managed counter. No frontend code is responsible for maintaining this value.

### Database Layer

| Object | Type | Behavior |
|---|---|---|
| `sync_campaign_total_leads()` | Trigger function | INSERT → +1; DELETE → GREATEST(-1, 0); UPDATE w/ campaign_id change → decrement old, increment new |
| `trg_sync_campaign_total_leads` | AFTER trigger | Fires FOR EACH ROW on INSERT OR DELETE OR UPDATE of `campaign_leads` |
| Backfill `UPDATE` | One-time | Sets `total_leads` from live `campaign_leads` row counts for all existing campaigns |

**Return contract (per Postgres AFTER trigger spec):**
- `INSERT` → returns `NEW`
- `DELETE` → returns `OLD`
- `UPDATE` → returns `NEW`

### Frontend Changes

6 manual update calls removed across 2 files:

| File | Removed |
|---|---|
| `src/pages/CampaignDetail.tsx` | 4 blocks — `handleAdd` (post-INSERT), CSV import (post-INSERT), `handleRemoveLead` (post-DELETE), `handleBulkRemove` (post-DELETE) |
| `src/components/contacts/AddToCampaignModal.tsx` | 2 blocks — `handleAddToExisting` (post-INSERT), `handleCreateAndAdd` (post-INSERT) |

**Also fixed:** `AddToCampaignModal.tsx` campaign INSERT `.single()` → `.maybeSingle()` per AGENT_RULES null-safety standard.

**Left intact:** `total_leads: 0` initial value on new campaign INSERT rows — this is a valid seed value on the `campaigns` record, not a `campaign_leads` mutation.

### What Prompt 2 Depends On

- `campaigns.total_leads` is now always accurate; any future UI that displays this count can trust it directly without a re-count query.
- If a future migration adds bulk-delete or TRUNCATE paths on `campaign_leads`, those paths will bypass the FOR EACH ROW trigger. Add a statement-level trigger or re-run the backfill UPDATE in that migration.
- `organization_id` scoping is untouched — trigger is count-only and never reads or writes org fields.

---

## 10. Context Snapshot — add_leads_to_campaign RPC (2026-04-06)

### What Was Built

A server-side Postgres RPC that validates lead ownership rules before inserting into `campaign_leads`, enforcing Personal/Team/Open campaign type logic at the database layer.

### Database Layer

| Object | Type | Behavior |
|---|---|---|
| `add_leads_to_campaign(p_campaign_id, p_lead_ids)` | SECURITY DEFINER function | Validates org membership, campaign type ownership rules, dedup, then batch-inserts valid leads |

**Ownership Rules by Campaign Type:**

| Type | Rule | Skip Reason |
|---|---|---|
| Personal | `lead.assigned_agent_id = campaign.user_id` | `not_owned_by_campaign_creator` |
| Team | `is_ancestor_of(campaign.user_id, lead.assigned_agent_id)` OR direct match | `outside_team_downline` |
| Open / Open Pool | `lead.organization_id = get_org_id()` (org membership only) | `outside_organization` |

**Additional skip conditions:**
- Lead not found or wrong org → `outside_organization`
- Lead already in `campaign_leads` for this campaign → `already_in_campaign`

**Return contract:** `JSONB { added: int, skipped: int, skipped_ids: uuid[] }`

### Frontend Changes

3 direct `.insert()` calls replaced with `supabase.rpc('add_leads_to_campaign')`:

| File | Function | Change |
|---|---|---|
| `AddToCampaignModal.tsx` | `handleAdd` | Removed client-side dedup query + filter; RPC handles dedup |
| `AddToCampaignModal.tsx` | `handleCreateAndAdd` | Replaced post-create `.insert()` with RPC call |
| `CampaignDetail.tsx` | `handleAdd` (AddLeadsModal) | Replaced inline `.insert()` with RPC call |
| `CampaignDetail.tsx` | `doImport` (CSV import) | Replaced `.insert(processedLeads)` with RPC; master lead creation loop unchanged |

All toast notifications now show skip counts when leads are skipped (e.g. "12 leads added, 3 skipped").

### Schema Decisions Made

| Decision | Rationale |
|---|---|
| Both `leads.assigned_agent_id` and `campaigns.user_id` are UUID | Migration `20260331200100` standardized `assigned_agent_id` to UUID; no casts needed |
| SECURITY DEFINER | Must read leads across agent boundaries for Team/Open validation |
| Dedup inside RPC, not client | Single source of truth; eliminates race conditions from concurrent adds |
| `UPPER(campaign.type)` comparison | DB stores mixed-case values ('Personal', 'Team', 'Open Pool'); normalizing avoids case bugs |
| CSV import still creates master leads client-side | RPC only validates + inserts into `campaign_leads`; master lead creation is a separate concern |
| `import-contacts` Edge Function untouched | Has its own server-side validation path; not part of this refactor |

### What's Next (Prompts 3 & 4)

- **Prompt 3**: Campaign Settings UI — queue filters editor, campaign configuration modal
- **Prompt 4**: Campaign integrity tests or additional hardening
- The `total_leads` trigger (`trg_sync_campaign_total_leads`) fires automatically on the RPC's INSERT — no manual count needed
- If bulk-remove or TRUNCATE paths are added to `campaign_leads`, they bypass the FOR EACH ROW trigger; add a statement-level trigger in that migration

---

## 11. Context Snapshot — campaign_leads RLS Refinement (2026-04-06)

### What Was Changed

Replaced the `campaign_leads_select` RLS policy with a campaign-type-aware version that scopes agent visibility based on campaign type. Also fixed role string inconsistency across three `campaigns` table policies.

### Findings Before Writing

| Finding | Detail |
|---|---|
| Old policy name | `"campaign_leads_select"` (from `20260403100000_campaigns_rls.sql`, line 115) |
| Old USING clause | `is_super_admin() OR organization_id = get_org_id()` — no role or campaign-type scoping |
| Role strings from `get_user_role()` | Function reads `profiles.role` directly; profile creation stores `'Team Leader'` (with "er") |
| Role string bug in campaigns RLS | `20260403100000` used `'Team Lead'` (without "er") in SELECT/UPDATE/DELETE — Team Leaders fell through to `user_id`/`assigned_agent_ids` fallback |
| Campaigns SELECT policy fix needed | **Yes** — also UPDATE and DELETE policies had the same `'Team Lead'` string |

### New campaign_leads_select Logic

| Role | Campaign Type | Visibility |
|---|---|---|
| Super Admin | Any | All rows |
| Admin | Any | All rows in org |
| Team Leader / Team Lead | Any | All rows in org |
| Agent | Team / Open / Open Pool | All leads in that campaign (needed for queue display + lock-mode dialing) |
| Agent | Personal | Only leads where `claimed_by = auth.uid()` OR `user_id = auth.uid()` |

### CampaignDetail.tsx Review

- `fetchLeads` (line 701): `supabase.from("campaign_leads").select("*, lead:leads(*)").eq("campaign_id", id)` — no additional campaign-type filter
- `filteredLeads` memo (lines 770-794): applies frontend role filter — agents see only `claimed_by === currentUserId`
- **No breakage**: For Personal campaigns, RLS now enforces the same constraint at DB level (frontend filter is redundant but harmless). For Team/Open campaigns, RLS returns all leads; the frontend filter then shows only claimed ones in the management UI, which is correct behavior. The dialer page uses separate query paths (`useLeadLock` / `get_next_queue_lead` RPC).
- **No code change required.**

### What's Next

- Consider a future migration to normalize all `profiles.role` values to a single canonical string and update all RLS policies to match, eliminating the need for dual-variant `IN` checks

---

## 12. Context Snapshot — Dialer Queue Routing by Campaign Type (2026-04-06)

### RPC Signatures Built

| RPC | Params | Returns | TTL | Notes |
|---|---|---|---|---|
| `fetch_and_lock_next_lead` | `(p_campaign_id UUID, p_filters JSONB)` | `SETOF campaign_leads` | 90s | No JOIN to leads; filters on campaign_leads only |
| `release_all_agent_locks` | `(p_campaign_id UUID)` | `VOID` | n/a | Deletes all locks for `auth.uid()` in campaign |

**Pre-existing RPCs preserved (20260405100000):**

| RPC | TTL | Notes |
|---|---|---|
| `get_next_queue_lead` | 5 min | JOINs leads table for lead_score/lead_source filters; used by `useLeadLock.ts` |
| `renew_lead_lock` | extends 5 min | Heartbeat renewal |
| `release_lead_lock` | n/a | Single lock release by lead_id |

### Column Names Verified from Schema

**campaign_leads columns used in `fetch_and_lock_next_lead`:**
- `campaign_id`, `organization_id`, `status`, `state`, `call_attempts`, `created_at`

**Columns NOT on campaign_leads (live on `leads` table only):**
- `lead_score` — score filtering is NOT supported in lock-mode `fetch_and_lock_next_lead` by design
- `lead_source` — source filtering is NOT supported in lock-mode by design
- Rationale: adding a JOIN to `leads` inside `FOR UPDATE SKIP LOCKED` increases lock scope and creates deadlock risk

### Campaign Type Routing Confirmed

| Campaign Type | Queue Fetch Method | Lock? | Filter Source |
|---|---|---|---|
| Personal | Direct `campaign_leads` query scoped to `userId` | No | Frontend `queueFilter` state (all keys) |
| Team | `fetch_and_lock_next_lead` RPC | 90s TTL | `buildFiltersFromQueueState` (state, max_attempts only) |
| Open / Open Pool | `fetch_and_lock_next_lead` RPC | 90s TTL | `buildFiltersFromQueueState` (state, max_attempts only) |

### Lock Lifecycle Wired

| Event | Action |
|---|---|
| `handleSaveAndNext` (lock mode) | `release_lead_lock` → `fetchNextQueuedLead` → enrich → `startHeartbeat` |
| `handleAdvance` / `handleSkip` (lock mode) | `releaseLock` → `loadLockModeLead` (existing useLeadLock path) |
| End Session (header button) | `releaseAllAgentLocks(campaignId)` |
| End Session (dialog button) | `releaseAllAgentLocks(campaignId)` |
| `beforeunload` | `releaseAllAgentLocksBeacon` via `fetch(..., { keepalive: true })` |

### Extractions to Helper Files

| File | Exports | Purpose |
|---|---|---|
| `src/lib/dialer-queue.ts` | `fetchNextQueuedLead`, `buildFiltersFromQueueState`, `releaseAllAgentLocks`, `releaseAllAgentLocksBeacon`, `LockModeFilters` | Campaign-type-aware queue operations extracted from DialerPage |
| `src/components/dialer/LockTimerArc.tsx` | `LockTimerArc` | 90-second CSS conic-gradient arc for Team/Open lock window visualization |

### What the Next Developer Needs to Know

1. **Two lock RPCs coexist** — `get_next_queue_lead` (5-min, with leads JOIN) and `fetch_and_lock_next_lead` (90s, no JOIN). Do NOT consolidate without understanding the TTL and deadlock implications.
2. **`accessTokenRef`** caches the Supabase access token for synchronous `beforeunload` usage. Updated via `onAuthStateChange` listener.
3. **`LockTimerArc`** uses CSS `@property` for animatable `--lock-progress` custom property. Requires browser support for `@property` (Chrome 85+, Edge 85+, Safari 15.4+).
4. **`buildFiltersFromQueueState`** intentionally drops `minScore`, `maxScore`, and `leadSource` — these require a leads table JOIN that is unsafe inside `FOR UPDATE SKIP LOCKED`.
5. **Lock-mode `handleSaveAndNext`** enriches the RPC result with a secondary `campaign_leads.select("*, lead:leads(*)")` query. This is the same pattern used by `loadLockModeLead`.

---

## 13. Context Snapshot — Dialer Hangup Lag Fix (2026-04-06)

### What Was Changed

Removed all `auto-dial-next-lead` CustomEvent dispatching from TelnyxContext. The WebRTC layer no longer dictates when the lead advances — this is now exclusively controlled by the UI's wrap-up phase in DialerPage.

### TelnyxContext Changes

| Item | Before | After |
|---|---|---|
| `isAutoDialingRef` | Tracked whether current call was auto-initiated | **Deleted** — no longer needed |
| `hangUp()` endResetRef timeout | Set `callState("idle")` + dispatched `auto-dial-next-lead` after 200ms | Sets refs to null synchronously; deferred timeout only clears `currentCall`, `isMuted`, `isOnHold` — `callState` stays `"ended"` |
| `telnyx.error` (code -32002) timeout | Read `isAutoDialingRef` → dispatched `auto-dial-next-lead` | Deferred timeout only clears cosmetic state |
| `telnyx.notification` (destroy/hangup) timeout | Read `isAutoDialingRef` → dispatched `auto-dial-next-lead` | Deferred timeout only clears cosmetic state |
| `makeCall()` | Set `isAutoDialingRef.current = !!clientState` | Removed |

### DialerPage Changes

| Item | Before | After |
|---|---|---|
| `auto-dial-next-lead` listener | `useEffect` listening for CustomEvent → `handleAdvance()` | **Deleted** — event no longer exists |
| `autoDialEnabled` sync | Not synced from campaign on selection | New `useEffect` reads `selectedCampaign.auto_dial_enabled` and sets local state |
| `displayQueue` memo | No max_attempts filtering | Filters out leads where `call_attempts >= campaign.max_attempts` |
| `handleHangUp` | Correctly does NOT touch `currentLeadIndex` | Unchanged — confirmed correct |

### Call Lifecycle After Fix

```
Agent presses Call → handleCall() → initiateCall() → TelnyxContext.makeCall()
→ Telnyx notification (active) → callState = "active"
→ Agent hangs up → handleHangUp() → TelnyxContext.hangUp()
  → callState = "ended" (INSTANT)
  → DialerPage useEffect detects "ended" → setShowWrapUp(true)
  → Agent selects disposition → handleSaveAndNext() / handleSaveOnly()
  → handleAdvance() → currentLeadIndex++ or loadLockModeLead()
  → Reactive auto-dial useEffect fires on new currentLead?.id (if auto-dial ON)
```

### What the Next Developer Needs to Know

1. **`callState` stays `"ended"` after hangup** — it is NOT auto-reset to `"idle"` by TelnyxContext. DialerPage's wrap-up phase is the only code path that triggers lead advancement.
2. **Auto-dial still works** — it's driven by the reactive `useEffect` on `currentLead?.id` that fires after `handleAdvance()` moves the queue head. No event listener needed.
3. **Campaign `auto_dial_enabled`** is now synced on campaign selection. If a manager disables auto-dial on a campaign, agents entering that campaign will have auto-dial off by default.
4. **`displayQueue` now enforces `max_attempts`** at the display layer. This is a safety net — the RPC and initial fetch also filter, but leads that slip through (e.g. race conditions with concurrent agents) are hidden.

---

## 14. Context Snapshot — Ring Timeout + Call Count + Auto-Dial Stall Fix (2026-04-06)

### What Was Changed

Three behavioral fixes applied to `src/pages/DialerPage.tsx`. No new components, no schema migrations.

### Fix 1 — Strict Ring Timeout Enforcement

| Aspect | Detail |
|---|---|
| Location | New `useEffect` after AMD detecting effect |
| Trigger | `telnyxCallState === "dialing"` |
| Timer | `ringTimeoutRef.current * 1000` ms |
| Guard | Aborts if AMD has confirmed `'human'` |
| Action | `telnyxHangUp()` + `toast.info()` |
| Why needed | TelnyxContext has its own ring timeout effect, but it checks `callRef.current.state` which may not always reflect the actual ringing state accurately. This DialerPage-level timeout is a belt-and-suspenders enforcement. |

### Fix 2 — Call Count UI Increment

| Handler | Before | After |
|---|---|---|
| `handleSaveOnly` | `setLeadQueue` updated `status` only | Also sets `call_attempts: (l.call_attempts \|\| 0) + 1` |
| `autoSaveNoAnswer` | No local queue update | Adds `setLeadQueue` with `status: d.name` + `call_attempts` increment before `handleAdvance()` |
| `handleSaveAndNext` (Personal) | Queue update via `applyQueueLifecycle` | `applyQueueLifecycle` already removes the lead — attempts are tracked in the re-inserted copy |
| `handleSaveAndNext` (Lock) | Queue replaced with fresh DB data | Already correct — DB row has updated `call_attempts` |

### Fix 3 — Auto-Dial Stall After Wrap-Up

| Aspect | Detail |
|---|---|
| Root cause | Inner `setTimeout` guard (2000ms delay) did not check `showWrapUp` |
| Fix | Added `showWrapUp` to the guard: `if (... \|\| showWrapUp) return;` |
| Outer dependency | `showWrapUp` was already in the outer `useEffect` dependency array (added in previous commit) |
| Behavior | When wrap-up closes → `showWrapUp` flips to `false` → effect re-fires → `triggerAutoCall` evaluates → 2000ms delay → inner guard passes → `handleCall()` |

### What the Next Developer Needs to Know

1. **Two ring timeout mechanisms exist**: TelnyxContext has one based on `callRef.current.state`, DialerPage has one based on `telnyxCallState`. Both are intentional — they cover different edge cases.
2. **`call_attempts` is updated locally AND in the DB** — the DB update happens inside `saveCall` / `updateLeadStatus`. The local `setLeadQueue` update is for instant UI feedback only.
3. **Auto-dial flow after wrap-up**: Agent dispositions → `handleSaveAndNext` → `applyQueueLifecycle` resets index to 0 → `showWrapUp` set to `false` → reactive trigger fires on `currentLead?.id` change AND `showWrapUp` change → 2000ms delay → `handleCall()`.

---

## 15. Context Snapshot — Enterprise Queue Waterfall (2026-04-06)

### What Was Built

A database-first waterfall queue that handles compliance and prioritization at the RPC level, ensuring the frontend only receives "dial-ready" leads.

### RPC: `get_enterprise_queue_leads`

| Logic | Implementation |
|---|---|
| **Max Attempts** | `cl.call_attempts < campaign.max_attempts` |
| **Retry Interval** | `cl.last_called_at + retry_interval <= now()` (Bypassed if `retry_interval = 0`) |
| **Calling Hours** | Timezone-aware map: `cl.state` → `IANA timezone`. Compares `now() AT TIME ZONE l.tz` to campaign `start`/`end` times. |
| **Waterfall Sort** | 1. Due Callbacks (`scheduled_callback_at <= now`) 2. New Leads 3. Retry Eligible |
| **Terminal Filter** | Excludes `DNC`, `Completed`, `Removed` at the DB layer. |

### Frontend Integration

- **`dialer-api.ts`**: `getCampaignLeads` now calls the RPC with `p_limit` and `p_offset`. It uses `.select("*, lead:leads(*)")` on the RPC result to maintain type consistency with joined master contact data.
- **`DialerPage.tsx`**: 
    - The reactive `triggerAutoCall` now has detailed logging for `isEnabled`, `telnyxCallState`, and `showWrapUp`.
    - `autoDialer.resumeAutoDialer()` is explicitly called during advance/save-next transitions to ensure the class-based state matches the UI state.
    - `scheduled_callback_at` (new TIMESTAMPTZ column) is synced from the UI disposition modal to drive the DB priority waterfall.

### Decisions Made

| Decision | Rationale |
|---|---|
| Move filtering to DB | Pagination (`limit`/`offset`) is impossible to calculate in JS if most leads are ineligible. |
| Timezone Map in SQL | Centralizes compliance. Mapping `CA` → `America/Los_Angeles` allows Postgres to handle DST offsets correctly without JS libraries like `moment-timezone`. |
| Zero-hour bypass | Explicitly checking `IF v_retry_hrs = 0` prevents `interval '0 hours'` math that could lead to edge-case exclusions. |
| `SETOF public.campaign_leads` | Returning the full table row allows PostgREST to join the `leads` table on the result, keeping the API clean and type-safe. |
---

## 17. Context Snapshot — Dialer Queue NULL Handling (2026-04-06)

### What Was Built

A robustness patch to the Enterprise Waterfall RPC to handle `NULL` state comfortably without dropping leads.

### The Problem: Strict NULL Exclusion

In PostgreSQL, boolean comparisons with `NULL` (e.g., `attempts < 10` where attempts is `NULL`) result in `NULL`. In a `WHERE` clause, any row that evaluates to `NULL` is treated as `FALSE`. This meant that:
1. **Fresh Leads** (status=NULL or call_attempts=NULL) were invisible.
2. **Unlimited Campaigns** (max_attempts=NULL) were returning 0 leads.
3. **Unknown States** (state=NULL) could not be mapped to a timezone and were dropped.

### The Fix: COALESCE wrappers

The patch introduces fallback values for all critical filtering columns:

| Column | Fallback | Purpose |
|---|---|---|
| `call_attempts` | `0` | New leads start at 0 attempts for comparison. |
| `max_attempts` | `9999` | Treat NULL as unlimited (effectively). |
| `status` | `'Queued'` | Treat missing status as ready-to-dial. |
| `lead_tz` | `'America/New_York'` | Default to EST for calling hour checks if state is unknown. |

### Verified Logic: New Lead Bypass

New leads where `last_called_at IS NULL` now correctly bypass the retry interval block (Bucket C) and are categorized as 'Queued' (Bucket B) via the internal `COALESCE(status, 'Queued') = 'Queued'` logic.

### Status Verified
1. **Migration 20260406900000** applied.
2. **Dialer Page** verified for fresh lead loading.

### Next Steps for Future Developers

1. **Type Regeneration**: If you run `npx supabase gen types`, ensure `scheduled_callback_at` and the RPC are preserved or re-generated into `types.ts`.
2. **Calling Hours Edge Cases**: States with multiple timezones (e.g. `KY`, `TN`) are defaulted to the primary state timezone. If pin-point accuracy is needed, map by `cl.phone` (area code) instead of `cl.state`.
3. **Queue Panel Sync**: The `QueuePanel` still uses `displayQueue` (memoized). Ensure `displayQueue` remains synced with the RPC results fetched via `fetchLeadsBatch`.
---

## 16. Context Snapshot — Dialer Queue Crash & Column Alignment (2026-04-06)

### What Was Built

A hotfix to the Enterprise Waterfall Queue that ensures the database RPC perfectly satisfies the PostgREST join requirements.

### The Problem: SETOF Column Mismatch

Current Supabase PostgREST behavior requires that any RPC returning `SETOF table_name` must output **every column** of that table in the **exact order** defined in the database. If columns are missing (like `user_id` in this case) or returned in a different order, PostgREST will fail to resolve relations in the `.select()` chain, resulting in a 400 Bad Request or 500 Internal Server Error.

### The Fix: cl.* Dynamic Selection

Instead of manually listing columns in the RPC which is brittle to schema changes, the revised RPC uses an inner JOIN to `public.campaign_leads cl` and returns `SELECT cl.*`.

```sql
  -- Revised logic ensures perfect SETOF matching
  SELECT cl.*
  FROM public.campaign_leads cl
  JOIN eligible_leads l ON cl.id = l.id
  WHERE ...
```

### UI Error Exposure

Previous `catch { toast.error("Failed to load leads") }` blocks were hiding the descriptive error messages returned by Supabase (e.g., "column user_id does not exist"). These have been converted to `catch (err: any)` blocks that log to the console and display the specific message.

### Verified State

1. **Migration 20260406800000** applied.
2. **PostgREST Schema Reload** notified.
3. **DialerPage.tsx** telemetry updated.
4. **`npx tsc`** confirmed 0 regressions.
---

## 18. Context Snapshot — RPC PostgREST Routing & Signature Alignment (2026-04-06)

### What Was Built

A stabilization patch to the dialer API and database RPC to resolve "Function Not Found" routing errors in the production environment.

### The Problem: PostgREST Introspection Drift

PostgREST's schema-caching layer uses the presence and order of arguments to route RPC requests. We encountered the `Could not find function ... in schema cache` error because:
1. **Implicit Defaults**: Passing `undefined` in JS (omitting keys) caused PostgREST to search for a 3-argument variant, even if a 4-argument variant with defaults existed.
2. **Signature Overloads**: Frequent migrations changed argument order/counts, leaving stale function signatures in the Postgres catalog that confused the introspection engine.

### The Fix: Non-Optional Signatures

We transitioned the RPC from an "optional/default" signature to a **"strict/explicit"** signature:

**SQL Signature:**
```sql
CREATE OR REPLACE FUNCTION get_enterprise_queue_leads(
  p_campaign_id uuid,
  p_limit int,
  p_offset int,
  p_org_id uuid
)
```

**JS Payload:**
```typescript
.rpc("get_enterprise_queue_leads", {
  p_campaign_id: id,
  p_limit: 100,
  p_offset: 0,
  p_org_id: orgId || null  -- Explicit null, never undefined
})
```

By passing `null` explicitly, we guarantee that the 4-argument signature is always matched, bypassing PostgREST's "closest match" heuristics which were failing due to cache staleness.

### Schema Cache Management

The migration now includes an explicit `DROP` and a `NOTIFY pgrst, 'reload schema'` command to force an immediate refresh across the entire cluster.

### Verified State

1. **Migration 20260406950000** applied.
2. **JS Payload** updated to 4-param explicit.
3. **`npx tsc`** zero errors.

---

## 19. Context Snapshot — Campaign & Dialer Architecture (2026-04-06)

### What Was Built
A terminal-grade technical architecture document (`docs/CAMPAIGN_AND_DIALER_ARCHITECTURE.md`) that serves as the Source of Truth for the entire campaign and dialer module.

### Key Technical Pillars Documented
1.  **Dual-Table Entity Separation:** Differentiation between master `leads` (CRM) and `campaign_leads` (Execution).
2.  **State-to-TZ Compliance Mapping:** The database-level logic that ensures leads are only dialed during legal branch hours for their specific US state.
3.  **Water-Fall Queue Sorting:** The 3-tier prioritization logic (Callbacks → Fresh → Retry) implemented in the `get_enterprise_queue_leads` RPC.
4.  **Auto-Dial Reactive Feedback Loop:** The `DialerPage.tsx` state machine that watches Telnyx WebRTC status and the wrap-up modal to trigger the next dial atomically.

### Rationale Behind Logic
| Feature | Implementation | Rationale |
|---|---|---|
| **RPC-Level Filtering** | `get_enterprise_queue_leads` | Prevents "empty page" syndrome when many leads are ineligible; ensures 300+ dials/day payload delivery. |
| **0-Hour Retry Bypass** | SQL `COALESCE` + bypass | Enables high-velocity "Power Hour" mode where agents can immediately redial no-answers without cool-down resets. |
| **hasDialedOnce Ref** | `DialerPage` guard | Essential safety measure; prevents the dialer from auto-initiating a call the second an agent enters a campaign before they've oriented themselves. |

### What's Next
This document should be the first file read by any agent tasking with "Dialer" or "Campaign" modifications. It serves as a guard against architectural regression during future SaaS graduation steps.

---

## 20. Work Log

| Date | Status | Notes |
|---|---|---|
| 2026-04-18 | [DONE] | **Templates modal UX:** SMS templates can attach files (stored like email); header `pr-12` so close control clears Preview. |
| 2026-04-18 | [DONE] | **Template Modal Enhancement — 7 features:** merge fields + emoji pickers (popovers), email attachments (private `template-attachments` bucket + signed URLs), SMS segment counter, live preview with sample life-insurance data, duplicate row action, category tags + filter. Migration `20260418_enhance_message_templates.sql`. List split: `EmailSMSTemplates.tsx` + `TemplatesListView.tsx` / `TemplatesFiltersRow.tsx`; modal in `TemplateModal.tsx` + hooks/utils. |
| 2026-04-16 | [DONE] | Hotfix: JSX pagination footer — template literal fix for Unicode separator |

### Context Snapshot — 2026-04-18 — Template Modal Enhancement

**What was built:** Add/Edit template experience moved to `TemplateModal.tsx` with toolbar (merge fields, attach, emoji), Zod-validated form including optional `attachments` JSON and nullable `category`, SMS character/segment counter, preview toggle (email card + SMS bubble), and category filter on the list.

**Files touched / added:** `EmailSMSTemplates.tsx`, `TemplateModal.tsx`, `TemplatesListView.tsx`, `TemplatesFiltersRow.tsx`, `MergeFieldsPopover.tsx`, `EmojiPickerPopover.tsx`, `TemplatePreviewPanel.tsx`, `TemplateSmsCounter.tsx`, `TemplateAttachmentChips.tsx`, `messageTemplateTypes.ts`, `templateCategories.ts`, `templateMergeData.ts`, `templateModalSchema.ts`, `templateAttachmentUtils.ts`, `useTemplateModalForm.ts`, `useTemplateFileAttachments.ts`, `saveMessageTemplate.ts`, `src/integrations/supabase/types.ts` (`message_templates` row), migration `supabase/migrations/20260418_enhance_message_templates.sql`.

**Storage:** Bucket **`template-attachments`** (private, 5MB limit, PDF/PNG/JPEG/DOCX). Object path `{organization_id}/{timestamp}_{filename}`. RLS on `storage.objects`: first path segment must match `profiles.organization_id` for the signed-in user.

**Deviations:** Spec mentioned “three new columns”; the provided SQL added **two** (`attachments`, `category`) — shipped as written. Bucket creation is in the migration (not client-side). `TemplateModal` props use `organizationId: string | null` so save stays disabled if org is missing.

**Test next:** Run migration on Supabase; confirm storage policies allow upload/delete for an org member; create/edit email with attachments and signed link open; SMS counter near 160/70 boundaries; duplicate + category filter; preview token replacement.
