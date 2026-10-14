# Instant, truthful manual SMS feedback

**Status:** approved by Chris on 2026-10-14 for a frontend-only build with binding corrections (D1–D9 and design corrections 1–7 below) and bounded read-only Gate 0 inspections. Not approved: backend code changes, production mutations, Realtime publication changes, merge, deployment, publication, secret rotation or live SMS.

**Base:** `main` `dacd921903a867de99276f8709f829995602c3bd` (rechecked unchanged before editing). **Branch:** `claude/sms-instant-send-20261014` (local, isolated, not published).

## 1. Goal and scope

When an agent presses Send, the outgoing SMS appears immediately with a compact pending indicator, the composer clears and stays editable, and the request finishes in the background. Measured frontend target: p95 click-to-painted-pending at or under 100 ms under the documented fixture conditions (§8). This is a frontend goal, not a server or handset-delivery claim.

- **In scope:** manual SMS from Conversations (`ConversationThread`) and from the contact record (`FullScreenContactView`, mounted by Contacts, Calendar, Dialer and the contact deep link).
- **Callers inventoried:** those two are the only live manual senders. The Dialer's inline composer is a "coming soon" stub (`DialerPage.tsx:4045`). Workflow, ClearPath, the consent worker and the after-hours voice helper are automated server paths and are not touched.
- **Out of scope:** email sending (unchanged), calls, the Conversations sidebar (D5 deferred), the history data layer, START, A2P, consent, delivery callbacks, every Edge function, migration, RLS policy and the Realtime publication.

## 2. Gate 0 evidence (read-only, 2026-10-14)

Tools: Supabase MCP `execute_sql` (SELECT only), `list_edge_functions`, `get_edge_function`, `query_logs` (24 h per query). No send endpoint was invoked and nothing was written.

- **G0-1 Realtime:** the `supabase_realtime` publication holds `call_scripts`, `calls`, `campaign_leads`, `campaigns`, `dnc_list`, `notifications`, `phone_numbers`, `phone_settings`, `wins`. `messages` and `contact_emails` are **not** published, matching the independent check and the baseline (`20260806000000_baseline_production_schema.sql:12780-12819`). The thread and sidebar `messages` subscriptions never fire in production; this build is designed and tested with Realtime disabled.
- **G0-2 live contract:** `twilio-sms` v38, ACTIVE, `verify_jwt=false`, ezbr `1b14b60a…`, deployed 2026-10-08T15:15:56Z. All 13 bundled files are byte-identical (sha256 and git blob) to `dacd921`, and the bundle equals the relative-import closure of `index.ts`. The response contract inspected below is what production runs. (`clearpath-lead-alert` is live v2 from unmerged PR #444; untouched.)
- **G0-3 server timing (logs):** retention reached at least 2026-09-29; the window used is v38's life, 2026-10-08T15:15Z–2026-10-14T~18:50Z. Six `twilio-sms` POSTs: 200 ×4 (4,462 / 4,518 / 5,143 / 4,622 ms execution), 503 ×1 (2,806 ms), 401 ×1 (283 ms). Each of the three most recent ran in a fresh isolate: boot 35–52 ms, CPU 52–64 ms, so about 99% of execution was waiting on network calls. The one complete gateway trace (4,622 ms) shows **19 sequential Supabase API calls** totalling 3,542 ms of gateway origin time (88–329 ms each, plus about 25 ms of client overhead per call), about 365 ms for credentials plus two Twilio checks, and about 234 ms for the Twilio Messages POST. Sample size is 4 successes: no percentiles are claimed.
- **G0-4 paths:** exactly one `sms_agency_policies` row (CG Financial: enforced, sending enabled, 5 senders). In the last 30 days every stored SMS belongs to that agency (12 outbound, 20 inbound), so the non-idempotent legacy path had no traffic.
- **G0-5 outcomes:** `sms_dispatches` holds 8 rows, all `accepted` (5 manual, 3 informational). None prepared, attempting, uncertain or failed.

## 3. Confirmed current flow and causes of waiting

1. **Nothing renders until the round trip ends.** `ConversationThread.handleSend` awaits the page (`ConversationThread.tsx:268-271`); the contact record awaits the same request (`FullScreenContactView.tsx:719-795`). Only the Send spinner changes.
2. **The server takes multiple seconds** (G0-3): the dispatcher path runs about 17 database reads/RPCs, an auth call and three Twilio calls in sequence before replying.
3. **Conversations then reloads the whole thread with a spinner.** `loadThread` sets `loading: true` (`:176`), which replaces every row with a spinner (`:414-417`) while calls, SMS and email are re-read. A failed reload sets the rows to `[]` (`:185`), erasing the conversation, and every rows change smooth-scrolls to the bottom (`:260-266`).
4. **The contact record refreshes every visible history page** (`:792`) before the SMS appears, and clears the composer on success (`:789`), destroying anything typed after pressing Send.
5. **"Message sent" toasts** (`Conversations.tsx:256`, `FullScreenContactView.tsx:787`) report provider acceptance as if it were delivery.
6. **A page-wide `sendingRef`** (`Conversations.tsx:38-39,186`) blocks texting any other contact while one send is in flight.
7. **Request identity and drafts live in component state** (`SmsIntent` per component), so closing a contact mid-send loses them.

## 4. Approved decisions (as corrected by Chris)

- **D1** One active client send per identity-scoped contact, shared by both SMS surfaces in the same application instance. Typing stays enabled. No send queue. This is not a cross-tab or server lock.
- **D2** Each send intent has an immutable request ID and a frozen snapshot (organization, actor, viewer, contact type/id, recipient, body, requested sender preference). `SmsIntent`'s identity is unchanged (it still includes the sender preference). A known unresolved attempt keeps its original ID and snapshot; changing the selector never rewrites it or turns it into a fresh retry (see §5.3). A genuine new message after confirmed acceptance gets a new intent, even with identical text.
- **D3** Text returns to the composer automatically only when non-sending is proven and the originating SMS composer still has the same identity, is empty, is on the SMS channel and has no newer draft revision. Otherwise the failed item is retained. Uncertain messages are never restored and get no resend action. SMS text never goes into email compose.
- **D4** No SMS success toast. Email unchanged.
- **D5** Sidebar cleanup deferred; sidebar behavior and ordering unchanged. Its separate defect (skeleton on every reload; a failed refresh empties the list, `ConversationsSidebar.tsx:91,102,190`) is reported, not fixed.
- **D6** Only the SMS-send part of invariant #31 is amended (§11).
- **D7** Gate 0 done (§2).
- **D8** No backend work in this pass; a next step is recommended after verification (§10).
- **D9** "Still sending…" after 10 s. A 60 s client deadline covers the pre-request phase too: if session resolution finishes after the deadline, or authority changed, the POST is not started. A dispatched request that reaches the deadline becomes "Not confirmed" — never "Not sent" or "Canceled"; aborting the browser request does not prove the server stopped.

## 5. Design

### 5.1 Pending-send store (`src/lib/sms-send/pendingSmsStore.ts`)

- In-memory module state with `subscribe`/`getSnapshot`, read through `useSyncExternalStore`. Never written to localStorage, sessionStorage, IndexedDB, logs or analytics.
- **Scope key:** organization | real actor | effective viewer | contact type | contact id. A record renders only where all five match the surface's current identity, compared at render time.
- **Record:** local id, frozen snapshot (incl. request ID), state (`sending`, `accepted`, `accepted_review`, `not_sent`, `uncertain`), reason and server message, `everUncertain`, attempt id/count, slow flag, receipt (`message_id`, `provider_message_id`, `status`, `replayed`), canonical row from the targeted read (with its read sequence), reconciliation state, hidden flag, originating draft sink and the composer revision captured at send.
- **Intent registry:** the existing `SmsIntent` key (`[actor, org, contactType, contactId, to, senderPreference, body]`), now app-level so an unresolved request ID survives closing a contact or changing route. Completion removes a mapping only if it still points at that request ID.
- **Capacity:** at most 100 records. Prune order: dismissed or list-reconciled resolved records, then other resolved records. Unresolved records (`sending`, `not_sent`, `uncertain`) and their request IDs are never discarded; if every slot is unresolved, the new submission is refused clearly and the composer keeps its text.
- **Dismiss** hides the presentation only. The request identity and snapshot remain, so an identical resubmission reuses the same ID instead of becoming a fresh duplicate attempt.
- **Authority binding:** `PendingSmsAuthorityBridge` (mounted once in `App.tsx`, inside `AuthProvider`) binds the real user id, the real profile's organization and View As state. The store keeps an authority generation that increases on every change, including sign-out and A → B → A. A lazy `supabase.auth.onAuthStateChange` subscription (the `leaderboardAvatarCache` pattern) clears immediately on sign-out or a user change even when no SMS surface is mounted.
- **Boundary (documented honestly):** state lives only in this browser tab's memory. Reload discards it; sign-out and user change clear it. In-flight requests may still complete on the server; their result then appears only through saved history. Nothing is resent.

### 5.2 Send lifecycle (`src/lib/sms-send/sendManualSms.ts`)

1. **Click/Enter, synchronous:** View As refusal first (before any credential read), then text, phone, online, single-flight, D2 and capacity checks. A refusal keeps the composer text and creates no record.
2. **`begin()`, synchronous:** freeze the snapshot, create or reactivate the record (`sending`), return. The surface clears its composer in the same event and records the post-clear revision on the record. The pending bubble paints on the next frame.
3. **Pre-dispatch (async):** await `getSession()` under the 60 s deadline. Immediately before POST, re-check: same authority generation, same real actor and organization, session user equals the snapshot actor, not View As, deadline not passed. Any failure here proves non-sending → `not_sent`.
4. **Dispatch:** one POST, same body contract as today (`request_id`, `actor_id`, `organization_id`, `view_as:false`, `to`, `from` only when a preference exists, `body`, `contact_id`, `contact_type`, `lead_id`), aborted at the deadline. No retry for any reason.
5. **Settle** by the exact classification in §5.4, guarded by attempt id and authority generation so a late result never updates another identity, restores a draft or shows a contact-specific toast.
6. **Accepted:** read that one `messages` row by `id` and `organization_id` with the caller's session (`.maybeSingle()`), validate it with Zod against the captured contact (`contact_id` or `lead_id`) and actor (`created_by`), and show it in place with the sender the server actually used. A failed or empty read leaves the record accepted with history reconciliation pending, retried at +2 s and +10 s only; it is never a send failure.
7. **Recovery:** after an uncertain or accepted-review outcome, the mounted surface receives one quiet history refresh. No polling.

### 5.3 Identity and matching

- A pending record is matched to a saved row **only** by the receipt's `message_id`. No body, phone, timestamp, actor or loaded-ID heuristics, and no hiding of saved rows (correction 2).
- Authorized saved messages always stay visible. A row from another tab, a refresh or pagination simply shows; if it is this send's row and the receipt has not arrived yet, the pending bubble stays visible next to it until the receipt names it. A temporary pending indicator is preferred to an incorrect match.
- If a lost response prevents correlation, the record stays "Not confirmed"; it is never presented as a second confirmed send.
- **Evidence, not ranking (correction 5):** acceptance and failure are separate branches. Accepted evidence is never downgraded, and a later refusal cannot turn an earlier uncertain attempt into `not_sent`. When the same saved row comes from several reads, the row from the most recently started read wins (a bounded read is the arbiter). The database default status is not treated as delivery evidence; no delivery labels are shown.
- **D2 guard:** while an unresolved record exists for a contact, an identical snapshot reuses its request ID and record. The same recipient and body with a different sender preference is refused locally (composer kept) instead of minting a fresh request ID.

### 5.4 Exact response classification (`src/lib/sms-send/smsSendResult.ts`)

Bodies are parsed with Zod. Only these exact (status, contract) pairs prove that **this request** did not send; everything else is uncertain. No code families, wildcards or "any 4xx".

| Proven non-sending (status, code / error literal) | Source |
|---|---|
| 403 `SEND_SCOPE` | `twilio-sms/index.ts:150`, `dispatch.ts:48` |
| 403 `CONTACT_SCOPE`, 403 `CONTACT_CHANGED` | `scope.ts` (before and inside dispatch, always before `sms_start_dispatch`) |
| 409 `CONTACT_CONVERTED` | `dispatch.ts:160`, before start |
| 403 `ACTOR` | `dispatch.ts:88` |
| 409 `SMS_PAUSED`, 400 `SMS_INPUT`, 409 `PHONE` | `dispatch.ts:36,56`, `wire.ts` |
| 503 `SMS_POLICY` | `index.ts:157` (dispatcher returned before any work) |
| 409 `SENDER_NOT_SELECTED`, 409 `A2P_NOT_READY` | `manual.ts`, `dispatch.ts:68,75`, `sending.ts:13` |
| 403 `SENDER_NOT_ALLOWED`, 409 `NUMBER_NOT_REGISTERED`, 409 `SENDER_REMOVED` | `sending.ts:24,33,46` (before prepare) |
| 401 "Unauthorized"; 400 "Organization not found for user", "Invalid JSON body", "Missing required fields: to, body" | `index.ts:88,100,112,121,142` |
| 400 "A sender number is required.", "Invalid phone number format (E.164 required).", "Sender number not registered to your organization.", "Twilio credentials not configured." | legacy path `index.ts:161-207`, before Twilio |

| Outcome | State and reason |
|---|---|
| `success:true` with a valid receipt (UUID `message_id`) | `accepted` |
| `SEND_ACCEPTED_REVIEW` (503) | `accepted_review` (provider accepted; history not saved) |
| `PROVIDER_REJECTED` | `uncertain` / provider_rejected (also used for provider 5xx) |
| `SMS_SUPPRESSED` | `uncertain` / provider_suppressed (emitted from the provider response code, not its HTTP status) |
| `SEND_UNCERTAIN` | `uncertain` / send_uncertain |
| `SEND_REVIEW` | `uncertain` / attempt_exists |
| `SEND_IN_PROGRESS` | `uncertain` / in_progress |
| `SMS_STATE` | `uncertain` / state_unverified (also STOP/DNC blocks and post-attempt persistence failures) |
| `success:true` with a malformed receipt | `uncertain` / malformed_receipt |
| unparseable body, unknown code, known code with an unexpected status, other uncoded responses | `uncertain` / unrecognized_response |
| fetch rejected after dispatch | `uncertain` / transport |
| deadline reached after dispatch | `uncertain` / deadline |
| local pre-dispatch stop (session, authority, deadline) | `not_sent` (POST never started) |

### 5.5 What the agent sees

- **Status line** under the bubble (`aria-live="polite"`, server reason in small text and `title`):
  - **Sending… / Still sending…** while in flight (bubble dimmed).
  - **Not sent** · reason · Edit (only when the composer for that contact is on SMS and empty) · Dismiss.
  - **Not confirmed** · reason · Dismiss. No restore, copy-to-composer or resend action.
  - **Accepted · history not saved** · Dismiss.
  - **Accepted:** no label; the saved row replaces the bubble once read.
- Error toasts stay concise; no success toast. Email toasts unchanged.
- **Conversations thread:** background reloads keep rows (spinner only before the first successful load); a failed refresh keeps rows and adds "Couldn't refresh · Retry". Scrolling jumps to the newest on first load and on the agent's own send, follows other new rows only within about 120 px of the bottom, and never moves for status changes or reconciliation.
- **Contact record:** pending items join the timeline; the existing reverse feed follows the same scroll rule. After an accepted send the history refreshes once, quietly, only while its Activity tab is open (keeps that panel as current as today).
- Pending records never feed the sidebar, Activity, counts or telemetry.

## 6. Files

**New**

| File | Purpose |
|---|---|
| `src/lib/sms-send/smsSendResult.ts` | Zod schemas and the exact classification table |
| `src/lib/sms-send/pendingSmsStore.ts` | Store, intents, authority generation, capacity, draft sinks |
| `src/lib/sms-send/sendManualSms.ts` | Shared submit/dispatch/settle/reconcile path for both surfaces, timing marks |
| `src/lib/sms-send/smsDisplayMerge.ts` | Pure merge by `message_id`, read-recency evidence, pending view builders |
| `src/hooks/usePendingSms.ts` | Store selectors and the composer draft-sink hook |
| `src/components/messaging/PendingSmsStatus.tsx` | Compact status line and actions |
| `src/components/messaging/PendingSmsAuthorityBridge.tsx` | Binds auth identity to the store (renders nothing) |
| `src/lib/sms-send/__tests__/*`, `src/components/conversations/__tests__/conversationThreadPendingSms.test.tsx`, `src/components/contacts/__tests__/fullScreenContactViewPendingSms.test.tsx`, `src/components/messaging/__tests__/pendingSmsStatus.test.tsx` | Tests (§7) |
| `scripts/tests/sms-responsiveness/*` | Browser fixture with stubbed services and a fake transport (§8) |

**Changed**

| File | Change |
|---|---|
| `src/App.tsx` | Mount the authority bridge (import + one line) |
| `src/lib/sms-intent.ts` | Completion removes a mapping only if it still holds that request ID; key unchanged |
| `src/pages/Conversations.tsx` | Synchronous SMS submit through the shared path (View As refusal still first); per-contact flight replaces the page-wide SMS lock; email unchanged |
| `src/components/conversations/ConversationThread.tsx` | Composer revision and draft sink; SMS submit clears the composer after retention; pending rows; quiet reloads that keep rows; scroll rule |
| `src/components/contacts/FullScreenContactView.tsx` | SMS submit through the shared path; draft sink; pending items in the timeline; no success toast; recovery refresh; email unchanged |
| `src/components/contacts/conversation-history/ConversationTimeline.tsx` | Scroll rule; pending actions passthrough |
| `src/components/contacts/conversation-history/SmsHistoryItem.tsx` | Status slot |
| `src/components/contacts/conversation-history/conversationTypes.ts` | Optional pending view on SMS items |
| Existing suites: `conversationsSendContract`, `fullScreenContactViewConversation`, `smsConsent`, `conversationThreadIsolation` | Updated only where the SMS contract changed |
| `.github/workflows/sms-consent.yml` | New paths/tests and the fixture step |
| This plan, `WORK_LOG.md`, `AGENT_RULES.md` (#31 SMS part), `docs/plans/2026-10-14-workflow-secret-rotation/rotation_plan.md` | Records |

**Differences from the first draft:** the hold/hide rule and numeric status ranking are removed (corrections 2, 5); `SmsIntent`'s key keeps the sender preference (D2); `PROVIDER_REJECTED`, `SMS_SUPPRESSED` and all uncoded non-literal responses are uncertain (correction 1); the sidebar change and the `ThreadMessageItem` extraction are dropped (D5, correction 7); `App.tsx` and the bridge are added for authority cleanup (correction 4); Copy is not offered for uncertain items (D3).

## 7. Test plan

All tests run with Realtime disabled (handlers registered but never fired) and a fake transport; no live SMS.

- **Unit:** every row of §5.4; store single flight, D2 guard, capacity and pruning order, dismissal keeping identity, attempt/generation guards, A → B → A, sign-out while `getSession` is pending, View As before POST, deadline before and after dispatch, conditional intent completion, no browser-storage writes; merge by `message_id` only, read recency, another tab's row arriving first, pagination revealing older rows.
- **Both surfaces (real components):** delayed response with immediate pending bubble; normal success with exactly one saved message and no full reload; double-click and Enter+click; identical intentional texts after acceptance; proven rejection, timeout, uncertain, `PROVIDER_REJECTED`/5xx, uncertain-then-preflight-error, receipt then failed row read; new draft typed while the previous send resolves; failure with a newer SMS or email draft; contact, route, viewer, organization and sender changes in flight; close/reopen; both composers in one app instance; converted contact and agency fallback sender; long histories with stable scroll and quiet refresh; existing email, View As and scope regressions.
- **Gates (base reproduced first, never assumed):** `npx tsc --noEmit`; `npx tsc -p tsconfig.app.json --noEmit` compared as a diagnostic multiset; full Vitest with dummy `VITE_SUPABASE_*`; ESLint on changed files; production build; `git diff --check`; desktop and mobile browser fixture.

## 8. Measurement

- **Metrics:** click to painted pending feedback (Event Timing plus a frame probe on the bubble), click to request start, request round trip, receipt to saved row shown. Rendered feedback is measured in the browser, not store insertion.
- **Conditions:** production Vite build; Playwright 1.56.1 headless Chromium; no CPU throttling; 1440×900 and 390×844; Conversations thread with 100 SMS, 50 calls and 50 emails; contact record with 90 history items; fake transport with a 1,500 ms receipt and an 80 ms row read; 50 sends per surface per viewport; p50/p95/max. A 4× CPU-throttled run is reported for information only.
- **Before/after:** the same DOM-driven script runs against `dacd921`. The base has no pending bubble; its comparable metrics are click to first visible change (Send spinner) and click to outgoing message visible.
- Fixture timings are reported separately from the server timings in §2; neither is a handset-delivery measurement.

## 9. Risks and limits

1. Exactly-once delivery is not claimed: a lost response leaves "Not confirmed", and correlation then depends on saved history plus the dispatcher's request-key protection.
2. The legacy path (no current traffic, G0-4) ignores request IDs; a manual resend there after an uncertain outcome could duplicate, as today.
3. `SMS_STATE` covers STOP/DNC blocks and post-attempt persistence failures, so such sends read "Not confirmed" (server code precision is a backend follow-up).
4. With Realtime unpublished, inbound replies still do not appear live in an open thread (unchanged).
5. State is per tab and memory-only; reload and sign-out end it (§5.1).
6. A second, different text to the same contact waits for the first to get a response (D1).

## 10. Backend follow-up

Not implemented here. The recommendation, with exact files, evidence and release implications, is recorded after frontend verification in the verification section below and in `WORK_LOG.md`.

## 11. Invariant #31 amendment (SMS part only)

Recorded in `AGENT_RULES.md` after verification; other #31 authority, scope, draft and stale-request protections are unchanged.

## 12. Rollback

Revert the commits (or use Vercel instant rollback after a future approved release). No migration, Edge deploy or stored state exists to unwind.

## 13. Verification record

Filled in after implementation: base and candidate gate results, measurements, limits and the backend recommendation.
