# Settings → DNC List — Compliance & Tenant-Isolation Hardening

**Date:** 2026-05-23
**Branch:** `claude/brave-hamilton-ax8SJ`
**Status:** Implemented + applied. See `WORK_LOG.md` newest entry for the full execution record.

## Context

A review of Settings → DNC surfaced multiple issues, the most serious being that the dialer never actually consulted `dnc_list` before placing a call even though the UI claimed it did. Tenant isolation was also weak (nullable `organization_id`, two overlapping RLS policy sets — some with `IS NULL` branches, client queries that didn't filter by org, delete keyed by id only). Because this is a TCPA-compliance feature, these gaps were treated as critical.

## Final DNC enforcement rule (approved)

1. **Automated / auto-dial / predictive dialing** — hard block. Twilio is never invoked. No override. Predictive-block events are activity-logged with `source: "predictive_dnc_block"` and the lead is auto-advanced.
2. **Manual click-to-call** — `dnc-warning` event fires, surfacing the existing DNC Warning Modal. Agents and non-managers cannot override (button disabled, helper text shown). Admins and platform Super Admins can override only after explicit confirmation. Every override is activity-logged with `category: "telephony"`, `source: "manual_dnc_override"`, and metadata (`organization_id`, `userId`, `phoneNumber`, `leadId`, `reason`).
3. **No broad override system, no new permissions infrastructure.** Uses existing `profile.is_super_admin === true || profile.role === 'Admin'` gating. Team Leader override delegation remains deferred to the Permissions tab.
4. **DNC check happens before any Twilio call initiation** (top of `handleCall`, before counter updates or `initiateCall`).
5. **Single-leg WebRTC Twilio architecture preserved.** `TwilioContext` was not modified.

## Schema/RLS (applied to prod `jncvvsvckxhqgqvkppmj`)

- Migration: `supabase/migrations/20260524140000_dnc_list_compliance_hardening.sql`.
- Pre-apply audit: 0 rows / 0 NULL `organization_id`.
- `organization_id` → `NOT NULL` (with guard that raises if any NULLs exist).
- Replaced global `UNIQUE (phone_number)` with composite `UNIQUE (organization_id, phone_number)`.
- Wiped all existing policies (8 across two overlapping legacy sets). Recreated canonical four:
  - SELECT: own-org OR `is_super_admin()`.
  - INSERT/UPDATE/DELETE: own-org Admin (`get_user_org_id()` + `get_user_role() = 'Admin'`) OR `is_super_admin()`.
- No `organization_id IS NULL` branches anywhere. Post-apply: exactly 4 policies confirmed.

## DNC Settings UI hardening

- `fetchDNCList`: org-scoped `.eq('organization_id', organizationId)` (was RLS-only).
- Realtime: scoped via `filter: organization_id=eq.${organizationId}`, channel keyed by org, torn down on org change.
- `handleRemoveNumber`: `.eq('id', id).eq('organization_id', organizationId)` and now fires `logActivity` (delete-side logging previously missing).
- Insert: `as any` cast removed; generated types updated for non-null `organization_id`.
- Zod schema (`src/components/settings/dnc/dncSchema.ts`) for phone (`1\d{10}` after normalize) and reason (≤200 chars); inline field errors.
- Non-managers see read-only table (no Add/Actions, banner shown). Add modal, delete buttons, and override button gated by `canManage`.
- Copy renamed: "Global DNC" → "Agency DNC List" everywhere. Compliance notice rewritten to accurately describe enforcement.
- Non-functional "Import CSV" button removed (no `onClick` ever existed). Hidden until properly implemented.
- Search now also matches formatted-phone string + normalized search query (previously only matched raw stored digits).

## Verification

- `npx tsc --noEmit` — clean.
- `npm test -- --run` — 56/56 pass. Same 4 pre-existing test-env file-load failures (`supabaseUrl is required`) unchanged and unrelated.
- Post-migration RLS: `pg_policies` shows exactly 4 rows on `dnc_list`.
- Manual UI verification deferred to Chris.

## Out of scope / next passes

- CSV import (parse → normalize → bulk insert with `organization_id`).
- DNC change history report (activity log already captures everything; this is a reporting view).
- Wire `permissions.f["Override DNC"]` Team Leader flag through `usePermissions().hasFeatureAccess` and replace the role-string Admin gate.

---

# (Prior plan: Settings → Call Scripts Pass 2 — Refactor)

**Date:** 2026-05-23
**Branch:** `claude/pensive-lovelace-8VwlI` (continues from Pass 1 commit `cfec156`)
**Status:** Plan only — no edits yet.

---

## Pre-flight (completed)

| Step | Result |
|------|--------|
| Read `AGENT_RULES.md`, `VISION.md`, `WORK_LOG.md` | Done |
| WORK_LOG conflicts | None. Pass 1 (2026-05-23) is newest entry; no in-flight Call Scripts work. |
| Current `CallScripts.tsx` | 977 lines, single file. |
| Pass 1 invariants verified in code | `canManage = isSuperAdmin || role?.toLowerCase() === 'admin'`; `fetchScripts` org-scoped + bails on missing org; all mutations `.eq('id', …).eq('organization_id', organizationId)`; Zod imported from `@/components/settings/call-scripts/callScriptSchema`; realtime subscribes only with org. |
| Schema source | `src/components/settings/call-scripts/callScriptSchema.ts` (existing) — will live alongside the new files in the same folder. |

---

## Goal

Split `CallScripts.tsx` (977 lines → ~150-line orchestrator) into focused files under `src/components/settings/call-scripts/`. **Behavior is not allowed to change** — Pass 1 security, scoping, validation, realtime, and toast/optimistic behavior must be preserved verbatim.

State ownership stays in the orchestrator; children receive props + callbacks. No new context, no new libraries.

---

## File map

**New (all under `src/components/settings/call-scripts/`):**

| File | Lines (est.) | Responsibility |
|------|-------------:|----------------|
| `callScriptTypes.ts` | ~20 | `Script` interface; re-export `ProductType` from schema. |
| `callScriptConstants.ts` | ~35 | `productBadgeClass`, `MERGE_FIELDS`, `MERGE_PREVIEW`. (`PRODUCT_TYPES` stays in `callScriptSchema.ts` and is re-exported via the barrel-free direct import to avoid duplication.) |
| `callScriptUtils.ts` | ~25 | `timeAgo`, `wordCount`, `renderMergePreview(content, productType)`. |
| `CallScriptsList.tsx` | ~140 | Left panel: search, type filter, list rows, empty states, inline rename input, kebab actions, active toggle. Props: `scripts, filtered, selectedId, search, filterType, canManage, renamingId, renameValue, renameError, loading, onSearchChange, onFilterChange, onSelect, onAdd, onRenameStart, onRenameChange, onRenameCommit, onRenameCancel, onToggleActive, onDuplicate, onRequestDelete`. |
| `CallScriptEditor.tsx` | ~150 | Right panel: header (name input / product type popover / Edit/Preview toggle), preview banner, editor textarea / read-only render, footer (word/read time + Save). Props: `selected, canManage, editorContent, editorDirty, previewMode, saving, onSetPreview, onEditorChange, onChangeName, onChangeProductType, onSave, editorRef, wrapSelection, insertMergeField`. |
| `CallScriptToolbar.tsx` | ~70 | Formatting buttons + Merge Fields dropdown. Props: `onWrap(before, after), onInsertMergeField`. Only rendered by editor when `!previewMode && canManage`. |
| `AddCallScriptDialog.tsx` | ~85 | Add modal with Zod error display. Props: `open, onOpenChange, name, type, active, nameError, adding, onNameChange, onTypeChange, onActiveChange, onSubmit`. |
| `DeleteCallScriptDialog.tsx` | ~35 | Delete confirm. Props: `target, saving, onCancel, onConfirm`. |
| `UnsavedChangesDialog.tsx` | ~30 | Discard/keep editing. Props: `open, onOpenChange, onDiscard`. |

**Modified:**
- `src/components/settings/CallScripts.tsx` — becomes the orchestrator (state, handlers, supabase calls, realtime, activity log). Target ~200 lines.

**Untouched:**
- `src/components/settings/call-scripts/callScriptSchema.ts` (Zod) — already correctly placed.
- `src/integrations/supabase/types.ts`, all RLS/migrations, all other Settings components.

---

## State / data flow (unchanged)

`CallScripts.tsx` keeps ownership of all state:
- `scripts, loading, selectedId, search, filterType, editorContent, editorDirty, previewMode, saving`
- Add modal: `addOpen, newName, newType, newActive, newNameError, adding`
- Delete: `deleteTarget`
- Unsaved: `pendingSelect`
- Rename: `renamingId, renameValue, renameError, renameRef`
- Editor ref: `editorRef`

It also keeps all handlers (`handleAdd, toggleActive, duplicateScript, confirmDelete, startRename, commitRename, handleSave, changeProductType, changeEditorName, insertMergeField, wrapSelection, fetchScripts, selectScript, confirmLeave`) and passes them as props.

The `editorRef` is created in the parent and forwarded to `CallScriptEditor` so `insertMergeField` / `wrapSelection` continue to work against the live DOM textarea (no behavior change). Pass via prop (`editorRef: RefObject<HTMLTextAreaElement>`); the child attaches it to the textarea.

`renameRef` stays in the parent (used by `startRename`) and is passed down to the list row.

---

## What does NOT change

- Pass 1 RLS and schema (migrations untouched).
- `canManage = isSuperAdmin || role?.toLowerCase() === 'admin'` from `useOrganization()`.
- `fetchScripts` bail-on-missing-org + `.eq('organization_id', organizationId)`.
- All UPDATE/DELETE `.eq('id', …).eq('organization_id', organizationId)`.
- Zod validation flow (Add modal, rename, save, duplicate).
- Optimistic update + revert via `fetchScripts(false)` on failure.
- Toast text and timing (success only after backend confirms).
- Activity logging via `logActivity` for create/delete/save.
- Realtime channel `call_scripts_changes` (still attaches only when `organizationId` is known).
- Read-only helper note for non-managers and all `if (!canManage) return` write-handler guards.
- Tailwind classnames preserved verbatim.

---

## Verification

```bash
npx tsc --noEmit
npm test -- --run
```

Manual (Chris, after merge): Admin add/rename/edit/toolbar/merge/preview/product/toggle/duplicate/delete + unsaved-change dialog; Agent/Team Leader read-only; no console errors.

---

## Files to touch

**New (9):**
- `src/components/settings/call-scripts/callScriptTypes.ts`
- `src/components/settings/call-scripts/callScriptConstants.ts`
- `src/components/settings/call-scripts/callScriptUtils.ts`
- `src/components/settings/call-scripts/CallScriptsList.tsx`
- `src/components/settings/call-scripts/CallScriptEditor.tsx`
- `src/components/settings/call-scripts/CallScriptToolbar.tsx`
- `src/components/settings/call-scripts/AddCallScriptDialog.tsx`
- `src/components/settings/call-scripts/DeleteCallScriptDialog.tsx`
- `src/components/settings/call-scripts/UnsavedChangesDialog.tsx`

**Modified (3):**
- `src/components/settings/CallScripts.tsx` — orchestrator
- `WORK_LOG.md` — newest-first entry on completion
- `implementation_plan.md` — this file

**Not modified:** Zod schema, types.ts, migrations, dialer, anything outside Settings → Call Scripts.

---

## Risk / guardrails

- Strictly a refactor — any behavior delta is a bug. If I find a real regression from Pass 1 during the move, I will pause and report rather than fix silently.
- No new libraries, no Tailwind class changes, no context providers.
- No reflow of supabase calls (same query shapes, same scoping).
- Prop drilling is acceptable for this surface; if a single child needs >12 props I'll group related callbacks into a small `actions` object — not a new context.
- Will not push to `main`. Will commit to `claude/pensive-lovelace-8VwlI`.

---

## Approval

Reply with one of:
- `#APPROVE: Call Scripts Pass 2 refactor` — proceed with the split as planned, push to working branch.
- `Hold` — feedback / changes to the plan.
