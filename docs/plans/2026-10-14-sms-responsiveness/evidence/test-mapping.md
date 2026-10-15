# Replaced SMS tests: base → candidate mapping

Base: `main` `dacd921903a867de99276f8709f829995602c3bd`. Candidate: this branch (see `regression.md` for the exact commit and results).

The list comes from a test-name diff of the two full Vitest JSON reports. 12 base test names no longer exist: 10 in `src/pages/__tests__/conversationsSendContract.test.tsx` and 2 in `src/components/contacts/__tests__/fullScreenContactViewConversation.test.tsx`. No test was deleted without a replacement. No test was skipped, weakened to a no-op or silenced. No unrelated test changed. Three existing files changed: these two and `conversationThreadIsolation.test.tsx` (one same-name test, below).

## Why the replaced tests changed

Three contracts changed by approved design (plan §4, D1–D9; §5.4):

1. **An SMS send no longer reloads the whole thread.** It shows one pending bubble at once, then exactly the receipt's saved row (read by `message_id`).
2. **Only exact pre-send refusals return the draft.**
   - The base restored the draft after any failure, including an uncoded `{ success: false, error }` body or a dropped connection. Either can follow a provider call.
   - Such outcomes are now **Not confirmed**: the text stays visible in its item, and the item offers no Edit or resend.
3. **The success toast for SMS is gone.** The bubble becoming the saved row is the confirmation. Email still toasts "Email sent".

## `conversationsSendContract.test.tsx` (10 replaced)

| # | Base test (full name) | Replacement(s) in the candidate | Assertion change |
|---|---|---|---|
| 1 | View As is READ-ONLY in Conversations › a direct handleSendMessage call refuses BEFORE touching session, mailbox or Twilio | View As is READ-ONLY in Conversations › direct send handler calls refuse BEFORE touching session, mailbox or Twilio | Renamed for the new SMS entry point. The base test called `onSendMessage(…, "sms")`. SMS no longer goes through that handler: after the View As refusal it returns `false` for anything but email. The test now calls `onSendMessage(…, "email")` and `onSubmitSms`. Kept: both report failure, no credential is read, and the read-only toast shows. Added: the SMS composer is not cleared, exactly two read-only toasts, and the pending store stays empty. |
| 2 | a SUCCESSFUL send clears the composer and refreshes › SMS success clears the draft and reloads the thread | a SUCCESSFUL send clears the composer › SMS: clears at once, shows one saved message, and does not reload the whole thread | Superseded contract: the base asserted exactly one thread reload, the candidate asserts zero. Added: the composer clears before any request, the pending bubble shows "Sending…", exactly one copy of the text, a targeted read of the receipt's row scoped by `organization_id`, and no SMS success toast. |
| 3 | a SUCCESSFUL send clears the composer and refreshes › email success clears the body and the subject | a SUCCESSFUL send clears the composer › email success clears the body and the subject | The describe name changed. One assertion was added: the success toast is exactly "Email sent" (contract 3: email keeps its toast). |
| 4 | a failed SMS send keeps the draft › a failed send does NOT refresh the thread | a PROVEN failure returns the SMS draft › a proven refusal does NOT refresh the thread · an UNCONFIRMED failure … › refreshes the thread once, quietly, to show whatever was saved | Split by evidence. A proven refusal (409 `PHONE`) still makes zero reloads. An uncertain outcome (503 `SEND_UNCERTAIN`) makes exactly one reload and leaves the pending text visible. "No spinner, rows kept" is asserted in `conversationThreadPendingSms` › an uncertain outcome reloads once without a spinner and without moving a reader in history. The base input (an uncoded `{ success: false, error }` body) has no reload-count assertion here: row 8 covers how it is classified. |
| 5 | a failed SMS send keeps the draft › a non-Error throw still reports a message | an UNCONFIRMED failure … › a non-Error throw still reports a message | The toast assertions are unchanged. The "composer still holds the draft" assertion is removed: a transport failure after dispatch is uncertain, and its text stays in the pending item instead. |
| 6 | a failed SMS send keeps the draft › contact has no phone number | a PROVEN failure returns the SMS draft › contact has no phone number | Same assertions. |
| 7 | a failed SMS send keeps the draft › expired session | a PROVEN failure returns the SMS draft › expired session | Same assertions, plus "no SMS request was made". |
| 8 | a failed SMS send keeps the draft › the provider reports failure | a PROVEN failure … › the server proves it did not send (an exact pre-send refusal) · an UNCONFIRMED failure … › an unrecognised failure body is Not confirmed, not restored | The base body (`{ success: false, error: "carrier rejected" }`, no code) is now uncertain: composer empty, item shows "Not confirmed", no Edit button, error toast. A coded 409 pre-send refusal restores the draft and leaves no failed item. |
| 9 | a failed SMS send keeps the draft › the request throws | an UNCONFIRMED failure … › the request throws after dispatch | Draft-restore assertion replaced by: composer empty, text in the item, "Not confirmed", and a "connection dropped" toast. |
| 10 | manual SMS request contract › keeps the same request ID and draft when the server refuses a suppressed recipient | manual SMS request contract › a proven refusal returns the draft, and resending it reuses the same request ID · manual SMS request contract › a suppressed recipient is Not confirmed; retyping the same text keeps its request ID | Request-ID reuse is kept for both a proven refusal and an `SMS_STATE` (STOP/opt-out) outcome. The draft returns only for the proven refusal. `SMS_STATE` also covers post-attempt persistence failures, so it never proves non-sending. |

New tests in this file:
- manual SMS request contract › a double click and Enter+click dispatch once
- manual SMS request contract › identical text after a confirmed send is a new message with a new request ID

Same-name tests whose assertions changed (not counted as replaced):

| Test | Change |
|---|---|
| …a FAILED send for A leaves B's fresh draft alone | Now drives a proven refusal, the only failure that restores a draft. |
| manual SMS request contract › rejects a second send while the first request is still in flight | Calls `onSubmitSms` (synchronous `boolean`). Also asserts Send stays disabled for that contact. |
| ordinary sending is unchanged › renders the composer and sends | `toastState.successes` must now equal `[]` (the base required "Message sent"); contract 3 above. Composer-clear and credential-read assertions unchanged. |

`conversationThreadIsolation.test.tsx` (same-name test changed, not counted as replaced):

| Test | Change |
|---|---|
| a stale contact can never START a request for itself › a stale post-send refresh cannot discard the current contact's response either | Now sends an **email**: it adds a click to the email channel and asserts the channel reads "email". A confirmed SMS no longer reloads the thread, so only email still has a post-send refresh to guard. The SMS counterpart, an uncertain SMS result arriving after the agent switched contacts, is pinned by a test added on 2026-10-15: `conversationThreadPendingSms` › an uncertain result for a contact the agent has left never reloads the open thread. It is mutation-checked: when scope events reach every contact, it fails. |

## `fullScreenContactViewConversation.test.tsx` (2 replaced)

| # | Base test (full name) | Replacement(s) in the candidate | Assertion change |
|---|---|---|---|
| 11 | manual SMS composer › sends with no website enrollment, purpose or selected voice number and refreshes real history | manual SMS composer › sends with no website enrollment, purpose or selected voice number and shows the saved row | Same request-payload assertions: no `purpose`, no `from`, and the `organization_id`, actor, contact and `view_as: false` fields. Added: the text is on screen with "Sending…" before the request starts; after the receipt, one copy, the sender the server used and no error toast. The fake receipt now carries `message_id`, the field the live `twilio-sms` v38 returns (Gate 0), instead of the pre-dispatcher `id`. |
| 12 | manual SMS composer › preserves the draft and request ID after a server STOP refusal | manual SMS composer › returns the draft and reuses the request ID after a proven refusal · manual SMS composer › a STOP or DNC block is Not confirmed: the text stays in its item, never back in the composer | Request-ID reuse is kept for the proven refusal. A STOP/DNC (`SMS_STATE`) outcome is uncertain: composer empty, text in the item, no Edit, one error toast. STOP/DNC enforcement itself is server-side and unchanged. |

New block in this file, "pending manual SMS on the contact record" (6 tests):
- a converted contact's refusal is proven: the draft comes back
- a failed saved-row read after a valid receipt stays accepted, then reads 'history pending'
- an uncertain outcome refreshes history once, on any tab
- both SMS composers in one app instance share one in-flight send per contact
- pagination reveals older identical texts without hiding any of them
- refreshes history after acceptance only while Activity is open

The same-name test "continues to refuse sending in View As" adds an assertion that the pending store stays empty.

**Harness change (corrected 2026-10-15).** `renderView` mounts `PendingSmsAuthorityBridge` beside the view.
- **The defect:** it was first added as a fragment. That made "A. filters use canonical identifiers › clears the previous contact's items when switching contacts (preservation pin)" remount the view on `rerender`, so the pin passed without exercising a contact switch.
- **The fix:** the bridge now rides in Testing Library's `wrapper`, so `rerender` updates the contact prop in place, as on base.
- **Mutation check:** with the contact id dropped from `useContactHistory`'s key, the pin passed under the fragment harness and fails under the corrected one.

## Required coverage → tests

| Behaviour | Tests (file › describe › name) |
|---|---|
| Uncertain sends | `smsSendResult.test.ts` › everything after a possible provider call is uncertain (9) · `sendManualSms.test.ts` › uncertain outcomes are never restored, resent or relabelled (3) · `conversationsSendContract` › an UNCONFIRMED failure … (4) · contact › a STOP or DNC block is Not confirmed |
| Immutable request IDs | `pendingSmsStore.test.ts` › begin … › freezes an immutable snapshot with the request ID · request identity (D2) (5) · `conversationsSendContract` › manual SMS request contract (3 request-ID tests) · contact › returns the draft and reuses the request ID … |
| Dismissal | `pendingSmsStore.test.ts` › dismiss hides; it never forgets (2) · `pendingSmsStatus.test.tsx` › proven not sent: … Dismiss |
| Capacity | `pendingSmsStore.test.ts` › capacity never discards unresolved text or IDs (2) |
| Late identity changes | `pendingSmsStore.test.ts` › identity changes (6) and dispatch re-check (3) · `sendManualSms.test.ts` › authority changes before dispatch (5) · `conversationThreadPendingSms` › identity and lifecycle (5) · `pendingSmsBridgeMount.test.ts` (the bridge stays mounted in `App.tsx`) |
| Draft preservation | `pendingSmsStore.test.ts` › draft restore (D3) (6) · `sendManualSms.test.ts` › proven non-sending (4) · `conversationThreadPendingSms` › failures never overwrite a newer draft (2) · `conversationsSendContract` › a PROVEN failure returns the SMS draft (4) |
| Exact-ID reconciliation | `smsDisplayMerge.test.ts` (13, incl. "never matches by body, phone or time") · `smsSendResult.test.ts` › the saved row is accepted only when it is exactly the receipt's row (7) · `sendManualSms.test.ts` › normal success (4) |
| Both UI surfaces | Conversations: `conversationsSendContract`, `conversationThreadPendingSms`, `conversationThreadIsolation`, `conversationsViewAs` (View As read scoping). Contact record: `fullScreenContactViewConversation` (both blocks). Both together: contact › both SMS composers in one app instance share one in-flight send per contact. |
| Realtime disabled | `conversationThreadPendingSms` registers the page's Realtime handlers but never fires them, as in production. "…renders on the click, keeps typing open, and becomes the saved row without a reload" asserts that handlers were registered, that the saved row arrived anyway (targeted read) and that the thread made zero reloads. `sendManualSms.test.ts` › normal success covers the read on its own. The browser fixture's stub channel also never delivers. Gate 0: `messages` and `contact_emails` are not in the Realtime publication. |
| View As read-only | `conversationsSendContract` › View As is READ-ONLY … · `conversationThreadPendingSms` › View As before the POST: nothing is sent, nothing shows under the viewed agent · a dispatched send is not resent or reported after View As starts · `pendingSmsStore.test.ts` › refuses under View As … · `sendManualSms.test.ts` › View As before the POST … · contact › continues to refuse sending in View As |
| Duplicate-attempt protection | `conversationsSendContract` › a double click and Enter+click dispatch once · rejects a second send while the first request is still in flight · `pendingSmsStore.test.ts` › allows one in-flight send per contact … (D1) · `sendManualSms.test.ts` › a second submit while in flight is refused silently … · contact › both SMS composers … share one in-flight send |
