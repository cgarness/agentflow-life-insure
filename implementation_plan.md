# Implementation Plan — Dispositions Build 1: canonical-field model

**Owner:** Chris Garness | **Status:** `[APPROVED] / [DONE]` 2026-05-23 — migration applied, Edge Function v37 deployed, frontend cutover landed, AGENT_RULES invariant added, tsc clean, 72/72 tests pass. Not pushed.
**Date:** 2026-05-23 (per system context)

> **Scope reminder.** Build 1 = canonical-field standardization, future-org seeding fix, reporting/classification cutover, AGENT_RULES invariant.
> Build 2 (deferred) = RLS, org-scoped API methods, Zod, read-only gates, reorder hardening.
> No Twilio/dialer architecture changes. No RLS changes. No frontend role gates added. No Zod added. No DispositionsManager refactor.

---

## 0. Product decisions (locked, from brief)

- **Canonical fields:** `campaign_action` (text enum), `dnc_auto_add` (bool).
- **Deprecated (kept for compat, NOT dropped):** `remove_from_queue` (bool), `auto_add_to_dnc` (bool).
- **No new code reads/writes legacy fields** except explicit migration/backfill compat.
- **Fake/test orgs are not touched.** Only Chris's home org `a0000000-0000-0000-0000-000000000001` is real.
- **No default-disposition backfill into existing zero-disposition orgs.**
- **Future create-organization seeding** must write canonical fields only.

---

## 1. Live inspection findings

### 1a. `public.dispositions` schema (prod `jncvvsvckxhqgqvkppmj`)
Columns relevant to this build:
- `campaign_action text NOT NULL DEFAULT 'none'` — canonical (already present).
- `dnc_auto_add boolean NOT NULL DEFAULT false` — canonical (already present).
- `remove_from_queue boolean NOT NULL DEFAULT false` — **legacy** (keep).
- `auto_add_to_dnc boolean NOT NULL DEFAULT false` — **legacy** (keep).
- `organization_id uuid NULL` (FK → organizations). **Not changed in Build 1.**

Existing constraints:
- `dispositions_campaign_action_check` already enforces `campaign_action IN ('none','remove_from_queue','remove_from_campaign')` — already matches brief §C.6.
- PK on `id`; FKs to organizations and pipeline_stages. No NOT NULL on `organization_id`.

### 1b. Row inventory (live)
- **6 dispositions total**, all in Chris's home org (`a0000000-0000-…-0000000001`).
- **0 rows with NULL `organization_id`** → no orphan rows; no rows to refuse migration on.
- **0 rows requiring safe legacy→canonical backfill** (`auto_add_to_dnc=true AND dnc_auto_add=false` → 0; `remove_from_queue=true AND campaign_action IN (NULL,'none')` → 0).
- **2 rows with action-side "mismatch" but in the *canonical-set, legacy-unset* direction:**
  - `Not Interested` — `remove_from_queue=false`, `campaign_action='remove_from_campaign'`.
  - `Sold` — `remove_from_queue=false`, `campaign_action='remove_from_queue'`.
  These are intentional canonical values that *do not* meet the "safe backfill" precondition (legacy true & canonical default). **Migration must NOT touch them.**
- `DNC` row has both legacy + canonical set true on both pairs — consistent, no-op.
- `dnc_auto_add` vs `auto_add_to_dnc` mismatch count: **0**.

Conclusion: migration is essentially a no-op data-wise. It adds protective documentation/constraints only.

### 1c. Orgs with zero dispositions (visibility only, NOT seeded by this build)
| org_id | name | created_at |
|---|---|---|
| `fe376eca-36b4-4e79-923e-49df41fcf4f9` | John's Agency | 2026-04-24 |
| `3e1c20d3-f240-4634-9829-cfca2222dc32` | test-prov-smoke-001 | 2026-05-03 |
| `6023b59c-1e82-4ea1-80d3-9853b6022307` | chris's Agency | 2026-05-04 |
| `2717155f-b058-4f47-9d78-d2898036b9b8` | capital | 2026-05-04 |
| `c60a2345-7f98-4b65-965b-3c5e13dca297` | Capital life | 2026-05-19 |

All five are fake/test orgs per Chris's directive. **Not touched.**

### 1d. Code-path inventory of legacy/canonical refs
Files referencing the columns or camel-case mirrors:

| File | Legacy reads/writes | Canonical reads/writes | Action |
|---|---|---|---|
| `src/lib/supabase-dispositions.ts` | none | `campaign_action`, `dnc_auto_add` (R/W via canonical only) | **No change.** Already canonical. |
| `src/components/settings/DispositionsManager.tsx` | none | `campaignAction`, `dncAutoAdd` (form) | **No change.** Already canonical. |
| `src/pages/DialerPage.tsx` (lines 130–131, 837–838, 2659–2700) | none | `campaignAction`, `dncAutoAdd` (disposition-submit path) | **No change.** Dialer already canonical. |
| `src/lib/types.ts` (`Disposition`) | none | `campaignAction`, `dncAutoAdd` | **No change.** |
| `src/lib/report-utils.ts` (`buildDNCDispositionSet`) | **reads `auto_add_to_dnc`** | — | **Cutover** → read `dnc_auto_add`. |
| `src/lib/reports-queries.ts` (`fetchDispositions`) | **selects `auto_add_to_dnc`** | — | **Cutover** → select `dnc_auto_add`. |
| `src/lib/stat-computations.ts` (interface + `dispoFlagSet` call) | **reads `auto_add_to_dnc`** | — | **Cutover** → read `dnc_auto_add`. |
| `src/components/reports/StatsGrid.tsx` (props interface line 21) | **types `auto_add_to_dnc`** | — | **Cutover** → type `dnc_auto_add`. |
| `supabase/functions/create-organization/index.ts` (lines 70–75) | **writes `remove_from_queue`, `auto_add_to_dnc`** | — | **Cutover** → write `campaign_action`, `dnc_auto_add`. Also fix default list per §3a. |
| `src/integrations/supabase/types.ts` (lines 2357–2426) | already includes both | already includes both | **No change.** Type already has both. |
| `supabase/migrations/20260513180000_fix_reports_rpcs_data_accuracy.sql` (historical) | uses `auto_add_to_dnc` in three SQL RPCs | — | New migration recreates the same three RPCs to read `dnc_auto_add`. |
| `supabase/migrations/20260324100000_add_disposition_campaign_action.sql` (historical) | references both | — | **Read-only** — historical, do not modify. |

### 1e. DB-side RPCs reading legacy `auto_add_to_dnc`
Confirmed via `pg_proc` scan — three SECURITY DEFINER functions still reference `auto_add_to_dnc`:
- `public.rpc_report_call_summary` (contacted classification).
- `public.rpc_report_call_volume_timeseries` (contacted classification).
- `public.rpc_report_campaign_performance` (contacted classification, both campaign and lead-source CTEs).

All three classify "contacted" as `duration > 45 OR EXISTS(disposition.auto_add_to_dnc = true)`. New migration recreates each with `dnc_auto_add` substituted; **no other logic change** (contacted-duration threshold 45 preserved per AGENT_RULES §5).

### 1f. AGENT_RULES.md / VISION.md / WORK_LOG.md scan
- `AGENT_RULES.md` does **not** currently document the disposition canonical/legacy split. **Add invariant in this build.**
- `VISION.md` mentions dispositions only at a high level — no edits required.
- `WORK_LOG.md` newest entries (2026-05-25 templates, 2026-05-23 goals, 2026-05-23 DNC, prior Call Scripts) — no conflicts with this work. No in-flight disposition migration.

### 1g. create-organization Edge Function (live)
- `version 36`, `verify_jwt: false` (preserve). Source on disk matches deployed source byte-for-byte. Default list currently seeds **6** dispositions using legacy flags:
  - Appointment Set (locked, `remove_from_queue=true`, `appointment_scheduler=true`)
  - Follow-Up (`remove_from_queue=true`, `callback_scheduler=true`)
  - Not Interested (`remove_from_queue=true`)
  - Wrong Number (`remove_from_queue=true`)
  - DNC (locked, `remove_from_queue=true`, `auto_add_to_dnc=true`)
  - No Answer (locked, `remove_from_queue=false`)
- **Brief specifies a different list:** No Answer, Appointment Set, Call Back, Not Interested, DNC, Sold (6 items, with `Call Back` and `Sold` replacing `Follow-Up` and `Wrong Number`).
- Per brief §7: "If the existing create-organization function uses a different list, document the diff in implementation_plan.md before editing." Diff documented; see §3a below for the proposed seed list and §3b for the resolution question for Chris.

---

## 2. Files to touch (exact list, before any edit)

### Migrations (new)
1. `supabase/migrations/20260524180000_dispositions_canonical_fields_backfill.sql`
   - Safe legacy→canonical backfill (currently 0 rows match, but harmless).
   - Reaffirm `campaign_action` CHECK constraint values (already correct; verify via DO).
   - `COMMENT ON COLUMN` for both legacy columns to mark deprecated.
   - Recreate the three reporting RPCs (`rpc_report_call_summary`, `rpc_report_call_volume_timeseries`, `rpc_report_campaign_performance`) reading `dnc_auto_add` instead of `auto_add_to_dnc`. Bodies otherwise byte-identical to the live functions in §1e.
   - `NOTIFY pgrst, 'reload schema';` at end.
   - **No** `organization_id NOT NULL`. **No** RLS changes.

### Edge Function (deploy full)
2. `supabase/functions/create-organization/index.ts`
   - Replace legacy disposition writes with canonical writes.
   - Adopt the brief's default list (see §3a/§3b).
   - **Preserve `verify_jwt: false`.**
   - Full-file deploy via `deploy_edge_function` (per AGENT_RULES §4).

### Frontend — reporting/classification cutover
3. `src/lib/report-utils.ts` — `buildDNCDispositionSet` parameter type + body: `auto_add_to_dnc` → `dnc_auto_add`.
4. `src/lib/reports-queries.ts` — `fetchDispositions` SELECT: `auto_add_to_dnc` → `dnc_auto_add`.
5. `src/lib/stat-computations.ts` — `StatDataSources.dispositions` interface, `dispoFlagSet`'s `flag` union, `aggregate()` call site: `auto_add_to_dnc` → `dnc_auto_add`.
6. `src/components/reports/StatsGrid.tsx` — `Props.dispositions` interface: `auto_add_to_dnc` → `dnc_auto_add`.

### Docs
7. `AGENT_RULES.md` — append invariant under §5 Schema Gotchas (see §5 below).
8. `WORK_LOG.md` — append newest-first entry per brief §G.
9. `implementation_plan.md` — this file (post-approval, mark `[APPROVED] / [DONE]`).

### Not touched (out of scope for Build 1)
- `src/components/settings/DispositionsManager.tsx` — already canonical-only on read/write paths.
- `src/lib/supabase-dispositions.ts` — already canonical-only.
- `src/pages/DialerPage.tsx` — already canonical-only on disposition-submit path.
- `src/lib/types.ts` — already canonical.
- `src/integrations/supabase/types.ts` — already lists both; no rename, no drop.
- RLS policies on `dispositions`, organization_id NOT NULL — Build 2.
- Zod, role gates, reorder hardening — Build 2.
- Twilio/dialer architecture — never in this build.

---

## 3. Migration design — `20260524180000_dispositions_canonical_fields_backfill.sql`

Pseudocode (final SQL written on approval):

```
-- 1. Safety: ensure no NULL org rows would be silently mutated (raise if any appear).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.dispositions WHERE organization_id IS NULL) THEN
    RAISE EXCEPTION 'dispositions has NULL organization_id rows — refuse to backfill (Build 1 invariant)';
  END IF;
END $$;

-- 2. Safe legacy → canonical backfill (verified 0 matching rows on prod; intentional canonical values are NOT touched).
UPDATE public.dispositions
   SET dnc_auto_add = true
 WHERE auto_add_to_dnc = true
   AND dnc_auto_add = false;

UPDATE public.dispositions
   SET campaign_action = 'remove_from_queue'
 WHERE remove_from_queue = true
   AND (campaign_action IS NULL OR campaign_action = 'none')
   AND campaign_action NOT IN ('remove_from_queue','remove_from_campaign');  -- defense-in-depth

-- 3. Reaffirm campaign_action CHECK (constraint already exists with these values — verify, do not duplicate).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dispositions_campaign_action_check'
  ) THEN
    ALTER TABLE public.dispositions
      ADD CONSTRAINT dispositions_campaign_action_check
      CHECK (campaign_action IN ('none','remove_from_queue','remove_from_campaign'));
  END IF;
END $$;

-- 4. Mark deprecated columns via COMMENT.
COMMENT ON COLUMN public.dispositions.remove_from_queue
  IS 'DEPRECATED — use campaign_action. Kept for backward compatibility; new code must not read/write.';
COMMENT ON COLUMN public.dispositions.auto_add_to_dnc
  IS 'DEPRECATED — use dnc_auto_add. Kept for backward compatibility; new code must not read/write.';

-- 5. Recreate the three reporting RPCs to read dnc_auto_add (full bodies preserved verbatim from §1e otherwise).
CREATE OR REPLACE FUNCTION public.rpc_report_call_summary(...) ...
  -- s/d.auto_add_to_dnc/d.dnc_auto_add/g
CREATE OR REPLACE FUNCTION public.rpc_report_call_volume_timeseries(...) ...
  -- s/d.auto_add_to_dnc/d.dnc_auto_add/g
CREATE OR REPLACE FUNCTION public.rpc_report_campaign_performance(...) ...
  -- s/d.auto_add_to_dnc/d.dnc_auto_add/g

-- 6. Reload PostgREST schema cache (column comments + RPC bodies changed).
NOTIFY pgrst, 'reload schema';
```

**Explicit non-actions:**
- No `ALTER COLUMN organization_id SET NOT NULL`.
- No `DROP COLUMN remove_from_queue` / `auto_add_to_dnc`.
- No RLS policy change.
- No default-disposition seeding into existing orgs.

---

### 3a. Proposed default-disposition seed list (create-organization)

Brief-specified canonical list with mapped flags. Sort order matches brief's order:

| sort_order | name | color | is_locked | campaign_action | dnc_auto_add | callback_scheduler | appointment_scheduler |
|---:|---|---|:---:|---|:---:|:---:|:---:|
| 0 | No Answer | `#3B82F6` | true | `none` | false | false | false |
| 1 | Appointment Set | `#10B981` | true | `remove_from_queue` | false | false | true |
| 2 | Call Back | `#F59E0B` | false | `none` | false | true | false |
| 3 | Not Interested | `#EF4444` | false | `remove_from_campaign` | false | false | false |
| 4 | DNC | `#000000` | true | `remove_from_campaign` | true | false | false |
| 5 | Sold | `#059669` | false | `remove_from_queue` | false | false | false |

Rationale for flag choices:
- `Appointment Set`: keep on the lead/contact, but pull out of active dial queue (matches FFL flow + matches Chris's home-org row where Sold uses `remove_from_queue`).
- `Not Interested`, `DNC`: remove from campaign entirely (matches existing `Not Interested` row in Chris's home org).
- `Sold`: `remove_from_queue` (matches Chris's home org row exactly).
- `DNC`: `dnc_auto_add=true` (matches existing live `DNC` row).
- `Call Back`: `callback_scheduler=true`, no campaign action (so the lead stays available to be re-queued after the callback).
- `No Answer`: no campaign action (keep dialing through the queue).
- Colors: re-use the FFL palette already present in `AGENT_RULES.md` notes / current seed; `Call Back` reuses `#F59E0B`.

### 3b. Open question for Chris (must resolve before editing the Edge Function)

The brief's list (`No Answer / Appointment Set / Call Back / Not Interested / DNC / Sold`) differs from the currently deployed seed list (`Appointment Set / Follow-Up / Not Interested / Wrong Number / DNC / No Answer`) in two items:
- **Adds:** `Call Back`, `Sold`.
- **Drops:** `Follow-Up`, `Wrong Number`.

Chris's home org currently has the **brief's** list (`No Answer / Appointment Set / Call Back / Not Interested / DNC / Sold`). I'll align future-org seeding to the brief / home-org list unless Chris says otherwise.

**Asking for explicit `#APPROVE` on the seed list above and the flag mapping in §3a.** No deploy until that answer lands.

---

## 4. Frontend cutover details

### 4a. `src/lib/report-utils.ts`
```diff
- dispositions: Array<{ name: string; auto_add_to_dnc?: boolean | null }>
+ dispositions: Array<{ name: string; dnc_auto_add?: boolean | null }>
  ...
- if (d.auto_add_to_dnc) dnc.add(d.name.toLowerCase());
+ if (d.dnc_auto_add) dnc.add(d.name.toLowerCase());
```

### 4b. `src/lib/reports-queries.ts`
```diff
- supabase.from("dispositions").select("id, name, color, pipeline_stage_id, auto_add_to_dnc, callback_scheduler, appointment_scheduler")
+ supabase.from("dispositions").select("id, name, color, pipeline_stage_id, dnc_auto_add, callback_scheduler, appointment_scheduler")
```

### 4c. `src/lib/stat-computations.ts`
```diff
  dispositions?: {
    name: string;
-   auto_add_to_dnc?: boolean;
+   dnc_auto_add?: boolean;
    callback_scheduler?: boolean;
    appointment_scheduler?: boolean;
  }[];
  ...
- flag: "auto_add_to_dnc" | "callback_scheduler" | "appointment_scheduler",
+ flag: "dnc_auto_add" | "callback_scheduler" | "appointment_scheduler",
  ...
- const dncSet = dispoFlagSet(dispositions, "auto_add_to_dnc");
+ const dncSet = dispoFlagSet(dispositions, "dnc_auto_add");
```

### 4d. `src/components/reports/StatsGrid.tsx`
```diff
  dispositions?: {
    name: string;
-   auto_add_to_dnc?: boolean;
+   dnc_auto_add?: boolean;
    callback_scheduler?: boolean;
    appointment_scheduler?: boolean;
  }[];
```

No new code reads `auto_add_to_dnc` or `remove_from_queue` after this build.

### 4e. Compatibility fallback?
**None.** Production has 0 rows where canonical and legacy disagree on DNC (`dnc_auto_add` vs `auto_add_to_dnc`); after the safe backfill in §3, the canonical column is authoritative. No fallback needed.

---

## 5. AGENT_RULES.md invariant (append under §5 Schema Gotchas)

Proposed addition (one new row + a short note block):

```
| Disposition canonical fields | `campaign_action` (queue/campaign action) and `dnc_auto_add` (DNC auto-add) are canonical. `remove_from_queue` and `auto_add_to_dnc` are deprecated, kept for compat, must not be read/written by new code except explicit migration/backfill. |
```

(Exact wording locked at edit time; ≤2 lines, matches §5 table style.)

---

## 6. Verification plan

1. **TypeScript:** `npx tsc --noEmit` → 0 errors.
2. **Tests:** `npm test -- --run` → pre-existing 72/72 passing baseline preserved.
3. **DB audit post-migration:**
   - Re-run the mismatch query from §1b → expect `mismatch_action_rows = 2` (unchanged; intentional canonical) and `mismatch_dnc_rows = 0`.
   - Confirm `safe_backfill_*` = 0 (no rows were eligible, so no mutation occurred).
   - `\d+ dispositions` shows COMMENTs on the two legacy columns.
   - `campaign_action` CHECK constraint still present with three allowed values.
   - All three reporting RPCs reference `dnc_auto_add`, no longer `auto_add_to_dnc` (`pg_get_functiondef` scan).
   - Disposition counts per org unchanged (6 in home org, 0 in each fake/test org).
4. **Edge Function:** `get_edge_function` after deploy → confirm `verify_jwt: false` preserved, new file content shows canonical inserts.
5. **Manual code verification (grep):**
   - No new occurrences of `auto_add_to_dnc` or `remove_from_queue` in `src/**` or `supabase/functions/**` except (a) historical migration files, (b) types.ts (kept), (c) DispositionsManager / supabase-dispositions / DialerPage / types.ts already canonical (untouched).
6. **Manual smoke (deferred to Chris):**
   - Dialer disposition-submit path still triggers campaign action + DNC auto-add for `DNC` row in home org (no behavior change expected).
   - Reports page renders with no console errors (DNC count, contacted rate, callback rate still populated from canonical column).
   - Create a throwaway test org via Settings → confirm seeded 6 dispositions with canonical fields populated. Delete after verification.

---

## 7. Stop-conditions (per brief §B "Stop and report")

Before applying migration / deploying function I will pause and re-confirm if any of the following emerge:
- Any row with `organization_id IS NULL` (currently 0, but re-checked at apply time).
- Any legacy/new mismatch that cannot be safely inferred (currently 0 in the safe-backfill direction; 2 in the canonical-set / legacy-default direction which are deliberately untouched).
- Any migration draft that would mutate fake/test-org data beyond the safe backfill (current draft mutates 0 rows total).

---

## 8. Risks / open questions

- **R1.** Recreating the three RPCs is a behavior-equivalent rename (`auto_add_to_dnc` → `dnc_auto_add`). Because live data has both columns equal where set, contacted-classification output is unchanged. Documented.
- **R2.** Edge Function deploy bumps version. `verify_jwt: false` preserved (per AGENT_RULES §4 / brief §D.3).
- **R3.** No fake/test org is mutated. Five existing zero-disposition orgs remain zero-disposition (none of them are used in production per Chris's directive).
- **R4.** Open question §3b — confirm the seed list `No Answer / Appointment Set / Call Back / Not Interested / DNC / Sold` and the per-row flag mapping.
- **R5.** Build 1 leaves `organization_id` nullable. Build 2 will close that and add RLS + Zod + read-only gates.

---

## 9. Sequencing

1. **Chris approves this plan (incl. §3a/§3b seed list).**
2. Write migration file `20260524180000_dispositions_canonical_fields_backfill.sql`.
3. `apply_migration` to prod (`jncvvsvckxhqgqvkppmj`).
4. Re-audit (§6.3).
5. Edit frontend reporting files (§4a–§4d).
6. Edit and deploy create-organization Edge Function (full file via `deploy_edge_function`, `verify_jwt: false`).
7. Append AGENT_RULES.md invariant (§5).
8. `npx tsc --noEmit` + `npm test -- --run`.
9. Append WORK_LOG.md entry (§G in brief; newest-first).
10. Stop. Do not push or merge unless Chris approves.

---

**Awaiting Chris's `#APPROVE` (and confirmation on §3a/§3b seed list) to proceed.**
