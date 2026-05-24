# Implementation Plan — Calendar Pass 1b
## Frontend Query Safety + Settings Honesty

**Goal:** Make the Calendar frontend safe and honest after Pass 1a hardened `appointments.organization_id` and RLS.

**Status: AWAITING CHRIS APPROVAL — no source files modified yet.**

---

## A. Pre-edit Inspection Findings

### A1. Live appointments schema (verified 2026-05-24 via MCP execute_sql)

Columns (no `contact_type`):
id, title, contact_name, contact_id, type, status, start_time, end_time, notes, created_by, created_at, updated_at, user_id, external_event_id, external_provider, external_last_synced_at, sync_source, **organization_id** (NOT NULL)

**Finding:** `contact_type` does NOT exist on live `appointments`. `FullScreenContactView.tsx:1560` includes `contact_type: type` in the insert payload — this is the reason `as any` was needed. It must be removed.

### A2. types.ts appointments block

Matches live schema correctly (no `contact_type`, `organization_id: string` required in Row/Insert). No types.ts changes needed for this pass.

### A3. CalendarContext.tsx

| Item | Finding | Action |
|---|---|---|
| `initialAppointments` mock array (lines 68-75) | Declared but never used — state initializes to `[]`. Dead code only. | Remove (mock data in production file). |
| `uid()` + `makeDate()` helpers (lines 59-66) | Only used by `initialAppointments`. | Remove with mock data. |
| `fetchAppointments` | Does not filter by `organization_id`. No guard for missing `organizationId`. Fetches even if org context not yet available. | Add `if (!organizationId) return;` guard + `.eq('organization_id', organizationId)` filter. |
| `addAppointment` | Guards `user?.id` but not `organizationId`. If null, inserts `organization_id: null` → DB rejects with NOT NULL error (silent fail until thrown). | Add `organizationId` guard. Throw early with descriptive error. |
| `updateAppointment` | No user/org guard. RLS handles org; user check is still good practice. | Add `if (!user?.id) throw` guard. |
| `deleteAppointment` | Same as update. | Same guard. |
| `useEffect` dependencies | Only `user?.id`. Won't refetch when org changes. | Add `organizationId` to deps. |

### A4. CalendarPage.tsx

| Item | Finding | Action |
|---|---|---|
| `resolveAttendeeEmail()` line 206 | `leads` query without org filter. | Add `.eq('organization_id', organizationId)`. |
| `searchContacts()` line 299 | `leads` query without org filter; no guard for missing `organizationId`. | Add `.eq('organization_id', organizationId)` + guard. Keep leads-only for this pass; document. |
| `handleOpenContact()` line 333 | `leads` query without org filter. | Add `.eq('organization_id', organizationId)`. |
| New lead creation lines 217-223 | Has `organization_id: organizationId` but missing `created_by: user?.id`; no guard for `organizationId` or `user?.id`; uses `as any`. | Add guard; add `created_by`; clean `as any` (leads.Insert type likely supports this without cast). |
| `localPayload` (passed to `addAppointment`) lines 226-238 | `organization_id` not in the payload — context adds it. But context has no guard yet. Also `user_id: (data as any).user_id || user?.id` uses `as any`. | Add `organization_id: organizationId` explicitly to payload so intent is clear; add top-of-handleSave guard for `!organizationId \|\| !user?.id`. |
| `syncAppointmentToGoogle()` lines 184-201 | Returns `void`. Errors are swallowed in catch. After local save succeeds, caller cannot know sync status. | Return `{ success: boolean; message?: string }`. Show warning toast in callers on failure. Do NOT block local save. |
| `handleSave` | No org/user guard at top. Calls `syncAppointmentToGoogle` but ignores result. | Add guard; show warning toast on Google sync failure. |
| `handleDeleteAppointment` | Same sync issue. | Show warning toast on Google sync failure. |

### A5. FullScreenContactView.tsx (appointment insert — lines 1556-1568)

| Item | Finding | Action |
|---|---|---|
| `contact_type: type` line 1560 | Column does not exist in live schema. This is why `as any` is needed. | Remove field. |
| `as any` line 1568 | Driven by `contact_type` (not in schema) + nullable `organizationId` type mismatch. After removing `contact_type`, the remaining type issue is `organizationId` (may be `string \| null` from hook) vs `organization_id: string` (required). Keep `as any` + post-guard cast; OR use non-null assertion after guard. Use non-null assertion post-guard to remove `as any`. | Remove `as any`. Use guard + `organizationId!`. |
| No guard for missing `organizationId` / `user?.id` | If either is null, the insert fails at the DB (NOT NULL / RLS). | Add guard before insert; toast error and return early. |
| `organizationId` and `user` are available | Pass 1a added `user` to `useAuth` destructure. `organizationId` is from `useOrganization()`. | Both present. Guard is sufficient. |

### A6. CalendarSettings.tsx — persisted vs. not persisted

| Card | Setting | Persisted today? | Action |
|---|---|---|---|
| Card 1 | Default Calendar View | **No** | Disable buttons, add "Coming soon" note, remove fake toast |
| Card 2 | First Day of Week | **No** | Disable buttons, add "Coming soon" note, remove fake toast |
| Card 3 | Appointment Types (Add/Edit/Delete) | **No** | Disable Add button + dropdown actions, add "Coming soon" note, remove fake toasts |
| Card 4 | Scheduling Defaults (buffer, max appts) | **No** | Disable controls + Save button, add "Coming soon" note, remove fake toast from `handleSchedulingSave` |
| Card 5 | Google Calendar Integration | **Yes** — `user_preferences[calendar_google_sync_settings]` | No change — keep fully functional |
| Card 6 | Contact Email/SMS Reminders | **No** | Disable switches, update existing note to be more explicit, remove fake toasts |
| Card 7 (confirmation block) | Send Confirmation Email | **No** | Disable switch, add note, remove fake toast |
| Card 7 (color block) | Calendar Color Coding | **No** | Disable switch, add note, remove fake toast |
| Card 8 | Working Hours | **No** | Disable all controls + Save button, add "Coming soon" note, remove fake toast from `handleWorkingHoursSave` |
| Card 9 | Personal Appointment Reminders | **Yes** — `user_preferences[agent_reminder_time/sound]` | No change — keep fully functional |

Strategy: **disable** (not hide) non-persisted controls, add a visible `<p>` note below each card description. Keep dead state variables in place (no code removal risk). Remove only the `toast()` calls from fake-save handlers. This is the smallest, lowest-risk approach.

---

## B. Files to Touch

1. `src/contexts/CalendarContext.tsx`
2. `src/pages/CalendarPage.tsx`
3. `src/components/contacts/FullScreenContactView.tsx`
4. `src/components/settings/CalendarSettings.tsx`
5. `WORK_LOG.md`
6. `implementation_plan.md` (this file)

**NOT touched:**
- `supabase/migrations/` — no schema changes needed; `contact_type` simply removed from frontend payload
- `src/integrations/supabase/types.ts` — already correct after Pass 1a; no `contact_type` there
- Edge Functions — no changes to Google Calendar sync functions
- `AppointmentModal.tsx` — no changes required
- Any dialer, Twilio, workflow, or other files

---

## C. Detailed Change Plan

### C1. CalendarContext.tsx

```
- Remove initialAppointments array (lines 68-75) + uid() + makeDate() helpers
- fetchAppointments:
    + add: if (!user?.id || !organizationId) { setLoading(false); return; }
    + add: .eq('organization_id', organizationId) to query
- addAppointment:
    + add: if (!user?.id || !organizationId) throw new Error("Missing user or organization context")
- updateAppointment:
    + add: if (!user?.id) throw new Error("Missing user context")
- deleteAppointment:
    + add: if (!user?.id) throw new Error("Missing user context")
- useEffect deps: add organizationId
```

### C2. CalendarPage.tsx

```
- resolveAttendeeEmail:
    + add .eq('organization_id', organizationId) to leads query
    + guard: if (!contactId || !organizationId) return fallbackEmail || null
- searchContacts:
    + add .eq('organization_id', organizationId) to query
    + guard: if (!organizationId) return (show no results)
    + label: add comment "leads-only for Pass 1b; multi-contact deferred to Pass 2"
- handleOpenContact:
    + add .eq('organization_id', organizationId) to query
- New lead creation in handleSave:
    + add guard: if (!organizationId || !user?.id) { toast error; return; }
    + add created_by: user.id to insert
    + remove as any (leads insert should satisfy types with org + creator)
- handleSave top-level:
    + add guard: if (!organizationId || !user?.id) { toast error; return; }
    + add organization_id: organizationId to localPayload explicitly
    + after syncAppointmentToGoogle calls: check result, show warning toast on failure
- syncAppointmentToGoogle:
    + change return type to Promise<{ success: boolean }>
    + return { success: true } on success
    + return { success: false } in catch (do not throw)
- handleDeleteAppointment:
    + after syncAppointmentToGoogle: check result, show warning toast on failure
```

### C3. FullScreenContactView.tsx (appointment insert only)

```
- Add guard before insert:
    if (!organizationId || !user?.id) {
      toast.error("Cannot schedule appointment: missing organization or user context");
      return;
    }
- Remove contact_type: type from insert payload
- Change: organization_id: organizationId  →  organization_id: organizationId!
- Change: user_id: user?.id  →  user_id: user.id
- Change: created_by: user?.id  →  created_by: user.id
- Remove as any cast (types now align after above changes + guard)
```

### C4. CalendarSettings.tsx

**Card 1 — Default View (not persisted)**
- Add disabled prop to each view button (pointer-events-none + opacity)
- Add `<p className="text-xs text-muted-foreground mt-3">Coming soon — this setting is not active yet.</p>` below the grid
- Remove `toast()` call from the onClick handler

**Card 2 — First Day (not persisted)**
- Add disabled prop to each day button
- Add "Coming soon" note
- Remove `toast()` call

**Card 3 — Appointment Types (not persisted)**
- Hide the "Add Appointment Type" button (or replace with a disabled version with tooltip)
- Disable Edit/Delete dropdown items for all types
- Add note below the list: "Appointment type customization will be enabled after the calendar scheduling settings are finalized."

**Card 4 — Scheduling Defaults (not persisted)**
- Add `disabled` to all Select and Input controls
- Replace Save button with disabled version
- Remove `setTimeout` + `toast()` from `handleSchedulingSave`
- Add "Coming soon" note

**Card 6 — Appointment Reminders (not persisted)**
- Disable both switches (add `disabled` prop)
- Update the existing muted info box text to: "Contact reminders are not active yet. Personal agent reminders are available below."
- Remove `toast()` calls from `onCheckedChange` handlers

**Card 7 — Confirmation + Color Coding (not persisted)**
- Disable both switches
- Update the info box to: "Confirmation emails and color coding are not active yet."
- Remove `toast()` calls

**Card 8 — Working Hours (not persisted)**
- Disable all day-row switches, start/end Selects
- Replace Save button with disabled version
- Remove `setTimeout` + `toast()` from `handleWorkingHoursSave`
- Add "Coming soon" note

**Cards 5 and 9 — no change.**

---

## D. Verification Plan

1. `npx tsc --noEmit` → must pass 0 errors
2. `npm test -- --run` → report if vitest not installed
3. Manual checklist (for Chris):
   1. Calendar page loads without console errors
   2. Appointment fetch is org-scoped (confirmed via browser Network tab — query should include `organization_id=eq.<org>`)
   3. Agent can create own appointment; missing org/user → toast error, no DB call
   4. FullScreenContactView "Schedule Appointment" works; no `contact_type` in the network payload
   5. Lead/contact search in CalendarPage scoped to org
   6. Google sync failure shows warning toast but appointment is still saved
   7. CalendarSettings: Cards 1–4, 6, 7, 8 show "Coming soon" messaging and controls are disabled (no fake saved toasts)
   8. CalendarSettings Card 5 (Google Calendar) still connects/disconnects/saves
   9. CalendarSettings Card 9 (Personal Reminders) still saves lead time + sound
   10. No console errors on Calendar or Settings pages

---

## E. Decisions / Deferments

- `contact_type` removed from insert (not in schema, not in types.ts — confirmed live).
- Contact search remains leads-only for Pass 1b. Multi-table (clients/recruits) deferred to Pass 2 / Contact Flow.
- No new migrations. No schema changes needed.
- No Zod added (no new form validation changed in this pass).
- No activity logging expanded (existing `logActivity` call in FullScreenContactView preserved).
- Google Edge Function reliability (retry, dual-write guarantees, DST handling) deferred to Pass 3.
- Real appointment type persistence deferred to Pass 2.
- Real org calendar settings (working hours, scheduling defaults) deferred to a future Calendar settings pass.
- No Twilio/dialer changes.
- No new DB tables.

---

**AWAITING CHRIS APPROVAL. Will not modify any source files until explicit go-ahead.**
