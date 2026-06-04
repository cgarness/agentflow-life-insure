# Implementation Plan — Auto-dial redial loop: persist campaign_leads advancement (single canonical path)

**Owner:** Chris Garness · **Author:** Claude · **Date:** 2026-06-04
**Status:** AWAITING APPROVAL — no files modified / no backend commands run yet.

---

## 1. Root cause (verified against production Supabase, project `jncvvsvckxhqgqvkppmj`)

The frontend already *tries* to advance `campaign_leads` (in `saveCall`, `autoSaveNoAnswer`, `saveCallData`), but **every client-side `campaign_leads` UPDATE silently affects 0 rows** and the result is never error-checked.

Why (reproduced live, rolled back):

1. RLS `campaign_leads_update` USING = `organization_id = get_org_id()` — looks permissive.
2. **But** any UPDATE whose `WHERE`/`SET` references a column (ours uses `WHERE id = …`) **also requires the row to pass the SELECT policy** (Postgres rule).
3. `campaign_leads_select` for an **Agent** on an **Open Pool / Team** campaign requires `get_user_role() = 'Agent'`.
4. `get_user_role()` reads **only** `request.jwt.claims → app_metadata.role` and has **no profiles fallback** (unlike `get_org_id()`, which does). When an agent's JWT has a stale/missing `app_metadata.role` claim, `get_user_role()` returns `NULL` → the pool lead is **invisible to SELECT** → the UPDATE matches **0 rows, no error**.

Live proof (rolled-back simulations as agent `5f952f0d…`, Open Pool lead `a09dda1b…`):
- role claim present → `select_visible=1`, `UPDATE rows=1` ✅
- role claim absent → `select_visible=0`, literal `UPDATE rows=0` ❌ (no error)

Result: `call_attempts=0`, `last_called_at=null`, `retry_eligible_at=null`, callback fields, and `status='Removed'`/`'DNC'` writes **all silently no-op**. The `calls` INSERT still succeeds (INSERT needs no SELECT visibility) and `dialer_lead_locks` writes succeed (separate `SECURITY DEFINER` RPCs). With `last_called_at`/`call_attempts`/`retry_eligible_at` never persisting, `get_next_queue_lead` re-serves the same top-of-queue lead → **redial loop**.

**Conclusion (repair-existing vs new RPC):** the existing client-side path *cannot* be safely repaired in place — it is structurally dependent on per-row SELECT visibility that breaks on stale JWT role claims. A **new `SECURITY DEFINER` RPC**, org-scoped via `get_org_id()` (which *has* the profiles fallback), is the only robust fix and is exactly what REQUIRED IMPLEMENTATION #3 calls for.

---

## 2. Confirmed live schema facts (re-verify on apply)

- `campaign_leads` columns present: `call_attempts int default 0`, `last_called_at`, `retry_eligible_at`, `status default 'Queued'`, `callback_due_at`, `scheduled_callback_at`, `callback_agent_id`, `callback_note`, `organization_id`. **No idempotency column → must add `last_advance_call_id uuid`.**
- `campaigns`: `max_attempts int` (nullable), `retry_interval_minutes int default 1440` (canonical), `retry_interval_hours` (deprecated compat).
- `dispositions` flags: `campaign_action text`, `dnc_auto_add bool`, `callback_scheduler bool`, `appointment_scheduler bool`, `pipeline_stage_id uuid` (→ `pipeline_stages.convert_to_client`).
- `get_next_queue_lead` excludes terminal statuses **`('DNC','Completed','Removed','Failed')`**, respects `call_attempts < max_attempts`, `retry_eligible_at <= now()`, callback ownership, locks, suppressions.
- Triggers on `campaign_leads`: `trg_sync_campaign_leads_called` (AFTER UPDATE OF call_attempts; **not** SECURITY DEFINER — runs in the RPC's definer context → its `campaigns` write succeeds; increments `leads_called` only on `0 → >0`) and `trg_sync_campaign_total_leads`. RPC writes one `call_attempts` increment per call → trigger fires once → no double count.
- Lock RPCs: `release_lead_lock(p_campaign_lead_id uuid)` SECURITY DEFINER.

---

## 3. Design — ONE canonical advancement RPC

### New migration: `supabase/migrations/20260604190000_advance_campaign_lead_rpc.sql`

**(a)** `ALTER TABLE public.campaign_leads ADD COLUMN IF NOT EXISTS last_advance_call_id uuid;` (idempotency key — ties an increment to a specific `calls.id`).

**(b)** `CREATE OR REPLACE FUNCTION public.advance_campaign_lead(...)` — `SECURITY DEFINER`, `SET search_path = public, pg_temp`. Signature:

```
advance_campaign_lead(
  p_campaign_lead_id uuid,
  p_call_id          uuid,            -- calls.id; idempotency key (nullable)
  p_disposition_id   uuid,            -- authoritative flag source (nullable)
  p_callback_due_at  timestamptz default null,
  p_release_lock     boolean default true
) RETURNS public.campaign_leads
```

Logic:
1. `v_org := get_org_id(); v_uid := auth.uid();`
2. `SELECT … FROM campaign_leads WHERE id = p_campaign_lead_id AND organization_id = v_org FOR UPDATE;` → if not found, `RETURN NULL` (org-scope guard; never touches cross-org rows).
3. Load campaign `max_attempts`, `retry_interval_minutes` (COALESCE → `retry_interval_hours*60` → 1440).
4. Load disposition flags by `p_disposition_id` (org-scoped) + `pipeline_stages.convert_to_client`.
5. Idempotent attempt count: `v_already := (p_call_id IS NOT NULL AND cl.last_advance_call_id IS NOT DISTINCT FROM p_call_id); v_new_attempts := cl.call_attempts + (0 if v_already else 1)`.
6. Classify outcome (mirrors existing frontend `isTerminalOrOwned`, server-authoritative):
   - **convert** (`convert_to_client`) → `status='Completed'`, retry=null, clear callbacks.
   - **DNC** (`dnc_auto_add`) → `status='DNC'`, retry=null, clear callbacks.
   - **remove_from_campaign** (`campaign_action`) → `status='Removed'`, retry=null, clear callbacks.
   - **callback_scheduler** → `status='Called'`, retry=null, set `callback_due_at=p_callback_due_at`, `scheduled_callback_at=p_callback_due_at`, `callback_agent_id=v_uid`.
   - **appointment_scheduler** → `status='Called'`, retry=null, clear callbacks.
   - **retryable** (everything else — No Answer / Busy / Failed / Voicemail / generic) → `retry_eligible_at = now() + retry_interval_minutes`, `status = 'Completed' if v_new_attempts >= max_attempts (and max_attempts not null) else 'Called'`, clear callbacks.
7. Single UPDATE: `call_attempts=v_new_attempts, last_called_at=now(), retry_eligible_at, status, callback_*`, `last_advance_call_id = COALESCE(p_call_id, last_advance_call_id)`, `updated_at=now()` WHERE id … AND organization_id=v_org.
   - **Never** touches `calls.duration` or any Twilio telemetry.
8. `IF p_release_lock THEN PERFORM public.release_lead_lock(p_campaign_lead_id); END IF;`
9. `RETURN` the updated row.

`REVOKE ALL … FROM public, anon; GRANT EXECUTE … TO authenticated;`
DROP guard for prior signature; end file with `NOTIFY pgrst, 'reload schema';`.

**Idempotency note:** only the *increment* is gated by `last_advance_call_id`; status/retry/callback are always recomputed (so Save Only → re-disposition → Save & Next on the same call applies the final disposition without double-incrementing). Respects `trg_sync_campaign_leads_called`.

---

## 4. Frontend — single shared call site

### `src/lib/dialer-api.ts`
- **Remove** the broken `call_attempts`/`last_called_at` client UPDATE block inside `saveCall` (current lines ~412–427). `saveCall` keeps writing the `calls` row only. (FloatingDialer passes no `campaign_lead_id`, so it was already skipping that block — no behavior change there.)
- **Add** `export async function advanceCampaignLead(params, organizationId)` → narrow `(supabase as any).rpc('advance_campaign_lead', { … })` (RPC absent from generated types). Returns the advanced row or null; **throws on RPC error** (no swallowing).

### `src/pages/DialerPage.tsx`
- **`autoSaveNoAnswer`** (~2548): after `saveCall`, replace the swallowed `retry_eligible_at` UPDATE (2569–2580) with `await advanceCampaignLead({ campaignLeadId: currentLead.id, callId: currentCallId, dispositionId: d.id, releaseLock: lockMode })`. Surface failures via toast (no silent catch). Lock-mode branch then `loadLockModeLead` directly (advancement+release atomic in RPC); Personal branch derives local queue from the persisted result.
- **`saveCallData`** (~2612): replace the three swallowed client UPDATEs — callback set/clear (2746–2774), `remove_from_campaign` status (2839–2843; keep the DNC-list insert and local `setLeadQueue` filter, move only the `status='Removed'` write into the RPC), and Phase-F `retry_eligible_at` (2902–2905) — with **one** `await advanceCampaignLead({ campaignLeadId, callId: currentCallId, dispositionId: selectedDisp.id, callbackDueAt, releaseLock: false })`. (`saveCallData` itself never releases — Save Only keeps the lock; Save & Next releases below.) Keep: appointment save, note save, DNC-list insert, `claimOnDisposition` hard-claim, conversion gating.
- **`proceedSaveOnly`** (~2924): drop the local-only `call_attempts`/`last_called_at`/`status` optimistic spread (2944–2948); mirror local state from the persisted row returned by the RPC. Keep `emitQueueMetricsRefresh()`.
- **`proceedSaveAndNext`** (~2960): Save & Next lock-mode branch keeps its existing `releaseLock(currentLead.id)` (the working `release_lead_lock` path) → `loadLockModeLead`. Personal branch: feed `applyQueueLifecycle` from the persisted row instead of the optimistic increments (3012–3024 local writes removed).
- **Guard #5 (no re-dial before persisted):** add `const pendingAdvanceRef = useRef<string | null>(null)`. Set it to `campaign_lead_id` at the start of the shared advancement, clear in `finally`. In `handleCall` (and the state-machine `onCall` wrapper), refuse to dial when `currentLead.id === pendingAdvanceRef.current`. Prevents the rapid duplicate "failed, duration 0" calls.
- **`getRetryIntervalMinutes`** stays the canonical frontend helper; the RPC independently derives the same interval server-side (source of truth for the persisted value).

No changes to `TwilioContext.tsx` (re-entrancy guards untouched). No new server REST / SIP / two-legged dialing. Tailwind-only; logic lives in the documented-exception `DialerPage.tsx`; new lib helper is small.

---

## 5. Files to modify / create (exact list)

1. **CREATE** `supabase/migrations/20260604190000_advance_campaign_lead_rpc.sql` — `last_advance_call_id` column + `advance_campaign_lead` RPC + grants + `NOTIFY pgrst`.
2. **EDIT** `src/lib/dialer-api.ts` — remove broken increment in `saveCall`; add `advanceCampaignLead` helper.
3. **EDIT** `src/pages/DialerPage.tsx` — route `autoSaveNoAnswer`, `saveCallData`, `proceedSaveOnly`, `proceedSaveAndNext` through `advanceCampaignLead`; remove the swallowed/optimistic local campaign_leads writes; add `pendingAdvanceRef` re-dial guard; derive local queue from persisted result.
4. **EDIT** `src/lib/database.types.ts` *(only if needed)* — surgical `last_advance_call_id` add on `campaign_leads` Row/Insert/Update (RPC called via `(supabase as any)` cast; no generated-types regen).
5. **EDIT** `WORK_LOG.md` — newest-first `[DONE]` entry + Context Snapshot.

(Read-only `campaign_leads` query at DialerPage:799 and the contact-edit denormalization at :3268 are **out of scope** — not advancement.)

---

## 6. Verification

- Reproduce as an `advance_campaign_lead` RPC call in a rolled-back tx → confirm `call_attempts` increments, `last_called_at`/`retry_eligible_at` set, lock released, `leads_called` +1 once, even with a NULL role claim.
- Idempotency: call RPC twice with same `p_call_id` → attempts increments once.
- `npx tsc --noEmit` clean.
- Apply migration via Supabase MCP; `list_migrations` to confirm; re-verify against live schema.
- Manual acceptance walk-through (No Answer auto path, Save Only, Save & Next, Callback, Appointment, DNC, Remove, Sold/Convert, max-attempts session end).

---

## 7. Open decisions for Chris

- **D1 — Lock release:** auto No-Answer releases atomically inside the RPC (`p_release_lock=true`); Save & Next keeps its existing frontend `release_lead_lock` call; Save Only never releases. Acceptable, or force *all* releases through the RPC?
- **D2 — Terminal status at cap:** at `max_attempts` I set `status='Completed'` (belt-and-suspenders with the existing `max_attempts` gate). Confirm `'Completed'`.
- **D3 — New column** `campaign_leads.last_advance_call_id` for idempotency — confirm OK (additive, nullable, no backfill).

**Awaiting your explicit approval before I modify any files or run apply_migration.**
