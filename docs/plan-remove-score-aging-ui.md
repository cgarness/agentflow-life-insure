# Plan: Remove Score and Aging from Contacts UI

**Date:** 2026-05-16  
**Status:** Ready to implement

---

## Work Log conflict check

| IN PROGRESS item | Touches Contacts.tsx / ContactManagement.tsx? |
|------------------|-----------------------------------------------|
| Permissions System (Phases 1–4) | No — sidebar, gates, role_permissions only |

**Verdict:** Safe to proceed.

---

## Preserved (do not change)

- `leads.lead_score` column and all Supabase queries
- `get_next_queue_lead` RPC
- Migration files (including `20260326220000` JSONB defaults)
- `leadScore` on create/import payloads (data layer defaults)
- Required Fields tab `"Age"` optional toggle (DOB-related field name, not aging column)

---

## Files to modify

| File | Changes |
|------|---------|
| `src/pages/Contacts.tsx` | Remove score/aging columns, helpers, sort, cells, layout widths |
| `src/components/settings/ContactManagement.tsx` | Remove Score + Age from `STANDARD_FIELDS_LEAD` (Field Layout tab) |
| `ROADMAP.md` | Work log entry + technical debt note for Contacts.tsx line count |

**Not in scope** (out of task): `FullScreenContactView.tsx`, `KanbanCard.tsx`, `contactFieldLayout.ts` — may still reference `leadScore` for other surfaces.

---

## Contacts.tsx — detailed edits

1. Remove `agingPill` helper (lines 91–97)
2. Remove `calcAging` import if unused after column removal
3. `ColumnKey` — drop `"score"` \| `"aging"`
4. `ALL_COLUMNS` — remove score and aging entries
5. `STARTER_LAYOUT.Leads` — remove `score` and `aging` width keys
6. `getSortValue` — remove `case "score"` and `case "aging"`
7. `renderCell` — remove score/aging branches; drop `aging` parameter
8. `colAlign` — remove score/aging center alignment branch
9. Table body — stop calling `calcAging` per row
10. Filters/detail — none found in this file (detail is `FullScreenContactView`)

---

## ContactManagement.tsx — detailed edits

**Already done (prior session):** Display Settings tab, Lead Aging Thresholds card, `ALL_COLUMNS` / `SORT_OPTIONS` in DisplaySettingsTab — removed per ROADMAP 2026-05-16.

**This task:**

1. `STANDARD_FIELDS_LEAD` — remove `{ id: "leadScore", name: "Score" }` and `{ id: "age", name: "Age" }`
2. Leave `fieldOrderLead` default array unchanged (harmless stale keys; migration untouched)

---

## Technical debt

- `Contacts.tsx` is **~2,433 lines** (limit 200). Note in ROADMAP; no refactor in this task.

---

## Verification

```bash
cd agentflow-life-insure && npx tsc --noEmit
```

Manual: Leads table — Score/Aging columns gone from picker and grid; Settings → Contact Management → Field Layout — Score/Age not listed for leads.
