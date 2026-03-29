

## Diagnosis: Auto-Dialer and AMD Issues

### Current Architecture
The system has three layers:
1. **AutoDialer class** (`src/lib/auto-dialer.ts`) — manages queue, DNC checks, caller ID selection, emits events
2. **DialerPage** (`src/pages/DialerPage.tsx`) — listens for events, triggers TelnyxRTC calls, handles wrap-up/AMD
3. **Webhook + AMD edge functions** (`telnyx-webhook`, `telnyx-amd-start`) — server-side call events and AMD triggering

### Identified Problems

**Problem 1: Auto-dialer never auto-starts dialing**
`handleAdvance()` increments `currentLeadIndex` and syncs the AutoDialer's index, but never calls `autoDialer.dialNext()`. The auto-dial flow only triggers when `saveDispositionAndNext()` is called (Save & Next button), not after advancing. So after the first call ends, if the agent manually disposes, the next call is never auto-initiated.

**Problem 2: AMD result lookup uses wrong column**
In `DialerPage.tsx` line ~796, the AMD check queries `supabase.from('calls').select('amd_result').eq('id', currentCallId)`. But `currentCallId` is the internal UUID from `createCall()`. The webhook writes `amd_result` matching on `telnyx_call_id` (the Telnyx session ID), not the internal `id`. So the AMD poll always returns null — the webhook wrote to the record via `telnyx_call_id`, but the frontend queries by `id`.

**Problem 3: AMD trigger timing is fragile**
AMD is triggered server-side in the webhook's `handleCallAnswered`, which calls the `telnyx-amd-start` edge function. This is correct architecturally, but the frontend's 2.5-second delay poll to check `amd_result` may not be enough time for the webhook round-trip (Telnyx → webhook → AMD start → AMD result webhook → DB update). The frontend needs a more reliable mechanism.

**Problem 4: Build error (unrelated but blocking)**
`supabase/functions/send-invite-email/index.ts` imports `npm:resend@3.2.0` which fails resolution. This blocks deployment of all edge functions.

### Plan

#### Step 1: Fix the build error
Update `supabase/functions/send-invite-email/index.ts` to import Resend from `https://esm.sh/resend@3.2.0` instead of `npm:resend@3.2.0`.

#### Step 2: Fix auto-dial flow — trigger next call after advance
In `handleAdvance()`, after incrementing the lead index, check if auto-dial is enabled and call `autoDialer.dialNext()`:

```typescript
function handleAdvance() {
  setShowWrapUp(false);
  setSelectedDisp(null);
  setNoteText("");
  setNoteError(false);
  setCurrentCallId(null);
  setCurrentLeadIndex((i) => {
    const next = i + 1;
    autoDialer?.setIndex(next);
    return next;
  });
  // Trigger next auto-dial after state updates
  if (autoDialEnabled && autoDialer?.isEnabled()) {
    setTimeout(() => autoDialer.dialNext(), 500);
  }
}
```

Also add the same logic to `handleSkip()`.

#### Step 3: Fix AMD result lookup
Change the AMD poll query from `.eq('id', currentCallId)` to `.eq('id', currentCallId)` but ensure the webhook links `amd_result` to the same record. The issue is the webhook updates by `telnyx_call_id`, but the frontend queries by `id`. Two options:

**Option A (chosen):** Query by `id` which is correct since the webhook's `handleCallInitiated` already maps the `clientState` UUID (which is the `callId` from `createCall`) to the record and sets `telnyx_call_id` on it. The `amd_result` is later updated via `.eq('telnyx_call_id', callSessionId)`. So the record IS the same row — both `id` and `telnyx_call_id` point to the same record. The query by `id` should work IF the webhook has had time to process.

**Actual fix:** The real issue is the `clientState` encoding. In `TelnyxContext.tsx` line 432, `clientState` is base64-encoded before passing to `newCall()`. But TelnyxRTC SDK also base64-encodes `clientState` internally. This means it gets **double-encoded**. The webhook tries to decode once, gets the pre-encoded value, and the UUID matching fails — so `telnyx_call_id` is never linked to the existing call record.

Remove the manual `btoa()` encoding in `TelnyxContext.tsx` since TelnyxRTC handles it:

```typescript
// Before (double-encoding):
const encodedClientState = clientState ? btoa(clientState) : undefined;

// After (let SDK handle encoding):
const call = clientRef.current.newCall({
  destinationNumber,
  callerNumber: callerNumber || defaultCallerNumber || "",
  audio: true,
  clientState: clientState, // SDK will base64-encode this
});
```

#### Step 4: Make AMD polling more robust
Replace the single 2.5s delay with a retry loop that polls for the `amd_result` up to 5 times with 1.5s intervals (total ~7.5s max wait). This accounts for the full webhook round-trip:

```typescript
// Poll for AMD result with retries
let amdResult = null;
for (let attempt = 0; attempt < 5; attempt++) {
  await new Promise(r => setTimeout(r, 1500));
  const { data } = await supabase
    .from('calls')
    .select('amd_result')
    .eq('id', currentCallId)
    .maybeSingle();
  if (data?.amd_result) {
    amdResult = data.amd_result;
    break;
  }
}
```

#### Step 5: Add Supabase Realtime subscription as alternative AMD detection
Instead of polling, subscribe to changes on the call record for real-time AMD results. This is more efficient and responsive:

```typescript
// Subscribe to call record changes for AMD result
const channel = supabase
  .channel(`call-amd-${currentCallId}`)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'calls',
    filter: `id=eq.${currentCallId}`,
  }, (payload) => {
    if (payload.new.amd_result) {
      // Handle AMD result immediately
    }
  })
  .subscribe();
```

This replaces the polling approach for faster, more reliable AMD detection.

### Summary of Files Changed

| File | Change |
|------|--------|
| `supabase/functions/send-invite-email/index.ts` | Fix Resend import (build error) |
| `src/contexts/TelnyxContext.tsx` | Remove double base64 encoding of clientState |
| `src/pages/DialerPage.tsx` | Fix `handleAdvance`/`handleSkip` to trigger auto-dial; replace AMD polling with Realtime subscription + polling fallback |
| `src/lib/auto-dialer.ts` | No changes needed — event flow is correct once DialerPage triggers `dialNext()` |

