# Instant, truthful manual SMS feedback

**Status:** approved by Chris on 2026-10-14 for a frontend-only build with binding corrections (D1–D9 and design corrections 1–7 below) and bounded read-only Gate 0 inspections. Not approved: backend code changes, production mutations, Realtime publication changes, merge, deployment, publication, secret rotation or live SMS. **Built and verified locally (§13); not published, merged or deployed.**

**Base:** `main` `dacd921903a867de99276f8709f829995602c3bd` (rechecked unchanged before editing). **Branch:** `claude/sms-instant-send-20261014` (local, isolated, not published).

## 1. Goal and scope

When an agent presses Send, the outgoing SMS appears immediately with a compact pending indicator, the composer clears and stays editable, and the request finishes in the background. Measured frontend target: p95 click → pending text **visible** at or under 100 ms under the documented fixture conditions (§8). This is a frontend goal, not a server or handset-delivery claim.

- **In scope:** manual SMS from Conversations (`ConversationThread`) and from the contact record (`FullScreenContactView`, mounted by Contacts, Calendar, Dialer and the contact deep link).
- **Callers inventoried:** those two are the only live manual senders. The Dialer's inline composer is a "coming soon" stub (`DialerPage.tsx:4045`). Workflow, ClearPath, the consent worker and the after-hours voice helper are automated server paths and are not touched.
- **Out of scope:** email sending (unchanged), calls, the Conversations sidebar (D5 deferred), the history data layer, START, A2P, consent, delivery callbacks, every Edge function, migration, RLS policy and the Realtime publication.

## 2. Gate 0 evidence (read-only, 2026-10-14)

Tools: Supabase MCP `execute_sql` (SELECT only), `list_edge_functions`, `get_edge_function`, `query_logs` (24 h per query). No send endpoint was invoked and nothing was written.

- **G0-1 Realtime:** the `supabase_realtime` publication holds `call_scripts`, `calls`, `campaign_leads`, `campaigns`, `dnc_list`, `notifications`, `phone_numbers`, `phone_settings`, `wins`. `messages` and `contact_emails` are **not** published, matching the independent check and the baseline (`20260806000000_baseline_production_schema.sql:12780-12819`). The thread and sidebar `messages` subscriptions never fire in production; this build is designed and tested with Realtime disabled.
- **G0-2 live contract:** `twilio-sms` v38, ACTIVE, `verify_jwt=false`, ezbr `1b14b60a…`, deployed 2026-10-08T15:15:56Z. All 13 bundled files are byte-identical (sha256 and git blob) to `dacd921`, and the bundle equals the relative-import closure of `index.ts`. The response contract inspected below is what production runs. (`clearpath-lead-alert` is live v2 from unmerged PR #444; untouched.)
- **G0-3 server timing (logs).** Full evidence and queries: `evidence/server-latency.md`.
  - **Source and window:** `function_edge_logs` for `twilio-sms` POSTs, 2026-10-08T15:15Z (the live deployment's `updated_at`) to 2026-10-14T18:51Z, read as 7 queries of 24 h each. Retention reached at least 2026-09-29.
  - **Sample:** 6 POSTs. Four returned 200, with Edge execution times (`execution_time_ms`) of 4,462, 4,518, 5,143 and 4,622 ms. One returned 503 (2,806 ms) and one 401 (283 ms).
  - **Cold starts:** the three most recent successes each booted a fresh isolate (boot 35–52 ms, CPU 52–64 ms), so almost all of the time was spent waiting on I/O.
  - **One trace:** the 00:18Z send shows **19 sequential Supabase API calls** totalling 3,542 ms of gateway origin time (82–329 ms each). The Twilio request falls between the start and finish dispatch RPCs, about 0.3 s apart in log time. This is one send, not a breakdown.
  - **What the metric is:** Edge execution time only. The production client round trip (network, TLS, the session read) and carrier/handset delivery are **not measured**. With 4 successes, no percentiles are claimed.
- **G0-4 paths:** exactly one `sms_agency_policies` row (CG Financial: enforced, sending enabled, 5 senders). In the last 30 days every stored SMS belongs to that agency (12 outbound, 20 inbound), so the non-idempotent legacy path had no traffic.
- **G0-5 outcomes:** `sms_dispatches` holds 8 rows, all `accepted` (5 manual, 3 informational). None prepared, attempting, uncertain or failed.

## 3. Confirmed current flow and causes of waiting

1. **Nothing renders until the round trip ends.** `ConversationThread.handleSend` awaits the page (`ConversationThread.tsx:268-271`); the contact record awaits the same request (`FullScreenContactView.tsx:719-795`). Only the Send spinner changes.
2. **The server takes multiple seconds** (G0-3: Edge execution 4,462–5,143 ms over 4 successful sends). In the one traced send, the dispatcher path made 19 sequential Supabase API calls plus the Twilio request before replying.
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
- **Record:** local id, frozen snapshot (incl. request ID and a display-only contact label), state (`sending`, `accepted`, `accepted_review`, `not_sent`, `uncertain`), reason and server message, `uncertainty` (the first uncertain outcome, kept so a later refusal cannot clear it), attempt id/count, slow flag, receipt (`message_id`, `provider_message_id`, `status`, `replayed`), canonical row from the targeted read (with its read sequence), reconciliation state, `observed` (the surface's own list now holds the row), hidden flag, originating draft sink and the composer revision captured at send.
- **Intent registry:** the existing `SmsIntent` key (`[actor, org, contactType, contactId, to, senderPreference, body]`), now app-level so an unresolved request ID survives closing a contact or changing route. Completion removes a mapping only if it still points at that request ID.
- **Capacity:** at most 100 records. Prune order: dismissed or list-reconciled resolved records, then other resolved records. Unresolved records (`sending`, `not_sent`, `uncertain`) and their request IDs are never discarded; if every slot is unresolved, the new submission is refused clearly and the composer keeps its text.
- **Dismiss** hides the presentation only. The request identity and snapshot remain, so an identical resubmission reuses the same ID instead of becoming a fresh duplicate attempt.
- **Authority binding:** `PendingSmsAuthorityBridge` (mounted once in `App.tsx`, inside `AuthProvider`) binds the real user id, the real profile's organization and View As state. The store keeps an authority generation that increases on every change, including sign-out and A → B → A. The bridge's `supabase.auth.onAuthStateChange` subscription clears and supersedes synchronously on sign-out or a user change, even when no SMS surface is mounted; it never re-binds the identity itself (only the bridge's React state does), so a sign-out answered by a sign-in that React never rendered cannot leave sending blocked. The store does not import the Supabase client (unit-testable without env).
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
- **Evidence, not ranking (correction 5):** acceptance and failure are separate branches. Accepted evidence is never downgraded, and a later refusal cannot turn an earlier uncertain attempt into `not_sent`. In the Conversations thread, when the list and the targeted read both hold the saved row, the row from the most recently started read wins (a bounded read is the arbiter). The contact-record history feed carries no read sequence (its data layer is out of scope), so its row wins once it holds the `message_id`; no current path modifies an outbound `messages` row after insert, so both reads carry the same content. A saved row is shown once even if two records carried its id. The database default status is not treated as delivery evidence; no delivery labels are shown.
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
  - **Accepted · history not saved** · Dismiss (the server's `SEND_ACCEPTED_REVIEW`).
  - **Accepted · history pending** · Dismiss (the targeted read failed or returned nothing at +0, +2 and +10 s; one quiet history refresh follows).
  - **Accepted:** no label; the saved row replaces the bubble once read.
- **Toasts:** while the contact is on screen, the bare reason; otherwise "Text to {contact} not sent / not confirmed: {reason}", so an outcome is never read as the open contact's. A second click while that contact's text is in flight is answered by the bubble, not a toast.
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
| `src/lib/sms-send/sendManualSms.ts` | Shared submit/dispatch/settle/reconcile path for both surfaces (dependency-injected), optional timing marks |
| `src/lib/sms-send/manualSmsSender.ts` | The app's one wired sender: Supabase session, `twilio-sms` fetch, the targeted `.maybeSingle()` row read, Sonner (added during build: keeps the store and send logic free of the Supabase client) |
| `src/lib/sms-send/smsDisplayMerge.ts` | Pure merge by `message_id`, read-recency evidence, pending view builders |
| `src/hooks/usePendingSms.ts` | Store selectors and the composer draft-sink hook |
| `src/components/messaging/PendingSmsStatus.tsx` | Compact status line and actions |
| `src/components/messaging/PendingSmsAuthorityBridge.tsx` | Binds auth identity to the store (renders nothing) |
| `src/lib/sms-send/__tests__/*`, `src/components/conversations/__tests__/conversationThreadPendingSms.test.tsx`, `src/components/messaging/__tests__/pendingSmsStatus.test.tsx` | Tests (§7). The contact-record cases were added to the existing `fullScreenContactViewConversation.test.tsx` (new describe block) instead of a new file, to reuse its harness. |
| `scripts/tests/sms-responsiveness/*` | Browser fixture with stubbed services and a fake transport (§8) |
| `src/components/messaging/__tests__/pendingSmsBridgeMount.test.ts` | Added 2026-10-15 (§14): source audit that `App.tsx` mounts the bridge exactly once, inside `AuthProvider` and outside the router |
| `docs/plans/2026-10-14-sms-responsiveness/evidence/*`, `measurements/*` | Added 2026-10-15 (§14): test mapping, regression comparison, server-timing evidence, fixture results and screenshots |

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
| Existing suites: `conversationsSendContract`, `fullScreenContactViewConversation`, `conversationThreadIsolation` | Updated only where the SMS contract changed (mapping: `evidence/test-mapping.md`). `smsConsent.test.tsx` is unchanged and still runs in CI. |
| `.github/workflows/sms-consent.yml` | New paths/tests and the fixture step; on 2026-10-15 also `src/App.tsx` in the path filter, the bridge-mount guard in the test list, and an explicit `SMS_EXPECT_BLOCKED` |
| This plan, `WORK_LOG.md`, `AGENT_RULES.md` (#31 SMS part) | Records (the separate security item's remediation plan is kept private, outside this public repository) |

**Differences from the first draft:** the hold/hide rule and numeric status ranking are removed (corrections 2, 5); `SmsIntent`'s key keeps the sender preference (D2); `PROVIDER_REJECTED`, `SMS_SUPPRESSED` and all uncoded non-literal responses are uncertain (correction 1); the sidebar change and the `ThreadMessageItem` extraction are dropped (D5, correction 7); `App.tsx` and the bridge are added for authority cleanup (correction 4); Copy is not offered for uncertain items (D3).

## 7. Test plan

All tests run with Realtime disabled (handlers registered but never fired) and a fake transport; no live SMS.

- **Unit:** every row of §5.4; store single flight, D2 guard, capacity and pruning order, dismissal keeping identity, attempt/generation guards, A → B → A, sign-out while `getSession` is pending, View As before POST, deadline before and after dispatch, conditional intent completion, no browser-storage writes; merge by `message_id` only, read recency, another tab's row arriving first, pagination revealing older rows.
- **Both surfaces (real components):** delayed response with immediate pending bubble; normal success with exactly one saved message and no full reload; double-click and Enter+click; identical intentional texts after acceptance; proven rejection, timeout, uncertain, `PROVIDER_REJECTED`/5xx, uncertain-then-preflight-error, receipt then failed row read; new draft typed while the previous send resolves; failure with a newer SMS or email draft; contact, route, viewer, organization and sender changes in flight; close/reopen; both composers in one app instance; converted contact and agency fallback sender; long histories with stable scroll and quiet refresh; existing email, View As and scope regressions.
- **Gates (base reproduced first, never assumed):** `npx tsc --noEmit`; `npx tsc -p tsconfig.app.json --noEmit` compared as a diagnostic multiset; full Vitest with dummy `VITE_SUPABASE_*`; ESLint on changed files; production build; `git diff --check`; desktop and mobile browser fixture.

## 8. Measurement

Corrected on 2026-10-15 (§14). The rules: only a real click on Send counts; a time is user-visible only when a person could see the text; a surface that cannot be used is reported as BLOCKED, never measured some other way.

- **Metrics (per send):**
  - click → first visible change (base: the Send spinner; candidate: the pending bubble);
  - click → outgoing text **visible**;
  - click → outgoing text **rendered** (in the DOM; diagnostic only, never a user-visible result);
  - click → request start;
  - request round trip (the fake transport);
  - receipt → saved row visible;
  - click → saved row visible;
  - Event Timing `duration` of the click (entries of 16 ms or more).
- **Visible** means:
  - non-zero size;
  - CSS-visible (`checkVisibility` with opacity and visibility);
  - at least half of the element inside the viewport and inside every overflow-clipping ancestor;
  - not covered (`elementFromPoint` at the centre of the visible part, plus every toast's rectangle).

  A hit that falls through a `pointer-events: none` target (a disabled Send button and its spinner) to the target's own ancestor is not counted as covering.
- **Timestamps:** "Visible"/"rendered" times are the first rAF-plus-posted-task after detection. The click time is the click event's `timeStamp`. The probe re-checks every frame while the text is rendered but not yet visible, because scrolling changes visibility without a DOM mutation.
- **Conditions** (`scripts/tests/sms-responsiveness/`, synthetic data only):
  - **Build and browser:** a production Vite build of the fixture, served statically. Only the Supabase client, auth, Twilio context and sidebar list are stubbed; everything else is the real page or contact record. Playwright 1.56.1, headless Chromium.
  - **Viewports and data:** 1440×900 and 390×844. A Conversations thread with 100 SMS, 50 calls and 50 emails; a contact record with 90 history items (three pages loaded).
  - **Fake transport:** a 1,500 ms receipt, an 80 ms targeted row read, 250 ms list and history-page reads.
  - **Runs:** 50 sends per surface per viewport without CPU throttling, and separately 20 sends under 4× CPU throttling. The two are never pooled.
- **Driver rules** (identical on both builds):
  - Each surface settles for 1.5 s after opening (the base build smooth-scrolls 200 rows).
  - **Preflight:** before any send, a Playwright trial click on Send must pass its actionability checks: visible, stable, enabled and receiving events. If it fails, the surface is BLOCKED, with the intercepting element, geometry and a screenshot.
  - **Sends:** only `page.click` on Send — never Enter, a forced click or DOM insertion.
  - **Start state:** each send starts with no toast on screen. The driver waits for any toast to leave and never removes one: the base build's "Message sent" toast covers its own Send spinner for about 4 s.
  - **Toasts:** made click-through, so the driver can reach Send. They still count as covering a message beneath them.
  - **Timeout:** a sent text that does not become visible within 3 s of being saved marks the surface BLOCKED, with its visibility data and a screenshot.
- **Assertions:** each text shows exactly once and the composer clears. For the candidate only, the outgoing text is visible before the receipt.
- **CI** (`sms-consent.yml`) runs the candidate with 5 sends. `SMS_EXPECT_BLOCKED` names the two known-blocked 390 px cases: they produce a warning, a screenshot and geometry. Any other block or failure fails the step. Timings are recorded, not gated.
- **Scope of the numbers:** fixture timings are a synthetic UI comparison. They are reported separately from the server timings in §2, and neither is a handset-delivery measurement.

## 9. Risks and limits

1. Exactly-once delivery is not claimed: a lost response leaves "Not confirmed", and correlation then depends on saved history plus the dispatcher's request-key protection.
2. The legacy path (no current traffic, G0-4) ignores request IDs; a manual resend there after an uncertain outcome could duplicate, as today.
3. `SMS_STATE` covers STOP/DNC blocks and post-attempt persistence failures, so such sends read "Not confirmed" (server code precision is a backend follow-up).
4. With Realtime unpublished, inbound replies still do not appear live in an open thread (unchanged).
5. State is per tab and memory-only; reload and sign-out end it (§5.1).
6. A second, different text to the same contact waits for the first to get a response (D1).

## 10. Backend follow-up (D8: recommended, not implemented)

**Recommended next step: B0, timing instrumentation in `supabase/functions/twilio-sms/index.ts` only.** It is the smallest step that turns G0-3's single complete trace into per-stage evidence. It changes no behavior and no shared code.

**Evidence.**
- G0-3: four successful sends had Edge execution times of 4,462–5,143 ms. Each of the three joined runs used 52–64 ms of CPU, so about 99% was waiting.
- The one complete trace shows 19 sequential Supabase calls with 3,542 ms of origin time. Two gaps in that log timeline are **inferred, not measured**: about 365 ms (attributed by reading the code to credentials plus two Twilio checks) and about 234 ms (the Twilio POST). Each gap assumes the logged timestamp is a request's start. B0 exists to replace these inferences with measurements.
- Duplicated reads, by reading the code: policy ×2, `phone_numbers` ×3, `a2p_registrations` ×2, `a2p_numbers` ×2, `profiles` ×2, and leads ×2 (the second is a deliberate final scope check).
- Speed changes (B1) would edit `_shared/sms/*` and `_shared/a2p/sending.ts`. Those files are also bundled into `workflow-executor`, the consent worker and `clearpath-lead-alert`, so B1 should wait for measured attribution rather than a single trace.

**Exact actions (one backend PR, separate approval).**
1. In `index.ts`, add a request-scoped timer. Create the three clients (`supabaseAuth`, the service client, the caller client) with `global: { fetch: timed("db") }`, and pass `timed("provider")` as `dispatch`'s existing third argument, `transport` (`_shared/sms/dispatch.ts:31`).
   - Record the REST/RPC path only: `/rest/v1/<table>`, `/rest/v1/rpc/<fn>`, `/auth/v1/user`. **Never record query strings**, because PostgREST filters carry phone numbers.
   - Record the status code and duration. The Twilio GETs in `registeredSender` use the global `fetch` and stay in the remainder unless `_shared` changes later.
2. Emit one structured log line per request: `request_id` (the client UUID), HTTP status and code, total ms, DB call count and ms, provider ms, remainder, and the five slowest paths. Never a phone number, body, token or credential.
3. Add `Server-Timing: total;dur=…, db;dur=…;desc="N calls", provider;dur=…` to the JSON responses (`jsonResponse`, plus the `SmsError` path). Optionally add `Timing-Allow-Origin` for the app origins so the browser's Resource Timing can show it.
4. Add a Deno unit test for path redaction and for aggregating the timing line, and add it to `.github/workflows/sms-consent.yml`.

**Release implications.**
- Only `twilio-sms` is redeployed, following invariant #4: capture the live v38 bundle (13 files, byte-identical to `dacd921` at G0-2), prove repository equality, deploy the complete bundle with `verify_jwt=false`, read it back. Rollback is the captured v38 bundle.
- `_shared` is unchanged, so no other function needs a redeploy. There is no schema or RLS change and no frontend change.
- The overhead is a few `performance.now()` calls, one log line and one header per request.
- **Sample size:** current volume is low (6 POSTs in six days at G0-3), so percentiles need weeks of organic traffic, unless Chris approves deliberate live test sends. Those are live SMS and need their own approval.

**After B0** (each separately approved): B1, the speed changes, chosen by measured stage; B2, a status lookup that lets "Not confirmed" resolve itself; B3, precise codes (`SMS_SUPPRESSED`, STOP/DNC separate from `SMS_STATE`, provider 5xx as `SEND_UNCERTAIN`); B5, publishing `messages` to Realtime (G0-1 shows it is absent). B4 (legacy-path duplicate protection) has no current traffic (G0-4) but remains a design decision.

## 11. Invariant #31 amendment (SMS part only)

Recorded in `AGENT_RULES.md` as a sub-bullet under "A send that did not happen must not be reported as one". Email keeps the boolean contract, and the View As bullet now names both handlers. Every other #31 authority, scope, draft and stale-request protection is unchanged.

## 12. Rollback

Revert the commits (or use Vercel instant rollback after a future approved release). No migration, Edge deploy or stored state exists to unwind.

## 13. Verification record (2026-10-14)

**Commits:**
- `488d4fc`: plan;
- `c367457`: implementation and tests;
- the records commit: fixture, CI, this section and the measurement summaries.

The publication-stage corrections and their commits follow in §14. Application source is identical from `c367457` to HEAD. The only later `src/` change is one added test file (`pendingSmsBridgeMount.test.ts`, §14).

§13.1 is the 2026-10-14 gate record. The SHA-tied comparison at the publication commit is in §14 and `evidence/regression.md`.

### 13.1 Gates

Base `dacd921` was reproduced first, not assumed.

| Gate | Base `dacd921` | Candidate |
|---|---|---|
| `npx tsc --noEmit` | exit 0. The root config checks no files, so this is vacuous. | exit 0 (same) |
| `npx tsc -p tsconfig.app.json --noEmit` | 85 diagnostics | **84**, compared as a multiset: none new. The one removed is the replaced contract-test mock (`conversationsSendContract.test.tsx`, TS2339 `bind` on `never`). |
| Vitest, full suite (`TZ=UTC`, dummy `VITE_SUPABASE_*`) | 5,301 tests: 5,266 passed, 1 failed, 34 skipped. The failure is `recordingRetentionVoicemail`, pre-existing. | 338 files, 5,465 tests: **5,430 passed, 1 failed (the same `recordingRetentionVoicemail` case), 34 skipped**. No new failure. Twelve base SMS cases were rewritten for the new contract and appear under new names. |
| CI's SMS suite list (no Supabase env) | — | 11 files, 255 tests, all passed |
| ESLint on every changed file (31) | 0 errors, 1 warning (`FullScreenContactView` exhaustive-deps) | 0 errors. The same warning, moved from line 305 to 328, plus an informational "ignored" notice for the `.mts` fixture config. |
| `npm run build` | passes (22.6 s) | passes (27.0 s, run alongside the test suite) |
| `git diff --check dacd921` | — | clean |
| Browser fixture (§8, corrected 2026-10-15) | 1440×900 measured; 390×844 BLOCKED | 1440×900 measured: each text shows exactly once, the composer clears, and the outgoing text is visible before the receipt. 390×844 BLOCKED on both builds (§13.3). |

**Mutation checks.**
- Removing the thread's stale-start guard fails the email post-send isolation test (restored afterwards).
- The new pending-SMS suites target modules and DOM states that do not exist at `dacd921`.

### 13.2 Measurements (synthetic fixture; corrected 2026-10-15)

**User-visible results only.**
- Method: §8. Results: `measurements/{base,candidate}-x{1,4}.json`. Screenshots: `measurements/screenshots/`.
- Times are ms, shown as p50 / p95 / max (nearest rank).
- The 2026-10-14 figures were rendering times and the 390 px rows used Enter. They are kept in `measurements/superseded-2026-10-14/` (see its README) and are **not** user-visible results.
- Base has no pending bubble. Its first visible change is the Send spinner; its outgoing text appears only after the round trip and a reload.

**Desktop 1440×900, CPU unthrottled, 50 real clicks per surface.**

| Surface | Metric | Base `dacd921` | Candidate |
|---|---|---|---|
| Conversations | click → first visible change | 14.0 / 17.0 / 18.1 (spinner, 50/50) | 18.1 / 27.0 / 27.3 (the text, 50/50) |
| | click → outgoing text **visible** | 2,479.8 / 2,496.1 / 2,512.3 | **18.1 / 27.1 / 27.4** |
| | click → outgoing text rendered (DOM, diagnostic) | 1,789.3 / 1,806.5 / 1,811.2 | 18.1 / 27.0 / 27.3 |
| | click → request start | 7.3 / 11.9 / 14.1 | 10.2 / 15.0 / 16.3 |
| | receipt → saved row visible | 972.9 / 988.6 / 1,001.5 | 103.4 / 105.7 / 106.9 |
| | click → saved row visible | 2,479.8 / 2,496.1 / 2,512.3 | 1,613.9 / 1,617.7 / 1,631.0 |
| | Event Timing click duration | 16 / 32 / 32 | 24 / 40 / 48 |
| Contact record | click → first visible change | 15.9 / 23.2 / 24.3 (spinner, 50/50) | 24.4 / 35.4 / 50.5 (the text, 50/50) |
| | click → outgoing text **visible** | 2,282.7 / 2,290.4 / 2,300.3 | **24.4 / 35.4 / 50.5** |
| | click → outgoing text rendered (DOM, diagnostic) | 2,282.7 / 2,290.3 / 2,300.3 | 24.4 / 35.4 / 50.5 |
| | click → request start | 11.2 / 17.6 / 18.3 | 13.0 / 18.5 / 27.0 |
| | receipt → saved row visible | 771.0 / 778.2 / 782.5 | 102.4 / 110.8 / 111.4 |
| | click → saved row visible | 2,282.7 / 2,290.4 / 2,300.4 | 1,615.9 / 1,626.4 / 1,634.7 |
| | Event Timing click duration | 16 / 24 / 32 | 32 / 48 / 56 |

The fake transport's round trip is 1,500.3 ms p50 on every run.

**Desktop 1440×900, 4× CPU throttle, 20 real clicks per surface** (separate run, never pooled with the above).

| Surface | Metric | Base `dacd921` | Candidate |
|---|---|---|---|
| Conversations | click → first visible change | 57.3 / 85.9 / 88.7 (spinner) | 85.6 / 143.2 / 178.8 (the text) |
| | click → outgoing text **visible** | 2,642.9 / 2,738.1 / 2,738.2 | **85.6 / 143.2 / 178.8** |
| | click → request start | 37.8 / 58.7 / 64.9 | 47.1 / 91.7 / 138.4 |
| | receipt → saved row visible | 1,106.8 / 1,202.7 / 1,206.6 | 159.9 / 175.3 / 177.1 |
| | click → saved row visible | 2,642.9 / 2,738.2 / 2,738.2 | 1,704.3 / 1,767.1 / 1,803.5 |
| | Event Timing click duration | 64 / 96 / 104 | 96 / 152 / 192 |
| Contact record | click → first visible change | 83.4 / 119.6 / 129.7 (spinner) | 132.8 / 181.2 / 217.8 (the text) |
| | click → outgoing text **visible** | 2,406.7 / 2,436.9 / 2,459.7 | **132.8 / 182.1 / 218.6** |
| | click → request start | 55.7 / 88.9 / 89.7 | 70.7 / 92.8 / 97.9 |
| | receipt → saved row visible | 846.6 / 861.0 / 901.3 | 184.7 / 284.3 / 296.6 |
| | click → saved row visible | 2,406.7 / 2,437.0 / 2,459.7 | 1,761.4 / 1,869.6 / 1,877.9 |
| | Event Timing click duration | 88 / 120 / 120 | 136 / 184 / 216 |

**Mobile 390×844: BLOCKED on both builds, at 1× and 4×.** Both are pre-existing desktop-only layouts; §13.3 has the details and screenshots. No mobile timing is claimed.

**Against the ≤100 ms p95 goal** (click → pending text visible):
- **Met on desktop at 1×.** p95 is 27.1 ms (Conversations) and 35.4 ms (contact record); the maximum is 50.5 ms.
- **Not met at 4×:** p95 is 143.2 ms and 182.1 ms.
- **Not assessable on mobile** (blocked).

**Costs, stated plainly:**
- **First visible change.** Base's spinner-only change is faster than the candidate's first change: 14.0 vs 18.1 ms p50 at 1×, and 57 vs 86 ms at 4×. The candidate's first paint carries the pending item. That item re-renders the unmemoized history list, which the contact record renders inside a 1,461-line component.
- **Click handling.** The Event Timing click duration rises for the same reason: p95 32 → 40 ms and 24 → 48 ms at 1×.
- **Follow-up, not done.** Memoizing history items is possible but was not in scope.

**What changes for the agent:**
- The outgoing text is visible about 2.3–2.5 s sooner (1×).
- The saved row appears about 0.7–0.9 s sooner after the receipt, because there is no whole-thread reload.
- The composer is usable at once.

### 13.3 Browser observations

- **390×844, Conversations: BLOCKED** (both builds; the same layout as `main`).
  - Playwright's actionability preflight fails: the 300 px contact pane (`div.w-[300px] … overflow-y-auto`) intercepts pointer events at Send.
  - The thread pane collapses to 48 px at x = −125 (−82 under throttling).
  - Screenshots: `screenshots/{base,candidate}-conversations-390-blocked.png`.
- **390×844, contact record: BLOCKED** (both builds; the same layout as `main`).
  - The three columns sit inside overflow-hidden containers. The message column is at x = −312 (357 px wide), and Send is at x = −57, so only a 29 px sliver is on screen.
  - A real click on that sliver sends. The sent text renders (227×46 px, CSS-visible), but 0% of it is inside the viewport and its clipping ancestors. It never becomes visible within 3 s.
  - Screenshots: `screenshots/{base,candidate}-contact-390-blocked.png`. Base also shows its "Message sent" toast.
  - Neither layout causes document-level horizontal overflow.
- **1440×900:**
  - The candidate shows the dimmed pending bubble with "Sending…", an empty composer and the Send spinner during the 1.5 s request (`candidate-*-1440-in-flight.png`).
  - Base shows only the spinner, with the text still in the composer (`base-*-1440-in-flight.png`).
  - After 50 sends each text is shown once on both builds (`*-1440-after.png`).
- **Base's success toast** covers its own Send spinner in Conversations at 1440 px for about 4 s. The driver therefore starts every send with no toast on screen (§8). The candidate shows no SMS success toast (D4).

### 13.4 Unresolved limits

All are documented in §9. In addition:
- STOP/DNC blocks read "Not confirmed" (`SMS_STATE`) until the server codes them separately (B3).
- A lost response leaves "Not confirmed" beside any saved row until dismissed (B2 would resolve it).
- Server time is unchanged: Edge execution was 4,462–5,143 ms over 4 successful sends (G0-3). The production client round trip and carrier delivery are not measured. Only the waiting in the composer is hidden.
- Mobile (390×844) feedback is unvalidated: both layouts are desktop-only and BLOCKED the fixture (§13.3). A mobile layout is separate work.
- Under 4× CPU throttling, the p95 to visible is 143–182 ms, above the 100 ms goal (§13.2).

### 13.5 Release gates

1. Chris reviews the branch. Publication as a **draft PR**, isolated CI and the protected Vercel preview were approved on 2026-10-15 (§14).
2. CI green on the exact published head, including `sms-consent` (new suites, bridge-mount guard and fixture) and `reports-frontend` (full-suite base comparison).
3. Preview: build and served-asset check only. The preview is wired to production services, so **any send from it is a live SMS** and needs its own approval. Sends are exercised only in the fake-transport fixture.
4. Merge and the Vercel production deploy (frontend only), separately approved. Then read back the served bundle.
5. Backend B0 (§10) and the separate security item (private remediation plan) are separate approvals.

## 14. Publication stage (2026-10-15)

**Approval.** Chris approved limited verification corrections, publication as a **draft** PR, isolated CI and frontend preview verification.
- **Not production release approval.**
- **Not approved:**
  - merge, auto-merge or promotion;
  - a push to `main` or a force-push of shared history;
  - a production deploy, production migration or Edge deploy, or a production setting change;
  - live SMS (including from the preview);
  - secret rotation, credential probing, cron changes, historical redaction or history rewriting.
- **Application changes and backend mutation commands** need his separate approval.

**Preserved work.**
- **Base:** `main` `dacd921903a867de99276f8709f829995602c3bd`. Remote `main` was re-fetched (unchanged) before the corrections and again before publication.
- **No restart:** the implementation (`c367457`) was not restarted or rewritten, and no other branch was merged.
- **Concurrent work:** no open PR changed since the build. Draft PR #429 (START, out of scope) shares three files with this branch: `.github/workflows/sms-consent.yml`, `AGENT_RULES.md` and `WORK_LOG.md`. Whichever merges second must reconcile them. #429 was not touched.
- **One local rebuild before first publication.** The never-published local branch was rebuilt once, so that the separate security item's remediation plan stays private and out of this public repository. The original local commits remain on a local backup ref; nothing shared was rewritten.

**Corrections (files).**

| File | Correction |
|---|---|
| `scripts/tests/sms-responsiveness/main.tsx` | A visibility probe: size, CSS visibility, at least 50% inside the viewport and clipping ancestors, and not covered (elementFromPoint plus toast rectangles; falling through a `pointer-events: none` target to its ancestor is not covering). Rendered and visible marks are kept separate; the first change is attributed to the text or the spinner; a click mark is taken only from a real click on Send. |
| `scripts/tests/sms-responsiveness/measure.mjs` | Real clicks only, after a trial-click actionability preflight. Each send starts with no toast on screen. BLOCKED / FAILED / MEASURED per surface and viewport, with reasons, geometry and screenshots. `SMS_EXPECT_BLOCKED`, GitHub annotations and a step summary; exit 1 on any unexpected block or failure. |
| `.github/workflows/sms-consent.yml` | `src/App.tsx` in the path filter; `pendingSmsBridgeMount.test.ts` in the SMS Vitest step; an explicit `SMS_EXPECT_BLOCKED`. |
| `src/components/messaging/__tests__/pendingSmsBridgeMount.test.ts` | New source audit: the bridge is mounted once, inside `AuthProvider` and outside the router. Mutation-checked: removing the mount fails 2 of its 3 tests. |
| This plan | §1 goal wording; §2 G0-3 and §3 with exact values and metric definitions; §6 file list (the `smsConsent` claim corrected); §8 method; §10 inferred attributions labelled; §13 rewritten; this section |
| `WORK_LOG.md` | 2026-10-14 entry: claims corrected; new 2026-10-15 entry |
| `evidence/test-mapping.md`, `evidence/server-latency.md`, `evidence/regression.md`, `evidence/vitest-files-*.json` | New auditable evidence |
| `measurements/*.json`, `measurements/screenshots/*`, `measurements/superseded-2026-10-14/*` | Corrected results, screenshots, and the superseded rendering-only results (moved and labelled) |

**Measurements.** See §13.2–13.3:
- **Desktop at 1×:** p95 to visible is 27.1 ms (Conversations) and 35.4 ms (contact record).
- **Desktop at 4×:** p95 is 143.2 ms and 182.1 ms, above the 100 ms goal.
- **Mobile at 390×844:** BLOCKED on both builds by the pre-existing desktop-only layouts. No mobile timing is claimed.

**Server-timing claim.** Kept, with its exact basis (`evidence/server-latency.md`):
- Edge `execution_time_ms` of 4,462–5,143 ms, over the 4 successful `twilio-sms` POSTs in `function_edge_logs` from 2026-10-08T15:15Z to 2026-10-14T18:51Z;
- the client round trip and carrier delivery are not measured.

**Regression evidence.** See `evidence/regression.md`. Local run of the repository's own `reports-frontend` verification (`scripts/verify_reports_frontend.py`), base `dacd921903a867de99276f8709f829995602c3bd` against candidate `3582ea109caadcd752e61b7daea8d2e85492e80f`. Code is identical from `14fd40f` onward. **Exit 0.**
- **`tsc --noEmit`:** exit 0 on both. The root config checks no files.
- **`tsc -p tsconfig.app.json`:** 85 → 84 diagnostics. None is new; the one removed is the replaced contract-test mock. This is a baseline-equivalent result, **not a clean pass**: 84 pre-existing diagnostics remain.
- **Vitest without Supabase env (as CI):**
  - base 5,183 passed, candidate 5,350 passed;
  - **1 failing test on each side, the same pre-existing `recordingRetentionVoicemail` case**;
  - the same 10 files fail to load on each side (`supabaseUrl is required.`);
  - 34 skipped on each side, with an identical inventory;
  - 0 unhandled runtime errors.
- **ESLint on the changed TypeScript files:** 0 errors; 1 pre-existing warning.
- **Build and Reports tests:** both pass.

The dummy-env run and its comparison are in `evidence/regression.md`.

**Publication preflight.** In progress at this commit; the result is recorded before the push.

**Publication.** Recorded after the push, with the exact published head and its CI, in the follow-up records commit.
