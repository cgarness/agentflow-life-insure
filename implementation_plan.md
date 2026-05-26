# Phone Numbers Tab Polish

**Repo:** `cgarness/agentflow-life-insure`  
**Status:** PLAN — awaiting Chris's explicit `#APPROVE` before editing files, migrations, Edge deploys, or Supabase mutations.  
**Scope:** Phone System → **Phone Numbers** tab only (plus `LocalPresenceSection` / `NumberGroupsSection` on same tab).  
**Out of scope:** `TwilioContext.tsx`, `src/lib/twilio-voice.ts`, dialer telemetry, inbound routing Edge Functions, Trust Hub / Reputation / Recording / Monitoring tabs (unless a one-line shared fix is required).

---

## A. Pre-read confirmation

| Doc / log | Status |
|-----------|--------|
| `AGENT_RULES.md` | Read — single-leg WebRTC, `verify_jwt: false` + in-function JWT, `get_org_id()` RLS, `.maybeSingle()`, no Telnyx / `dialer-start-call` |
| `VISION.md` | Read — Twilio subaccounts, local presence, agency-facing phone management |
| `WORK_LOG.md` — Phone System Foundation | Present (2026-05-26 `[DONE]`) |
| `WORK_LOG.md` — Twilio Connection removal | Present (2026-05-26 `[DONE]`) |

---

## B. Live Supabase inspection (read-only)

| Check | Result |
|-------|--------|
| `phone_numbers` row count | **10** |
| NULL `organization_id` | **0** |
| Active rows missing `twilio_sid` | **0** |
| Orgs with >1 active default | **0** (Chris home org: 1 default, 10 active) |
| Statuses in use | **active: 10** (no released rows in prod today) |
| Direct lines | **0** |
| Assigned numbers | **2** |
| `number_groups` / `number_group_members` | **0 / 0** |
| Orphaned `number_group_members` | **0** |
| Released/direct-line rows still in groups | **0** |
| `idx_phone_numbers_one_default_per_org` | **Exists** (partial unique on `organization_id` WHERE `is_default` AND `status = 'active'`) |
| `phone_numbers` RLS (Foundation) | **4 policies:** `phone_numbers_select`, `_insert`, `_update`, `_delete` — INSERT/UPDATE WITH CHECK present |
| `twilio-search-numbers` deployed | v18, `verify_jwt: false`, entrypoint `supabase/functions/twilio-search-numbers/index.ts` |
| `twilio-buy-number` deployed | v23, `verify_jwt: false`, entrypoint `supabase/functions/twilio-buy-number/index.ts` |
| Edge Function drift | **No deploy proposed** — repo paths match live entrypoints; buy/search already sanitize Twilio errors and insert `organization_id`, `twilio_sid`, `status`, `area_code` |

### Stop conditions — all clear

No schema migration, RLS change, or Edge deploy required to proceed with **frontend-only** polish.

---

## C. Code inspection summary

### Architecture (Phone Numbers tab)

- `PhoneSystem.tsx` tab `phone-numbers` renders:
  1. `NumberManagementSection` — list, purchase modal (inline), assign/default/direct line/release/remove
  2. `LocalPresenceSection` — org toggle + area-code coverage summary
  3. `NumberGroupsSection` — CRUD + members modal
- Data: `usePhoneSettingsController` — org-scoped fetches; mutations in child components mostly include `organization_id` (Foundation pass).
- Purchase/search: embedded in `NumberManagementSection` (no separate `NumberSearchModal.tsx`).
- Edge: `twilio-search-numbers`, `twilio-buy-number` — JWT in Deno, subaccount creds, service-role DB on buy.

### What already works well

- Org-scoped queries/mutations on numbers, groups, direct line (`numberGroupMutations.ts`).
- Purchase flow: loading states, cart batch, sanitized `readInvokeError`, refresh after checkout.
- Direct line: requires assigned agent; clears direct line on unassign; wipes group membership when enabling direct line.
- Default: radio disabled for non-active; partial unique index on DB.
- Group members modal: only **active**, non-direct-line numbers.
- Local presence: wired to `secretBundle.local_presence_enabled` and dialer (`TwilioContext` / `caller-id-selection.ts`) — copy mostly honest.
- Activity: **purchase** logs via `logActivity` (telephony category).

### Gaps to fix (frontend polish)

| Area | Issue | Planned fix |
|------|--------|-------------|
| **A. Search / purchase** | Search allows empty filters (very broad Twilio query); no “inventory is limited” helper | Add helper copy; optional: require area code **or** state **or** city before search; validate area code = 3 digits when non-empty |
| **A. Search / purchase** | Purchase modal not Zod-validated | Add small `numberSearchSchema` (optional fields + refine) or inline validation before invoke |
| **B. Number list** | `trust_hub_status` on row type but **not shown** in table | Compact badge when `trust_hub_status` present (pending / approved) |
| **B. Number list** | Non-`active`/`released`/`spam` statuses render blank | Fallback **Unknown** badge |
| **C. Default** | `handleSetDefault` no error handling if unique index fires; no loading guard | Check errors; toast on failure; `settingDefaultId` loading state; only update other **active** rows when clearing default |
| **C. Default** | Releasing default number — no warning / fallback copy | Release dialog: if `is_default`, warn to pick another default; explain org will use another active number or dialer fallback |
| **D. Assignment** | No loading on assign; no activity log | Per-row or global `assigningId`; toast on RLS failure (already partial) |
| **E. Direct line** | No activity log | Log toggle + assign/unassign where we add logging |
| **F. Release** | **Local-only** release (status `released`) — dialog understates vs tooltip on row | Align **Release** dialog with honest copy: marks inactive in AgentFlow; does **not** release from Twilio subaccount; Twilio Console for full removal |
| **F. Release** | Does not remove `number_group_members` on release | On release: delete memberships for that `phone_number_id` (org-scoped) |
| **F. Remove** | OK — deletes AgentFlow row only | Keep; ensure copy stays clear |
| **G. Groups** | UI allows Team Leader manage — **matches RLS** (`Admin`, `Team Leader`) | **Preserve** unless Chris says Admin-only |
| **G. Groups** | No activity log on create/edit/delete/members | Add `logActivity` for group ops (settings or telephony) |
| **H. Local presence** | Copy could match spec sentence exactly | Tighten to: “Local presence uses your **active org numbers** to choose the best caller ID for outbound dials.” |
| **I. Activity** | Only purchase logged | Add logs for release, default change, assign/unassign, direct line, group CRUD/members (use existing `activityLogger.ts`) |
| **J. Loading** | Default / release / assign lack spinners & double-submit guards | `useState` busy flags + disabled controls |

### Explicit non-changes

- No edits to `TwilioContext.tsx`, `twilio-voice.ts`, `DialerPage` outbound path, inbound routing Edge Functions.
- No Edge deploy for `twilio-search-numbers` / `twilio-buy-number` (no confirmed functional bug vs RLS/NOT NULL).
- No migration unless implementation discovers a new DB issue (none found).

### RLS note (product, not a bug)

`phone_numbers` **INSERT/UPDATE/DELETE** = Admin or Super Admin only. **Team Leader** can manage **number groups** but cannot assign numbers or set default via API — UI should disable those controls for non-Admin roles (or show tooltip). **Agents** read-only on numbers.

---

## D. Files intended to touch

| File | Change |
|------|--------|
| `src/components/settings/phone/NumberManagementSection.tsx` | UX polish, honest release copy, group cleanup on release, default/assign/release loading + errors, activity logs, trust hub badge, search validation |
| `src/components/settings/phone/LocalPresenceSection.tsx` | Copy alignment |
| `src/components/settings/phone/NumberGroupsSection.tsx` | Activity logs (optional Admin-only UI gate if Chris confirms) |
| `src/components/settings/phone/NumberGroupMembersModal.tsx` | Activity log on save |
| `src/components/settings/phone/NumberGroupFormModal.tsx` | Activity log on create/edit |
| `src/components/settings/phone/numberSearchSchema.ts` | **New** — Zod schema for purchase search filters (small) |
| `WORK_LOG.md` | Newest-first entry after implementation |
| `implementation_plan.md` | Mark APPROVED / applied after work |

**Not touching:** `TwilioContext.tsx`, `src/lib/twilio-voice.ts`, `supabase/functions/*` (unless Chris approves a confirmed Edge bug), `src/integrations/supabase/types.ts` (unless type gap blocks compile).

---

## E. Verification plan

```bash
npx tsc --noEmit
npm test -- --run   # if vitest available
```

### Manual smoke (Chris)

1. Settings → Phone System → Phone Numbers loads; **10** numbers visible.
2. Purchase modal: invalid area code blocked; search empty/error/loading clear; purchase refreshes list.
3. Set default — one active default; cannot set released (when one exists).
4. Assign / unassign; direct line requires agent.
5. Release copy honest; released row not default/direct/group-eligible.
6. Number groups CRUD + members (active only).
7. Local presence copy accurate; toggle persists.
8. Dialer outbound still works (`device.connect()` unchanged).

---

## F. Open questions for Chris (answer before `#APPROVE`)

1. **Number groups permissions** — Keep **Team Leader** manage (matches DB RLS), or restrict UI to **Admin** only?
2. **Release behavior** — Stay **AgentFlow-local status only** (no Twilio API release in this pass), with honest copy? (Recommended: yes.)
3. **Search** — Require at least one filter (area code / state / city) before calling Twilio, or allow nationwide search with a “results limited to 20” disclaimer only?
4. **Role-gated number table actions** — Should non-Admins see assign/default/release disabled with tooltip? (Recommended: yes, matches RLS.)

---

## G. Approval status

**NOT APPROVED** — waiting for Chris `#APPROVE` (and answers to §F if needed).

After approval, implementation order:

1. `NumberManagementSection` (largest)
2. `LocalPresenceSection` + group modals + activity logs
3. `tsc` + tests
4. `WORK_LOG.md` entry

---

## H. Context snapshot (planning only)

**Changes (planned):** Frontend UX honesty, loading/error states, release/group cleanup, activity logging, optional role gates — no dialer/telephony architecture changes.

**Decisions (proposed):** No Edge deploy; no migration; preserve Team Leader group access unless Chris overrides.

**Blockers:** None for planning. Implementation blocked on approval.

**Deferred:** Inbound Routing reality check; Trust Hub / Reputation tab polish; Recording / Monitoring polish.
