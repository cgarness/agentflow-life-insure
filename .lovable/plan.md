

## Fix AMD Auto-Skip and Auto-Dial Next on Machine Detection

### Problem
When AMD detects a voicemail/machine, the flow breaks at two points:
1. **`handleAutoDispose` doesn't trigger the next call** — it advances the index but never calls `autoDialer.dialNext()`, so the dialer stops after the first machine detection.
2. **The call may not be properly hung up on the frontend** — the webhook hangs up server-side via Telnyx REST API, but by the time the frontend's `"ended"` state fires and polls for `amd_result`, the `telnyxCurrentCall` reference used in `handleAutoDispose` may already be null (since `telnyxHangUp()` is called first at line 771), causing the disposition update to silently fail.
3. **Redundant disposition write** — the webhook already writes `disposition_name: 'No Answer'` server-side, so the frontend re-write via `handleAutoDispose` using `telnyx_call_id` is redundant but harmless if it works. However, it queries by `telnyxCurrentCall` which is likely cleared by then.

### Changes

#### File: `src/pages/DialerPage.tsx`

**Fix 1: `handleAutoDispose` — add auto-dial trigger**
After advancing the index, if auto-dial is enabled, call `autoDialer.dialNext()`:

```typescript
const handleAutoDispose = useCallback(async (disposition: Disposition) => {
  // Update disposition in DB (use currentCallId which is more reliable than telnyxCurrentCall)
  if (currentCallId) {
    try {
      await supabase.from('calls')
        .update({ disposition_name: disposition.name })
        .eq('id', currentCallId);
    } catch {
      // non-blocking
    }
  }
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
  // Auto-dial next lead
  if (autoDialEnabled && autoDialer?.isEnabled()) {
    setTimeout(() => autoDialer.dialNext(), 500);
  }
}, [currentCallId, autoDialEnabled, autoDialer]);
```

**Fix 2: Save `currentCallId` before it's cleared**
In the AMD check effect (line 770), capture `currentCallId` at the top of the `checkAmd` closure before `telnyxHangUp()` clears state, so the polling query has the correct ID.

**Fix 3: Ensure `currentCallId` isn't cleared prematurely**
Move the `setCurrentCallId(null)` call to after AMD processing completes (inside the machine-detected branch and the human/wrap-up branch), not at the beginning of the effect.

### Summary
| What | Where |
|------|-------|
| Add `dialNext()` call to `handleAutoDispose` | `DialerPage.tsx` ~line 755 |
| Use `currentCallId` instead of `telnyxCurrentCall` for disposition update in `handleAutoDispose` | `DialerPage.tsx` ~line 742 |
| Capture `currentCallId` before state reset in AMD effect | `DialerPage.tsx` ~line 774 |

No new files. No database changes. No edge function changes needed — the webhook already handles server-side hangup and disposition correctly.

