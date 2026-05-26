# Implementation Plan — Remove Twilio Connection from Agency Settings

**Goal:** Twilio is platform-managed. Remove the customer-facing **Twilio Connection** tab and credential editor from CRM Settings while preserving Phone System, dialer, Edge Functions, and `twilio-token` behavior.

**Status:** ✅ **COMPLETE** — approved and implemented 2026-05-26.

---

## What shipped

| Area | Change |
|------|--------|
| Settings nav | Removed `twilio-connection` from Telephony Stack |
| Render path | Removed `TwilioConnection` from `SettingsRenderer` |
| Legacy URLs | `?section=twilio-connection` → `phone-system` |
| Permissions | Removed `PLATFORM_ONLY_SETTINGS_SLUGS` |
| Credential UI | Deleted `TwilioConnection`, `TwilioCredentialsSection`, `twilioCredentialsSchema` |
| Docs | Updated `docs/SETTINGS_LAYOUT.md` access-control note |

**Not touched:** `TwilioContext.tsx`, `twilio-voice.ts`, Edge Functions, schema/RLS, `usePhoneSettingsController.ts`.

---

## Files touched

- `src/config/settingsConfig.ts`
- `src/components/settings/SettingsRenderer.tsx`
- `src/pages/SettingsPage.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/config/permissionDefaults.ts`
- `docs/SETTINGS_LAYOUT.md`
- `WORK_LOG.md`
- `implementation_plan.md`

**Deleted:** `TwilioConnection.tsx`, `TwilioCredentialsSection.tsx`, `twilioCredentialsSchema.ts`

---

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npm test -- --run` | 72/72 passing |

Manual smoke: pending Chris (5-point checklist in WORK_LOG).

---

## Decisions

- Twilio credentials are platform-managed — not agency Settings.
- `usePhoneSettingsController` preserved for Phone System.
- Future Control Center Telephony Provisioning replaces admin/debug surface (see WORK_LOG).

---

## Context snapshot

Agency Settings no longer exposes Twilio credential fields. Phone System, single-leg WebRTC dialer, `twilio-token`, and all Twilio Edge Functions unchanged. Next: Control Center Telephony Provisioning (platform-only).
