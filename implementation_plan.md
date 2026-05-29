# Implementation Plan | P1 Build 3A — `counts_as_contacted` Disposition Setting

**Status:** FILES EDITED (Gate 1 done) — migration NOT applied, NOT pushed/deployed; awaiting Gate 2
**Prerequisites:** P1 Build 3 (local, NOT pushed/deployed); Build 1 migration `20260529003210` applied; Build 2 merged `2137da8`

> **Gate 1 addition beyond the original file list:** the `disposition_id` persistence gap is
> in `src/lib/dialer-api.ts` `saveCall` (it accepted but never wrote `disposition_id`). Fixed
> with a one-line write to `sharedCallFields`; `src/components/layout/FloatingDialer.tsx` now
> passes `disposition_id: disp.id` (one line). Both are the smallest surgical fix per
> requirement #4 — flagged here and in WORK_LOG for Gate 2 review.

**Verification (Gate 1):** `npx tsc --noEmit` → exit 0; `npm test -- --run` → 14 files / 85 passed.
Static: 0 Twilio files changed; no `calls.duration` write added; migration ends with
`NOTIFY pgrst, 'reload schema';`; runtime contacted logic uses `disposition_id` / lowercased
`disposition_name` + `counts_as_contacted` (no agency-label literals).

---

## 1. Goal

Let agencies control which dispositions count as **Contacted** via a disposition-level boolean
`counts_as_contacted boolean NOT NULL DEFAULT false`.

Trusted Contacted logic becomes:

```
calls.duration > 45  OR  disposition.counts_as_contacted = true
```

Reason: short real conversations ("Not interested," hangs up in 10s) are genuine contacts but
fall under the 45s threshold. We do **not** hardcode disposition names — agencies label
dispositions differently, so contact-credit must be a configurable per-disposition flag.

---

## 2. Phase A findings (read-only, confirmed live on `jncvvsvckxhqgqvkppmj`)

- **`dispositions` schema:** has `organization_id` (NOT NULL), `name`, `dnc_auto_add`,
  `appointment_scheduler`, `callback_scheduler`, `pipeline_stage_id`, `campaign_action`,
  deprecated `remove_from_queue`/`auto_add_to_dnc`. **No `counts_as_contacted` column yet.**
- **`calls` schema:** has BOTH `disposition_id (uuid)` and `disposition_name (text)`.
  **`disposition_id` is 0/30 populated** — every dispositioned call carries only
  `disposition_name`. ⇒ Runtime contacted matching MUST use `disposition_name` (lowercased),
  NOT `disposition_id`. Documented limitation; `disposition_id` fallback deferred.
- **`pipeline_stages.convert_to_client` exists** — sold/conversion dispositions are reliably
  detectable via `dispositions.pipeline_stage_id → pipeline_stages.convert_to_client = true`
  (used for migration backfill only, not runtime).
- **Generated types:** `src/integrations/supabase/types.ts` types the `dispositions` table
  (Row/Insert/Update). `supabase-dispositions.ts` uses the typed client for `insert`/`update`,
  so the new column must be added to the generated type to keep `tsc` green. Manual edit of
  `types.ts` is acceptable (no full regen required) — same approach already used in repo.
- **App uses manual mapping:** `supabase-dispositions.ts` has its own `DispositionRow` type +
  `rowToDisposition`. `src/lib/types.ts` `Disposition` is the app model.
- **Trusted helper (Build 3):** `getTrustedTodayDialerStats` builds contacted via
  `report-utils.isContactedCall(duration, disposition_name, dncSet)`. `DialerPage`
  `reconcileTrustedStats` builds `dncSet = buildDNCDispositionSet(dispositions)` and passes it.
- **Reports:** `isContactedCall` / `buildDNCDispositionSet` are used only in
  `supabase-dialer-stats.ts` + `DialerPage.tsx` (verified). Extending `isContactedCall` with an
  optional trailing param is backwards-compatible — no Reports breakage.
- **Current org dispositions (FFL Chris):** No Answer(F), Appointment Set(appt→T),
  Call Back(callback→T), Not Interested(none→F, agency can toggle on), DNC(dnc→T),
  Sold(convert stage→T).

---

## 3. Phase B — Migration (NEW)

File: `supabase/migrations/20260529120000_add_counts_as_contacted_to_dispositions.sql`
(sorts after latest applied `20260529003210`).

1. `ALTER TABLE public.dispositions ADD COLUMN IF NOT EXISTS counts_as_contacted boolean NOT NULL DEFAULT false;`
2. Backfill `counts_as_contacted = true` where ANY of:
   - `dnc_auto_add = true`
   - `appointment_scheduler = true`
   - `callback_scheduler = true`
   - disposition's `pipeline_stage_id` maps to a `pipeline_stages` row with `convert_to_client = true`
   (Kept simple/safe. No agency-label dependence. "No Answer / Busy / Failed / Bad Number /
   Voicemail / skip-only" stay false unless they happen to carry one of the flags above.)
3. End with `NOTIFY pgrst, 'reload schema';`

No RLS change (column inherits existing `dispositions` policies). No data destruction.

---

## 4. Phase C — Settings UI (`DispositionsManager.tsx` + schema)

- `dispositionSchema.ts`: add `countsAsContacted: z.boolean()`; add to `NormalizedDisposition`
  + `normalizeDisposition`.
- `DispositionsManager.tsx`: `FormState` + `emptyForm` + `openEdit` + create/update payloads;
  new toggle card (surgical, matches existing pattern):
  - Label: **`Counts as Contacted`**
  - Helper: **`Turn on when this disposition means the agent reached a real person.`**
  - Optional small list badge (consistent with existing chips).
- `src/lib/types.ts` `Disposition`: add `countsAsContacted: boolean`.
- `supabase-dispositions.ts`: `DispositionRow` + `rowToDisposition` + `create` insert +
  `update` set.

---

## 5. Phase D — Trusted stats logic

- `report-utils.ts`:
  - Add `buildContactedDispositionSet(dispositions: {name; counts_as_contacted?}): Set<string>`
    (lowercased names where flag true).
  - Extend `isContactedCall(duration, dispositionName, dncSet?, contactedSet?)`:
    `duration > 45 OR contactedSet.has(name) OR dncSet.has(name) OR legacy dnc literal`.
    (DNC behavior preserved for back-compat; backfill also sets DNC → counts_as_contacted=true.)
- `supabase-dialer-stats.ts`: `getTrustedTodayDialerStats` accepts
  `contactedDispositionNames?: Set<string>` and forwards it to `isContactedCall`.
  Matching stays on `disposition_name` (since `disposition_id` is unpopulated — documented).
- `DialerPage.tsx` `reconcileTrustedStats`: build
  `contactedSet = buildContactedDispositionSet(dispositions)` and pass it. Requires
  `Disposition.countsAsContacted` (added in Phase C).

---

## 6. Phase E — Legacy/data behavior

- Existing calls with `duration > 45` remain contacted (unchanged threshold).
- DNC-style dispositions stay contacted (backfilled true).
- Short human-contact calls become contacted once the agency toggles that disposition on.
- No `calls.duration` change; no Twilio change.

---

## 7. Phase F — Docs

- `AGENT_RULES.md`: invariant — *Contacted is not inferred from agency-specific disposition
  labels. Trusted Contacted = Twilio-backed duration threshold OR
  `disposition.counts_as_contacted = true`.* Update §5 Contacted gotcha + invariant #12.
- `WORK_LOG.md`: newest-first entry.
- `implementation_plan.md`: this file.

---

## 8. Files & DB objects to touch

| File / object | Change |
|---|---|
| `supabase/migrations/20260529120000_add_counts_as_contacted_to_dispositions.sql` | NEW migration |
| `src/lib/types.ts` | `Disposition.countsAsContacted` |
| `src/integrations/supabase/types.ts` | add `counts_as_contacted` to `dispositions` Row/Insert/Update |
| `src/lib/supabase-dispositions.ts` | row type + map + create/update |
| `src/components/settings/dispositions/dispositionSchema.ts` | Zod field + normalize |
| `src/components/settings/DispositionsManager.tsx` | FormState + toggle UI |
| `src/lib/report-utils.ts` | `buildContactedDispositionSet` + `isContactedCall` param |
| `src/lib/supabase-dialer-stats.ts` | `contactedDispositionNames` param |
| `src/pages/DialerPage.tsx` | build + pass contacted set in `reconcileTrustedStats` |
| `AGENT_RULES.md`, `WORK_LOG.md` | docs |

**NOT touched:** `calls.duration`, `twilio-voice-status`, `twilio-voice-webhook`,
`answerOnBridge`, Twilio/queue architecture, `TwilioContext.tsx` guards, Sold/Convert gating,
callback/appointment reliability, queue manager, disposition save flow beyond the new field,
Reports surfaces (Build 4 cleanup).

---

## 9. Verification

1. `npx tsc --noEmit`
2. `npm test -- --run`
3. Static: no `calls.duration` change; 0 Twilio files in diff; migration ends with
   `NOTIFY pgrst, 'reload schema';`; runtime contacted logic hardcodes no agency labels;
   settings UI reads/writes `counts_as_contacted`.
4. Migration (pre-prod): show full diff; after apply confirm column exists + backfill result +
   PostgREST reload.
5. Runtime (post-deploy): toggle "Not Interested" → Counts as Contacted; short answered call
   <45s dispositioned as it → Contacted increments; toggle off no-answer/busy → no increment;
   call >45s → increments regardless of toggle; no-answer duration 0 → no increment; P0
   duration stays Twilio-backed.
