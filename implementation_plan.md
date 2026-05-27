# Phone System — Browser Recording follow-up debug

**Owner:** Chris Garness  
**Status:** Implemented (awaiting manual runtime verification)  
**Date:** 2026-05-27

---

## 0) Scope and invariants

This plan is surgical and keeps all critical invariants:

- Keep browser-side recording only.
- Do not switch to Twilio-native recording.
- Do not call Twilio Recording APIs or recording webhooks.
- Keep single-leg Twilio Voice.js WebRTC outbound (`device.connect()`).
- Do not touch `src/lib/twilio-voice.ts`.
- Preserve telemetry, call row lifecycle, disposition flow, and existing TwilioContext guards.
- No migration expected.
- No Edge Function deploy expected.

---

## 1) Preflight doc/code checks (completed)

Read:
- `AGENT_RULES.md`
- `VISION.md`
- `WORK_LOG.md`
- `src/contexts/TwilioContext.tsx`
- `src/lib/browser-recording.ts`
- `src/components/ui/RecordingPlayer.tsx`
- `src/components/settings/CallRecordingLibrary.tsx`
- `src/lib/call-recording-policy.ts`

Confirmed in `WORK_LOG.md` (newest-first):
- `2026-05-27 | [DONE] Phone System — Browser Recording / Monitoring reality check + UI honesty`

---

## 2) Required live read-only inspection (completed)

### 2.1 Latest calls (requested shape)

Latest 5 query returned 4 rows (only 4 exist in that recent window):

1. `2b1994a7-1994-4755-a089-8c376b1fb931`
   - `organization_id`: `a0000000-0000-0000-0000-000000000001`
   - `status`: `completed`
   - `direction`: `outbound`
   - `duration`: `60`
   - `twilio_call_sid`: present
   - `recording_url`: null
   - `recording_storage_path`: null
2. `173d7227-80b4-4930-b1be-029a60d27f56`
   - `organization_id`: `a0000000-0000-0000-0000-000000000001`
   - `status`: `completed`
   - `direction`: `outbound`
   - `duration`: `34`
   - `twilio_call_sid`: present
   - `recording_url`: null
   - `recording_storage_path`: null
3. `09a4b7d6-b74b-4290-93c3-e931556af17b`
   - `organization_id`: `a0000000-0000-0000-0000-000000000001`
   - `status`: `completed`
   - `direction`: `outbound`
   - `duration`: `50`
   - `twilio_call_sid`: present
   - `recording_url`: null
   - `recording_storage_path`: null
4. `7c33c607-34ba-467d-bdfd-bf2d5cec8528`
   - `organization_id`: `a0000000-0000-0000-0000-000000000001`
   - `status`: `completed`
   - `direction`: `outbound`
   - `duration`: `13`
   - `twilio_call_sid`: present
   - `recording_url`: null
   - `recording_storage_path`: null

### 2.2 Aggregate checks

- Calls with `recording_url IS NOT NULL`: **0**
- Calls with `recording_storage_path IS NOT NULL`: **0**
- `phone_settings.recording_enabled`: **true**
- `phone_settings.recording_retention_days`: **7**
- `call-recordings` bucket exists: **yes** (count 1)
- Objects currently in `call-recordings`: **0**
- Object path matching recent call IDs: **0**

### 2.3 Storage policy check

`storage.objects` has authenticated read/upload policies for `call-recordings`, including org-folder scoped policies:

- `call_recordings_select_own_org`
- `call_recordings_insert_own_org`

Also present are broader authenticated bucket policies:

- `Authenticated users can read call recordings`
- `Authenticated users can upload call recordings`

Conclusion for this task: upload/select are not blocked at policy absence level.

---

## 3) Required code diagnosis (answers)

1. **Does `startRecording()` actually start `MediaRecorder`?**  
   Yes, when remote stream capture succeeds. It calls `recorder.start(1000)` and sets `activeRecorder`.

2. **Does `MediaRecorder` receive any chunks before hangup?**  
   Likely yes for longer calls due `start(1000)`, but not guaranteed; depends on browser timing and whether capture actually started.

3. **Does `stopRecording()` return null because chunks are empty?**  
   Yes, that can happen if `recordingChunks` is empty when read (or if recording never started).

4. **Is final `dataavailable` async and being missed?**  
   Yes. Current `stopRecording()` calls `recorder.stop()` and immediately snapshots/clears `recordingChunks` without awaiting `stop`/final chunk emission.

5. **Does `uploadCallRecording()` run at all?**  
   Only when `stopBrowserCallRecording()` returns a non-null blob. If blob is null, upload is skipped.

6. **If upload runs, does storage upload fail?**  
   No direct failure evidence yet; bucket/policies exist, but object count is 0 because upload likely never receives a blob.

7. **If upload succeeds, does `calls` update fail?**  
   Potentially if org mismatch occurs. No direct success evidence in current data.

8. **Does `.eq("organization_id", safeOrg)` match actual row org?**  
   It should when `safeOrg` is the real org id (`a000...001`). It fails if `safeOrg` is wrong.

9. **Does `safeOrg` ever become `"unknown"` during hangup/finalize?**  
   Yes, fallback logic allows `"unknown"` when profile/org context is missing at stop/upload time; that would break row update and write to an `unknown/...` storage path.

10. **Does clearing remote audio before recording stop break remote capture?**  
    Current order generally stops recording before remote detach, but asynchronous finalize risk still exists because stop is not awaited.

11. **Does `hangUp()` stop/upload recording before clearing remote audio?**  
    Yes by current order, but via synchronous stop path that does not await recorder finalization.

12. **Does `finalizeEnded()` still stop/upload on non-button disconnect paths?**  
    Yes. `disconnect`, `cancel`, `reject`, and `error` all invoke `finalizeEnded()` which attempts stop/upload.

---

## 4) Root cause assessment

Most likely primary root cause:
- `MediaRecorder.stop()` finalization is asynchronous, while `stopRecording()` reads and clears chunks synchronously.
- Result: final chunk can be missed, blob is null/empty, upload path is skipped, and `calls.recording_*` stays null.

Secondary contributor to harden:
- `safeOrg` fallback to `"unknown"` can create path/update mismatch if org context is unavailable during finalize.

---

## 5) Proposed surgical fix (post-approval)

### 5.1 `src/lib/browser-recording.ts`

Add async stop path:
- `stopRecordingAsync(): Promise<Blob | null>`
- Behavior:
  - capture current recorder instance
  - if none: cleanup + return null
  - subscribe to final `dataavailable` and `stop`
  - call `recorder.requestData()` when supported and active
  - call `recorder.stop()` if not already inactive
  - await stop/final-chunk with timeout (target ~2000ms)
  - copy chunks before clearing global buffer
  - cleanup `AudioContext` and acquired local stream
  - return null only for empty/no chunks or zero-size blob
- Keep existing `stopRecording()` only as compatibility wrapper if needed, but TwilioContext call-end paths should use async version.
- Add minimal logs:
  - recording started
  - stop requested
  - chunks count at finalize
  - blob size
  - upload start/success/fail
  - calls update success/fail

### 5.2 `src/contexts/TwilioContext.tsx`

Surgical changes only:
- Import/use `stopRecordingAsync` for call-end paths.
- Update both `hangUp()` and internal `finalizeEnded()` to use async stop/upload task.
- Keep UI teardown responsive:
  - capture `callId` + `orgId` early
  - fire async stop/upload task
  - continue UI cleanup without waiting long
- Ensure recorder stop is invoked before remote audio detach in the synchronous sequence.
- Keep all existing guards/re-entrancy behavior intact.

### 5.3 `WORK_LOG.md`

Append newest-first entry after implementation:
- task name
- confirmed root cause
- changes
- files touched
- verification results
- manual smoke result
- deferred items

---

## 6) Intended files to touch (after approval)

Expected:
- `src/lib/browser-recording.ts`
- `src/contexts/TwilioContext.tsx`
- `WORK_LOG.md`
- `implementation_plan.md` (this file, updated now; may receive final status update)

Only if required by evidence:
- `src/components/ui/RecordingPlayer.tsx`
- `src/components/settings/CallRecordingLibrary.tsx`

Will not touch:
- `src/lib/twilio-voice.ts`
- Edge Functions
- migrations
- schema/RLS

---

## 7) Verification plan (post-implementation)

Automated:
- `npx tsc --noEmit`
- `npm test -- --run`

Manual runtime:
- hard refresh app
- confirm recording enabled in Phone System
- place fresh outbound call (20–30s)
- hang up via normal button
- wait 10–20s
- confirm latest `calls` row has:
  - `status = completed`
  - `duration > 0`
  - `twilio_call_sid` populated
  - `recording_storage_path` populated
  - `recording_url` populated
- confirm storage object exists:
  - `call-recordings/{orgId}/{YYYYMMDD}/{callId}.webm`
- verify Recording Library + player behavior
- ensure outbound dialer + disposition flow still intact and no console errors

---

## 8) Stop-and-report conditions

Will stop and report before implementation if any become true:
- requires broad TwilioContext refactor
- browser captureStream proves unreliable for this environment
- storage upload blocked by policies
- org id unavailable at finalize/upload
- requires schema/RLS changes
- requires Twilio-native recording
- risks telemetry/disposition flow

---

## 9) Execution results

Implemented changes (surgical, approved scope only):
- `src/lib/browser-recording.ts`
  - added `stopRecordingAsync(timeoutMs?: number)` with bounded stop wait (1500–2500ms, default 2000ms)
  - waits for recorder stop/finalization before assembling blob
  - logs: stop requested, chunk count, blob size, upload success/failure, calls update success/failure
  - blocks missing org uploads (no `unknown` path writes)
- `src/contexts/TwilioContext.tsx`
  - switched call-end recording handling to async stop/upload path in both `hangUp()` and `finalizeEnded()`
  - captures org id early (`profile.organization_id || organizationId`) before cleanup
  - initiates recording stop/upload before remote audio detach
  - no broad lifecycle refactor; telemetry/disposition/outbound flow unchanged

Automated verification:
- `npx tsc --noEmit` ✅
- `npm test -- --run` ✅ (13 files, 72 tests)

Manual runtime verification:
- Pending Chris validation steps from approval checklist.
