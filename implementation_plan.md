# Implementation Plan — FullScreenContactView Conversation History: Filter Fix + Visual Redesign + Inline Endpoint Details

**Task branch:** `claude/conversation-history-redesign-jsqk6h`
**Date:** 2026-08-17
**Status:** PLAN — awaiting Chris's explicit approval. No source file has been modified; this file is the only change. This plan **supersedes** the policy-dates plan previously in `implementation_plan.md` — WORK_LOG.md (2026-08-12 entries) is authoritative that the policy-dates task is fully SHIPPED (PR #357 → `main` `b47e39e`, production migration `20260812042319` live, Vercel READY), so that plan is complete history and is replaced here per house convention.

---

## 1. Branch / working-tree / origin state (verified)

- Branch: `claude/conversation-history-redesign-jsqk6h`, working tree **clean**, HEAD `018739e` == `origin/main` `018739e0f59b3680c5459b89d833d558a06aaabb` (fetched fresh). No uncommitted work exists to protect. Nothing will be pushed to `main`.
- Baselines captured on this clean tree after `npm install`: root `npx tsc --noEmit` exit **0**; app-project `npx tsc -p tsconfig.app.json --noEmit` = **73 errors** (identical to the main baseline recorded in WORK_LOG 2026-08-12); existing FSCV regression suites green (`fullScreenContactViewQuickCall` + `fullScreenContactViewScore`: 9/9 passed).

## 2. Required reading — confirmed

`AGENT_RULES.md` (all 332 lines, invariants 1–29 + schema gotchas + component standards), `VISION.md` (all 122 lines), and `WORK_LOG.md` (all 8,800 lines — current-task-relevant entries read directly plus an exhaustive full-file pass; 76 FullScreenContactView mentions across 35 entries mined) were read completely before this plan. Key history honored below: the 2026-05-01 eight-entry cluster that built this center column (dialer parity, iMessage bubbles, `HistorySkeleton`, `flex-col-reverse`), the 2026-04-20 call Info modal that originally justified the over-broad calls select (removed 2026-05-01 for dialer parity), the 2026-08-11 contact-name/quick-call protections, the 2026-06-20 rules-of-hooks + no-fabricated-activities fixes, and the 2026-08-06 lead-score/`handleSave` whole-`editForm` round-trip invariant.

**Deliberate, scoped divergence:** the 2026-05-01 rule "center column = dialer ConversationHistory visual parity" is superseded **for this surface only** by Chris's redesign brief (distinct SMS/call/email treatments + inline details). `src/components/dialer/ConversationHistory.tsx` itself is untouched, and the shared `MessageComposePanel` is untouched, so the Dialer keeps its current look. This divergence will be recorded in the WORK_LOG entry.

## 3. Confirmed filter root cause (static, decisive)

`src/components/contacts/FullScreenContactView.tsx:573-576`:

```ts
const filteredConvos = useMemo(
  () => (convoFilter === "All" ? convoItems : convoItems.filter((i) => i._type === convoFilter.toLowerCase())),
  [convoItems, convoFilter],
);
```

Filter state is the **display label** (`"All" | "Calls" | "SMS" | "Email"`, line 246) while timeline rows carry `_type: "call" | "sms" | "email"` (lines 534/541/549). `"Calls".toLowerCase()` → `"calls"` ≠ `"call"` → **the Calls filter always yields an empty list** and renders "No activity yet" even when calls exist. `"SMS"`/`"Email"` lowercase to exact matches, so those two filters are logically sound in the comparison itself.

## 4. Additional proven/probable filter issues (each will be pinned by a fail-first test before being claimed as fixed)

1. **SMS timestamp NaN risk breaks chronological order.** `_ts` for SMS is `new Date(m.sent_at).getTime()` with **no fallback** (line 542); `messages.sent_at` is nullable. A null `sent_at` yields `NaN`, which poisons the `sort((a,b) => a._ts - b._ts)` comparator (NaN comparisons make the sort order unspecified) and renders "Invalid Date". Fix: `sent_at || created_at` fallback in the typed builder (calls and emails already have fallback chains). Will be reproduced with a null-`sent_at` fixture test.
2. **A failed conversation fetch leaves the skeleton forever.** The three-source `Promise.all` (line 511) has no catch; `getContactEmails` **throws** on error, so one failed source rejects `loadData` and `convoLoading` never clears — which presents to the user exactly as "the timeline/filters are broken". Minimal hardening (not an error-state architecture): wrap the conversation fetch in one try/catch → on failure log via `console.error`, set items `[]`, clear loading, render a one-line non-blocking "Couldn't load conversation history" note instead of a channel empty state.
3. **One generic empty state for every filter** ("No activity yet", line 1166) — replaced with per-channel empty states (required behavior #6).

No other root cause is claimed. The component test will exercise SMS and Email filters against mixed fixtures to reproduce or refute the rest of Chris's report before implementation conclusions are drawn.

**Canonical filter model (replaces label-string comparison):**

```ts
export type ConversationFilter = "all" | "call" | "sms" | "email";
export const CONVERSATION_FILTERS: ReadonlyArray<{ id: ConversationFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "call", label: "Calls" },
  { id: "sms", label: "SMS" },
  { id: "email", label: "Email" },
];
```

State becomes `useState<ConversationFilter>("all")`; filtering compares `item.kind === filter` — no display-string manipulation anywhere. `convoItems: any[]` is replaced by a **conversation-only discriminated union** (`kind: "call" | "sms" | "email"`, below). No other FullScreenContactView state is refactored.

## 5. Exact visual treatment

Only SMS keeps iPhone-style chat bubbles. Calls and emails become **full-width neutral cards** in the same scroll flow (this is the deliberate distinction: alignment + bubble = message; card = event/document). Existing icon color language is preserved (emerald = calls, blue = SMS, violet = email). All colors via existing Tailwind tokens (`bg-card`, `border-border`, `text-muted-foreground`, `bg-muted`…) except the one documented intentional literal, iMessage `#007AFF`, which stays outbound-SMS-only. Timeline keys become **source-qualified** (`call:<id>` / `sms:<id>` / `email:<id>`) per the house key-collision convention from the dashboard-callbacks defect. Motion follows house discipline: `transition-colors`/`transition-transform` on interaction only, the existing brief expand animation pattern, zero animations at idle, no `transition-all` in new code.

**SMS (`SmsHistoryItem`)** — bubbles per spec, plus Details:
- Outbound: right-aligned, `bg-[#007AFF] text-white rounded-2xl rounded-tr-sm`, `max-w-[85%]`, compact timestamp beneath.
- Inbound: left-aligned, **token-based neutral surface `bg-muted border border-border text-foreground rounded-2xl rounded-tl-sm`** — replacing the current hardcoded `bg-[#E9E9EB] dark:bg-[#262629]`, which WORK_LOG 2026-05-01 already once fixed as a token regression ("inbound bubbles must use `bg-card border border-border`, not the legacy hex"); tokens are inherently dark-mode-correct. `bg-muted` (not `bg-card`) is proposed so the bubble reads as a gray chat surface against the `bg-card` vessel.
- Beneath the bubble, in the existing timestamp row: a small `Details` control (secondary, `text-[10px] text-muted-foreground`). Details stay visually secondary to the message.

**Calls (`CallHistoryItem`)** — neutral event card, never blue:
- `bg-card border border-border rounded-lg shadow-sm px-3.5 py-2.5`, full width, `min-w-0`.
- Leading circular icon chip `bg-emerald-500/10`: `PhoneIncoming` (inbound) / `PhoneOutgoing` (outbound) `text-emerald-600 dark:text-emerald-400`.
- Row 1: **Inbound Call / Outbound Call** (`text-sm font-semibold`), disposition badge when present (existing pill style, neutral `bg-muted text-foreground/70`), else telephony `status` as muted text; duration `m:ss` muted.
- Row 2 (muted, compact): timestamp (`formatDateTime`), existing recording toggle (`Play` button → inline `RecordingPlayer callId compact`, behavior/URLs/auth untouched), `Details` control.
- Direction is shown by icon + label, **not** by left/right alignment.

**Email (`EmailHistoryItem`)** — compact email card, never a bubble:
- Same neutral card shell as calls; leading `Mail` icon chip `bg-violet-500/10 text-violet-500`.
- Header line: `Email · Inbound` / `Email · Outbound` (`text-[10px] uppercase tracking-wide text-muted-foreground`).
- Subject (`text-sm font-medium line-clamp-2 break-words`; "(No subject)" fallback preserved).
- From/To summary line: `From a@x.com · To b@y.com` (`text-xs text-muted-foreground truncate`).
- Footer row: timestamp, expand/collapse body chevron (aria-expanded — preserves today's behavior incl. `>`-quoted-line dimming and `max-h` scroll), `Details` control.

**Theme/responsiveness:** dark mode via tokens (cards inherit `bg-card`/`border-border`); `min-w-0` + `break-words`/`break-all` on subjects/addresses/numbers; long SMS keeps `whitespace-pre-wrap break-words`; cards and expanded panels stay inside the scroll container (no horizontal overflow); verified at narrow center-column and mobile widths (matrix in §10).

## 6. Lightweight inline details — exact interaction and fields

One shared `CommunicationDetails` component used by all three item types:
- A small `Details` **button** (native `<button>`, keyboard accessible) with `aria-expanded`, `aria-controls`, and an accessible label naming the channel (e.g. "Call details"); chevron rotates.
- Expands **inline beneath the item** (no modal): `bg-muted/40 border border-border rounded-lg px-3 py-2` containing a compact `<dl>` label/value grid (`text-[10px] uppercase` labels, `text-xs` values, `break-all` on endpoints).
- Missing values render **"—"**. Never rendered: UUIDs, `twilio_call_sid`, `provider_message_id`, provider error/debug fields, recording URLs/storage paths. Phones via `formatPhoneNumber`; timestamps via branding `formatDateTime`.

| Channel | Rows (in order) | Source columns (all existing) |
|---|---|---|
| SMS | From · To · Direction · Sent · Status | `messages.from_number`, **`to_number`** (select expansion), `direction`, `sent_at` (fallback **`created_at`**, select expansion), **`status`** (select expansion) |
| Call | Contact number · AgentFlow number · Direction · Started · Ended (when present) · Duration · Status · Disposition (when present) | `calls.contact_phone`, `caller_id_used`, `direction`, `started_at`, `ended_at`, `duration`, `status`, `disposition_name` — **already all in the existing select; zero expansion needed for calls** (see R4 for the recommended trim) |
| Email | From · To · CC (only when present) · BCC (only when present) · Direction · Sent/Received · Delivery status | `contact_emails.from_email`, `to_emails`, **`cc_emails`**, **`bcc_emails`** (select expansion in `getContactEmails`), `direction`, `sent_at`/`received_at`, `delivery_status` |

Existing semantics honored as-is: `contact_phone` = customer endpoint, `caller_id_used` = AgentFlow number / inbound DID (AGENT_RULES §5 phone gotchas; values never rewritten). No per-item queries — everything comes from the rows already fetched. No agent/campaign lookups, no email-account resolution system.

## 7. Optimistic email subject fix (+ optimistic SMS endpoints)

`FullScreenContactView.handleSendMessage` only:
- **Email** (line 743 today omits the subject): the optimistic item is built from the values actually sent — `subject = emailSubject.trim() || "Message from " + AGENT_NAME` (captured into a const before state clears, same expression passed to `sendContactEmail`), body, `direction: "outbound"`, From = `selectedConnection?.provider_account_email` (already known — same value passed as `from_email`), To = `contact.email`, sent timestamp = now, delivery status `"sent"` — truthful because `email-send-contact-message` returns `success: true` **only** when the provider send succeeded and it recorded `delivery_status: "sent"` (verified read-only in the function body; the failure path returns HTTP 502/`success:false` and the optimistic item is never created).
- **SMS** (Details support only): the optimistic item adds From = the E.164 `from` actually sent, To = E.164 of `contact.phone`, and status = **the real `status` echoed back by `twilio-sms`** (`result.status`, Twilio's own value, default "queued"); the real `result.message_id` is used as the item id when present. No reconciliation system, no messaging state architecture — items are still replaced wholesale on the next contact load exactly as today.

No change to `sendContactEmail`, `MessageComposePanel`, templates, Gmail OAuth, or any composer surface.

## 8. Component extraction (minimal, FullScreenContactView-specific)

New focused folder `src/components/contacts/conversation-history/` — each component **< 200 lines**, Tailwind only, no new dependencies:

| File | Responsibility |
|---|---|
| `conversationTypes.ts` | `ConversationFilter` + `CONVERSATION_FILTERS`; discriminated union `ConversationItem = CallConversationItem \| SmsConversationItem \| EmailConversationItem` (each with `kind`, `id`, `timestampMs`, `outbound` + channel fields incl. endpoints); row→item builders (`buildCallItem`/`buildSmsItem`/`buildEmailItem` — direction via existing `isCallsRowInboundDirection`, timestamp fallback chains, defensive `to_emails`/`cc_emails`/`bcc_emails` Json→string[] parsing); optimistic builders; `filterConversationItems`; local `formatCallDuration` (m:ss, logic identical to today's inline math) |
| `ConversationTimeline.tsx` | The whole center card: header (title + filter pill bar driven by `CONVERSATION_FILTERS`), `flex-col-reverse` scroll container (scroll-to-bottom effect moves here), `HistorySkeleton` loading state, per-channel empty states, load-error note, item dispatch by `kind` |
| `SmsHistoryItem.tsx` | SMS bubble + timestamp + Details |
| `CallHistoryItem.tsx` | Neutral call card + recording toggle (`RecordingPlayer callId compact`, moved verbatim) + Details |
| `EmailHistoryItem.tsx` | Email card + body expand/collapse (today's behavior preserved) + Details |
| `CommunicationDetails.tsx` | Shared accessible Details button + inline `<dl>` panel |

Wiring in `FullScreenContactView`: data fetching, `convoItems` (now `ConversationItem[]`), `convoFilter` (now canonical), send/optimistic logic, and the contact-switch reset (`useLayoutEffect` clear + `latestContactIdRef`/`isCurrent()` guards) **stay in the parent unchanged**; the ~270-line inline timeline JSX is replaced by `<ConversationTimeline key={contact.id} …/>` (the `key` resets per-item expansion state on contact switch; filter selection continues to live in the parent and persists across contacts, matching today). Item components hold their own expand state (no id-keyed maps); date formatting via the existing `useBranding` hook (house idiom; tests already mock `BrandingContext`). The filter pill bar keeps its **current segmented chrome verbatim** (`bg-muted` track / `bg-card` active pill) so it stays visually paired with the shared `MessageComposePanel` switcher. **Rules-of-hooks constraint honored:** the `if (!contact) return null` early return stays below every remaining hook when the two timeline `useMemo`s are removed (the 2026-06-20 fix is not reintroduced). Net effect: FullScreenContactView **shrinks ~230+ lines**. Not built: generic frameworks, app-wide timeline, Dialer ConversationHistory replacement, data-fetch architecture.

Preserved untouched: quick-call dispatch + activity logging (unconditional-and-first per the 2026-08-11 ruling), contact edit/save + whole-`editForm` round-trip (2026-08-06 invariant) + required-field enforcement, contact-name protections (`contactDisplayName`), policy-date fields/cases (incl. legacy `issueDate`), `MessageComposePanel` props/behavior (shared with the Dialer), recording playback architecture, contact-switch cancellation guards, chronological ascending order + `flex-col-reverse` presentation. The known open appointment-save double-write in this file (WORK_LOG 2026-08-06 discovery) remains deliberately untouched — separate follow-up, not this task.

## 9. Exact files to be touched (complete list — nothing else)

1. `src/components/contacts/conversation-history/conversationTypes.ts` — NEW
2. `src/components/contacts/conversation-history/ConversationTimeline.tsx` — NEW
3. `src/components/contacts/conversation-history/SmsHistoryItem.tsx` — NEW
4. `src/components/contacts/conversation-history/CallHistoryItem.tsx` — NEW
5. `src/components/contacts/conversation-history/EmailHistoryItem.tsx` — NEW
6. `src/components/contacts/conversation-history/CommunicationDetails.tsx` — NEW
7. `src/components/contacts/FullScreenContactView.tsx` — MODIFIED: canonical filter state; typed `convoItems`; `messages` select expanded by exactly `to_number, status, created_at`; builder-based mapping; conversation-fetch try/catch; optimistic email/SMS fixes (§7); inline timeline JSX → `<ConversationTimeline/>`; removal of now-dead inline helpers (`contactTimelineBubbleIcon`, `expandedEmails`/`expandedRecordings` state, `filteredConvos`/`reversedFilteredConvos` memos, related imports)
8. `src/lib/supabase-email.ts` — MODIFIED: `getContactEmails` select expanded by exactly `cc_emails, bcc_emails` (existing columns, verified in generated types)
9. `src/components/contacts/conversation-history/__tests__/conversationTypes.test.ts` — NEW (unit)
10. `src/components/contacts/__tests__/fullScreenContactViewConversation.test.tsx` — NEW (component; harness cloned from the established `fullScreenContactViewQuickCall` mock pattern)
11. `implementation_plan.md` — this plan (already replaced)
12. `WORK_LOG.md` — newest-first entry after approved implementation + verification

No other file. Explicitly untouched: `src/contexts/TwilioContext.tsx`, `src/pages/DialerPage.tsx`, `src/components/dialer/ConversationHistory.tsx`, `supabase/functions/**` (twilio-sms and email-send-contact-message were **read** for §7 truthfulness, never modified), `supabase/migrations/**`, RLS/schema, deployment/config files, `MessageComposePanel.tsx`, `RecordingPlayer.tsx`, generated `types.ts`.

## 10. Focused test plan

**Fail-first component suite** (`fullScreenContactViewConversation.test.tsx`), fixtures = mixed calls/messages/emails via the existing `tableData` supabase mock + mocked `getContactEmails`:
1. Calls filter shows the call fixtures — **proven failing against unmodified code** (reproduces Chris's report), passing after.
2. All shows every kind; SMS-only; Email-only (reproduces or refutes any SMS/Email breakage before claiming root causes).
3. Chronological order identical across filter switches; null-`sent_at` SMS ordered by `created_at` (fail-first for §4.1).
4. Per-channel empty states; fetch-failure note (§4.2) instead of eternal skeleton.
5. Contact switch (rerender with a new contact id) leaves zero previous-contact items visible.
6. Details per channel: SMS From/To/status; call `contact_phone` + `caller_id_used` (formatted); email From/To + CC/BCC only-when-present; `aria-expanded` toggling; missing metadata renders "—"; no UUID/provider-id text in the DOM.
7. Optimistic email: compose with a real subject → timeline immediately shows that subject (fail-first: today renders "(No subject)") with known From/To in Details.
8. Recording control renders for a call with `recording_url` (RecordingPlayer mocked) and not for `__recording_pending__`.

**Unit suite** (`conversationTypes.test.ts`): builder mapping incl. direction normalization, timestamp fallbacks, Json email-array parsing, filter function on the canonical union.

**Regression:** existing `fullScreenContactViewQuickCall` + `fullScreenContactViewScore` (9 tests, re-verified green pre-change) and the full Vitest run must stay green (full-suite baseline captured fresh before the diff; last recorded main baseline 1263 passed / 12 skipped / 94 files).

**House test conventions followed:** fail-first runs against unmodified source are executed FIRST and reported with exact failure counts/text; tests import production helpers (never re-declare them); assertions unconditional; source-qualified keys asserted; the jsdom/global Vitest setup and the established FSCV mock harness are reused.

## 11. Verification (after approval)

`npx tsc --noEmit` (exit 0; reported-not-credited — root tsconfig compiles nothing) · `npx tsc -p tsconfig.app.json --noEmit` — the meaningful gate: error **multiset line-insensitively identical** to the clean-main **73** baseline captured in §1, zero new errors · focused new Vitest suites (fail-first proven) · existing FSCV suites · full `npx vitest run` under both `TZ=UTC` and `TZ=America/Los_Angeles` (house convention; totals reported with timezone stated; throwaway placeholder `VITE_SUPABASE_*` env vars for the ~9 suites that need them — nothing added to the repo) · `npx eslint` on all touched TS/TSX — new files 0 errors/0 warnings; for the documented-oversized `FullScreenContactView.tsx` the standard is **problem multiset identical-or-reduced vs `origin/main`** (main baseline: 22 problems across it + DialerPage) · `npm run build` · `git diff --check` · diff scan for `service_role`/secrets/Telnyx/`.single()`/mock-data/unauthorized paths. Visual inspection without production credentials: local Vite + a **scratchpad-only** fixture harness (never committed to production paths) screenshot via the pre-installed Playwright/Chromium across the required matrix — all four filters, three-channel visual distinction, light + dark, narrow center column + mobile width, long bodies/subjects/addresses, expanded details, expanded recording UI, email body expansion. No deploy of any kind.

## 12. Explicit scope confirmation

**No** backend, Edge Function, migration, schema, RLS, RPC, Realtime, inbound-linkage, TwilioContext, contact-dedup, phone-normalization, pagination, composer, OAuth, telemetry-interface, recording-architecture, or deployment work is included. `organization_id` scoping and existing RLS are untouched (all queries remain the existing client-side selects). No new dependencies; Tailwind only; no mock data in production paths (test fixtures + scratchpad harness only); `.maybeSingle()` conventions unaffected (no new singular lookups). **No blocker was found requiring an excluded backend change** — every required Details field exists in already-readable columns (verified against generated types and the live selects).

## 13. Risks / decisions for Chris's ruling

- **R1 — Layout shift for calls/emails:** they become full-width neutral cards (no longer left/right-aligned pseudo-bubbles). This is the plan's reading of "must not look like SMS"; flagging since it visibly changes the timeline's shape. Alternative: keep direction alignment with card styling (recommend full-width).
- **R2 — Optimistic status values** (§7): SMS shows Twilio's echoed status; email shows "sent". Alternative: omit status on optimistic items and render "—" until reload.
- **R3 — Filter persistence:** filter selection persists across contact switches (today's behavior, kept). Say the word if it should reset to All per contact.
- **R4 — Trim the conversation calls select (RECOMMENDED: yes).** WORK_LOG history explains the over-broad select: the 2026-04-20 call **Info modal** "selects the extra columns needed for that modal", and the modal was removed on 2026-05-01 — the columns stayed behind with no consumer. This build owns exactly this query, and inline Details reinstate only part of that need, so the recommendation is to trim the select to the columns this timeline actually renders: `id, direction, duration, disposition_name, recording_url, started_at, created_at, ended_at, caller_id_used, contact_phone, status`. Never-rendered telemetry (`mos`, `sip_response_code`, `shaken_stir`, `provider_*`, `amd_result`, `hangup_details`, `quality_percentage`, `pdd_seconds`, `twilio_call_sid`, `agent_id`, `contact_name`, `outcome`, `is_missed`, `notes`, `recording_duration`, `campaign_id`, `flagged_for_coaching`) stops being fetched per contact open. Alternative: leave the select byte-untouched (zero risk, keeps dead transfer).
- **R5 — Load-error note** (§4.2) is a one-line hardening inside the timeline, not an error-state architecture; included because a rejected fetch currently presents as "filters broken". Can be dropped if preferred.

---

## STOP — awaiting Chris's explicit approval

No source file will be modified, nothing pushed beyond this plan, no deploy/merge, until the plan (and rulings R1–R5) are approved.
