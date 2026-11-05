# AgentFlow P0 Dialer Reliability — implementation_plan.md

Date: November 4, 2026 (America/Los_Angeles)
Status: Chris approved isolated implementation, synthetic tests, read-only diagnosis, and then branch/PR publication, CI and possible previews on November 4, 2026. Draft PR #515 is published. Production database changes, merge and frontend release remain separately gated.
Implementation update (November 5 UTC): published source `2fc8dce8bbf2293d454c219d810e72fb184c6337` exactly matches the reviewed local tree. Native PostgreSQL 16.15 CI passed the actual migrations, concurrency in both admission/failure orders, DNC/claim races, exact rollback, reporting readers and recovery pin; 606 dialer tests passed again in CI. Final verification and release manifest supersede the original pre-build verification section below. Additional verification/package files: `scripts/tests/dialer-reliability/{engine,concurrency}.mjs`, the existing `.github/workflows/dialer-dnc-backend.yml` (disposable tests only), and this plan's `live-function-metadata.json`, `rollback.sql`, `manifest.json`, `verification.md`, and `publication.json`. Captured live readers preserve their exact authorization metadata; both candidate migrations and rollback refuse source/ACL drift. Production execution is not authorized by publication.
Incident: Skip transitions incorrectly or rapidly; some Call clicks do not initiate dialing.
Campaign supplied by Chris: Will Harrison — "Goat leads aged 11/3".

## 1. Verified baseline and limits

- Repository: cgarness/agentflow-life-insure.
- GitHub main: `2b6f5cefe4f4d7980ab670067a5634e320cd20fd`.
- Vercel production at www.fflagent.com: READY, deployment `dpl_6Ue8L6EDqwhqfThT4UJeUA9wuDZc`, production branch main at the same SHA.
- Supabase project metadata: AGENTFLOW CRM, `jncvvsvckxhqgqvkppmj`, ACTIVE_HEALTHY. This is a project health status, not a diagnosis of individual clicks.
- Live read-only source inspection: twilio-voice-webhook v61, ACTIVE, verify_jwt=false. It validates provider requests and calls admit_twilio_outbound before issuing outbound TwiML.
- Read authoritative AGENT_RULES.md (relevant telephony, queue, disposition, tenancy and workflow sections), VISION.md, latest main WORK_LOG.md entries, existing root plan, all seven requested application files, and related session, lock, disposition, caller-ID, Voice.js and test code.
- Initial review was read-only. After approval, local implementation and disposable synthetic tests were completed; read-only SQL verified campaign/session facts and live source. Separately approved publication created draft PR #515 and two READY previews. No production mutation, outbound call, main merge or production deployment has occurred.
- After approval, live SQL verified the manual campaign setting, the eight newest sessions carrying true Auto Dial metadata, the default/omitted field in session creation, and 32 sampled provider-admitted calls. See verification.md for exact scope and limits.
- No failed click has yet been correlated to a specific readiness, microphone, authorization, caller-ID, transport or provider error. Successful recent calls do not identify the failed-click cause.

Production evidence: [main](https://github.com/cgarness/agentflow-life-insure/commit/2b6f5cefe4f4d7980ab670067a5634e320cd20fd) · [Vercel deployment](https://vercel.com/cgarness-projects/agentflow/6Ue8L6EDqwhqfThT4UJeUA9wuDZc).

## 2. Conflicting work

Reviewed file lists of all 16 open PRs. None overlaps the requested dialer implementation files. Several overlap root documentation, especially draft PR #514.

An active branch WITHOUT an open PR does overlap:
- `claude/great-goodall-911azc-integration`, initial head `580f206b8a611731aa521f84194f80e4457245ee` (Reports V2). Refreshed November 5 UTC: `f7ff977992a873f23ac9bbe27eeadd878a3f83be`, two newer WORK_LOG-only commits; overlapping code unchanged.
- DialerPage.tsx adds `type: data.type` to standalone appointment persistence and `sourceCallId={currentCallId}` to ConvertLeadModal.
- dialer-api.ts adds optional appointment type forwarding.
- Its WORK_LOG records approved protected-file mounts; TwilioContext was deliberately left unchanged.
- The candidate also changes only the admission predicate in live `private.report_call_facts` and its recovery pin. Coordinate that function/pin with Reports V2; exact source/ACL guards refuse drift.
- Preserve these exact changes if Reports merges before the hotfix. Do not import the 102-commit Reports branch into this P0. Refresh main and branch/file comparisons before editing, preparing a PR, and release. Merge documentation entries without overwriting concurrent work.

[Reports overlap](https://github.com/cgarness/agentflow-life-insure/compare/2b6f5cefe4f4d7980ab670067a5634e320cd20fd...580f206b8a611731aa521f84194f80e4457245ee).

## 3. Evidence-backed findings

| Finding | Evidence in inspected source | Confidence / limit |
|---|---|---|
| Queue, selected index and URL have separate writers. | DialerPage: currentLead is queue[index] at 449–450; URL-to-index and index-to-URL effects at 573–616; lifecycle queue update at 2191–2225 and layout-effect selection at 2227–2233. | Confirmed structural race risk. Synthetic replay demonstrates index identity changes after sorting; full React/browser reproduction remains to run. |
| Skip releases its transition protection too early; older timers can release a newer operation. | handleSkip finally clears isAdvancing at 2425–2426 while applyQueueLifecycle separately schedules a 100 ms clear. Other loaders/navigation schedule 100/500 ms clears. | Confirmed conflicting ownership of the busy flag; the existing ref does prevent simultaneous entry while true, so it must be strengthened, not removed. |
| Automatic calling-hours handling persists Skip repeatedly. | useDialerStateMachine: failed checkCallingHours invokes onSkip immediately, before its dial delay and without marking that lead processed. isAdvancing and lead changes re-run the effect. | Confirmed automatic traversal path after hasDialedOnce, when effective Auto Dial is enabled. Not proof it caused Will's manual-mode incident. |
| Skip can discard an unsaved outcome. | handleSkip checks only isAdvancing, then clears disposition, notes and currentCallId. It does not check dispositionSaveRef or pendingDispositionDraftRef. Arrow handlers also clear draft fields; queue selection/URL navigation have separate rules. | Confirmed protection gap. Protect all navigation entrances so fixing one button cannot be bypassed by another. |
| Call appears available when its eventual gates can refuse. | DialerActions Call button has no disabled/readiness/pending props; Skip only checks voice call state. handleCall checks error status but connecting/idle passes to deeper checks. | Confirmed UI/handler mismatch. Underlying readiness, DNC and authorization guards are required and stay intact. |
| Call has no action identity spanning its earliest awaits. | handleCall awaits session and DNC before initiateCall captures the current visit generation. No synchronous page-level call/preflight lock is acquired at click entry. | Confirmed stale-action gap. TwilioContext's existing isDialingRef prevents concurrent provider entry; retain it as a second boundary. Do not claim duplicate real calls were observed. |
| Session-start contention and unexpected dispatch rejection can look like a dead click. | useDialerSession returns false immediately when startInFlightRef is set. runGatedCall catches DNC verification errors, but not a thrown session/dispatch error; callers launch handleCall with void. | Confirmed silent-busy/unhandled-error paths. No evidence yet that either explains Will's specific click. |
| Session Auto Dial metadata is not the runtime source of truth. | Current baseline schema defines dialer_sessions.auto_dial_enabled DEFAULT true. start_dialer_session inserts no value for it; the client session wrapper neither passes nor reads it. Runtime uses campaign setting and local toggle. | Explains how a manual campaign can have a true session field. Live definition/default verification pending; do not use that field to infer actual automatic dials or rewrite historical sessions. |
| Runtime settings can arrive stale. | autoDialEnabled initializes true at DialerPage 839; campaign-list sync at 1842–1851 and async syncSettings at 3294–3354 independently set it. syncSettings has no campaign/request-generation cancellation. | Confirmed stale-response/default window. Whether it occurred for Will is unproven. |
| Failed dispatch can leave misleading call state/history. | TwilioContext inserts a ringing calls row at 2330–2352, then checks Device and invokes Voice.js; catch at 2413–2422 resets browser state but does not settle the inserted row or clear all attempt ownership. | Confirmed source path. Preserve audit history and distinguish definitely not sent from an ambiguous provider outcome. Do not delete rows or infer failure solely from missing CallSid. |

Primary code references:
- [DialerPage](https://github.com/cgarness/agentflow-life-insure/blob/2b6f5cefe4f4d7980ab670067a5634e320cd20fd/src/pages/DialerPage.tsx#L2342)
- [State machine](https://github.com/cgarness/agentflow-life-insure/blob/2b6f5cefe4f4d7980ab670067a5634e320cd20fd/src/hooks/useDialerStateMachine.ts#L146)
- [Call gate](https://github.com/cgarness/agentflow-life-insure/blob/2b6f5cefe4f4d7980ab670067a5634e320cd20fd/src/pages/dialerCallGate.ts)
- [TwilioContext](https://github.com/cgarness/agentflow-life-insure/blob/2b6f5cefe4f4d7980ab670067a5634e320cd20fd/src/contexts/TwilioContext.tsx#L2171)
- [Session creation](https://github.com/cgarness/agentflow-life-insure/blob/2b6f5cefe4f4d7980ab670067a5634e320cd20fd/supabase/migrations/20260811201401_dialer_session_campaign_access.sql#L139)

## 4. Call preflight trace

| Stage | Existing decision | Required correction or preserved behavior |
|---|---|---|
| Click entry | Current lead; active call; saving/advancement; existing wrap-up/draft; voice error | Acquire one synchronous action token before the first await. Use the same actionable readiness decision for UI and handler. Keep deliberate manual redial after a saved outcome. |
| Campaign session | Cached matching session, otherwise server start/authorization; mismatched active campaign refuses | Join identical in-flight starts or show a clear busy state. Preserve server refusal and explain end-current-session recovery. Never auto-end someone else's session or broaden Personal campaign access. |
| First DNC check | check_dialer_dnc; failures fail closed | Preserve. Bind result to original scope. Use explicit manual/auto intent rather than the toggle to decide interaction behavior; neither may bypass authoritative DNC. |
| Caller-ID choice | Sticky/manual/local-presence/group selection | Preserve agency/personal ownership, caps, active state and Inbounds exclusions. Surface a specific unavailable reason; never substitute an unauthorized number. |
| Final page dispatch | Rechecks campaign session, calls provider context | Revalidate original user/org/campaign/membership/visit after each await. Do not adopt the newly visible lead as the old click's target. |
| Provider entry | isDialingRef, active/incoming state, registered readiness ref, Device presence and ready status | Preserve all guards. Also carry expected action ownership so navigation/identity changes cannot invalidate the call's contact metadata. |
| Auth and microphone | Session refresh, org claim, profile, getUserMedia | Surface rejection distinctly. Re-check ownership after the permission prompt. Cancellation must not cause a late dial. |
| Final caller ID / DNC / identity | Allowed number, active campaign group, DNC recheck, identity continuity | Preserve. Re-check current eligibility before calls insert and provider dispatch. |
| Attempt record | Stable UUID, calls insert, same-ID recovery on ambiguous response | One attempt identity per deliberate action, reused for recovery; new UUID only for a new deliberate attempt. No optimistic stats before accepted dispatch; never create No Answer for unknown admission. |
| Voice dispatch | twilioMakeCall → device.connect | Single-leg browser Voice.js only. Catch and classify pre-dispatch, rejected and ambiguous outcomes. No automatic retry after an uncertain dispatch. |
| Provider admission/lifecycle | Signed webhook → admit_twilio_outbound; provider status callbacks and disposition admission check | Preserve signed admission, tenant/actor/campaign/lock/DNC validation, canonical duration, call history, recording, end-state and log deduplication. |

Twilio's documentation distinguishes obtaining a Call object from subsequent call lifecycle events. A successful connect promise alone is not evidence that the prospect answered or that every later gate succeeded:
[Device API](https://www.twilio.com/docs/voice/sdks/javascript/twiliodevice) · [Call lifecycle](https://www.twilio.com/docs/voice/sdks/javascript/twiliocall).

## 5. Proposed implementation

### A. One action owns one transition

1. Use campaign membership ID as selection identity; derive the displayed index. Commit queue plus selected ID together through one transition owner.
2. Capture action ID and user/org/campaign/visit at entry. Reject another Skip/Call/navigation while that owner is unresolved. Only that owner may release its lock; eliminate time-based unlocking.
3. Persist Skip for the captured membership, then choose exactly one eligible next membership using the existing priority semantics. No fallback to queue index zero when nothing is eligible; show a truthful paused/exhausted state.
4. Personal uses the existing canonical skip/disposition operation and stable retry identity. Team/Open keeps per-agent suppression, confirmed lock release and atomic get_next_queue_lead. Never change Skip into a call attempt or global suppression.
5. Synchronize URL from the committed selection. Treat deliberate Back/deep-link navigation as a separate guarded action, not as feedback from a stale URL. While an outcome is unsaved, retain the original contact, call and draft.
6. Reject stale campaign loads, resume-position reads, enrichment, settings, pagination, history and transition completions. A late shared-queue claim must be safely reconciled by its own identity, without releasing a newer claim.

### B. Stop automatic skip loops and preserve drafts

- When existing calling-hours logic refuses Auto Dial, cancel its countdown and pause on that lead with one concise reason. Do not persist Skip from the timer/effect and do not invent another timezone heuristic.
- Default automatic execution to off/unresolved until the current campaign's settings load. Preserve the existing first-call-manual requirement and intentional session toggle.
- Block Skip, arrows, queue jumps and programmatic advancement while calling, preflighting, saving, converting, scheduling, or holding an unsaved outcome. Keep failed-save drafts, call identity, notes, callback/appointment values and request IDs.
- Save Only retains the lead and Team/Open lock. Save & Next transitions once, only after confirmed persistence. Explicit manual redial remains available under the existing saved/draft rules.

### C. Make Call outcomes explicit and prevent extra dispatches

- Add one shared preflight result with a short visible reason and action state (checking/starting/blocked/error).
- Disable Call and Skip for the same conditions enforced by handlers; retain handler guards for keyboard, timer and stale event entry.
- Keep existing isDialingRef and every provider lifecycle guard. Add page-level serialization across session/DNC/caller-ID awaits, plus original-selection validation after each await.
- Handle all rejected promises and false outcomes. Specific messages cover connecting phone, permission denial, unavailable microphone, session conflict/authorization, no caller ID, DNC verification, lost lock and transport failure.
- Emit bounded diagnostic records keyed by opaque action/attempt IDs and gate/reason. Do not log tokens, phone numbers, prospect names, notes or session credentials.
- Preserve call-attempt audit records. Settle only a provably failed attempt using a guarded operation that cannot overwrite signed provider evidence or a newer attempt. An ambiguous outcome stays visibly unresolved and cannot be automatically redialed.
- Separate preflight failure, browser dispatch, authoritative admission, actual call outcome and disposition. Do not count a blocked click as an actual call or campaign attempt.

### D. Backend scope must be finalized from live read-only evidence

The client repair does not authorize production changes. The complete telemetry requirement may need a narrow migration.

After approval, inspect only Will's matching campaign and its organization:
1. Resolve exactly one active profile and campaign by name/owner; refuse an ambiguous match.
2. Read campaign settings, recent session IDs/status/mode, aggregate queue eligibility and own lock/suppression metadata.
3. Inspect relevant live function definitions, grants, RLS/defaults and migration history: session start/heartbeat/end, queue claim/personal reader, save_disposition_with_booking, DNC/admission and trusted dialer counts.
4. Correlate recent call attempt IDs with signed admission and provider/status events. Limit rows and dates; do not retrieve notes, recordings or unrelated prospect PII.
5. Compare production definitions with repository migrations before proposing SQL.

Two candidates need explicit design and tests:
- Session-mode metadata: initialize it from the verified campaign/runtime choice and record future mode changes consistently without changing server-owned timestamps or rewriting history.
- Dispatch/telemetry settlement: repository get_trusted_today_dialer_stats counts outbound rows without an admission predicate, and getContactCallStats counts every returned call row. Marking a row failed alone does not prove it will disappear from call totals. Audit the current readers and use explicit existing admission evidence for new admission-required calls, preserving legacy and genuine provider-failed calls. Never exclude historical calls merely for lacking a provider ID.

Author any necessary DDL as new CLI-generated migrations on the isolated branch; do not edit applied migrations. Present exact SQL, preimages, hashes, rollback and advisor results for separate approval before production. No Edge deployment is currently proposed; preserve live v61 and all unrelated inbound/A2P behavior.

## 6. Intended files

Application files expected to change:

| File | Purpose |
|---|---|
| src/pages/DialerPage.tsx | Wire coherent navigation, original-click identity, settings freshness and draft protection. |
| src/hooks/useDialerNavigation.ts (new) | Own transition lifecycle, scope generation and selection commits. Keep focused and small. |
| src/lib/dialer-navigation.ts (new) | Pure identity-based selection/transition decisions. |
| src/components/dialer/DialerActions.tsx | Pass shared action state and retain outcome UI. |
| src/components/dialer/DialerPrimaryActions.tsx (new) | Small Call/Skip/Hang Up control with busy/blocked reasons; Tailwind only. |
| src/hooks/useDialerStateMachine.ts | Pause on calling-hours refusal; cancel stale scheduled calls; no automatic persistent Skip. |
| src/pages/dialerCallGate.ts | Structured gate outcomes and action freshness checks. |
| src/hooks/useDialerSession.ts | Same-scope in-flight session handling and truthful failure results. |
| src/contexts/TwilioContext.tsx | Preserve guards; bind provider attempt ownership; surface and reconcile dispatch failure safely. |

Conditional, only when confirmed necessary and listed again before edits:
- src/lib/supabase-dialer-sessions.ts — mode/status contract.
- src/lib/dialer-api.ts — truthful per-contact call read path; preserve Reports appointment-type forwarding.
- src/lib/supabase-dialer-stats.ts — only if reader response changes are necessary.
- New SQL migration and focused Supabase tests — paths generated after live baseline inspection; no production execution under build approval.

Verification files:
- src/pages/__tests__/dialerCallGate.test.ts
- src/hooks/__tests__/dialerSessionCampaignScope.test.ts
- src/hooks/__tests__/useDialerNavigation.test.tsx (new)
- src/hooks/__tests__/useDialerStateMachine.test.tsx (new)
- src/components/dialer/__tests__/dialerPrimaryActions.test.tsx (new)
- src/contexts/__tests__/twilioOutboundAttempt.test.tsx (new)
- scripts/tests/dialer-reliability/check.mjs (new actual-component synthetic browser runner)

Documentation:
- implementation_plan.md — prepend this focused plan, preserve other plans.
- docs/plans/2026-11-04-dialer-reliability/implementation_plan.md
- docs/plans/2026-11-04-dialer-reliability/verification.md
- WORK_LOG.md — newest-first after implementation, accurate release status.
- AGENT_RULES.md — propose/document action ownership and automatic-hours pause invariant; preserve every existing security/telephony rule.

queue-manager.ts, dialer-disposition.ts, useDispositionPersistence.ts, useLeadLock.ts and twilio-voice.ts have been inspected. Retain their existing priority/persistence/locking/transport contracts; edit only if a concrete tested defect requires it and update the intended list first. Do not refactor broad dialer or reporting code as part of the hotfix.

## 7. Pre-approval reproduction (historical)

Ran the actual unchanged pure queue and call-gate helpers with synthetic inputs using Node 24.22.1, without backend access.

- Five existing-behavior checks PASS: session refusal stops dispatch/count; DNC refusal stops dispatch/count; false dispatch adds no count; successful dispatch counts once; manual redial with an unsaved draft is blocked.
- Queue replay reproduced: current B at index 1 in [A,B,C,D]; persisted skip reorders to [A,C,D,B]; old index 1 points to C while lifecycle picks A. This proves the identity mismatch in separately applied state, not a measured browser flicker.
- A delayed session gate accepted a scope change before dispatch: the helper has no original-scope guard.
- A thrown synthetic dispatch error rejected out of runGatedCall and did not invoke the verification error handler.
- These are diagnostic checks of existing code, not hotfix acceptance tests.

Those were the initial diagnostic checks. The implementation and final results now appear in verification.md; native PostgreSQL contention subsequently passed in CI. Real carrier/media tests remain explicitly unverified.

## 8. Acceptance matrix after build approval

| Area | Required synthetic checks |
|---|---|
| Skip | Repeated clicks in one tick and while response is delayed produce one operation and one selected-ID transition. Retry after known failure uses the same identity where appropriate. |
| Queue/URL | Re-sort, equal tiers, callback promotion, pagination, exhausted queue, browser Back, deep links and delayed resume reads preserve a coherent selected lead and URL. |
| Stale responses | A→B and A→B→A campaign/user/org changes; late skip/save/claim/settings/history responses cannot commit or unlock another action. |
| Drafts | Notes, outcome, callback, appointment and conversion drafts survive every rejected transition and failed save; Save Only retains lock; Save & Next advances once. |
| Auto/manual | Campaign false, loading/error, stale settings, deliberate toggle, first call manual, hours refusal, early owned callback, canceled countdown and manual repeat calls. No self-running Skip chain. |
| Call entry | Double-click and manual/timer overlap, session start in progress, expired auth, unauthorized Personal campaign, mismatched campaign session, lost lock and offline readiness. Zero duplicate provider connects. |
| Microphone | Allowed, denied, missing device, busy device, permission prompt resolving after scope change, reconnect and disposal. |
| Caller IDs | Agency, owned Personal, foreign Personal, inactive/capped, empty/error number group, stale saved selection and Inbounds-only numbers. No forbidden fallback. |
| Dispatch | Insert failure, ambiguous insert recovery, Device loss, synchronous throw, rejected connect, late provider admission and duplicate/out-of-order callbacks. Unknown is not No Answer. |
| DNC | Preflight DNC, verification unavailable, DNC added during awaits, signed admission refusal, cross-tenant denial. No bypass or fabricated attempt. |
| Lifecycle | Real component flow with mocked synthetic Voice.js: start, ringing, answer, hangup, No Answer, Save Only, Save & Next, callback, appointment and Sold conversion. Call/history/stat ownership stays with the original attempt. |
| Shared pool | Two synthetic agents: atomic claims, suppression only for skipper, lock expiry/loss, renewal failure and stale claim completion. |
| Telemetry | Rejected preflight has no calls row/count/usage/attempt; retained dispatch-failure audit row is truthfully classified; provider-admitted actual calls count once; duration remains provider-owned. |

Use deterministic fake timers and deferred promises for races, plus actual rendered page/control browser flows. Synthetic test fixtures belong only in test code. No real prospects, production test rows or outbound test calls.

Run required `npx tsc --noEmit`, focused Vitest, lint and production build. Also run the actual application TypeScript project (`npx tsc --noEmit -p tsconfig.app.json`) and compare baseline diagnostics: the root tsconfig has an empty files list, so its success alone is insufficient. Existing WORK_LOG reports 79 baseline application diagnostics; re-measure rather than assuming that count remains current. Keep unrelated failures visible and require zero new failures.

## 9. Production release plan

1. Approval A: read-only campaign/backend diagnosis, isolated implementation and synthetic tests. Create an isolated branch from refreshed production main; no main push, hosted deployment or production mutation.
2. Complete the concrete candidate, manifest, tests, work log and conflict review. If remote publication creates a Vercel preview, obtain permission for that publishing/deployment step rather than triggering it under a local-only approval.
3. If backend changes are necessary, prepare exact migration/rollback and live preimages; require separate database approval. Retrieve any affected live Edge bundle first if Edge scope changes; none is currently proposed.
4. Obtain approval for the exact frontend commit/merge/release. Coordinate with Reports V2; preserve its two DialerPage mounts and appointment type change.
5. Release only the approved compatible package. Verify GitHub commit, Vercel READY and custom-domain serving SHA, any approved migration history, signed-in synthetic UI flow and runtime errors. Do not interrupt an agent's active call with an automatic reload.
6. Watch transition count, blocked gate reasons, dispatch failures, unresolved attempts and duplicate IDs without exposing contact PII. Compare counts against authoritative provider/admission evidence.
7. Rollback on repeated transitions, duplicate dispatch, draft loss, wrong-contact attribution, new blocked legitimate calls or telemetry regression. Restore the approved prior frontend without destructive data rollback. Backend rollback must preserve receipts/history and old-client compatibility.
8. Close with exact commits, test results, production verification, migrations/deployments, remaining uncertainties and next actions. A successful build is not proof of live audio.

## 10. Copyable execution brief

```text
HOTFIX — AgentFlow P0 dialer reliability

Read AGENT_RULES.md, VISION.md, the latest WORK_LOG.md and this plan. Recheck current production main and conflicts, including Reports V2 integration. Update implementation_plan.md and list exact files before edits. WAIT for Chris's explicit build/backend-command approval if not already recorded; then work on an isolated branch.

Implement one-action/one-transition navigation by membership ID with original user/org/campaign/visit ownership; block conflicting actions and retain unsaved outcomes. Remove effect-driven persistent calling-hours Skip and pause visibly instead. Share Call readiness between UI and handler, serialize preflight, revalidate scope after every await, and report every refusal/error. Preserve intentional manual redial and all existing Voice.js, DNC, cooldown, disposition, session, lock, recording and telemetry contracts.

Trace Will Harrison's "Goat leads aged 11/3" using minimal read-only diagnostics after approval. Treat specific failed-click cause as unknown until correlated. Separate runtime Auto Dial from stale/default session metadata. Preserve stable attempt IDs and history; never infer no call from missing CallSid, create No Answer for unknown admission, or auto-retry ambiguous dispatch.

Keep surgical diffs, organization_id and RLS; use .maybeSingle() for optional rows, Zod for any changed forms, Tailwind only, no production mocks or frontend secrets. Do not change the outbound architecture: device.connect() remains single-leg browser Voice.js. Retrieve full live Edge code before any proposed deployment and preserve verify_jwt.

Author any needed schema/function changes as new migrations and obtain separate exact production approval. Run required npx tsc --noEmit, actual app typecheck against baseline, focused tests, lint and build. Test all acceptance-matrix cases with synthetic data only. Append WORK_LOG.md newest-first and end with changes, decisions, verification, migrations/deploys, blockers and next steps. Do not push main, publish a branch that deploys, merge or deploy without the corresponding Chris approval.
```

Suggested execution agent: current strong coding model in Claude Code, Cursor or Codex; retain this explicit review/release workflow regardless of model.
