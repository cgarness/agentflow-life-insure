# Plan: Centralized DOB Parsing + MM/DD/YYYY Display

**Date:** 2026-05-16  
**Status:** Awaiting review — do not implement until approved

---

## Pre-flight summary

### Docs read
- `AGENT_RULES.md` — component limits, Zod, no schema changes without permission
- `VISION.md` — US life-insurance niche, telemetry accuracy
- `ROADMAP.md` (Work Log through 2026-05-16) — no conflicting in-progress work on this surface

### Work Log conflict check

| Active `[IN PROGRESS]` | Touches `ImportLeadsModal.tsx`, `dateUtils`, or lead DOB display? |
|------------------------|---------------------------------------------------------------------|
| Permissions System (Phases 1–5, historical entries) | No — gates, sidebar, `role_permissions` only |

**Verdict:** Safe to proceed after plan approval.

### Prior BUGFIX: `workflow_on_lead_created` / `NEW.source`

- **Status:** `[DONE]` — 2026-05-16 (`20260517000000_fix_lead_workflow_trigger_source_column.sql`)
- Import path uses `import-contacts` → `lead_source` on insert; not blocked by this task

### Storage contract (unchanged)
- Postgres `leads.date_of_birth` remains `date` → ISO `YYYY-MM-DD`
- App layer: **display** = `MM/DD/YYYY` via `formatDOB()`; **submit/import** = ISO via `parseDOB()`

---

## 1. New utility: `src/utils/dobUtils.ts`

**Dependencies:** `date-fns` is already in `package.json` — use `parse`, `format`, `isValid` for consistency with `DateInput.tsx`. Hand-roll only where date-fns does not help (Excel serial, strict validation).

### `parseDOB(input: string | number | null | undefined): string | null`

**Returns:** ISO `YYYY-MM-DD` for DB, or `null` if empty/invalid.

| Input type | Handling |
|------------|----------|
| `null` / `undefined` / `""` / whitespace-only | `null` |
| `number` or numeric string (e.g. `30819`) | Excel serial → local calendar date (epoch **1899-12-30**, standard 1900 system) |
| `YYYY-MM-DD` or `YYYY/MM/DD` | Parse as ISO order (year first) |
| `MM/DD/YYYY`, `MM-DD-YYYY`, `M/D/YYYY` | US order (month first) |
| Two-digit year | Pivot: `YY >= 26` → `19YY`, else `20YY` (per spec; anchor year 2026) |

**Validation (all paths):**
- Reject month ∉ [1,12], day ∉ valid range for month/year (incl. leap years)
- Reject impossible dates (e.g. Feb 30)
- Optional sanity band: year 1900–2100 (document in tests)

**Ambiguity rule:** When the first segment is 4 digits, treat as **ISO (YYYY-MM-DD)**. Otherwise treat as **US (MM/DD/YYYY)**. No European `DD/MM/YYYY` — product is US-only.

### `formatDOB(iso: string | null | undefined): string`

**Returns:** `MM/DD/YYYY` with zero-padded month/day, or `""` if null/invalid.

- Parse ISO with `date-fns` `parse(iso, 'yyyy-MM-dd', …)` + `isValid`
- Do **not** use `new Date(iso)` alone (timezone drift risk)

### Tests: `src/utils/dobUtils.test.ts` (Vitest)

Cover at minimum:
- ISO and slash ISO
- US formats (padded and single-digit)
- Two-digit year pivot (25 → 2025, 26 → 1926, 99 → 1999, 00 → 2000)
- Excel serial `30819` → known date
- Invalid: Feb 30, month 13, garbage string
- Empty → null; format empty → `""`

### `dateUtils.ts` (existing)

- **No change required** for this task — `calculateAge()` already splits on `[-T/]` and works on ISO from DB
- Optional follow-up: have `calculateAge` call `parseDOB` first if non-ISO slips through (out of scope unless needed)

---

## 2. Import flow: `ImportLeadsModal.tsx` + extraction

**Current state:** ~1,654 lines (known tech debt). Task: keep **sections** from growing; extract DOB logic.

### New hook: `src/hooks/useDOBImportValidation.ts`

**Inputs:** `csvRows`, `mappings`, `existingLeads` (same as today’s `analysisResult` deps)

**Outputs:**
- `analysisResult` — extend row type with optional `dobError?: string`
- `dobMapped: boolean` — true when any column maps to `"Date of Birth"`
- Helpers: `getDisplayDOB(raw: string): string` → `formatDOB(parseDOB(raw) ?? '')` or show raw with error styling

**Step 3 analysis rules:**
1. After phone/name checks, if `dobMapped`:
   - Read raw cell for mapped DOB column
   - If non-empty: `parseDOB(raw)`; if `null` → `status: "error"`, `errorMsg: "Invalid date of birth (use MM/DD/YYYY)"`
   - If empty: allow (optional field) — no error
2. Increment **Rows with Errors** via existing `errorCount` filter

**Step 3 preview table:**
- If DOB column is mapped, add **DOB** column to preview (or format in Step 2 mapping preview when field is `"Date of Birth"`)
- Display via `formatDOB(parseDOB(raw))` for valid; show raw + error badge when invalid

**`doImport` payload (before `import-contacts`):**
```ts
dateOfBirth: (() => {
  const raw = getVal(r.row, "Date of Birth");
  if (!raw) return undefined;
  return parseDOB(raw) ?? undefined; // invalid rows already excluded by analysis filter
})(),
```
- Filter import rows: only `ready` | `duplicate` **without** `error` (already the case once DOB errors are tagged)

**Template CSV:**
| Row | Change |
|-----|--------|
| John Smith | `1983-05-12` → `05/12/1983` |
| Jane Doe | `1990-08-23` → `08/23/1990` |

**Step 2 mapping preview:** When mapped field is `"Date of Birth"`, show `formatDOB(parseDOB(previewVal))` instead of raw ISO.

---

## 3. Display audit — files to touch

| File | Current behavior | Planned change |
|------|------------------|----------------|
| `src/pages/Contacts.tsx` | Table + sort show raw ISO `l.dateOfBirth` | **Display:** `formatDOB(l.dateOfBirth)`; **sort:** keep ISO string (sorts correctly) |
| `src/components/contacts/FullScreenContactView.tsx` | Read-only dates use `formatDate(val)` from branding | **DOB field only:** `formatDOB(val)` in `renderField` when `key === "dateOfBirth"`; edit mode unchanged (`DateInput` already MM/DD display, ISO storage) |
| `src/components/dialer/LeadCard.tsx` | `Field` renders raw `date_of_birth` | **Display:** `formatDOB(String(value))` when `fieldKey === "date_of_birth"`; **Edit:** swap to `DateInput` for that key (ISO in `editForm`) |
| `src/pages/DialerPage.tsx` | Passes through `date_of_birth` to LeadCard | **No display logic** unless a stray render exists — verify grep; only ensure save path keeps ISO (DateInput / existing string ISO) |
| `src/components/dashboard/DashboardDetailModal.tsx` | Anniversaries: `toLocaleDateString({ month, day })` | **Birthday line:** use `formatDOB(item.date)` for consistency (full MM/DD/YYYY in US format) |

### Verified — already correct (no change)

| File | Why |
|------|-----|
| `src/components/shared/DateInput.tsx` | Displays `MM/dd/yyyy`, emits `yyyy-MM-dd` |
| `src/components/contacts/AddLeadLeadFormBody.tsx` | Uses `DateInput` + `calculateAge` on ISO |
| `src/contexts/BrandingContext.tsx` | `formatDate` already `MM/dd/yyyy` — used for generic dates, not replacing dedicated DOB util for lead DOB fields |

### Out of scope (not user-facing DOB render)

| File | Reason |
|------|--------|
| `src/lib/supabase-contacts.ts`, `supabase-leads.ts`, `types.ts` | Storage/mapping only |
| `src/integrations/supabase/types.ts` | Generated |
| `supabase/functions/import-contacts/index.ts` | Receives ISO from client; **no EF change** |
| `ContactManagement.tsx` | Field layout labels only |
| `contactFieldLayout.ts` | Metadata |

### Future audit checklist (no DOB UI today)

- **Export Contacts** permission exists but **no CSV export implementation** in `Contacts.tsx` yet — when built, use `formatDOB` for DOB column
- **Reports CSV** (`reports-queries.ts` + chart components) — no lead DOB column in any current export; add `formatDobForCsv(iso)` helper next to `downloadCSV` for future lead exports
- `LeadCardBlurred.tsx` — blurred placeholder only
- Workflow time-based trigger (Edge) — server-side; out of scope

---

## 4. Reports / CSV export

**Current:** `downloadCSV` in `reports-queries.ts` is generic; no report includes `date_of_birth`.

**Plan:**
- Add `formatDobForCsv(iso: string | null | undefined): string` in `dobUtils.ts` (alias/wrapper around `formatDOB`) **or** export from `reports-queries.ts` re-exporting `formatDOB`
- Document in code comment: any future row builder that includes DOB must call this before `downloadCSV`
- **No changes** to existing report chart exports (they don't include DOB)

---

## 5. Forms + Zod

| Surface | Action |
|---------|--------|
| `AddLeadLeadFormBody` + `DateInput` | Already correct — verify submit path sends ISO |
| `addLeadLeadZod.ts` | Add optional `dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal(""))` (or `.refine` with `parseDOB`) |
| `FullScreenContactView` | Edit uses `DateInput` — OK |
| `LeadCard` dialer inline edit | Upgrade DOB to `DateInput` (see above) |

---

## 6. Blockers assessment

| Risk | Assessment |
|------|------------|
| `DateInput` / Popover calendar | **Not a blocker** — already MM/DD display, ISO value |
| Third-party DOB picker elsewhere | **None found** on lead DOB |
| `ImportLeadsModal` size | Extract hook; do not refactor whole modal |

**BLOCKERS section in ROADMAP:** Only if implementation discovers an unfixable third-party format — none expected.

---

## 7. Implementation order

1. `dobUtils.ts` + `dobUtils.test.ts` — run `npm test` / `vitest`
2. `useDOBImportValidation.ts`
3. `ImportLeadsModal.tsx` — template, hook wiring, preview, `doImport`
4. Display audit files (Contacts, FullScreenContactView, LeadCard, DashboardDetailModal)
5. `addLeadLeadZod.ts` — DOB ISO optional
6. `reports-queries.ts` — comment + thin `formatDobForCsv` export (optional re-export)
7. `ROADMAP.md` Work Log entry + context snapshot (after implementation, not in plan phase)

---

## 8. Quality gates

```bash
cd agentflow-life-insure && npx vitest run src/utils/dobUtils.test.ts
cd agentflow-life-insure && npx tsc --noEmit
```

**Manual QA:**
1. Download template → DOB columns show `05/12/1983`, `08/23/1990`
2. Import CSV with mixed formats (ISO, US, Excel serial, invalid `02/30/2000`) → invalid rows in error count; valid rows store correct age/DOB in DB
3. Contacts table (enable DOB column) → MM/DD/YYYY
4. Full-screen lead view → DOB read-only MM/DD/YYYY
5. Dialer connected card → DOB MM/DD/YYYY; edit via calendar/text mask
6. Re-export round-trip: copy DOB from Contacts display into new CSV → re-import succeeds

---

## 9. ROADMAP entry (post-implementation)

```
[DONE] · 2026-05-16 · FEATURE: Centralized DOB parsing (parseDOB/formatDOB utils) + MM/DD/YYYY display across imports, lead detail, and CSV exports.
```

### Context snapshot template (fill after build)

**Files touched:**
- `src/utils/dobUtils.ts` (new)
- `src/utils/dobUtils.test.ts` (new)
- `src/hooks/useDOBImportValidation.ts` (new)
- `src/components/contacts/ImportLeadsModal.tsx`
- `src/pages/Contacts.tsx`
- `src/components/contacts/FullScreenContactView.tsx`
- `src/components/dialer/LeadCard.tsx`
- `src/components/dashboard/DashboardDetailModal.tsx`
- `src/lib/addLeadLeadZod.ts`
- `src/lib/reports-queries.ts` (helper/comment only)
- `ROADMAP.md`

**Already correct (verified, not skipped):** `DateInput.tsx`, `AddLeadLeadFormBody.tsx`, `BrandingContext.formatDate` for non-DOB dates

**Future checklist:** Contacts CSV export, any new lead report/export columns

---

## 10. Open questions for Chris

1. **Invalid DOB on import:** Confirm row is skipped with error (not imported with null DOB) when cell is non-empty but unparseable — plan assumes **yes**.
2. **Empty DOB on import:** Remains optional — no error — **confirm**.
3. **Dashboard birthdays:** Show full `MM/DD/YYYY` vs current “May 12” style — plan uses **full `formatDOB`** for consistency.

---

*End of plan — awaiting approval before any code changes.*
