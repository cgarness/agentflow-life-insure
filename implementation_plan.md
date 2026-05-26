# Phone System — Inbound Routing data safety + validation + UI honesty

**Owner:** Chris Garness · **Status:** Plan (awaiting approval before any edits) · **Date:** 2026-05-26

---

## 0. Scope & invariants

Scope is **only** Settings → Phone System → Inbound Routing.

Untouched:
- `TwilioContext.tsx`, `src/lib/twilio-voice.ts`, outbound dialer.
- Single-leg WebRTC outbound model.
- `twilio-token`, number search/buy Edge Functions, Twilio credential handling.
- Phone Numbers / Trust Hub / Reputation / Recording / Monitoring tabs (beyond per-number routing modal entry).

---

## 1. Findings (read-only inspection)

### 1.1 Live data state

| Table | Total rows | NULL `organization_id` | Notes |
|---|---|---|---|
| `inbound_routing_settings` | **1** | **1** | The single row (`id = 00000000-0000-0000-0000-000000000000`, created 2026-04-11, updated 2026-04-12) is a **legacy seed**. |
| `business_hours` | 7 | 0 | All 7 rows belong to Chris home org (days 0–6). |
| `phone_numbers` | 10 | 0 | Already hardened by Phone System Foundation. |

**Null-org `inbound_routing_settings` row contents:**

| Field | Value |
|---|---|
| `id` | `00000000-0000-0000-0000-000000000000` |
| `organization_id` | **NULL** |
| `routing_mode` | `'first_available'` (NOT a valid UI value — UI expects `assigned` / `all-ring` / `round_robin`) |
| `auto_create_lead` | `false` |
| `after_hours_sms_enabled` | `false` |
| `after_hours_sms` | default copy ("Thank you for calling. We are currently closed…") |
| `voicemail_enabled` | `false` |
| `fallback_action` | `'voicemail'` |
| `voicemail_greeting_text` | NULL |
| `voicemail_greeting_url` | NULL |
| `forwarding_number` | NULL |
| `inbound_fallback_chain` | `["last_agent","campaign_agents","all_available"]` (UI default) |
| `created_at` | 2026-04-11 |
| `updated_at` | 2026-04-12 |

**Chris home org (`a0000000-0000-0000-0000-000000000001`)** has **NO** org-owned row.

**Only one org exists in production** (`organizations` has exactly 1 row: Family First Life — Chris Garness). The null-org row therefore unambiguously belongs to Chris home org.

The UI (`InboundRoutingManager.tsx`) filters by `organization_id`, so the null-org row is **currently invisible** to the UI; on first save the UI would attempt an INSERT but RLS would silently block it (see §1.2).

### 1.2 Live RLS audit

`inbound_routing_settings` (3 policies, **broken**):
- `SELECT`: `organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())` — raw subquery (not `get_org_id()`).
- `INSERT WITH CHECK`: same subquery **AND** `role IN ('admin','super_admin','manager')` — these are **lowercase strings that never match** canonical roles (`'Admin'`, `'Super Admin'`, `'Team Leader'`). **No one can INSERT or UPDATE from the frontend today.** No super-admin carve-out.
- `UPDATE`: same broken policy. **No WITH CHECK.**
- No DELETE policy. (Fine — no product path.)

`business_hours` (4 policies, partially correct but legacy):
- Uses legacy helper `get_user_org_id()` (security_definer) instead of `get_org_id()`.
- INSERT/UPDATE/DELETE require `role = 'Admin'` (canonical). No `is_super_admin()` carve-out. No WITH CHECK on UPDATE.

`phone_numbers`: already hardened, helper-based, with WITH CHECK. Untouched.

### 1.3 Constraints / indexes

- `inbound_routing_settings`: PK on `id`, FK to `organizations` (ON DELETE CASCADE), CHECK on `fallback_action ∈ {voicemail, forward, hangup}`. **No CHECK on `routing_mode`** (which is why `'first_available'` is stored). **No unique constraint on `organization_id`** — nothing prevents multiple rows per org. **No index on `organization_id`.**
- `business_hours`: PK on `id`, FK to `organizations`, CHECK on `day_of_week (0..6)`. **No index on `organization_id`**, **no uniqueness on `(organization_id, day_of_week)`**.

### 1.4 Helpers (all present, security-definer where expected)

`get_org_id()`, `get_user_org_id()` (legacy), `get_user_role()`, `is_super_admin()`, `super_admin_own_org(uuid)`, `update_updated_at()`.

### 1.5 Edge Function

- `twilio-voice-inbound` v24, `verify_jwt = false`, Twilio signature validation present, recording-callback URLs derived from `SUPABASE_URL`.
- **Live function code matches repo byte-for-byte** (SHA `d406f5a5…`). No drift.
- **Real bug in `loadPhoneSettings()`** (line ~366): the service-role per-number override query is `.eq("id", phoneNumberId)` only. Because the function uses service role, this bypasses RLS. With unique-by-id `phone_numbers.id` this is *de facto* safe today, but adding `.eq("organization_id", organizationId)` enforces tenant isolation in code.
- All other service-role queries in this function are already `.eq("organization_id", organizationId)`.

### 1.6 UI honesty gaps in `InboundRoutingManager.tsx`

| Surface | Current copy | Reality (per webhook code) |
|---|---|---|
| Routing — Assigned Agent | "Ring the lead's owner" | Rings the **phone number's `assigned_to` agent**, not the lead's `assigned_agent_id`. |
| Routing — Ring All | "First to answer wins" | Correct, but should clarify rings **all active org agents** (any profile with `twilio_client_identity`, no online-presence check). |
| Routing — Round Robin | "Distribute evenly" | Picks the active agent with the **oldest `last inbound`** call; based on past inbounds in `calls`, not presence. |
| Auto-create leads | "Automatically create a lead record for unknown inbound callers." | Correct but should mention: created only when no lead/client/recruit phone match. |
| After-hours SMS | "Sent automatically to callers when you are closed." | Sends `from` = the number the caller dialed (`To`), `to` = caller's `From`. Should say so. |
| Fallback chain — campaign agents | "Ring agents assigned to the campaign that uses this phone number's group." | Correct, but skipped if no campaign references this number's group. Add helper hint. |
| Fallback chain — state-licensed | Already shows a warning when no licenses configured. Keep. | Also depends on `area_code_mapping` having the caller's area code; mention this. |

### 1.7 UI honesty gaps in `PhoneNumberRoutingModal.tsx`

- No validation: forwarding number / greeting fields can be saved blank.
- "Voicemail Enabled" toggle in the modal is confusing — it always overrides the global setting because the function uses `numberOverrides?.voicemail_enabled ?? orgData?.voicemail_enabled`. Switch label and helper need to make the override explicit, or leave the toggle out of override scope.
- The modal already updates by `id + organization_id` (Foundation work).

---

## 2. Decisions

1. **Null-org row → backfill, sanitize, keep.** Only one org exists; the row is unambiguously legacy default belonging to Chris home org. Backfill `organization_id` to `a0000000-0000-0000-0000-000000000001`, **also normalize `routing_mode` to `'assigned'`** so the UI radio renders correctly. This is the safer path (Chris's "prefer backfill over delete when uncertain").
2. **Add unique partial index** on `(organization_id) WHERE organization_id IS NOT NULL` so future code can never create duplicates per org. After backfill, set `organization_id NOT NULL` (null count becomes 0).
3. **Add `routing_mode` CHECK** (`assigned | all-ring | round_robin`) and tighten `fallback_action` CHECK to match UI (`voicemail | forward | hangup`).
4. **Rewrite `inbound_routing_settings` RLS** to use the house pattern (`get_org_id()` + `is_super_admin()`/`super_admin_own_org()`, canonical role strings, WITH CHECK on INSERT/UPDATE, no DELETE).
5. **Rewrite `business_hours` RLS** to the same house pattern (since rows are clean: 0 null orgs, 7 rows in Chris org). Add WITH CHECK on UPDATE. Add `is_super_admin()` carve-out for write so super admin in their home org can edit.
6. **Add indexes**: `inbound_routing_settings(organization_id)` and `business_hours(organization_id, day_of_week)` (also helps `loadFallbackChain` / `checkBusinessHours`).
7. **Edge Function: one surgical fix.** In `loadPhoneSettings`, change per-number override query to also filter by `organization_id`. No other Edge Function changes.
8. **Add Zod validation** to `InboundRoutingManager.tsx` and `PhoneNumberRoutingModal.tsx`.
9. **Fix UI copy** in `InboundRoutingManager.tsx` and `FallbackChainSection.tsx` per §1.6.
10. **Patch `src/integrations/supabase/types.ts`** only for the `inbound_routing_settings.organization_id` non-null narrowing.
11. **Do not change** any other Edge Function, any outbound dialer code, `phone_numbers` / `phone_settings` RLS, or `TwilioContext.tsx`.

---

## 3. Files / functions / migrations to touch

### 3.1 Migration (one file)

`supabase/migrations/20260528000000_inbound_routing_safety_honesty.sql`

Phases:

1. **Preflight** (raise if helper functions missing): `get_org_id`, `get_user_role`, `is_super_admin`, `super_admin_own_org`, `update_updated_at`.
2. **Backfill + sanitize the legacy row** (idempotent and conservative):
   - `UPDATE public.inbound_routing_settings SET organization_id = 'a0000000-0000-0000-0000-000000000001', routing_mode = 'assigned', updated_at = now() WHERE organization_id IS NULL AND id = '00000000-0000-0000-0000-000000000000';`
   - Recheck `SELECT COUNT(*) WHERE organization_id IS NULL = 0` before proceeding; raise on mismatch.
3. **Partial unique index** (only enforce one-per-org for non-null rows; survives even if a future row slips in null):
   - `CREATE UNIQUE INDEX IF NOT EXISTS inbound_routing_settings_org_unique_idx ON public.inbound_routing_settings (organization_id) WHERE organization_id IS NOT NULL;`
4. **NOT NULL** on `organization_id` (only if 0 nulls after step 2 — gated by a `DO $$` precheck that raises otherwise).
5. **CHECK constraints**:
   - `inbound_routing_settings_routing_mode_check` → `routing_mode IN ('assigned','all-ring','round_robin')`.
   - `fallback_action` CHECK already exists and matches.
6. **`inbound_routing_settings` RLS rewrite**:
   - `DROP POLICY IF EXISTS "Users can view their organization's routing settings" ON public.inbound_routing_settings;`
   - `DROP POLICY IF EXISTS "Admins can insert routing settings for their org" ON public.inbound_routing_settings;`
   - `DROP POLICY IF EXISTS "Admins can update routing settings for their org" ON public.inbound_routing_settings;`
   - `DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.inbound_routing_settings;` (defensive; foundation already dropped this but keep idempotent).
   - `CREATE POLICY inbound_routing_settings_select USING (organization_id = public.get_org_id() OR public.super_admin_own_org(organization_id));`
   - `CREATE POLICY inbound_routing_settings_insert WITH CHECK (organization_id = public.get_org_id() AND (public.get_user_role() = 'Admin' OR public.is_super_admin()));`
   - `CREATE POLICY inbound_routing_settings_update USING (...) WITH CHECK (...);` (same gate on both sides).
   - **No DELETE** policy.
7. **`business_hours` RLS rewrite** (clean dataset; safe):
   - Drop the four legacy `business_hours_*` policies.
   - Recreate SELECT / INSERT / UPDATE / DELETE using `get_org_id()` + role + `is_super_admin()`; INSERT and UPDATE both with WITH CHECK.
   - Set `business_hours.organization_id NOT NULL` (gated on a 0-nulls precheck).
8. **Indexes**:
   - `CREATE INDEX IF NOT EXISTS inbound_routing_settings_organization_id_idx ON public.inbound_routing_settings(organization_id);` (the unique partial index above also serves; this is for clarity / belt-and-braces if later we want a non-unique listing index).
   - `CREATE INDEX IF NOT EXISTS business_hours_org_day_idx ON public.business_hours(organization_id, day_of_week);` (matches webhook `WHERE organization_id = ? AND day_of_week = ?`).
9. **`NOTIFY pgrst, 'reload schema'`** at end.

> **Stop-and-report triggers covered:** only 1 null-org row, only 1 org, no duplicates per org, the backfill cannot overwrite anything (no org-owned row exists). `business_hours` has 0 null-org rows. RLS tightening keeps writes possible (current frontend already only writes via `id + organization_id` after Foundation).

### 3.2 Edge Function (one surgical change)

`supabase/functions/twilio-voice-inbound/index.ts`

In `loadPhoneSettings()`, change:

```ts
const { data } = await supabase
  .from("phone_numbers")
  .select("inbound_routing_mode, voicemail_enabled, fallback_action, voicemail_greeting_text, voicemail_greeting_url, forwarding_number")
  .eq("id", phoneNumberId)
  .maybeSingle();
```

to:

```ts
const { data } = await supabase
  .from("phone_numbers")
  .select("inbound_routing_mode, voicemail_enabled, fallback_action, voicemail_greeting_text, voicemail_greeting_url, forwarding_number")
  .eq("id", phoneNumberId)
  .eq("organization_id", organizationId)
  .maybeSingle();
```

No other Edge Function change. Preserve `verify_jwt = false`, Twilio signature validation, recording callback, direct-line behavior. Retrieve current live function code via MCP one more time immediately before deploy (per AGENT_RULES §4) and ship full file content.

### 3.3 Frontend — new file

`src/components/settings/inbound-routing/inboundRoutingSchema.ts`

Zod schemas:
- `routingModeSchema`: `z.enum(['assigned','all-ring','round_robin'])`.
- `fallbackActionSchema`: `z.enum(['voicemail','forward','hangup'])`.
- `e164ishSchema`: trimmed string matching `/^\+?[0-9\s().\-]{7,20}$/` (forgiving; not strict E.164).
- `fallbackChainTierSchema`: `z.enum(['last_agent','campaign_agents','state_licensed','all_available'])`.
- `inboundRoutingSettingsSchema`: routing_mode + fallback_action + conditional rules via `.superRefine`:
   - `fallback_action === 'forward'` ⇒ `forwarding_number` present + e164ish.
   - `fallback_action === 'voicemail' | 'hangup'` ⇒ `voicemail_greeting_text` trimmed length ≥ 1, ≤ 500.
   - `after_hours_sms_enabled === true` ⇒ `after_hours_sms` trimmed length ≥ 1, ≤ 320.
   - `inbound_fallback_chain`: array of tier keys, no duplicates, allowed to be empty (UI already explains).
- `businessHoursDaySchema`: when `is_open === true`, `open_time` and `close_time` are required `HH:MM` strings and `close_time > open_time` (same-day only — not midnight-spanning).
- `perNumberRoutingSchema` (modal):
   - `inbound_routing_mode`: `z.enum(['global','assigned','all-ring','round_robin'])`.
   - `fallback_action`: `z.enum(['global','voicemail','forward','hangup'])`.
   - `voicemail_enabled` boolean.
   - Conditional: forward requires forwarding_number; voicemail/hangup requires non-empty greeting (≤ 500); `global` skips greeting/forward validations.
   - `organizationId` required uuid.

All errors return user-friendly messages.

### 3.4 Frontend — edits

`src/components/settings/InboundRoutingManager.tsx`
- Import the schema; validate before `handleSave`.
- On validation failure: show first issue as a destructive toast; do not call Supabase.
- Save flow unchanged (already org-scoped: INSERT with explicit `organization_id`; UPDATE by `id + organization_id`).
- Copy changes:
  - "Assigned Agent" subtitle → "Ring this number's assigned agent."
  - "Ring All" subtitle → "Ring every active org agent at once. First to answer wins."
  - "Round Robin" subtitle → "Ring the active agent who has waited longest since their last inbound call."
  - Auto-create leads description → "If a caller's phone doesn't match an existing lead, client, or recruit, create a basic lead record so the call shows up in the CRM."
  - After-hours SMS helper → "Sent from the number the caller dialed back to the caller, when business hours say you are closed."
  - Header subtitle minor tweak (optional): "Configure how inbound calls to your organization are routed during business hours, after hours, and on no-answer."
- Soften the "available agents" misnomer — webhook does **not** check online presence. Use "active" not "available" wherever the UI claims presence.

`src/components/settings/inbound-routing/FallbackChainSection.tsx`
- Description of `campaign_agents` add helper hint: "If no campaign references this number's group, this tier is skipped." (rendered as small muted text under the description, similar to the existing state-licensed warning pattern).
- Description of `state_licensed`: append "Also requires the caller's area code to be in the area-code map" (small muted text near the existing warning).

`src/components/settings/phone/PhoneNumberRoutingModal.tsx`
- Import the schema; validate before `handleSave`.
- On validation failure: toast + return.
- Confirm save uses `id + organization_id` (it already does — keep).
- Update helper copy: when `voicemail_enabled` is toggled inside the modal, add a small note: "Per-number override. When set, this number ignores the organization-level voicemail toggle."
- Forward and voicemail conditional fields keep the same UX (already show conditionally).

### 3.5 Types

`src/integrations/supabase/types.ts`
- Narrow `inbound_routing_settings.Row.organization_id` from `string | null` to `string` after migration sets NOT NULL.
- Leave `business_hours.Row.organization_id` as `string | null` (column stays a normal nullable for now even if we set NOT NULL — the type can be narrowed too, since 0 nulls exist; do it for symmetry).
- Insert/Update keep `organization_id?: string | null`; setting it on insert is still required by RLS but Insert type optional is fine because DB-level NOT NULL gives a real error.

### 3.6 WORK_LOG

Append newest-first entry: `2026-05-26 | [DONE] Phone System — Inbound Routing data safety + validation + UI honesty.`

---

## 4. Verification plan

After applying the migration (only with approval):

1. SQL: `SELECT * FROM inbound_routing_settings;` → exactly 1 row with `organization_id = 'a000…001'`, `routing_mode = 'assigned'`.
2. SQL: `SELECT count(*) FROM inbound_routing_settings WHERE organization_id IS NULL;` → 0.
3. SQL: `is_nullable` of `inbound_routing_settings.organization_id` and `business_hours.organization_id` = `NO`.
4. SQL: `pg_policies` for both tables shows only helper-based policies with WITH CHECK on INSERT/UPDATE, no DELETE on `inbound_routing_settings`, four policies on `business_hours`.
5. SQL: `pg_constraint` shows `inbound_routing_settings_routing_mode_check`.
6. SQL: `pg_indexes` shows partial unique index on `inbound_routing_settings(organization_id)` and `business_hours_org_day_idx`.

Edge Function:
7. `get_edge_function('twilio-voice-inbound')` returns new ezbr_sha256 and `verify_jwt = false`.
8. Signature validation block (`validateTwilioSignature`) present and unchanged.

Repo:
9. `npx tsc --noEmit` exits 0.
10. `npm test -- --run` passes (or notes the same `vitest: not found` as Build 4 / 5 if running in a sandboxed shell).

UI smoke (per task):
- Inbound Routing tab loads with the now-visible existing settings.
- Validation toasts trigger on: forward without number, voicemail/hangup with blank greeting, after-hours SMS enabled with blank message, business hours close ≤ open.
- Save flows for assigned / ring-all / round-robin / chain reorder / auto-create / after-hours SMS each succeed.
- Per-number modal blocks forward-without-number and voicemail/hangup-without-greeting; saves under the org scope.
- Direct-line still works (no behavior changes to the webhook path).
- Inbound test call still routes through the function unchanged.

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Backfill assigns the legacy row to the wrong org. | Production has exactly **one** org; verified by `SELECT * FROM organizations`. The UPDATE is gated by `organization_id IS NULL AND id = '00000000-…'`. |
| Tightening RLS breaks current frontend writes. | New policy requires `Admin` (canonical) or `is_super_admin()`. Foundation work has already locked the rest of phone-system writes to Admin. Chris's profile is `Admin` AND `is_super_admin` — covered. |
| `routing_mode` CHECK rejects the row pre-update. | The migration **updates the row before adding the CHECK** (constraint added after `UPDATE`). |
| Edge Function deploy clobbers a newer live version. | Will re-pull current live code with `get_edge_function` immediately before deploy (already pulled once during inspection — no drift). |
| `verify_jwt` flip. | `verify_jwt = false` preserved on deploy. |
| `business_hours` policy changes lock out existing UI saves. | The UI is already only used by Admin / Super Admin to edit hours. Policy keeps both code paths writable. |
| UI Zod validation false-positives existing saved data. | Validation runs only on save, not load. Existing rows with `'first_available'` are sanitized to `'assigned'` by the migration before any UI save attempt. |

---

## 6. Stop / blocker triggers

None encountered. All the task's stop conditions are not met:
- Exactly 1 null-org `inbound_routing_settings` row.
- Only 1 org candidate.
- No duplicate routing rows.
- Backfill cannot overwrite an org-owned row (none exists).
- `business_hours` already has 0 null-org rows.
- `twilio-voice-inbound` live code matches repo (no drift).
- Only one Edge Function change needed (the per-number override `organization_id` filter the task explicitly listed).

---

## 7. Out of scope (explicitly deferred)

- Trust Hub / Reputation polish.
- Recording / Monitoring polish.
- Full Twilio API number release.
- Live Listen / Whisper / Barge.
- Online presence / availability routing.
- Updating any other Edge Function.
- Touching `TwilioContext.tsx`, `src/lib/twilio-voice.ts`, or outbound dialer behavior.

---

## 8. Ordered execution plan (after approval)

1. Write `supabase/migrations/20260528000000_inbound_routing_safety_honesty.sql`.
2. Pre-flight prod SQL recheck (null count, org count, no duplicate per org, single Chris org).
3. `apply_migration` to prod via MCP.
4. Live SQL verification (Phase 4 of §4).
5. Pull current live `twilio-voice-inbound` once more via `get_edge_function`; confirm SHA still `d406f5a5…`.
6. Edit `supabase/functions/twilio-voice-inbound/index.ts` with the one-line org-scope addition.
7. Deploy `twilio-voice-inbound` (full body, `verify_jwt = false`).
8. Confirm new ezbr_sha256.
9. Write `src/components/settings/inbound-routing/inboundRoutingSchema.ts`.
10. Edit `InboundRoutingManager.tsx` (validation + copy).
11. Edit `FallbackChainSection.tsx` (helper hints).
12. Edit `PhoneNumberRoutingModal.tsx` (validation).
13. Patch `src/integrations/supabase/types.ts` (NOT NULL narrowing).
14. `npx tsc --noEmit` and `npm test -- --run`.
15. Append `WORK_LOG.md` entry.
16. Context snapshot in chat.

---

**Awaiting Chris's explicit approval before any of steps 1–16.**
