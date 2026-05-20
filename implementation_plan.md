# Phase 2g + 2h: Wire Dialer Pool Filtering + Inbound Direct-Line Protection

**Branch:** `claude/number-groups-integration-JbiEu`
**Scope:** Two changes — outbound caller-ID pool filtering by campaign Number Group, and inbound direct-line routing + per-number `voicemail_greeting_url`.

---

## PART A — Outbound: caller-ID pool filtered by campaign Number Group

### Files
1. `src/hooks/useDialerSession.ts` — add `number_group_id` to the campaigns SELECT so `selectedCampaign` already carries it (no new fetch).
2. `src/contexts/TwilioContext.tsx` — split full org pool from outbound caller-ID pool; expose a setter the dialer calls on campaign change.
3. `src/pages/DialerPage.tsx` — push the active campaign's `number_group_id` into TwilioContext when the campaign changes.

### Detail

**`useDialerSession.ts`** — append `, number_group_id` to the campaigns SELECT at line 79. `selectedCampaign` then exposes it directly.

**`TwilioContext.tsx`:**
- Extend org pool fetch (line 400–418) — add `is_direct_line` to the SELECT. Keep `availableNumbers` as the **full** org pool (still feeds `defaultCallerNumber`, `inboundCallerExcludeOrg`, FloatingDialer UI). Direct lines are NOT filtered here so inbound exclude detection still works.
- Add state `callerIdCampaignGroupId: string | null` + setter, and `callerIdPool: CallerIdPhoneRow[]`. Expose `setCallerIdCampaignGroupId` on `TwilioContextValue`.
- New effect keyed on `(organizationId, callerIdCampaignGroupId)`:
  - **Group set:** fetch `number_group_members.phone_number_id` for the group, then `phone_numbers` where `id IN (...) AND is_direct_line=false AND status IN ('active','Active')`. If empty, `console.warn("[caller-id] Campaign number group is empty, falling back to all org numbers")` and use the org path.
  - **No group / fallback:** fetch `phone_numbers` where `organization_id=$org AND status IN ('active','Active') AND is_direct_line=false`.
- `getSmartCallerId` — pass `phones: callerIdPool` (not `availableNumbers`); add `callerIdPool` to deps.
- `CallerIdPhoneRow` shape unchanged.

**`DialerPage.tsx`** — destructure `setCallerIdCampaignGroupId`; new effect keyed on `selectedCampaign?.id` / `selectedCampaign?.number_group_id` calls `setCallerIdCampaignGroupId(selectedCampaign?.number_group_id ?? null)`; cleanup sets `null`.

**FloatingDialer** — no change. Outside campaign context → `callerIdCampaignGroupId` is null → pool is the full org non-direct pool.

### Edge cases
- Empty group → warn + fall back to org pool.
- Campaign switch → effect re-fires → pool refetched.
- Direct lines always excluded from outbound.
- Inbound exclude / default caller ID still use full pool.

---

## PART B — Inbound: direct-line protection + per-number voicemail_greeting_url

### File
`supabase/functions/twilio-voice-inbound/index.ts` (local matches prod v21). Deploy → v22.

### Detail
1. **`resolvePhoneNumberRow`** (line 137) — SELECT becomes `"id, organization_id, assigned_to, is_direct_line"`; return type gains `is_direct_line: boolean | null`.
2. **`loadPhoneSettings`** (line 337):
   - Per-number SELECT (line 368) gains `voicemail_greeting_url`.
   - Merge cascade: `voicemail_greeting_url: numberOverrides?.voicemail_greeting_url || orgData?.voicemail_greeting_url || defaults.voicemail_greeting_url`.
3. **`handleInitialInbound`** — after `loadPhoneSettings` and the business-hours check, before the routing-strategy switch (~line 832):
   ```
   if (phoneRow.is_direct_line) {
     console.log(`[inbound] Direct line for agent ${phoneRow.assigned_to} — bypassing org routing`);
     const ident = await resolveAssignedIdentity(supabase, phoneRow.assigned_to);
     identities = ident ? [ident] : [];
   } else {
     // existing routing-strategy switch
   }
   ```
   If identities ends up empty, existing zero-identities fallback runs (per-number `fallback_action`). Twilio's Dial `action` URL hits `handleFallback`, which already reloads phone-number-scoped settings — direct-line voicemail/forwarding works without further change. No round-robin spillover.

### Unchanged
Signature validation, business hours, after-hours SMS, voicemail TwiML, CRM enrich, `auto_create_lead`, recording, `handleFallback`, `_shared/notifications.ts`.

---

## Verify
- `npx tsc --noEmit`.
- Deploy edge function → confirm version **22** ACTIVE.

## WORK_LOG
Append newest-first entry per task spec.

---

**Awaiting Chris's approval before modifying files.**
