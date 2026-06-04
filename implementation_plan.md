# Implementation Plan — Campaign calling settings not enforced at runtime (BUGFIX)

**Owner:** Chris Garness · **Author:** Claude · **Date:** 2026-06-04
**Status:** AWAITING APPROVAL — no files modified / no backend commands run yet.

---

## 0. Pre-flight

- Read `AGENT_RULES.md`, `VISION.md`, `WORK_LOG.md`. Latest WORK_LOG entry (2026-06-04) is the redial-loop fix marked **[DONE]** — no `[IN PROGRESS]` dialer/settings/queue work in flight. This task is the sequential closeout after that fix.
- Relevant invariants: **#15** (canonical retry field is `campaigns.retry_interval_minutes`; `retry_interval_hours` is deprecated compat; ring window + calling-hours model), **#19** (do NOT modify `advance_campaign_lead`; do NOT reintroduce client-side `campaign_leads` advancement UPDATEs), **#8** (browser must never write `calls.duration`/Twilio telemetry), Dialer model #6 (single-leg Twilio Voice.js only).
- **No migration.** All needed columns already exist in prod.

---

## 1. Root cause / mismatches found

| # | Defect | Evidence |
|---|--------|----------|
| 1 | After save, local `campaigns` state only mirrors `max_attempts` → active `selectedCampaign`/runtime keeps stale values until reload. | `handleSaveCallingSettings` `setCampaigns(... { ...c, max_attempts } )` only (DialerPage ~2352). |
| 2 | Save writes `retry_interval_hours` only; canonical advancement prefers `retry_interval_minutes`. A stale non-zero `retry_interval_minutes` overrides the new hours. | save object lacks `retry_interval_minutes` (~2329); `advance_campaign_lead` + `getRetryIntervalMinutes` prefer minutes. |
| 3 | Ring timeout saves to global `phone_settings.ring_timeout`, not `campaigns.ring_timeout_seconds`. | `phone_settings.update({ ring_timeout, ... })` (~2336). |
| 4 | Save also writes unrelated global `phone_settings.amd_enabled = false`. | (~2340). |
| 5 | Dialer reads non-existent `campaigns.dial_delay_seconds`; dial delay is now a system standard, not a campaign setting. | reads at DialerPage 1194, 2420/2424; `dialDelayMs` state at 647. |

---

## 2. Confirmed live schema facts (re-verify on apply)

- `campaigns` has: `max_attempts`, `calling_hours_start`, `calling_hours_end`, `retry_interval_hours`, `retry_interval_minutes`, `ring_timeout_seconds`, `auto_dial_enabled`, `local_presence_enabled`, `number_group_id`, `queue_filters`.
- **No** `campaigns.dial_delay_seconds` column.
- `resolveOutboundRingSeconds(campaignRingSeconds, phoneRingSeconds)` already enforces order: campaign → `phone_settings.ring_timeout` → 25s default (DialerPage ~244).
- `getRetryIntervalMinutes()` already prefers `retry_interval_minutes` → `retry_interval_hours*60` → 1440 (DialerPage ~1676).
- `queue_filters` is fetched in its own queries (DialerPage ~974, `QueuePanelLocked.tsx`), **not** from the `useDialerSession` campaign list → not needed in that select.

---

## 3. Changes (surgical)

### A. `src/pages/DialerPage.tsx`

**A1 — Dial delay → system constant (defect 5).**
- Add module constant near the top: `const SYSTEM_AUTO_DIAL_DELAY_MS = 2000;`
- Remove the `dialDelayMs`/`setDialDelayMs` `useState` (647). Pass `dialDelayMs={SYSTEM_AUTO_DIAL_DELAY_MS}` to `useDialerStateMachine` (~2498). A module constant is a stable value → no extra timer resets in `useDialerStateMachine` (its effect dep `dialDelayMs` never changes).
- Remove the `dial_delay_seconds` block from the auto-dial-prefs effect (1194–1200); keep the `auto_dial_enabled` sync.
- Remove the `dial_delay_seconds` fetch/`setDialDelayMs` block in `syncSettings` (2418–2432).
- Update the two stale comments (646/648) to note dial delay is a system standard.

**A2 — Ring timeout campaign-level (defects 3 & 4).**
- In `handleSaveCallingSettings`, add `ring_timeout_seconds: ringTimeoutValue` to the `campaigns.update({...})` object.
- **Delete** the entire `phone_settings.update({ ring_timeout, amd_enabled, updated_at })` block and the `phoneError` references (revert the success/failure check to `campaignError` only).
- After save, set `ringTimeoutRef.current` and call `twilioApplyDialSessionRingTimeout(...)` from the just-saved value via `resolveOutboundRingSeconds(ringTimeoutValue, null)` (drop the now-redundant re-fetch of `ring_timeout_seconds`).
- In the **modal load** effect (2282–2316): add `ring_timeout_seconds` to the `campaigns` select; set `ringTimeoutValue` from campaign value first, falling back to `phone_settings.ring_timeout`, then `DEFAULT_OUTBOUND_RING_SEC`.

**A3 — Canonicalize retry interval (defect 2).**
- In `handleSaveCallingSettings`, add `retry_interval_minutes: retryIntervalHours * 60` to the `campaigns.update` (keep `retry_interval_hours: retryIntervalHours` in sync for compat/display).
- In the modal load effect, derive displayed hours from minutes when present: `setRetryIntervalHours(mins != null ? Math.round(mins/60) : (retry_interval_hours ?? 24))`; keep `setRetryIntervalMinutes(mins)`.
- Do **not** touch `advance_campaign_lead` (server derives retry from `retry_interval_minutes`).

**A4 — Stale local state after save (defect 1) + immediate runtime apply.**
- In the success branch, update local `campaigns` with all saved fields:
  `max_attempts, calling_hours_start, calling_hours_end, retry_interval_hours, retry_interval_minutes, ring_timeout_seconds, auto_dial_enabled, local_presence_enabled`.
- Preserve the existing max-attempts queue-refilter block unchanged.
- When `effectiveCampaignId === selectedCampaignId`, apply runtime state immediately without reload:
  - `setAutoDialEnabled(settingsAutoDialEnabled)` (modal uses a separate `settingsAutoDialEnabled`).
  - `setRetryIntervalMinutes(retryIntervalHours * 60)` (runtime `getRetryIntervalMinutes` reads this).
  - `ringTimeoutRef.current` + `twilioApplyDialSessionRingTimeout` already updated in A2.
  - `callingHoursStart/End`, `maxAttemptsValue`, `localPresenceEnabled` are the same state vars the modal binds → already current.

### B. `src/hooks/useDialerSession.ts`

- Add `retry_interval_minutes` and `ring_timeout_seconds` to the `campaigns` select list (line 259). All other runtime-needed fields (`max_attempts`, `calling_hours_start`, `calling_hours_end`, `retry_interval_hours`, `auto_dial_enabled`, `local_presence_enabled`, `number_group_id`) already present. `queue_filters` not needed (fetched elsewhere). Surgical 2-field add.

### C. `src/components/dialer/CampaignSettingsModal.tsx`

- **No change.** Presentational/props-only; retry shown in hours, ring in seconds, all wired through props. No new field or Zod validation required.

---

## 4. Files to touch (exact list)

1. **EDIT** `src/pages/DialerPage.tsx` — A1–A4.
2. **EDIT** `src/hooks/useDialerSession.ts` — B (add 2 fields to campaign select).
3. **EDIT** `WORK_LOG.md` — newest-first `[DONE]` entry + context snapshot + dial-delay-as-system-standard note.
4. **EDIT** `implementation_plan.md` — this file.

No migration. No Edge Function deploy. No `advance_campaign_lead` / `get_next_queue_lead` / `TwilioContext.tsx` change.

---

## 5. Out of scope (do not expand)

Backend calling-hours/timezone filtering · queue filter expansion · `TwilioContext` changes · reporting/stat redesign · multi-line dialer · AI voice · unrelated campaign-tab cleanup.

---

## 6. Verification

- **Code/static:** no `dial_delay_seconds` reference remains in production dialer code; no `phone_settings.ring_timeout` write from the campaign save; no `amd_enabled` write; auto-dial delay = one named constant; no `TwilioContext.tsx` re-entrancy change; no browser `calls.duration` write.
- **`npx tsc --noEmit`** clean.
- **Manual matrix (Personal + Team/Open):** retry interval save → `retry_interval_minutes`; No-Answer retry window ≈ 1h; ring timeout save = `ring_timeout_seconds`; auto-dial on/off; local presence on/off; max-attempts cap; calling-hours skip; lock release + next-lead fetch (Team/Open); number-group caller-ID scoping; settings take effect on the active campaign with no reload.

---

**Awaiting Chris's explicit approval before I modify any files.**
