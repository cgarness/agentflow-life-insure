

## Wire Up Real Dialing + AMD on TestDialerPage

The TestDialerPage currently mocks all Telnyx values (lines 240-248), replacing context values with hardcoded stubs. This causes TypeScript errors because `const telnyxCallState = "idle"` is inferred as the literal type `"idle"`, making comparisons to `"dialing"`, `"active"`, `"ended"` invalid.

### The Fix

**File: `src/pages/TestDialerPage.tsx`**

**Replace the mocked Telnyx variables (lines 240-248) with the real context values:**

Remove:
```typescript
const telnyxStatus = "ready";
const telnyxErrorMessage = null;
const telnyxCallState = "idle";
const telnyxCallDuration = 0;
const telnyxCurrentCall = null;
const telnyxMakeCall = (num: string) => console.log(`[Test Dialer] Simulated call to ${num}`);
const telnyxHangUp = () => console.log("[Test Dialer] Simulated hang up");
const telnyxInitialize = () => Promise.resolve();
const telnyxDestroy = () => {};
```

Replace with aliases that use the real context values (already destructured on lines 223-238 as `_telnyx*`):
```typescript
const telnyxStatus = _telnyxStatus;
const telnyxErrorMessage = _telnyxErrorMessage;
const telnyxCallState = _telnyxCallState;
const telnyxCallDuration = _telnyxCallDuration;
const telnyxCurrentCall = _telnyxCurrentCall;
const telnyxMakeCall = _telnyxMakeCall;
const telnyxHangUp = _telnyxHangUp;
const telnyxInitialize = _telnyxInitialize;
const telnyxDestroy = _telnyxDestroy;
```

This single change:
1. Fixes all 6 TypeScript build errors (type comparisons now valid since `CallState` is `"idle" | "dialing" | "active" | "ended"`)
2. Enables real calling via TelnyxRTC WebRTC
3. Enables AMD detection (the AMD check effects and Realtime subscription are already wired up in the page)
4. Enables auto-hang-up on machine detection (the `handleMachineDetectedAction` callback and Realtime listener are already in place)

### Telnyx Setup Requirements

For full functionality, ensure the following in your Telnyx portal:

1. **SIP Connection** — Create a Credential-based SIP connection at portal.telnyx.com → Voice → SIP Connections. Note the SIP username and password — these should already be stored as `TELNYX_SIP_USERNAME` and `TELNYX_SIP_PASSWORD` secrets.

2. **Webhook URL** — On your SIP Connection, set the webhook URL to: `https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/telnyx-webhook`. This receives call events (answered, ended, AMD results).

3. **AMD (Answering Machine Detection)** — AMD is triggered server-side by the `telnyx-amd-start` edge function when a call is answered. No additional Telnyx portal config is needed — the API call uses your `TELNYX_API_KEY` secret.

4. **Phone Numbers** — At least one phone number must be assigned to your SIP Connection for outbound caller ID.

No other files need changes — the AMD flow, auto-disposition, and auto-dial-next logic are already implemented in the page code.

