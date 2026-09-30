# Implementation Plan — Agent-voicemail recording callback repair (B1 Phase 2) — rev 2, APPROVED FOR LOCAL IMPLEMENTATION (2026-09-30); production packages APPROVED WITH EXECUTION CONDITIONS (2026-09-30) — NOT DEPLOYED, BLOCKED (§12.1)

> **PRODUCTION APPROVAL WITH EXECUTION CONDITIONS (Chris, 2026-09-30, in session) — NOT YET EXECUTED; BLOCKED (§12.1).**
> Condensed here with every condition retained; the full text is recorded verbatim in §12.11.
> Chris approved the exact Phase 2 production packages below, **subject to execution conditions**. It is **not** approval
> to skip an unresolved condition or to change the source. No additional broad audit or implementation cycle is requested.
>
> | order | function | source | manifest | payload sha256 | verify_jwt |
> |---|---|---|---|---|---|
> | 1st | `twilio-recording-status` | `02b8ba5c91def63ebfe7670c33a4981dc452037b` | `125a3cd85b8d6cf562903fc88565e3000a1bab8e5c2b6328b5a073f2b2fbd81a` | `5b33d169f431db89b64993c75c32dce31715e8e05ac4bf26487aab3ed30efc92` | false |
> | 2nd | `twilio-voice-inbound` | `02b8ba5c91def63ebfe7670c33a4981dc452037b` | `22c56d17063660705f8edae0e47a172bb740925b274617c420991e461b0d42f3` | `31d1cf5ab0cc87281d01c8ac8339343f50a2bc076f0e0d7365c94a85e3da45e1` | false |
>
> Project `jncvvsvckxhqgqvkppmj`. **Approved recovery artifacts:** `twilio-recording-status` v36 source, manifest
> `0893d95c57bce335589524bb2e6c57c5f5e30ed07dbaefb3b015b717165ae975`, payload
> `73e1f28fc370758f1107c9acc989887c6e044711dfd588f793aade420677a42e`; `twilio-voice-inbound` v45 source, manifest
> `6aeaeee6dc11dc05bd311c9fac0e0466bb3e1881fafd80367b71aca6d4116e79`, payload
> `f3c1f0e1c1b7adbeeaec5807cf15ea7c057300bbb6a8242579c4e204d7d16289`. Live-version guards and full read-back apply to
> recovery too. Source-byte parity is not proof of an identical dependency runtime.
>
> **Deployment method — option B:** MCP for `twilio-recording-status`; a **file-based CLI upload** for
> `twilio-voice-inbound`.
> - Before deploying **either** function: confirm who runs the CLI upload, that its authentication is ready, and that the
>   **same operator** can execute the inbound rollback. **The first deployment must not start while the second
>   deployment or its recovery still depends on unavailable access.**
> - Never ask Chris to paste an access token into chat, source code or commits. No manually transcribed inbound upload
>   without approval.
> - Isolated checkouts pinned to exact commits. **Never a moving `main` checkout as the recovery source.**
>
> **Record first.** Re-read AGENT_RULES.md, VISION.md and the newest WORK_LOG.md for conflicts. The **only** repository
> edits authorized are this plan and `WORK_LOG.md`; unrelated content is preserved. No application-source change is
> authorized: any necessary source change requires a revised file list, plan and Chris's explicit approval before editing.
>
> **Fresh production gates immediately before EACH forward deployment** (§12.4): no actively handled calls, fresh active
> dialing sessions or ringing reservations under the established read-only preflight, with known stale rows distinguished
> from genuinely active calls and never closed or modified; complete current live function retrieved and the approved
> preimage and recovery artifact verified; approved source manifest and package verified; stop on unexplained drift, never
> overwrite intervening work. `twilio-recording-status` first → every file verified → the 15-minute observation (zero
> traffic is **no evidence**, not a pass) → gates rechecked → `twilio-voice-inbound` → all 10 files verified. Entrypoints,
> complete dependency files and `verify_jwt` preserved.
>
> **Recovery corrections — required before execution** (implemented in §12.5–§12.8):
> - Never classify old/new callback format solely by `calls.created_at`; an earlier call can receive newly generated
>   voicemail TwiML after cutover. Use actual callback-format evidence; otherwise **unknown**.
> - The drain set is the conservative set of **all** calls that could have received new-form voicemail instructions: calls
>   in progress at cutover, later voicemail stage transitions, legitimate attempt-less fallback paths, and delayed or
>   retried recording callbacks. Fifteen minutes is a minimum wait, not proof of drain. A stored voicemail row alone is
>   not proof that all callback/cleanup work finished. Missing evidence does not mean "nothing owed".
> - **No blanket waiver of AGENT_RULES #32.** A release-specific exclusion may cover only individually identified old
>   stalled records positively shown unable to produce new-form callbacks. Unknown or relevant outstanding work blocks
>   restoring the old receiver.
> - The new compatible `twilio-recording-status` stays by default after an inbound-only rollback. If safe receiver
>   restoration cannot be established: **stop and escalate** rather than acknowledge and lose pending new-form calls.
> - **ONE consistent failure/action table** (§12.7): a producer fault may trigger the exact inbound-only rollback; a
>   retryable downstream recording 503 is investigated with source preservation and retries intact and is not
>   automatically evidence that the URL repair should be undone; a receiver boot failure, corrupt deployment or verified
>   regression in previously working recording paths follows receiver-specific recovery, subject to
>   compatibility/drain conditions; unrelated live-version drift means stop, not overwrite; a changing status mix alone
>   is not proof of a regression.
> - If these conditions cannot be satisfied with read-only checks and documentation corrections: stop before deployment
>   and identify the specific unresolved condition.
>
> **Verification and scope.** No controlled call or test-lead reassignment. Natural traffic and bounded read-only checks
> during the active session only; monitoring is never implied while the session is inactive. Reported separately:
> deployed and source-verified; agent voicemail stored; correct recipient and notification verified; playback confirmed
> by the recipient. Until the evidence exists: **production verification pending**. Preserve signature validation,
> organization_id/RLS, call ownership, `device.connect()`, re-entrancy guards, duration, dispositions, notifications and
> recording policy; ordinary verified-store source cleanup remains existing product behaviour; no manual historical
> recovery/deletion. The recorded TypeScript, exact-Deno, SQL and regression results keep their baseline limitations; no
> clean-pass claim where errors remain. Read-only Supabase advisors after deployment, without mutating unrelated
> findings. A newest-first WORK_LOG entry with actual results; commit/push only the two documentation files to this
> branch. **Not authorized:** PR/merge, migration, unrelated data change, historical recording recovery,
> unfinished-attempt cleanup, Task A activation.
>
> **Any subsequently approved code change** requires `npx tsc --noEmit`, the meaningful application typecheck and the
> affected tests; `.maybeSingle()` where appropriate, Zod for forms/modals and Tailwind for UI; no exposed secrets or
> production mock data; schema changes require migrations.
>
> **Closing report required:** the actual live versions, verification evidence, any recovery performed, remaining
> blockers and the next step for Task A.
>
> **Files listed before editing (the only two):** `docs/plans/2026-09-30-agent-voicemail-callback-repair/implementation_plan.md`
> and `WORK_LOG.md`.

> **APPROVAL (Chris, 2026-09-30, in session):** rev 2 is approved for **LOCAL IMPLEMENTATION** on
> `claude/b1-phase2-voicemail-callback-repair` from `main` `d675a4b`, touching **only the 13 files in §4**. The approved
> rulings:
> - **Do not ship the old B1 diagnostic.**
> - **Keep the current database ownership checks** (§3.3). The attempt / `voicemail_agent_id` SQL cross-check is **not**
>   added in this urgent phase. It is recorded as a separate defense-in-depth follow-up.
> - **The existing success log exposes only the mailbox type** (`agent` | `group`), never the mailbox identity or query
>   values.
> - **The §7 AGENT_RULES amendment is not added yet.**
>
> **Test clarification (binding).** Legacy compatibility and the old-defect negative control are separate requirements:
> 1. **Legacy compatibility.** A correctly signed legacy callback with `mailbox=agent:<uuid>` must still parse and proceed
>    through the existing voicemail pipeline (200, stored). The legacy format itself is **not** invalid.
> 2. **Old-defect negative control.** A callback signed against one URL canonicalization but delivered and validated
>    against a different percent-encoding representation must still fail signature validation (403, zero writes). This
>    proves the historical canonicalization problem can still be represented in the harness. It must **not** assert that
>    every properly signed legacy `agent:<uuid>` callback is rejected.
> 3. **The new form must pass across the whole canonicalization matrix without depending on colon encoding:**
>    `source=voicemail&mailbox=agent&mailbox_agent_id=<uuid>`.
>
> **Must be preserved:**
> - X-Twilio-Signature validation, exactly;
> - the organization, call and attempt checks;
> - group voicemail behaviour;
> - storage pipeline ordering, with the Twilio source deleted only after successful storage and database persistence;
> - notification behaviour and missed-call attribution;
> - call duration, status and disposition behaviour;
> - the mobile-forward recording policy;
> - the single-leg Voice.js outbound architecture.
>
> **After implementation:** an adversarial review of the final diff, a newest-first WORK_LOG entry for the local state,
> then a commit and push to this branch only.
>
> **NOT approved:**
> - a PR or merge;
> - deploying either Edge Function;
> - production data changes;
> - a controlled call;
> - recovering or deleting historical recordings;
> - cleaning up unfinished attempts;
> - Task A activation.
>
> **Scope confirmed before editing:** exactly §4 files 1–13, with no expansion.
> 1. `supabase/functions/twilio-voice-inbound/planner.ts`
> 2. `supabase/functions/twilio-voice-inbound/stages.ts`
> 3. `supabase/functions/twilio-recording-status/idempotency.ts`
> 4. `supabase/functions/twilio-recording-status/index.ts`
> 5. `scripts/edge_payload.mjs`
> 6. `src/lib/__tests__/edgePayloadVerification.test.ts`
> 7. `src/lib/__tests__/inboundStages.test.ts`
> 8. `src/lib/__tests__/inboundV2Twiml.test.ts`
> 9. `src/lib/__tests__/voicemailRecordingPipeline.test.ts`
> 10. `src/lib/__tests__/voicemailOwnershipRecovery.test.ts`
> 11. `src/lib/__tests__/voicemailCallbackContract.test.ts` (new)
> 12. this plan
> 13. `WORK_LOG.md`

> **Status (2026-09-30):** IMPLEMENTED LOCALLY on `claude/b1-phase2-voicemail-callback-repair`: base `d675a4b`, the P0
> cherry-picks of `7d5bc36`/`49253a5`, and the Phase 2 changes to §4 files 1–4 and 7–11 (commit `02b8ba5`).
> - **Production packages approved with execution conditions; NOT deployed; NOT verified in production.** Execution is
>   blocked before the first deployment (§12.1) on: U1 — no available CLI operator/access for the inbound upload and its
>   rollback; U2 — Chris's rulings on #32 for (a) the v36 receiver restore (a3 = 1 organization on v2) and (b) the
>   inbound-only rollback without the drain gate; U3 — confirmation that "preserve entrypoints" means the same entry
>   module and bytes under the CLI's `supabase/functions/…` prefix. U4 (AGENT_RULES record of CLI quirks) is needed
>   before the S11 record commit only.
> - No backend command, deployment, migration or production data change has run. Production access was read-only only.
> - The verification record is in §11; the corrected release procedure is §12. Commit SHAs and push state are in the
>   WORK_LOG entries.
>
> Chris superseded the B1 controlled diagnostic test on 2026-09-30:
> - the B1 diagnostic-only package is **not** deployed;
> - `READY FOR B1 TEST` is **not** run;
> - the test lead is **not** reassigned, and no controlled call is placed.
>
> The B1 A/B/C/D1 approval of 2026-09-28 is unused and void.
>
> **Label:** BUGFIX. **Mode:** BUILD, after approval (§10).
>
> **Rev 2** includes the 34 findings confirmed by an adversarial review of rev 1. They cover: the diagnostic excluded, a
> canonicalization-independence proof, strict legacy casing, a duplicate-`source` guard, the recovery order and drain
> rule, voice-inbound verification, the Task A footprint, merge sequencing, the floating esm.sh import, and the single
> approval.

## 1. Verified starting point (read-only, 2026-09-30)

- **`main`** = `d675a4b11d6f05f1cdf39414d274439358d1b877` (worktree `/home/user/rel-main`).
  - It is the **only** baseline for every comparison. `/home/user/rel-base` (`5d37e5f`) and the stale local `main` ref are
    **not** baselines.
  - Four commits landed since `5d37e5f`: #393–#396 (Reports, Contact Follow-ups, Group leaderboard). None of them touches
    `supabase/functions/twilio-*`, `_shared`, `scripts/edge_payload.mjs` or voicemail/inbound SQL.
  - Their AGENT_RULES changes (#38, appointment ownership, Group leaderboard) and the newest WORK_LOG entry (2026-09-29
    release) do not conflict with telephony.
- **Production:** every live file is byte-identical to `main`.

| function | version | verify_jwt | files | ezbr_sha256 |
|---|---|---|---|---|
| `twilio-recording-status` | 36 | false | 2 | `a75e7c80c877c3efdbf7bf9f08e6daf1079c0f94c8d47a1fea5d73473589fdca` |
| `twilio-voice-inbound` | 45 | false | 10 (incl. `functions/_shared/notifications.ts`, `notification-recipients.ts`) | `354441f26643f70db04782d0cfb717b125309d19ca0989cf80b46430eb63e86f` |
| `twilio-voice-status` | 42 | false | 5 | `d9bbe55cc30e58e33e61644537bf5e43b6c33a5bdeff256f24a1972754953b27`: **not touched** |

- **Defect, last 30 days:**
  - 4 agent-mailbox voicemails left, **0** stored;
  - 14 group-mailbox voicemails left, 14 stored.
  - Each lost agent callback got exactly one signature 403. A 403 is not retried by Twilio.
- **Branches:**
  - **Phase 2:** `claude/b1-phase2-voicemail-callback-repair` from `d675a4b`, with no upstream tracking. Any push uses an
    explicit refspec. The push state and commit SHA are recorded in the WORK_LOG entry.
  - **B1:** `claude/b1-agent-voicemail-signature` @ `635c0c7` (source `f208f07`, never deployed).
  - **Task A:** `claude/unsaved-callback-routing-plan-abvlzk` @ `efa8151`. Its real footprint is in R8.

## 2. Root cause (inferred; the exact step was not measured)

- **Producer.** `twilio-voice-inbound/stages.ts` `voicemailTwiml()` builds the `<Record recordingStatusCallback>` URL
  with `URLSearchParams`:
  - agent mailbox: `?source=voicemail&mailbox=agent%3A<uuid>&call_row_id=…&org_id=…&attempt_id=…`
  - group mailbox: `?source=voicemail&mailbox=group&call_row_id=…&org_id=…&attempt_id=…`
- **Consumer.** `twilio-recording-status` validates `X-Twilio-Signature` as HMAC-SHA1 over
  `SUPABASE_URL + "/functions/v1/twilio-recording-status" + new URL(req.url).search` plus the sorted form parameters.
- **The one difference.** Both URLs come from the same builder with the same keys, UUID values and retry fragment. The
  only difference is the percent-encoded `:` in the agent value. Every other key and value uses only `[A-Za-z0-9._-]`.
- **The inference.** Group callbacks validate and agent callbacks fail, which is consistent with Twilio or the platform
  canonicalizing `%3A` differently from our reconstruction. Which step does it was **not** measured.
- **Why the repair does not depend on it.** New agent URLs use only `[A-Za-z0-9._-]`, the same property group URLs have
  in production. No serializer or canonicalization (decode, re-encode, form-encode) changes those bytes. §6 proves this
  locally across six canonical forms. It is confirmed in production only when the first natural agent voicemail is
  stored.

## 3. Repair design (contract)

### 3.1 Producer — `twilio-voice-inbound` (new callbacks only)
- A new pure helper, `voicemailCallbackQuery(mailbox)`, in `planner.ts` serializes the internal mailbox string. The
  internal representation (`agent:<uuid>` | `group`) and every routing decision that uses it stay unchanged.

| internal mailbox | signed recording query |
|---|---|
| `agent:<uuid>` (valid UUID) | `source=voicemail&mailbox=agent&mailbox_agent_id=<lowercase uuid>&call_row_id=…&org_id=…&attempt_id=…` |
| `group` | `source=voicemail&mailbox=group&call_row_id=…&org_id=…&attempt_id=…` (**byte-identical to today**) |
| anything else (unreachable: agent ids come from UUID columns) | `source=voicemail&mailbox=agent&call_row_id=…` **without** an id. The consumer rejects it with a logged reason. Never falls back to `group`, which would expose an agent's private voicemail to group recipients. A producer warning logs the call row id only. |

- **Where it is used.** `voicemailTwiml()` uses the helper for the recording URL only. `attempt_id` is still omitted when
  empty.
- **Unchanged:**
  - the agent greeting lookup;
  - the `<Record action>` `voicemail_done` stage URL;
  - the retry fragment `#rc=3&rp=5xx,ct,rt`;
  - the conversation-recording URL;
  - every planner, reservation, missed-call, notification, duration and disposition path;
  - the mobile-forward recording policy.

### 3.2 Consumer — `twilio-recording-status`
- **Signature validation is unchanged and still runs first on the raw request.** No alternate signatures, no
  normalization, no bypass. The origin still comes only from `SUPABASE_URL`, never `X-Forwarded-Host`.
- **Dispatch guard (fail closed).** A request carrying `source` more than once, or whose value is not exactly
  `voicemail`, is answered like today's invalid request: 200, nothing downloaded, uploaded, written or deleted. It never
  falls into the conversation-recording pipeline.
  - Only a request with **no** `source` keeps today's conversation path.
  - Today `searchParams.get('source')` reads the first value, so `source=x&source=voicemail` would reach the conversation
    pipeline.
- **The parser.** `readVoicemailCallbackQuery(search)` in `idempotency.ts` rejects any of `source`, `mailbox`,
  `mailbox_agent_id`, `call_row_id`, `org_id` or `attempt_id` appearing more than once (`duplicate_param`). It then applies
  exactly this table, with **presence** meaning `search.has(key)`, so an empty value is present:

| `mailbox` (case-sensitive, exact) | `mailbox_agent_id` | result |
|---|---|---|
| `group` | absent | `group` (legacy, unchanged) |
| `group` | present (any value, incl. empty) | **reject** `conflicting_mailbox` |
| `agent` | exactly one UUID | canonical `agent:<lowercase uuid>` (new form) |
| `agent` | absent, empty or not a UUID | **reject** `invalid_mailbox_agent_id` |
| `agent:<uuid>` (lowercase `agent:` prefix; UUID hex any case) | absent | `agent:<lowercase uuid>` (legacy) |
| `agent:<uuid>` | present | **reject** `conflicting_mailbox` |
| anything else, including `AGENT:<uuid>`, `Agent`, `GROUP` | any | **reject** `invalid_mailbox` |

  - Tightening versus today: the legacy prefix is now case-sensitive. Today `AGENT:<uuid>` passes the Edge parser, but SQL
    `LIKE 'agent:%'` is case-sensitive, so it would be stored as a **group** voicemail. No issued URL uses that casing.
  - `source` must be exactly `voicemail`. `call_row_id` and `org_id` are required UUIDs, and `attempt_id` is optional but
    must be a UUID when present, as today. Safe paths legitimately omit `attempt_id`.
  - Values are compared after trimming surrounding whitespace, as today for every callback field (the new
    `mailbox_agent_id` included). Matching is case-sensitive.
- **Downstream is unchanged.** A successful parse returns today's shape, with `mailbox` as the canonical internal string.
  `upsert_voicemail_from_recording`, storage, ownership/cleanup ordering and idempotency are unchanged. **No database
  change and no migration.**
- **Rejected queries** are acknowledged, with nothing written and the Twilio source preserved, as today's
  `invalid_request`.
- **Logging (Chris's rule: no query values).**
  - The new rejection paths log only the reason code plus the body SIDs already logged today.
  - The one existing success log (`index.ts` ~l.365: `callRowId`, `mailbox`) prints values from the signed query. It
    becomes `mailbox_kind: 'agent'|'group'`, keeping `recordingSid`, `callSid` and `outcome` for correlation (included
    unless Chris says keep).
  - Tests assert that no query value appears in these lines.

### 3.3 Ownership — what is proven (unchanged; stated precisely)
- **Authority for the agent identity:** the signed, server-issued callback URL. Only a URL our TwiML gave Twilio can carry
  a valid signature. No browser value is involved.
- **What the database proves before persisting** (`upsert_voicemail_from_recording`, unchanged):
  - the RecordingSid format;
  - the call exists, is inbound and belongs to `org_id`;
  - `attempt_id` is linked only if it belongs to that call and organization;
  - an agent mailbox's agent is a profile in that organization;
  - group recipients come from the committed attempt's `voicemail_group_ids` or the organization's inbound group, never
    from the URL;
  - a RecordingSid already stored for another call is refused.
- **Not done today and not added here:** a cross-check of the agent id against `inbound_route_attempts.voicemail_agent_id`.
  - Attempt-less safe paths and `owner_browser` attempts, which are created with `voicemail_agent_id` NULL, would need
    defined fallbacks: `voicemail_agent_id` → `owner_agent_id` → `calls.missed_for_agent_id`.
  - This is a separate hardening proposal. Chris rules on it in §10.

### 3.4 The B1 failure-only diagnostic is NOT included
- New-form queries contain no `%` or `:`, so all six of the diagnostic's query forms are the same bytes. It could only
  distinguish an explicit `:443`, and it cannot explain a residual failure after the repair.
- Chris also asked for no diagnostic-only package and for a surgical change.
- The executed-handler harness therefore stays on its existing 2-file set.

### 3.5 Packaging support carried over from B1 (P0)
- `main`'s `scripts/edge_payload.mjs` packages only the function directory, but `twilio-voice-inbound` v45 has 10 files,
  including 2 `_shared` files.
- The P0 commits `7d5bc36` and `49253a5` add the relative-import closure: TypeScript's own scanner, and refusal of symlinks
  and path escapes. Single-directory manifests are unchanged.
- They are cherry-picked with their test. `main` has not changed either file since `5d37e5f`.

## 4. Exact files (unconditional)

| # | file | change |
|---|---|---|
| 1 | `supabase/functions/twilio-voice-inbound/planner.ts` | add `voicemailCallbackQuery()`; doc comment on `mailboxForAttempt` |
| 2 | `supabase/functions/twilio-voice-inbound/stages.ts` | `voicemailTwiml()` builds the recording query via the helper |
| 3 | `supabase/functions/twilio-recording-status/idempotency.ts` | extended `parseVoicemailCallbackQuery`; new `readVoicemailCallbackQuery` |
| 4 | `supabase/functions/twilio-recording-status/index.ts` | dispatch guard; parser wiring; the one success log changes to `mailbox_kind` |
| 5 | `scripts/edge_payload.mjs` | P0 closure support (cherry-pick of `7d5bc36`, `49253a5`) |
| 6 | `src/lib/__tests__/edgePayloadVerification.test.ts` | P0 tests (cherry-picked) |
| 7 | `src/lib/__tests__/inboundStages.test.ts` | new agent query pinned exactly on every producer path; group query pinned exactly; the `[A-Za-z0-9._-]`-only invariant; the unparseable-mailbox fallback |
| 8 | `src/lib/__tests__/inboundV2Twiml.test.ts` | the example URL moves to the new form; escaping and fragment assertions are unchanged |
| 9 | `src/lib/__tests__/voicemailRecordingPipeline.test.ts` | parser matrix: new, legacy, casing, conflicts, empties, duplicates |
| 10 | `src/lib/__tests__/voicemailOwnershipRecovery.test.ts` | executed handler (existing 2-file harness): new form stored; legacy forms; tampering 403 with zero writes; dispatch guard; log hygiene |
| 11 | `src/lib/__tests__/voicemailCallbackContract.test.ts` | **new:** producer→consumer contract plus the canonicalization-independence matrix (§6) |
| 12 | `docs/plans/2026-09-30-agent-voicemail-callback-repair/implementation_plan.md` | this plan |
| 13 | `WORK_LOG.md` | one newest-first entry, headed "IMPLEMENTED LOCALLY; NOT DEPLOYED; NOT VERIFIED IN PRODUCTION"; existing content preserved |

**Not touched:**
- `twilio-voice-status`;
- in `twilio-voice-inbound`: `index.ts`, `twiml.ts`, `request.ts`, `settings.ts`, `failure.ts`, `routing.ts`;
- `_shared/*`, all migrations and database objects;
- `src/integrations/supabase/types.ts`, all frontend code, `TwilioContext`;
- the root `implementation_plan.md` (the Leaderboard plan);
- `AGENT_RULES.md` (the §7 amendment is a proposal).

## 5. Implementation steps (after approval)

1. Unset the Phase 2 branch upstream. Cherry-pick P0 (files 5, 6) and run its tests.
2. Producer (1, 2), then consumer (3, 4).
3. Tests (7–11): update the pinned legacy agent URL expectations, then add the matrix, the executed cases and the
   contract/invariance tests.
4. Run the verification in §6, then one adversarial review of the diff. Fix and re-run.
5. Commit, add the WORK_LOG entry (13), and push to the Phase 2 branch only with the explicit refspec
   `origin claude/b1-phase2-voicemail-callback-repair:claude/b1-phase2-voicemail-callback-repair`.
6. Release prep (read-only): the packet in §9. **No deployment, PR or merge.**

## 6. Verification plan

### 6.1 Local tests (mapped to Chris's 14 requirements)

| # | requirement | proof |
|---|---|---|
| 1 | new agent URL `mailbox=agent&mailbox_agent_id=<uuid>`, not `agent%3A` | Exact new query pinned on every producer path (owner_voicemail, wave-suppressed, planner-failure, no-attempt, owner_browser return), plus an invariant check on every path: extract `recordingStatusCallback`, XML-unescape it, strip the `#rc…` fragment, and assert every key and value is `[A-Za-z0-9._-]+` with no `%`. Negative control: the legacy URL fails the invariant. |
| 2 | group URL valid | exact pin of today's group query; contract: group → 200 stored |
| 3–5 | new, legacy agent and legacy group parse | parser matrix, plus executed handler (each signed form → 200 stored) |
| 6 | conflicts fail closed | legacy + `mailbox_agent_id` (same, different, empty); `group` + `mailbox_agent_id` (incl. empty); duplicate `mailbox` / `mailbox_agent_id` / `source`: all rejected with zero writes |
| 7 | missing or invalid id fails closed | `mailbox=agent` with an absent, empty, non-UUID or `agent:`-prefixed id; `AGENT:<uuid>`; `Agent`: all rejected with zero writes |
| 8 | valid signatures pass | executed: new agent, legacy group and legacy agent, each signed exactly → 200 |
| 9 | tampering → 403, zero persistence | executed: `mailbox_agent_id` changed after signing; `mailbox` agent↔group swapped; a body parameter changed; another token; no signature. Each gives 403 with no RPC, upload, download or DELETE. |
| 10 | agent voicemail persists | `p_mailbox = 'agent:<uuid>'`, the storage object, `calls.voicemail_id`, the convergence call |
| 11 | group unchanged | existing group tests unmodified and passing |
| 12 | duplicate callback idempotent | redelivered new-form callback: sticky `stored`, no second upload |
| 13 | ordering | upload → persist → delete assertions run for the new form |
| 14 | nothing else changes | full inbound/voicemail/recording suites; the stage TwiML for every path is compared with `main` (only the recording query differs); `twilio-voice-status` untouched |

**Canonicalization independence (file 11).** This is the local proof Chris's "do not assume the variant" rule needs.
Exact-sign tests alone cannot tell the fixed URL from the broken one.
- Take the URL emitted by the real producer, with the fragment stripped as Twilio does, through six canonical query forms:
  `raw`, `colon_decoded`, `colon_encoded`, `fully_decoded`, `form_reencoded`, `legacy_reencoded`. The helper is test-only;
  `:443` origin variants are excluded, because they affect group URLs equally.
- **Both directions:** sign over form *f* and deliver raw, and sign over raw and deliver *f*. New agent and group must be
  200 and stored in both directions.
- Assert `form(newQuery, f) === raw` for every *f*.
- **Negative control:** the legacy `agent%3A` URL signed over `colon_decoded` and over `fully_decoded`, delivered raw, gives
  **403 with zero writes**.
- File 11 also proves in-process producer→consumer consistency, and is labelled as such. It does not prove Twilio's own
  behaviour.

**Negative controls (mutations that must be caught):**
- the parser accepts `mailbox=agent` without an id;
- the parser accepts legacy + new together;
- the parser rejects the legacy lowercase form;
- the parser accepts `AGENT:`;
- the handler skips signature validation;
- the dispatch reads only the first `source`;
- the producer emits `agent%3A`;
- the producer falls back to `group`;
- a rejection log includes a query value.

**Commands** (baselines = `/home/user/rel-main` @ `d675a4b`):
- the affected Vitest files, then all `inbound*`, `voicemail*`, `recording*` and `edgePayload*` suites, then the full
  Vitest run versus the baseline (pre-existing failures named as such);
- `npx tsc --noEmit` (root; a known empty project, reported as such);
- `tsc -p tsconfig.app.json` versus the baseline (0 new);
- **exact Deno check** of both entrypoints with the real `https://esm.sh/@supabase/supabase-js@2`:
  - same session, same `DENO_DIR` and `--no-lock` for the baseline and the branch;
  - the repo's `deno.lock` (which pins 2.98.0) is not in effect, and this is stated;
  - the Deno version and the resolved supabase-js version are recorded;
  - known baseline: `twilio-recording-status` has 2 pre-existing TS2339; `twilio-voice-inbound` is measured;
  - reported as a comparison. If esm.sh is unreachable: "exact Deno check NOT RUN", with no substitution;
- `edge_payload.mjs build` + `verify` for both packages, plus the P0 self-test;
- `supabase/tests/inbound_voicemails.sql` on local PostgreSQL 17.6 as a regression (the database is unchanged).

### 6.2 Production verification after a separately approved deployment (natural traffic, bounded, read-only)
No controlled call. A window with no traffic is **no evidence**, never a pass. Nothing is described as a passed live test
until a real one exists.

**Pre-deploy baseline:** 7-day edge-log status counts for `twilio-voice-inbound`, `twilio-recording-status` and
`twilio-voice-status`.

> **SUPERSEDED 2026-09-30 by §12.5 (S4/S8/S9) and §12.7 — kept for the record only; §12.7 is the only failure/action
> table in force.**

**After `twilio-recording-status` (step 1):**
- byte read-back;
- for 15 min:
  - no new 5xx;
  - group and conversation callbacks still 200;
  - no `invalid_*`, `conflicting_mailbox` or `duplicate_param` rejections.

**After `twilio-voice-inbound` (step 2):**
- byte read-back;
- the next natural inbound calls:
  - `twilio-voice-inbound` returns 200, with no boot errors or 5xx;
  - the calls row and route attempt are created and progress normally;
  - `twilio-voice-status` status mix unchanged.
- **Any failure → inbound-only rollback** (§9). The consumer stays.

**SUPERSEDED 2026-09-30 by §12.5 Q1 and §12.7 (F8–F10):** callbacks are classified by their actual logged format
(`request.search`), never by `calls.created_at`; a call created before the deploy can receive new-form TwiML after it.
The original rule is kept below for the record only.

**Classifying recording-status 403s (superseded):** by the call's `created_at` relative to the `twilio-voice-inbound`
deploy timestamp.
- **Before:** legacy in-flight, expected. The window is the greeting, plus up to 120 s of recording, plus Twilio
  processing.
- **After:** a new-form failure.

> **SUPERSEDED 2026-09-30 by §12.7 (F5–F10) — kept for the record only.**

**First new-form agent callback — decision table:**

| observed | meaning | action |
|---|---|---|
| 200, stored | repair works in production | downstream checks below |
| 403 | repair ineffective; no regression (the same loss as today) | keep deployed; report; investigate separately |
| 200 `invalid_*` / `conflicting_mailbox` / `duplicate_param` | producer/parser mismatch | inbound-only rollback |
| 503 | downstream failure; the source is preserved and Twilio retries | investigate; do not roll back the consumer |

**Downstream checks.** This path has **never run in production**, because every agent callback so far died at the 403:
- `voicemails` has `recipient_kind='agent'`, `status='stored'` and `source_cleanup_state='deleted'`;
- `recipient_agent_id` = the agent the TwiML used (attempt `voicemail_agent_id` → `owner_agent_id` →
  `calls.missed_for_agent_id` when there is no attempt); **superseded 2026-09-30 by §12.10 item 3** for calls without an
  attempt (`resolveOwnerCandidate` precedence; `missed_for_agent_id` is only a cross-check);
- `calls.voicemail_id` is set;
- `notified_at` is set, and a `type='voicemail'` notification exists for that agent;
- the **recipient agent** confirms the voicemail is listed and plays. An Admin's playback does not exercise the agent
  access branch. If the recipient can't confirm, this is recorded as "not verified by recipient".

**Cadence:** a read-only check when Chris next engages, then daily when engaged, for up to 7 days or until the first
new-form agent voicemail. Nothing runs automatically while the session is inactive, and this is stated as such.

## 7. Proposed AGENT_RULES.md amendment (NOT added; propose adding only after the first natural agent voicemail is verified stored)

> **Signed Twilio callback query keys and values use only `[A-Za-z0-9._-]` (Agent-voicemail callback repair,
> 2026-09-30).**
> - Twilio signs the callback URL, and our functions rebuild it from the received request. A value that any serializer
>   percent-encodes can then be canonicalized differently on each side. Examples: `:` → `%3A`, and `~` → `%7E` under
>   `URLSearchParams`.
> - Observed (the exact step was not measured): agent-mailbox callbacks carrying `%3A` failed validation 4/4, while group
>   callbacks without it were stored 14/14.
> - Encode identities as separate UUID-valued parameters (`mailbox=agent&mailbox_agent_id=<uuid>`).
> - Consumers stay backward-compatible with every previously issued signed form while it can still arrive.
> - Mixed, duplicated or mis-cased forms fail closed.
> - Signature validation is never relaxed or normalized to compensate.

## 8. Risks

- **R1 — the cause is inferred.** The new URL has the same byte property as working group URLs, and §6 proves invariance
  locally. What remains is a cause specific to agent callbacks other than the query. It is detected at the first natural
  agent voicemail (decision table).
- **R2 — deployment order.** A new producer ahead of the new consumer would lose callbacks, because v36 acknowledges the
  new form as `invalid_mailbox` and Twilio does not retry a 200. The order is therefore consumer, then producer.
- **R3 — legacy in-flight.** TwiML issued before the producer deploy keeps failing as today. The window is the greeting,
  plus up to 120 s of recording, plus processing. A 403 is not retried.
- **R4 — transfer risk.** Deploy `files` are typed into the tool call. Byte read-back of every file is the gate.
  (2026-09-30: under option B this applies to the MCP receiver deploy only; the inbound CLI upload's risks and controls
  are in §12.9.)
- **R5 — first proof is a real caller.** If the repair failed, that message would be missing from the app, as today. No
  failure path (403, a rejected query, 503) deletes the Twilio source recording; only a verified store does. Recovering
  such a recording is separately unapproved.
- **R6 — ownership hardening not included** (§3.3). Chris rules on it in §10.
- **R7 — out of scope.** The 4 lost recordings, the 12 unfinished voicemail-stage attempts (17 at 2026-09-30 14:20 UTC,
  individually listed in §12.6.3), recording recovery or
  deletion, and Task A activation. Task A stays blocked until this repair is verified.
- **R8 — Task A reconciliation (corrected).** Task A (`efa8151`) changes more than `twilio-voice-status`:
  - it adds migration `20260927052736_inbound_recent_outbound_routing.sql`, which redefines `public.plan_inbound_route`
    (a producer of `voicemail_agent_id`), plus a rollback;
  - it changes `src/integrations/supabase/types.ts` and the SQL test tooling;
  - it adds an S6 block to `inboundStages.test.ts` that pins `mailbox=agent%3A` twice.
  
  Whichever branch lands second merges cleanly as text but **fails semantically**. The S6 assertions must move to the new
  form, and Task A's full verification must be re-run after Phase 2 merges.
- **R9 — floating import.** Both entrypoints import `esm.sh/@supabase/supabase-js@2`, which is re-resolved on **every**
  deploy, recovery included. A recovery is therefore a redeploy of the v45/v36 **source**, not a restore of their
  runtime, and ezbr is not expected to match.
- **R10 — merge sequencing.** Merging to `main` may trigger the Supabase GitHub "Deploy to production" integration, whose
  state is recorded as unverified and must be re-confirmed before **any** merge, and triggers a Vercel production build.
  Therefore:
  - merge only after both approved deployments (2026-09-30 option B: MCP receiver, CLI inbound, §12.5) and their
    read-backs pass;
  - merge only with a separate approval;
  - re-confirm the integration state from the dashboard first.
  
  Until the merge, production equals the branch head, not `main`, and the WORK_LOG records this.

## 9. Production release packet (prepared after implementation and review; nothing deployed)
1. **Source commit.**
2. **Exact changed files.**
3. **`twilio-voice-inbound` package:** 10 files, per-file sha256, payload sha256 and manifest.
4. **`twilio-recording-status` package:** 2 files, the same detail.
5. **Recovery packages** (2026-09-30: the re-proof mechanism per function is stated in §12.4 G2 — `edge_payload.mjs`
   for the MCP receiver recovery, the §12.9 CLI rollback preflight for the inbound recovery): the per-file bytes read
   from live v36 and v45 by a read-only `get_edge_function`, cross-checked
   both ways against `main` @ `d675a4b`. The receiver package is re-parsed with `edge_payload.mjs verify` (the MCP
   mechanism R-RX uses); the inbound source is re-proved with the CLI rollback preflight (the mechanism R-IN uses under
   option B). Both are re-proved immediately before deploying (#29; §12.4 G2/G5).
6. **`verify_jwt = false`** for both, unchanged.
7. **Order:** `twilio-recording-status` → read-back → 15-min check → `twilio-voice-inbound` → read-back → inbound checks.
   (Superseded 2026-09-30 by §12.5, which keeps this order and adds the gates.)
8. **Byte-for-byte read-back of every file.** (Superseded 2026-09-30 by §12.5 S3/S7 and §12.8.)
9. **Stop conditions:** §12.7 only (the §6.2 decision table and checks are superseded, 2026-09-30).
10. **Recovery (SUPERSEDED 2026-09-30 by §12.6–§12.8: the drain set is the conservative set D, not "created after the
    producer deploy"; the standing 30-minute quiet period replaces "at least 15 minutes"; no blanket #32 waiver — the
    original text is kept for the record only):**
    - **Default:** inbound-only. Restore `twilio-voice-inbound` to the v45 source behind a live-version guard, with a
      read-back. The new consumer stays deployed: it accepts every legacy form, which fits AGENT_RULES #32's "compatible
      handlers stay deployed".
    - **Restoring v36 is allowed only if the consumer itself is at fault,** and only after:
      1. the producer has been restored;
      2. a drain window of at least 15 minutes (the longest greeting + 120 s recording + Twilio processing + the 5xx retry
         schedule);
      3. a read-only check that every voicemail-stage attempt created after the producer deploy has a stored `voicemails`
         row or owes no callback.
    - **The drain gate:** #32's literal §14 gate ("no open attempts/…") cannot pass while the 12 pre-existing unfinished
      attempts remain. The packet will therefore ask Chris for this release-specific drain criterion, or an explicit
      waiver, before any deployment.
11. **Residual risks** (§8), including R9 and R10.

## 10. Single next approval needed — GRANTED 2026-09-30 (see the approval block at the top)

> **Approve rev 2 for LOCAL implementation of B1 Phase 2 on `claude/b1-phase2-voicemail-callback-repair` (from `main`
> `d675a4b`)**, touching exactly files 1–13 in §4, with these rulings:
> - the B1 diagnostic is **excluded**;
> - the existing database ownership proofs (§3.3) are accepted as "continue to be proven", and the attempt cross-check is
>   **not** added now;
> - the one success log changes to `mailbox_kind`;
> - the §7 AGENT_RULES amendment is **not** added now.
>
> Commits and a push with an explicit refspec go to that branch only.
>
> **Not approved:** a PR, a merge, a deployment, any production command beyond read-only checks, a migration, recording
> recovery or deletion, and Task A activation.

## 11. Implementation and verification record (2026-09-30, local only)

**Commits on the branch.**
- `8e56b6c` and `111ea91`: P0 cherry-picks of `7d5bc36` and `49253a5`. `scripts/edge_payload.mjs` and its test are
  byte-identical to `f208f07`. The `111ea91` message was corrected to state this branch's closures, including a 2-file
  `twilio-recording-status`.
- The Phase 2 commit: code, tests, this plan and WORK_LOG.

**Files changed versus `main` `d675a4b`** (exactly §4 files 1–13):

| file | lines added / removed |
|---|---|
| `twilio-voice-inbound/planner.ts` | +24/−1 |
| `twilio-voice-inbound/stages.ts` | +9/−1 |
| `twilio-recording-status/idempotency.ts` | +58/−6 |
| `twilio-recording-status/index.ts` | +9/−11 |
| `scripts/edge_payload.mjs` | +68/−14 |
| tests (6 files; `voicemailCallbackContract.test.ts` new, 269 lines) | |
| this plan | |
| `WORK_LOG.md` | |

**Behaviour change.**
- **Producer:** new agent callbacks carry `mailbox=agent&mailbox_agent_id=<uuid>`, and group callbacks are byte-identical.
- **Consumer:**
  - accepts the new, legacy agent and group forms, and fails closed on conflicts, missing or invalid ids, casing and
    duplicate keys;
  - routes any `source` key to the voicemail handler;
  - its success log shows only `mailbox_kind`.
- **Unchanged:** signature validation, the database, storage ordering and everything else.

**Verification.**

*Tests and checks:*
- **Focused Vitest:** 205 passed and 1 skipped across 7 files. Separately, all 28 inbound, voicemail, recording and
  packaging files: 600 passed, 1 failed (the pre-existing `recordingRetentionVoicemail` "byte-identical to deployed v29"
  check, which fails identically on `main`), 2 skipped.
- **Full Vitest versus `main`:** 250 versus 249 files and 3,960 versus 3,842 tests. The 12 failing files are identical on
  both: 11 fail with "supabaseUrl is required" (environment) and 1 is the v29 comparison. 0 status changes; the added
  tests all pass.
- **Mutation controls:** 12 of 12 caught, with sources restored byte-identical. They cover:
  - the parser accepting `mailbox=agent` with no id, legacy + new together, group + id, or `AGENT:`;
  - the parser rejecting the legacy lowercase form;
  - duplicate keys accepted;
  - signature validation skipped;
  - dispatch reading only the first `source`;
  - query values in the rejection log, or the mailbox identity in the success log;
  - the producer emitting `agent%3A`, or falling back to group.
  
  An independent reviewer applied 16 further mutations, and all were caught.
- **Differential against `main` (one-off, outside the committed suite):**
  - The command bundles both `stages.ts` files with esbuild and runs 23 scenarios with identical deps. The script is
    `diff.cjs`, sha256 `8570a9cf…`, in the session scratchpad.
  - In all 23, status, masked TwiML, every RPC call and every log line are identical.
  - The only difference is the voicemail recording-callback query on the 9 agent paths. The 6 group paths are unchanged,
    and 8 non-voicemail paths have no callback.
- **App typecheck:** 90 errors, and the normalized set is identical to `main`. Root `tsc --noEmit` exits 0, but it covers
  no files (`"files": []`).
- **Exact Deno check** (Deno 2.1.4, real `esm.sh/@supabase/supabase-js@2`, which resolved to 2.117.2; `--no-config
  --no-lock`, so the repository `deno.lock` is not in effect):
  - both functions exit 1 on the branch **and** on `main`, with the same pre-existing errors: `twilio-recording-status`
    2 × TS2339 (lines 445/451 → 443/449), and `twilio-voice-inbound` TS2322 + TS2345 (planner reference 255 → 278);
  - the normalized error text is byte-identical, with **0 new** errors. This is a baseline comparison, not a clean pass.
- **PostgreSQL 17.6** (local, `plpgsql.variable_conflict = error`): `scripts/run_inbound_sql_tests.sh` exits 0. All
  inbound and v2 suites pass, including `inbound_voicemails`, the voicemail listen/cleanup suite, the barrier proofs and
  the rollback proof. Migrations and SQL tests are identical to `main`.

*Packages* (`edge_payload.mjs build` + `verify`, both PAYLOAD VERIFIED):
- **`twilio-recording-status`:** 2 files, manifest `125a3cd8…`, payload `5b33d169…` (59,398 B).
- **`twilio-voice-inbound`:** 10 files, manifest `22c56d17…`, payload `31d1cf5a…` (214,531 B, 1,463 non-ASCII characters).
  The closure equals the live file set, and 8 of the 10 files are byte-identical to live v45.

*Recovery packages* (from a fresh read-only `get_edge_function`, compared both ways with live, 0 differences, re-parsed
by `edge_payload.mjs verify`):
- **v36:** manifest `0893d95c…`, payload `73e1f28f…`.
- **v45:** manifest `6aeaeee6…`, payload `f3c1f0e1…`.

*Adversarial review of the final diff* (4 lenses, each with a skeptic): 7 findings, 6 confirmed (all minor, none a
behaviour defect), 1 refuted. Fixed:
- the stale plan status;
- the S7 test now pins the exact query on 16 producer paths, adding group wave suppressed, no attempt with no owner,
  mobile with no `agent_id` (`mailboxForAttempt`), and group stage_mismatch while still ringing;
- the TwiML differential recorded above;
- the cherry-pick commit message.

**Not done and not claimed:**
- no deployment;
- no production write;
- no controlled call;
- no live test;
- no production verification;
- no PR or merge.

**Follow-ups (separate approval):**
- the attempt / `voicemail_agent_id` ownership cross-check (defense in depth);
- the §7 AGENT_RULES amendment, after the first natural agent voicemail is verified stored;
- Task A's S6 assertions move to the new form when the branches reconcile.

## 12. Production release — approved with execution conditions (2026-09-30); corrected procedure; NOT EXECUTED

This section implements Chris's 2026-09-30 production approval (summary at the top of this plan; verbatim text in
§12.11). **§12.7 is the only failure/action table in force**, and §12.5 is the only observation procedure. They
supersede §6.2's `created_at` classification, its post-deploy step lists and its first-callback decision table, and §9
items 7–10 (each marked in place). §6.2's downstream checks remain as evidence detail, used by §12.10. Everything below
was established read-only: nothing was deployed, written or changed in production. It was adversarially reviewed on
2026-09-30 (4 lenses, each finding challenged by an independent skeptic), and every confirmed finding is applied here.

### 12.1 Execution state — BLOCKED before the first deployment

Deployment may start only when **U1, U2 and U3** are cleared. U4 is needed only before the S11 record commit.

**U1 — the operator for the file-based `twilio-voice-inbound` upload and its rollback (access).** Verified 2026-09-30
14:10–14:30 UTC in this session's container:
- there is no `supabase` CLI binary, `SUPABASE_ACCESS_TOKEN` is unset, and `~/.supabase` holds only telemetry (no login
  token);
- the environment's egress policy **denies** `api.supabase.com` and `jncvvsvckxhqgqvkppmj.supabase.co` (proxy `CONNECT`
  403), so a CLI here could not reach the Management API even with a token.

Chris's condition: the first deployment must not start while the second deployment **or its recovery** depends on
unavailable access. Therefore `twilio-recording-status` is **not** deployed either.

To clear U1, one operator is named who does all of the following:
- (a) passes runbook block G (§12.9) before S1, which proves the pinned CLI, both pristine pinned clones, authentication
  and the live version;
- (b) runs the forward upload at S6;
- (c) stays able to run R-IN (block (b)) for the whole **recovery-availability period**. It starts at S6 and ends at
  the earliest of three points: S9 has been classified under §12.7 (the first new-form agent callback) **and** the first
  natural inbound calls have shown that F6 does not apply; Chris explicitly ends it; or 7 days have passed (§6.2's
  cadence).
- The scoped token is revoked only at the end of that period. If the operator's shell or token has lapsed inside the
  period, R-IN starts from block 0 in a fresh shell. After the period, or whenever the operator cannot run R-IN, a
  producer fault is **stop and escalate**, and Chris must accept that before S1.

There are two routes to clearing U1, and neither involves pasting a token into chat, source or commits:
1. **Chris runs the CLI** on his own machine in `bash` with the §12.9 runbook, typing a scoped token only into his own
   terminal. This session runs every other gate, the MCP receiver deploy, every MCP read-back and every observation.
2. **A Claude session with its own access.** Chris adds a scoped Supabase token as an environment secret and allows
   `api.supabase.com` in the environment's network settings. A **new** session is needed to pick the secret up. That
   session then needs a reviewed **non-interactive** variant of the runbook, written and reviewed before execution,
   with its sha256 recorded here. The variant must meet three requirements:
   - it runs blocks 0–2 + G + (a) as one script, and blocks 0–2 + (b) as another, so that state such as `$WORK`, `$SB`,
     `CLI_OK` and the guard functions carries over;
   - it takes the token from the environment secret instead of `read`;
   - under `-e`, it captures each deploy's exit status (`rc=0; ( … deploy … ) … || rc=$?`), so that the upload-set,
     guard and read-back checks still run and produce the evidence F6, F15 and F17 need.

**U2 — #32 and the two recoveries (rulings).** The executable drain gate (`RELEASE_READINESS.md` §4, the §14
replacement #32 points to) was run read-only at 2026-09-30 ~14:25 UTC:

| check | owed |
|---|---|
| a1 open route attempts (any age) | **17** |
| a2 v2-owned calls not terminal | 0 |
| a3 organizations still on v2 | **1** |
| b1 voicemails pending or failed | 0 |
| b2 voicemails stored but not notified | 0 |
| b3 source deletion still owed | 0 |
| c1 missed-call notifications owed (snapshot) | 0 |
| c2 missed-call notifications owed (unresolved v2) | 0 |
| d1 / d2 / d3 retry budgets exhausted | 0 / 0 / 0 |

- **a1 = 17** are old stalled attempts. Each is individually identified in §12.6.3 with the evidence that it cannot
  produce a new-form callback, so the release-specific exclusion Chris allowed can cover them (re-proved at the time of
  any restore).
- **a3 = 1** is Chris's organization on `routing_engine='v2'` (WORK_LOG 2026-09-19). It is **not** an old stalled record,
  so the exclusion does not cover it. The gate's own rule 1 ("flag first": `set_inbound_routing_engine('legacy')`) is a
  production configuration write that is **not** authorized, and it would switch every new inbound call of that
  organization to the legacy engine.

Two rulings are needed:
- **U2(a) — receiver restore (R-RX).** As ruled, restoring the `twilio-recording-status` v36 source cannot pass #32,
  before or after the producer cutover, because a3 cannot reach zero. The gate's stated rationale (rule 5: an earlier
  version would route v2 recipients through legacy tiers) concerns **pre-v2** handlers, whereas v36 is the current v2
  receiver. That reading is not relied on here. Chris either:
  - rules that a3 does not apply to restoring the v2-era v36 receiver, so R-RX becomes available under §12.8; or
  - accepts explicitly that **any receiver fault is stop and escalate**. The new receiver would then stay in place even
    if broken: 5xx answers keep the Twilio source, while 200-acknowledged failures lose app-side storage and keep the
    source at Twilio.

  If R-RX is permitted, it still needs the RELEASE_READINESS.md §4 drain script to be zero, except the §12.6.3 records
  and a3, **and** the 30-minute quiet period, **before S6 as well as after it**. The only alternative is for Chris to
  rule the pre-S6 restore exempt. At that point no new-form instruction can exist, but outstanding legacy or group work
  (for example a `failed` voicemails row, b1) is still "relevant outstanding work".
- **U2(b) — producer rollback (R-IN).** This plan reads Chris's "A producer fault may trigger the exact inbound-only
  rollback" as a release-specific authorization to run R-IN **without** the §4 drain gate and the 30-minute quiet period.
  The grounds: v45 differs from the new producer only in the agent recording query, every stage callback in flight is
  handled identically, and the new receiver stays deployed and accepts every legacy form. **Chris confirms or rejects
  this.** If rejected, R-IN is unavailable, a producer fault is stop and escalate, and the second deployment would then
  have no recovery. U2(b) therefore blocks the first deployment.
- **The standing 30-minute quiet period** (RELEASE_READINESS §4 rule 2) replaces §9 item 10's "at least 15 minutes"
  for **R-RX**. It starts only after every §4 count is zero except the individually excluded §12.6.3 records (and a3
  only as U2(a) rules). It is never proof on its own. Its application to R-IN is U2(b).

**U3 — the entrypoint under option B (confirmation).** The CLI records the inbound entrypoint and file names as
`supabase/functions/…`, where live v45 has `functions/…` (§12.9). This holds for the forward upload **and** for R-IN.
The entry module (`twilio-voice-inbound/index.ts`), every file's bytes and `verify_jwt` are identical, but the recorded
entrypoint string, raw names and ezbr change. This plan reads "Preserve entrypoints" as "same entry module and same
bytes". Chris confirms that reading before S1. The receiver keeps `functions/twilio-recording-status/index.ts` exactly
(MCP, §12.5 S2).

**U4 — AGENT_RULES record of the CLI deploy quirks (before S11 only).** AGENT_RULES §9 requires recording a newly found
deploy quirk in AGENT_RULES.md in the same commit. §12.9 documents such quirks: the path prefix and ezbr change, a
missing slug deploying every function, an untracked `deno.json` being uploaded silently, and download overwriting local
files. Only the plan and WORK_LOG are authorized, so Chris either authorizes an AGENT_RULES.md edit in the S11 commit
or defers it explicitly to a separate approved change.

### 12.2 Records re-read for conflicts (2026-09-30)

AGENT_RULES.md, VISION.md and the newest WORK_LOG entries (origin/main `5fc4649` and this branch) were re-read.
- `origin/main` advanced to `5fc4649` (#397, Main Dialer appointment writer, frontend only).
  - `git diff --quiet d675a4b 5fc4649 -- supabase/` is clean.
  - AGENT_RULES differs only in the #22/#23 appointment bullets, so there is no conflict with the packages.
  - Merging later will conflict textually in `WORK_LOG.md` only. Both branches add a top entry; keep both, newest first.
- No freeze, and no other pending telephony release.
  - Task A stays unapplied and undeployed. Its migration redefines `plan_inbound_route`, and its S6 test pins
    `mailbox=agent%3A` (R8).
  - B1's package and its conditional v36 restore are void and must never be deployed.
- **#30, #4 and AGENT_RULES §11 name the MCP as the deploy path.** Chris's explicit option-B approval is the authority
  for the CLI upload. The CLI quirks it brings are U4 (AGENT_RULES §9).
- **#28:** production stays read-only except the two approved Edge deployments and the approved recoveries.
- **#29 (re-parse by the exact recovery mechanism):**
  - The **receiver** recovery artifact is re-proved with `edge_payload.mjs verify`, the MCP mechanism R-RX uses (G2).
  - The **inbound** recovery source is re-proved for the **CLI** mechanism R-IN uses, in two ways:
    - the 2026-09-30 CLI 2.118.0 runs against a local stand-in API (§12.9; upload set = manifest `6aeaeee6…`), a
      limitation stated here;
    - `preflight.sh <fresh d675a4b clone> rollback` in runbook block G before S1 and again at S5 (G5), repeated in
      block (b) at R-IN.
- **#30 reporting:** nothing is described as passed without evidence.
- VISION.md has nothing on voicemail, and no outbound, bridge or telemetry path changes.

### 12.3 Artifacts and isolated checkouts (verified 2026-09-30)

These are detached `git worktree`s in this session, never a moving `main` checkout. Both were clean at 14:10–14:25
UTC. At 15:37 UTC a review tool wrote an untracked 8-file pre-P0 payload into the recovery worktree; it was moved out at
16:13 UTC, and both are clean again, which G2 re-checks each time:
- `/home/user/pin-02b8ba5` at `02b8ba5c91def63ebfe7670c33a4981dc452037b` (release source);
- `/home/user/pin-d675a4b` at `d675a4b11d6f05f1cdf39414d274439358d1b877` (recovery source = the live v36/v45 source).

The CLI operator uses **fresh** pinned clones made by runbook block G instead. These worktrees hold an ignored
`node_modules` link, which the strict preflight rejects by design.

**Every `edge_payload.mjs` build and verify, release and recovery alike, uses
`/home/user/pin-02b8ba5/scripts/edge_payload.mjs`** (sha256 `2dd893d3…4b`, the P0 version). For recovery it runs
against the `d675a4b` source tree. `d675a4b`'s own copy (`c3374d49…`) predates P0: it packages only the function
directory, drops both `_shared` modules, and must not be used.

All four artifacts rebuilt from those checkouts match the approved values:

| artifact | files | manifest | payload sha256 |
|---|---|---|---|
| release `twilio-recording-status` | 2 | `125a3cd8…` | `5b33d169…` |
| release `twilio-voice-inbound` | 10 | `22c56d17…` | `31d1cf5a…` |
| recovery `twilio-recording-status` (v36 source) | 2 | `0893d95c…` | `73e1f28f…` |
| recovery `twilio-voice-inbound` (v45 source) | 10 | `6aeaeee6…` | `f3c1f0e1…` |

MCP payload file names are `functions/<function>/…` and `functions/_shared/…`.

Live, from `list` at 2026-09-30 ~14:15 UTC:
- `twilio-recording-status` v36, ezbr `a75e7c80…fdca`, raw entrypoint `file:///tmp/user_fn_…_36/source/functions/
  twilio-recording-status/index.ts` (key `functions/twilio-recording-status/index.ts`);
- `twilio-voice-inbound` v45, ezbr `354441f2…e86f`, raw entrypoint `file:///tmp/user_fn_…_45/source/functions/
  twilio-voice-inbound/index.ts` (key `functions/twilio-voice-inbound/index.ts`);
- `twilio-voice-status` v42, ezbr `d9bbe55c…3b27`.

All three are unchanged since the recovery read. Source-byte parity of a recovery is not proof of an identical
dependency runtime: `esm.sh/@supabase/supabase-js@2` re-resolves at every deploy (R9), so a recovery is verified by file
bytes, never by ezbr.

### 12.4 Fresh production gates — immediately before EACH forward deployment

Each gate is run fresh; a previous pass is not reused. G1–G4 are run within 5 minutes of the deployment. G5 is
bounded by the runbook's enforced 10 minutes (block G's `READY`, used once). Any failure means **defer**
and report. A stale row is never closed, modified or "cleaned".

**G1 — active work (the established read-only preflight, plus enumeration).**
```sql
select now() as checked_at,
 (select count(*) from public.calls c where c.ended_at is null
    and coalesce(c.status,'') not in ('completed','failed','no-answer','busy','canceled')
    and (c.created_at > now() - interval '2 hours' or c.updated_at > now() - interval '15 minutes')) as recent_nonterminal_calls,
 (select count(*) from public.dialer_sessions s where s.ended_at is null
    and s.last_heartbeat_at > now() - interval '3 minutes') as fresh_dialer_sessions,
 (select count(*) from public.inbound_route_attempts a where not a.terminal
    and a.stage in ('owner_browser','group_browser','owner_mobile')) as open_ringing_attempts,
 (select count(*) from public.inbound_route_attempts a where not a.terminal
    and coalesce(cardinality(a.reserved_agent_ids),0) > 0) as open_reservations,
 (select max(c.ended_at) from public.calls c) as latest_call_end,
 (select count(*) from pg_stat_activity where wait_event_type = 'Lock') as lock_waiters;
-- enumeration (ids are compared with the known-stale list below):
select 'call' as kind, id, status as state, updated_at as last_change from public.calls
 where ended_at is null and coalesce(status,'') not in ('completed','failed','no-answer','busy','canceled')
union all
select 'dialer_session', id, null, last_heartbeat_at from public.dialer_sessions where ended_at is null
union all
select 'attempt', a.id, a.stage, a.updated_at from public.inbound_route_attempts a where not a.terminal
order by 1, 4;
```
- **Pass:** 0 / 0 / 0 / 0 / 0 lock waiters, `latest_call_end` at least 5 minutes old, **and** every enumerated row is on
  the known-stale list with `last_change` no later than 2026-09-30 14:20 UTC (the snapshot) or, for a row added
  later, equal to the `last_change` recorded when it was added. A listed row that has changed since is treated as
  genuinely active.
- **Known stale rows** (recorded 2026-09-30 14:16–14:20 UTC; not modified):
  - nonterminal calls `e1efade5`, `6e32c26a`, `1de66d07`, `cc6093e1`, `f70de664` (inbound `ringing`, 2026-05-28 →
    09-09) and `8e281515`, `80f78130`, `bb20dd30` (outbound `ringing`, 2026-09-29 19:37, never updated);
  - open dialer sessions `9e58d2ea`, `21393721`, `c94cc55b`, `6cd21d6c` (last heartbeat 06-04 … 09-29 19:38);
  - the 17 non-terminal voicemail-stage attempts of §12.6.3.
- **A row not on the list** counts as known stale only if its own kind's rule holds:
  - **attempt:** its parent call is terminal with `ended_at` at least 30 minutes old, and no `voicemails` row for the
    call is pending or failed;
  - **dialer session:** its last heartbeat is at least 30 minutes old;
  - **call:** created at least 24 h ago and unchanged for at least 24 h.

  Such a row is added individually to this list, with its `last_change` at that moment, as a documentation edit, before
  the gate is re-run. Anything else is treated as genuinely active: **defer**.

**G2 — the complete live function, its preimage and the recovery artifact (#4, #29).** Run `get_edge_function` (MCP,
read-only) for the function about to be deployed, and `list_edge_functions` for all three telephony functions.
- The target is at the expected version: v36 / ezbr `a75e7c80…` for the receiver deploy, v45 / ezbr `354441f2…` for
  the inbound deploy.
- It is `ACTIVE`, `verify_jwt=false`, with no import map. Its raw `entrypoint_path` **and its comparison key** are
  recorded. **Entrypoint comparison key:** the path after `/source/` in the raw value, for example
  `file:///tmp/user_fn_<ref>_<id>_36/source/functions/twilio-recording-status/index.ts` →
  `functions/twilio-recording-status/index.ts`. The raw value embeds the version, so raw values are never compared.
  Expected keys:
  - the receiver before and after S2: `functions/twilio-recording-status/index.ts`;
  - the inbound function before S6: `functions/twilio-voice-inbound/index.ts`;
  - the inbound function after the CLI upload: `supabase/functions/twilio-voice-inbound/index.ts` (U3).
- The recovery checkout is detached at `d675a4b…` with an empty `git status --porcelain`, and the release checkout the
  same at `02b8ba5…`.
- The complete file set equals the recovery artifact in both directions, byte for byte. Names are compared by the path
  after the last `functions/`, and a name with no `functions/` segment is treated as `functions/<name>`.
  - **Receiver:** re-parsed with the 02b8ba5 `edge_payload.mjs verify` against the `d675a4b` tree, the MCP mechanism
    R-RX uses.
  - **Inbound:** additionally, runbook block G's `preflight.sh … rollback` (G5), the CLI mechanism R-IN uses.
- `twilio-voice-status` is still v42 / `d9bbe55c…`. For the inbound deploy, the receiver is at the version and ezbr
  recorded at S3.
- Any other difference is **unexplained drift → stop** (F11). Intervening work is never overwritten.

**G3 — the approved package.**
- **Receiver:** from `/home/user/pin-02b8ba5`, `edge_payload.mjs build` reproduces manifest `125a3cd8…` and payload
  `5b33d169…` exactly, and the checkout is detached at `02b8ba5…` with an empty `git status --porcelain`.
- **Inbound:** the §12.9 `preflight.sh` in forward mode on the operator's fresh clone. It checks the per-file sha256
  list (the SUMS block: forward `planner.ts` `9659164e…`, `stages.ts` `8f4ab0f3…`; rollback `cc216e09…`, `77c63b44…`;
  the other 8 files are shared), the manifest `22c56d17…`, a pristine tree including ignored files, no import map or
  `deno.json`, no symlink, and `config.toml` sha256 `cc673901…`.

**G4 — baseline.** Edge-log status counts per function for the 7 days before the deployment (Q1 and Q1b below): the
reference for "previously working" paths.

**G5 — operator readiness.**
- Runbook block G prints `G5 READY` in the operator's shell **before S1**, so that U1 is closed before anything changes,
  and again **at S5**. Block G proves:
  - the pinned CLI 2.118.0 with integrity-checked lock entries;
  - both fresh pinned clones (`02b8ba5` forward, `d675a4b` rollback) passing `preflight.sh`;
  - authentication, through a read-only `functions list` run with the pinned CLI in the isolated `SUPABASE_HOME` with
    `SUPABASE_NO_KEYRING=1`;
  - live `twilio-voice-inbound` at v45.
- The operator keeps that shell open through the recovery-availability period (§12.1 U1).

### 12.5 Forward sequence

Four times are recorded:
- **T_r:** the time the new receiver's read-back passes.
- **T_p0:** the `T_p0 upload start` timestamp printed by runbook block (a).
- **V:** the new inbound version.
- **T_b:** the time R-IN's read-back passes. If there is no rollback, T_b is "now".

Steps:
- **S1.** G1–G5 pass for the receiver, with G5 = block G `READY`, and U1–U3 are cleared.
- **S2.** MCP `deploy_edge_function` `twilio-recording-status`:
  - use the pinned release payload (2 files, `functions/twilio-recording-status/…`);
  - pass the literal **`entrypoint_path` = `functions/twilio-recording-status/index.ts`** explicitly (equal to the G2
    comparison key). Never rely on the MCP default `index.ts`, which matches no uploaded name;
  - `verify_jwt=false`;
  - before submission, verify the typed `files` with `edge_payload.mjs verify` against the pinned checkout. This
    catches transcription defects of the kind that produced v43.
- **S3.** Full read-back with `get_edge_function`:
  - version advanced (expected 37), `ACTIVE`, `verify_jwt=false`, no import map;
  - entrypoint comparison key equal to G2's (`functions/twilio-recording-status/index.ts`);
  - exactly the 2 files, byte-identical to `125a3cd8…` by the path after the last `functions/`;
  - record the version, ezbr and T_r. A mismatch is F2.
- **S4.** 15-minute observation (Q1):
  - no receiver 5xx or boot error, apart from F5-classified downstream 503s;
  - group and no-source callbacks still 200;
  - no `invalid_*`, `conflicting_mailbox`, `duplicate_param` or `not_voicemail` rejection.

  Zero traffic is recorded as **no evidence** (F13), not a pass. The sequence may continue after 15 minutes if no stop
  condition was observed.
- **S5.** Re-run G1–G5 for the inbound deploy, with block G `READY` again.
- **S6.** The operator runs runbook block (a), first setting `RX_EXPECTED` only if S3 recorded a version other than 37. The upload runs only inside its
  `if`, after `CLI_OK`, a fresh `G5 READY` (≤10 minutes, used once), `GUARD OK twilio-recording-status v<RX_EXPECTED>`,
  `PREFLIGHT OK` and `GUARD OK v45`. Record T_p0 from its output. No manually transcribed inbound upload.
- **S7.** Full read-back, done twice: the operator's `functions download` + `readback.sh` (block (a) prints
  `READBACK OK (forward)`), and this session's MCP `get_edge_function`. Both must show:
  - version advanced (expected 46), `ACTIVE`, `verify_jwt=false`, no import map;
  - entrypoint comparison key `supabase/functions/twilio-voice-inbound/index.ts` (U3);
  - exactly the 10 files, both `_shared` modules included, byte-identical to `22c56d17…` by the path after the last
    `functions/`;
  - record the version and ezbr.

  A mismatch, a missing or extra file, an import map, or a changed `verify_jwt` is F6.
- **S8.** Inbound observation on the next natural calls:
  - `twilio-voice-inbound` 200, with no boot error or 5xx;
  - the call row and route attempt are created and progressing;
  - Q1b shows the new version V serving;
  - the `twilio-voice-status` mix is recorded, but a change alone is not a regression (F12).
- **S9.** The first new-form agent voicemail: §12.7 decides, and §12.10 lists the evidence.
- **S10.** Read-only `get_advisors` (security and performance). Pre-existing findings are reported unchanged, and none
  is mutated.
- **S11.** A WORK_LOG entry with the actual results. Commit and push this plan and WORK_LOG only (plus AGENT_RULES.md
  only if U4 authorizes it).

**Q1 — recording-status callback format and per-function status (read-only log query; values are never printed).**
```sql
select log_attributes['function_id'] as fn, log_attributes['version'] as ver,
 multiIf(log_attributes['function_id']!='6eb57066-b643-43f4-b939-e5370f1567a8','-',
         position(log_attributes['request.search'],'mailbox_agent_id=')>0,'new_agent',
         position(log_attributes['request.search'],'mailbox=agent%3A')>0,'legacy_agent_pct',
         position(log_attributes['request.search'],'mailbox=agent:')>0,'legacy_agent_raw',
         position(log_attributes['request.search'],'mailbox=group')>0,'group',
         position(log_attributes['request.search'],'source=')>0,'other_source',
         log_attributes['request.search']='','no_query','query_no_source') as fmt,
 log_attributes['response.status_code'] as status, count() as n, min(timestamp) as first, max(timestamp) as last
from logs where source='function_edge_logs'
 and log_attributes['function_id'] in ('6eb57066-b643-43f4-b939-e5370f1567a8',   -- twilio-recording-status
                                       '5453fa38-8e88-4ee3-9451-af17ea62f253',   -- twilio-voice-inbound
                                       'b8e88cd0-7f18-4f13-b732-ec9e9fb655fb')   -- twilio-voice-status
group by fn, ver, fmt, status order by fn, fmt, status
```

**Q1b — `twilio-voice-inbound` initial versus staged requests, by version (read-only).**
```sql
select log_attributes['version'] as ver,
 if(log_attributes['request.search']='','initial','staged') as kind,
 extract(log_attributes['request.search'],'stage=([a-z_]+)') as stage,
 log_attributes['response.status_code'] as status, count() as n, min(timestamp) as first, max(timestamp) as last
from logs where source='function_edge_logs' and log_attributes['function_id']='5453fa38-8e88-4ee3-9451-af17ea62f253'
group by ver, kind, stage, status order by ver, kind, stage
```

Q1 and Q1b were validated on real data on 2026-09-30 (Q1b, 2026-09-24 window: v45 served 20 `initial`, 1
`owner_browser` and 9 `voicemail_done` requests):
- The 2026-09-24 window shows 2 `legacy_agent_pct` callbacks answered 403 by v36 and 7 `group` callbacks answered 200.
- Edge logs carry `version`, `request.search`, `response.status_code` and `execution_id`.
- Retention reaches at least 7 days, and the MCP query window is 24 h per query.

**Q2 — per-call pairing (read-only; call ids are hashed in the output).** The `<Record action>` request
(`?stage=voicemail_done&call_row_id=…`) and the recording-status callback (`?…call_row_id=…`) share `call_row_id`. Each
recording end can therefore be paired with its callback and format. Measured on 2026-09-24 (n = 9): the callback came
1.0–6.7 s after `voicemail_done`. That is an observation, not a bound; Twilio documents none.

### 12.6 The conservative drain set (replaces §9 item 10's "created after the producer deploy")

The drain set is evaluated only before an R-RX after S6. It is available only as U2(a) rules.

**12.6.1 Why created-after is wrong.** New-form instructions are produced by **any** request that the new
`twilio-voice-inbound` version serves, not only by calls created after the deploy. From source (`twilio-voice-inbound`
differs only in the agent query):
- Agent-mailbox TwiML is emitted by the initial webhook: owner voicemail, wave suppression, planner failure, the
  no-attempt fallback and a duplicate webhook.
- It is also emitted by the `owner_browser` and `owner_mobile` stage callbacks. These reach calls created up to about
  4–5 minutes earlier: the browser rings for ≤120 s, and the mobile leg for ≤120 s plus the whisper.
- Group, legacy-engine and conversation-recording URLs are byte-identical across the release.

**12.6.2 Set D: every call that could have received new-form voicemail instructions.** V is the new inbound version.
Its serving interval runs from **T_lo = min(T_p0, the first Q1b row with version V)** to **T_hi = max(T_b, the last Q1b
row with version V)**.
- **D1 — every request V served that names a call (log-attributable).** Every `call_row_id` in the query of a V-served
  `twilio-voice-inbound` request, whatever its stage. This covers calls already in progress at cutover and every later
  voicemail stage transition. `owner_browser` and `owner_mobile` can emit agent voicemail; `group_browser`,
  `voicemail_done`, the mobile stages and the legacy fallbacks are included anyway. Every non-initial request carries
  `call_row_id`.
- **D2 — initial webhooks, which are not attributable by query (the call is only in the POST body).** Every inbound call
  whose row was created in [T_lo − 1 min, T_hi + 1 min], **with or without an attempt row**. Planner failure and the
  no-attempt fallback write no attempt, and the no-attempt path writes nothing at all.
  - The number of V-served `initial` requests (Q1b) must not exceed the D2 calls. That is a necessary consistency check,
    **not** a completeness proof.
  - Any V-served initial request that cannot be matched to a D2 call makes D **UNKNOWN**.
- **D3 — calls in progress at cutover, even without an attributable request.** Every inbound call created before
  T_lo − 1 min that was not terminal at T_lo.
- **D4 — delayed or retried recording callbacks.**
  - every call referenced by a `new_agent` callback;
  - every recording owed by a D member whose callback has not yet been observed (each `record_action` RecordingSid and
    each `voicemail_done`);
  - every callback for a D member answered 5xx. Twilio retries only within ≤15 s, and only for 5xx, connect or
    read-timeout failures.

**Log completeness (needed for any "no V-served request" conclusion).** Absence of a log row is used only after a
positive completeness check, evaluated at the end of the quiet period so that ingestion has settled. Every
database-visible event after T_lo must have a matching logged `twilio-voice-inbound` or `twilio-recording-status`
request. Those events are:
- `provider_outcomes` entries with `at` ≥ T_lo;
- `record_action` / `voicemail_done` outcomes;
- missed marks;
- `voicemails` rows.

An unmatched event, or a check that cannot be run, makes the affected members **UNKNOWN**.

**Member classification.** Each member gets exactly one class, using evidence from Q1/Q1b/Q2, the RELEASE_READINESS
§4 drain script, the per-recording work-finished predicate below, and `inbound_route_attempts` / `calls`.
- **NO-NEW-FORM (proven)**, by any one of:
  - a D3 member for which the completeness check passed and no V-served request names it;
  - a call that never reached an agent-mailbox path: answered in the browser (`final_outcome='browser_answered'`),
    mobile-bridged, or `routing_engine='legacy'` (whose voicemail URL has no query);
  - a call whose only recording callbacks were observed in `legacy_agent_pct` or `group` format.

  An attempt in `mode='group'` is **not** proof on its own for a D1/D2 member. A group attempt can be committed while
  every reply is lost, after which the planner-failure path emits agent voicemail with no attempt id. Such a member also
  needs executed-format evidence (a group-format callback, or its `voicemail_done` observed without `agent_id`), or
  complete function logs showing no `plan_inbound_route FAILED` / `returned no attempt` line for the call. Otherwise it
  is **UNKNOWN**. A D2 member is never NO-NEW-FORM on timing alone.
- **FINISHED.** Every recording the call owes (each `record_action` RecordingSid, and each observed callback) has a 200
  callback answered by the new receiver, **and** the work-finished predicate holds:
  - `voicemails.status` is `stored` (or `purged`);
  - `source_cleanup_state='deleted'`, with a valid `provider_account_sid`;
  - `notified_at` is set;
  - `calls.voicemail_id` is set;
  - the storage object is present, unless purged;
  - for an agent mailbox, the recipient equals the expected agent (§12.10).

  A stored row alone is **not** FINISHED.
- **PENDING.** Anything owed and not finished:
  - a `record_action` without a `voicemails` row;
  - a callback answered 5xx;
  - a `failed` or `pending` row;
  - cleanup not `deleted`;
  - a notification not converged;
  - a stored row without its call link or object.
- **UNKNOWN.** Everything else, including missing or expired logs, a failed completeness check, an unmatched initial
  request, and a caller who may have hung up mid-record without a `voicemail_done`. **Missing evidence is never "nothing
  owed".**

**Restore rule.** v36 may be restored after S6 only when all of the following hold:
1. U2(a) permits R-RX.
2. R-IN is verified (T_b).
3. D has **no PENDING and no UNKNOWN** member.
4. The RELEASE_READINESS.md §4 drain script is zero, except the individually excluded §12.6.3 records (and a3 as U2(a)
   rules).
5. The 30-minute quiet period has then elapsed with no `new_agent` callback.
6. The R-RX pre-deploy checks, guard and full read-back (§12.8) pass.

Otherwise: **stop and escalate**, and the new receiver stays.

**12.6.3 Individually identified old stalled records (release-specific #32 exclusion; no blanket waiver).** These are
the 17 non-terminal attempts at 2026-09-30 ~14:20 UTC. The evidence relied on:
- **Age.** Each parent call ended 14 hours to 6 days before the snapshot. That is far beyond the observed
  recording-callback lag (Q2: 1.0–6.7 s), Twilio's ≤15 s retry window, and Twilio's 10-minute "stuck processing"
  heuristic.
- **Issued by v45.** Their routing and voicemail TwiML was issued by v45, the only inbound version since 2026-09-18.
  Any callback they could still produce is therefore fixed in `group` or legacy-agent format, which both receivers
  handle identically.
- **Sweep-written end times.** For the 6 `no-answer` rows, `ended_at` was written by the stale-call sweep, not by Twilio,
  so it is not relied on as Twilio evidence. Age and v45 issuance are the grounds.
- **Re-proved at any restore.** No V-served request may name their `call_row_id` / `attempt_id`, each row's
  `updated_at` must still be at or before 2026-09-30 14:20 UTC, and there must still be no `voicemails` row. Any other non-terminal attempt, or any change to these, is
  not excluded.

Closing them remains unapproved (#28; RELEASE_READINESS §4 rule 3).

| attempt | stage / mailbox | attempt created (UTC) | call status | call ended (UTC) |
|---|---|---|---|---|
| `e035d1b2` | group_voicemail / group | 09-24 16:13:47 | no-answer | 09-24 16:44:00 |
| `790aa5ca` | group_voicemail / group | 09-24 18:09:59 | completed | 09-24 18:10:01 |
| `db533d3b` | group_voicemail / group | 09-24 18:10:19 | completed | 09-24 18:10:25 |
| `16b95886` | group_voicemail / group | 09-24 18:10:34 | no-answer | 09-24 18:42:00 |
| `00cbca0e` | group_voicemail / group | 09-24 18:30:31 | completed | 09-24 18:30:38 |
| `5f52aadd` | group_voicemail / group | 09-24 21:16:26 | completed | 09-24 21:16:33 |
| `123d3039` | group_voicemail / group | 09-24 21:50:41 | completed | 09-24 21:50:41 |
| `95c70185` | group_voicemail / group | 09-25 02:06:04 | no-answer | 09-25 02:38:00 |
| `7a52a8bf` | group_voicemail / group | 09-25 20:54:45 | completed | 09-25 20:55:03 |
| `d6a6c1ae` | owner_voicemail / agent | 09-26 00:00:25 | no-answer | 09-26 00:32:00 |
| `3c3c0e71` | group_voicemail / group | 09-26 01:27:17 | no-answer | 09-26 01:58:00 |
| `881c080a` | owner_voicemail / agent | 09-26 18:32:25 | no-answer | 09-26 19:04:00 |
| `72b306f3` | owner_voicemail / agent | 09-28 17:35:44 | completed | 09-28 17:35:54 |
| `02dfccd9` | group_voicemail / group | 09-28 19:11:13 | completed | 09-28 19:11:14 |
| `3f6b0d9b` | group_voicemail / group | 09-29 21:52:14 | completed | 09-29 21:52:21 |
| `8e90a7eb` | owner_voicemail / agent | 09-29 22:08:16 | completed | 09-29 22:08:48 |
| `1b667239` | group_voicemail / group | 09-29 23:59:46 | completed | 09-29 23:59:48 |

### 12.7 The single failure/action table

Rows are mutually exclusive and are evaluated in this order: F11, F15, F17, F5, then the rest. A 503 counts toward F3/F4
only when it is shown **not** to be explained by a downstream dependency (F5).

**Receiver-fault rule after S6 (F2/F3/F4/F14).** **Stop and escalate**, with both new functions left in place. R-IN is
authorized by U2(b) for producer faults only, so after a receiver fault it runs only on Chris's explicit instruction
(for example as the first step of an R-RX he has cleared under U2(a) and §12.6).

| # | Observed evidence | Meaning | Action |
|---|---|---|---|
| F1 | A §12.4 gate or U1–U3 fails before a forward deployment | not ready | Do not deploy. Report the failing gate. |
| F2 | With the new receiver version live: a read-back mismatch in bytes, file set, entrypoint, `verify_jwt` or import map (a version that did not advance is F17) | corrupt receiver deployment | Stop the sequence. **Before S6:** R-RX if U2(a) permits it, otherwise stop and escalate. **After S6:** the receiver-fault rule above. |
| F3 | Receiver boot failure, or a 5xx not explained by a downstream dependency | receiver fault | As F2. |
| F4 | Verified regression in a previously working recording path. Any of: a group or no-source callback answered non-200 (other than an F5 downstream 503) where the G4 baseline shows 200; a group or no-source callback answered 200 with `invalid_*`, `conflicting_mailbox`, `duplicate_param` or `not_voicemail`; a group voicemail that does not reach the work-finished predicate beyond the sweep cadence; a conversation recording that is not stored-verified | receiver regression | As F2. |
| F5 | A callback answered **503** by a downstream step (download, upload, persist, cleanup, ownership), with the Twilio source preserved | retryable downstream failure | Investigate read-only, with source preservation and Twilio retries intact. **Not** evidence against the URL repair; no automatic rollback of either function. Escalate if it persists. |
| F6 | With the new version live (v46): an inbound read-back mismatch, a boot failure or 5xx on `twilio-voice-inbound`, or calls or attempts not created or not progressing | producer fault | Exact inbound-only rollback R-IN by the same operator, **only as U2(b) permits**; otherwise stop and escalate. The new receiver stays. |
| F7 | A `new_agent` callback answered 200 with `invalid_mailbox_agent_id`, `invalid_mailbox`, `conflicting_mailbox` or `duplicate_param` | producer/parser mismatch | A producer fault: R-IN as in F6. The receiver stays; it fails closed, and the source stays at Twilio. |
| F8 | A `new_agent` callback answered **403** | the repair is ineffective in production, but there is no regression (legacy agent callbacks get 403 today) | Keep both deployed. Report and investigate separately. Not a pass. |
| F9 | A `legacy_agent_pct` callback answered 403 after S6 | TwiML issued by v45 (shown by the format): in-flight residual | Expected. Record it; no action. |
| F10 | A callback whose format cannot be determined (no log row, expired retention, unparseable) | unknown | Record as unknown. Never counted as a pass, as legacy or as finished. |
| F11 | A version or file change not made by this release (any telephony function), or a target at a version that is neither its pre-deploy version nor the expected new version | unrelated live drift | **Stop.** Do not overwrite; report. |
| F12 | A changed status mix alone (for example `twilio-voice-status` counts) | not proof of a regression | Investigate read-only. Act only if F2–F7 is established. |
| F13 | No traffic in an observation window | no evidence | Record "no evidence". Never a pass. |
| F14 | A receiver fault after S6 where §12.6's restore rule or U2(a) cannot be satisfied | safe receiver restoration not established | Keep the new receiver. **Stop and escalate.** R-IN only on Chris's explicit instruction. Never acknowledge and lose pending new-form callbacks. |
| F15 | A recovery deploy (R-IN or R-RX) exits non-zero, or its guard, upload set or read-back fails | failed recovery | Stop all deployment writes. Record the live version and files, and escalate to Chris. Never retry with another package or with the forward package. |
| F16 | A `new_agent` callback answered 200 **without** a stored `voicemails` row for a reason other than the F7 codes (`unmatched`, `ignored`, a malformed RecordingSid) | agent store path not completed; this path has never run in production | Keep both deployed. The source is preserved at Twilio. Investigate read-only. Classify as a producer or receiver fault only on evidence from the logged reason; otherwise **stop and escalate**. |
| F17 | After a forward deploy (S2 or S6), the live version is **still the pre-deploy version**, whatever the exit status | nothing was deployed | Stop and report. There is nothing to roll back: no R-IN or R-RX over an unchanged version. A non-zero exit with live at the expected new version continues to the S3/S7 read-back (F2/F6 on a mismatch). |

**Success at S9:** a `new_agent` callback answered 200 and stored is not a fault. Run the §12.10 checks.

### 12.8 Recovery procedures (live-version guard and full read-back on every recovery)

**R-IN — inbound-only rollback.**
- **When:** producer faults (F6, F7), only as U2(b) permits. After a receiver fault, only on Chris's explicit
  instruction. Block (b) must be armed by hand with `R_IN_REASON` (`F6`, `F7` or `chris`).
- **Operator and source:** the same CLI operator (U1), within the recovery-availability period. The source is a fresh
  clone pinned to `d675a4b…`, never `main`, checked by `preflight.sh … rollback` against manifest `6aeaeee6…`. In a
  fresh shell, blocks 0–2 are re-run first.
- **Guard:** block (b) with `EXPECTED_LIVE` = the version recorded at S7 (default 46; set before pasting only if S7
  recorded another value, or on Chris's instruction). Anything else is F11. The upload runs only inside block (b)'s `if`, and it prints the R-IN start time
  and reason.
- **Read-back, done twice** (the operator's `readback.sh` in rollback mode, and MCP `get_edge_function`):
  - version advanced, `ACTIVE`, `verify_jwt=false`, no import map;
  - entry module `twilio-voice-inbound/index.ts`;
  - exactly the 10 files, byte-identical to `6aeaeee6…` by the path after the last `functions/`.

  Record T_b. Neither the ezbr nor the recorded path prefix is expected to equal v45's (R9, U3). Any failure is F15.
- **The new receiver stays.** It accepts every legacy form (§3.2) and keeps new-form callbacks that were already issued
  processable.

**R-RX — receiver restore to the v36 source.**
- **Before S6** (the producer is still v45, shown by the G2 guard and by Q1b showing no request served by any version
  other than v45): no new-form instruction can exist, so the compatibility condition holds. The #32 condition is
  **U2(a)**: R-RX must be permitted, the RELEASE_READINESS §4 drain script must be zero except the §12.6.3 records and
  a3, and the 30-minute quiet period must have elapsed, unless Chris rules the pre-S6 restore exempt.
- **After S6:** only under §12.6's restore rule, after R-IN, and as U2(a) permits.
- **Pre-deploy checks,** within 5 minutes before the deploy:
  - `list_edge_functions` for all three telephony functions;
  - `twilio-voice-inbound` at exactly the version and ezbr recorded at T_b, with a byte read-back equal to `6aeaeee6…`
    (suffix-compared), when after S6;
  - `twilio-voice-status` at v42 / `d9bbe55c…`;
  - when after S6, Q1b shows no `twilio-voice-inbound` request since T_b from any version other than the T_b version.

  Any difference is F11.
- **Mechanism:** MCP `deploy_edge_function` with the pinned recovery payload (`73e1f28f…`, 2 files), verified with
  `edge_payload.mjs verify` before submission, and with the literal **`entrypoint_path` = `functions/twilio-recording-status/index.ts`**
  (the v36 comparison key recorded at G2). The guard is the version and ezbr recorded at S3 (expected 37).
- **Full read-back** (the S3 standard):
  - version advanced (expected 38), `ACTIVE`, `verify_jwt=false`, no import map;
  - entrypoint comparison key equal to v36's (`functions/twilio-recording-status/index.ts`);
  - exactly the 2 files, byte-identical to `0893d95c…` by the path after the last `functions/`;
  - record the version, ezbr and time. Any failure is F15.
- **If the conditions cannot be established:** stop and escalate. Do not restore; the new receiver stays.

### 12.9 CLI mechanics and operator runbook (researched and gate-tested 2026-09-30; not run against production)

**Evidence.**
- Supabase CLI source at tag `v2.118.0` (npm `latest`, published 2026-09-25).
- The real CLI 2.118.0 was run against a local stand-in API with a dummy token and project. There was no Supabase,
  GitHub or Vercel contact.
- The real API's live guard and download were **not** exercised.

**What the CLI does.**
- **Upload set.** `functions deploy twilio-voice-inbound --use-api` walks the relative imports from the entrypoint with
  a regex scanner. It uploads exactly the 10 approved files, both `_shared` modules included and nothing else,
  byte-identical.
  - The captured multipart requests reproduce manifest `22c56d17…` (forward), `6aeaeee6…` (rollback clone) and
    `125a3cd8…` (receiver).
  - Re-checked independently: the runbook's manifest formula over the pinned checkouts gives `22c56d17…` and
    `6aeaeee6…`.
- **Metadata sent:**
  - `entrypoint_path` `supabase/functions/twilio-voice-inbound/index.ts`;
  - `import_map_path` `""`;
  - `static_patterns` `[]`;
  - `verify_jwt` `false`, from `--no-verify-jwt` and also from `supabase/config.toml` (sha256 `cc673901…`, identical at
    both commits).
- **No import map is involved.** No `deno.json`, `deno.jsonc`, `import_map.json` or `package.json` exists under
  `supabase/` at either commit, and `deno.lock` is never read.
- **The path prefix changes (U3).** The CLI records files and the entrypoint as `supabase/functions/…`, whereas the
  MCP-era deploys used `functions/…`.
  - Read-backs therefore compare by the path after the last `functions/`, never by raw names.
  - The ezbr changes too.

**Hazards the runbook closes.**
- Omitting the slug deploys every function, and `--prune` deletes remote functions. The slug is always given, and
  `--prune` is never used.
- Omitting `--use-api` can take the local Docker/eszip path.
- An untracked `deno.json` or import map is silently uploaded (negative control: 11 files, exit 0). The preflight
  requires a pristine tree, including ignored files.
- Without `--workdir`, the CLI searches upward and could deploy a moving checkout.
- `functions download` overwrites local files, so it runs in a throwaway workdir.
- A stored classic token from `supabase login` could be picked up. The runbook uses an isolated `SUPABASE_HOME` and
  `SUPABASE_NO_KEYRING=1`.

**Token.** Use a scoped personal access token for this organization and project:
- Edge Functions read-write (optionally Project Settings read);
- the shortest expiry that covers the recovery-availability period;
- typed only into the operator's own terminal (`read -rs`), never into chat, source or commits;
- revoked at the end of that period.

CLI ≥ 2.117.0 is needed for `sbp_v0_` tokens.

**Bash only.** On macOS (zsh by default), run `exec bash --noprofile --norc` first. Under zsh, `read -rs -p` exports an
empty token, and `#` comments run as commands.

**Hard gating (runbook v4).**
- Every production write runs only inside an `if` whose checks all passed; otherwise it prints `STOP … NOTHING
  DEPLOYED`. Paste one block at a time, never the whole file.
- Block 0 always discards any inherited `SUPABASE_ACCESS_TOKEN` and reads the scoped token silently.
- Block G is the G5 readiness proof and stamps `G5_AT`.
- Block (a) deploys only if all of these hold:
  - `CLI_OK`;
  - a block G `READY` from the last 10 minutes, used once;
  - the **receiver live at `RX_EXPECTED`** (the S3 version; default 37, set before pasting only if S3 recorded another
    value), which enforces receiver-before-producer;
  - the forward preflight;
  - inbound live at v45.

  It prints `T_p0 upload start` and the upload end, and captures the exit status. The post-deploy guard decides the
  class: still v45 is F17 (nothing deployed, whatever the exit status); v46 continues to the read-back (F6 on a mismatch,
  or if not `ACTIVE` / `verify_jwt=false`); anything else is F11.
- Block (b) deploys only if all of these hold:
  - `CLI_OK`;
  - a hand-set **`R_IN_REASON`** (`F6`, `F7` or `chris`), used once;
  - the rollback preflight;
  - live at `EXPECTED_LIVE` (default 46; set before pasting only if S7 recorded another value, or on Chris's
    instruction).
- Guard versions (45 → 46 → 47) assume nothing else deploys in between. Any other value is a STOP (F11).

**Gate tests** (2026-09-30, ~15:45 UTC for v2, ~16:15 UTC for v3 and ~16:27 UTC for v4; real CLI 2.118.0 with integrity-checked lock
entries, local stand-in API, live-version guards stubbed):

| case | result |
|---|---|
| guard fail (live 44) | G5 NOT READY, forward STOP, **0** uploads |
| untracked `deno.json` in the forward clone | preflight FAIL, STOP, **0** uploads |
| all checks pass | exactly **1** upload: 10 parts, 207,240 B, manifest `22c56d17…`, `verify_jwt:false`, entrypoint `supabase/functions/twilio-voice-inbound/index.ts`, `UPLOAD SET OK` |
| rollback guard fail | STOP, **0** uploads |
| rollback, all pass | exactly **1** upload: 10 parts, 205,398 B, manifest `6aeaeee6…`, `UPLOAD SET OK` |
| v3: a different token pre-exported | discarded; block 0 used the silently typed token |
| v3: receiver not yet deployed (live 36, want 37) | forward STOP, **0** uploads |
| v3: block G older than 10 minutes | forward STOP, **0** uploads |
| v3: forward pasted twice | first paste exactly **1** upload (`22c56d17…`); second paste without re-running G: STOP, **0** uploads |
| v3: rollback without `R_IN_REASON` | STOP, **0** uploads |
| v3: rollback with `R_IN_REASON=F6`, pasted twice | first paste exactly **1** upload (`6aeaeee6…`); the reason is consumed, so the second paste STOPs with **0** uploads |
| v4 (~16:27 UTC): all v3 cases re-run | identical outcomes (0 uploads on every STOP; 1 upload `22c56d17…` forward, 1 upload `6aeaeee6…` rollback) |
| v4: operator sets `RX_EXPECTED=38`, receiver live 38 | the operator value is honoured: exactly **1** upload (`22c56d17…`) |
| v4: receiver live 38, `RX_EXPECTED` unset (default 37) | STOP, **0** uploads |

This runbook covers only `twilio-voice-inbound`; the receiver is deployed first by MCP. Paste one block at a time.
Script (runbook v4) sha256 `ceafe07e…f5ef` (`bash -n` clean).

```bash
# Runbook v4 — twilio-voice-inbound only (the receiver is deployed first by MCP). BASH ONLY:
# on macOS (zsh by default) first run:  exec bash --noprofile --norc
# Paste one block at a time (never the whole file). Every production write below runs only inside an `if`
# whose CLI, preflight and live-version checks all passed; otherwise it prints STOP and writes nothing.
# Block (a) also requires a fresh block G and the receiver live at its S3 version; block (b) also requires a
# hand-set R_IN_REASON.
# Keep this shell open from block G until the recovery-availability period ends (plan §12.4 G5).

# ===== 0. Fresh bash shell, isolated CLI home, token read silently (never echoed) =====
[ -n "${BASH_VERSION:-}" ] && echo "bash $BASH_VERSION OK" || echo "STOP: not bash - run: exec bash --noprofile --norc"
export PROJECT_REF=jncvvsvckxhqgqvkppmj CLI_VER=2.118.0
export REPO_URL="${REPO_URL:-https://github.com/cgarness/agentflow-life-insure.git}"
export WORK="$(mktemp -d "${TMPDIR:-/tmp}/b1p2.XXXXXX")"; echo "WORK=$WORK"
export SUPABASE_HOME="$WORK/sbhome" SUPABASE_NO_KEYRING=1; mkdir -p "$SUPABASE_HOME"
unset SUPABASE_PROJECT_ID SUPABASE_WORKDIR SUPABASE_PROFILE SUPABASE_ENV CLI_OK G5_OK G5_AT R_IN_REASON RX_EXPECTED EXPECTED_LIVE
unset SUPABASE_ACCESS_TOKEN   # never inherit a token; the scoped one is typed below, silently
read -rs -p 'Scoped PAT (project jncvvsvckxhqgqvkppmj, Edge Functions RW): ' SUPABASE_ACCESS_TOKEN; echo
export SUPABASE_ACCESS_TOKEN
utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# ===== 1. Pinned CLI (npm, integrity-checked); CLI_OK=1 only if both checks pass =====
mkdir -p "$WORK/cli" && printf '{"private":true}\n' > "$WORK/cli/package.json"
npm install --prefix "$WORK/cli" --no-audit --no-fund --ignore-scripts "supabase@$CLI_VER"
export SB="$WORK/cli/node_modules/.bin/supabase"
if [ "$("$SB" --version 2>/dev/null)" = "$CLI_VER" ] \
   && node -e 'const l=require(process.argv[1]).packages;const w={"node_modules/supabase":"sha512-0aPIlzBSBLwbJZCMZKD1QAwlc4xNnNvvk07QuSuuKBKzGLSeV3GovgTLlMKFTJ4JWfJubWF0URPLuPUr0kZr5g==","node_modules/@supabase/cli-darwin-arm64":"sha512-48W7wkHIVNgwSz4zr+xsC94la1PytCpudOw5w9qJWAISyBWRXMFBCEMb9aVIEG8S9OcLb4X1KZy4PPA/T+f7NQ==","node_modules/@supabase/cli-darwin-x64":"sha512-r6z41S0ycJiy2cO6sbJA7kPCodpAus6b3Km+qyn2zYlnTLN0nbscYnKxrZf/rJNR+S+sdpOZXgdQjGc/z5jvXw==","node_modules/@supabase/cli-linux-x64":"sha512-nHm27uv15iu4xIQZRC++CS4uKYU9HuFn9HiOf407620OQ3cCp70fLT59grFlYQ+bqM7Zrv/GmEZHdgR8UO65RA=="};for(const[k,v]of Object.entries(w)){if(l[k]?.version!=="2.118.0"||l[k]?.integrity!==v){console.error("STOP integrity",k);process.exit(1)}}console.log("CLI lock integrity OK")' "$WORK/cli/package-lock.json"; then
  export CLI_OK=1; echo "CLI $CLI_VER OK"
else
  unset CLI_OK; echo "STOP: CLI version or lock integrity failed - do not continue"
fi

# ===== 2. Helper scripts (preflight, read-back, live guard, upload-set check) =====
cat > "$WORK/preflight.sh" <<'EOF'
set -euo pipefail
SRC="$1"; MODE="$2"
case "$MODE" in
  forward)  PIN=02b8ba5c91def63ebfe7670c33a4981dc452037b; MANIFEST=22c56d17063660705f8edae0e47a172bb740925b274617c420991e461b0d42f3
            PLANNER=9659164e7f0cdb618c88fb9a539847fc9843b9889a9d4c4fb3ca48d213ac22ee; STAGES=8f4ab0f3b07cc1a3701c05d985f388bfd80b721b28acb6d662cea5eaaf72ae58 ;;
  rollback) PIN=d675a4b11d6f05f1cdf39414d274439358d1b877; MANIFEST=6aeaeee6dc11dc05bd311c9fac0e0466bb3e1881fafd80367b71aca6d4116e79
            PLANNER=cc216e09f07607c5ba30b8c7922e2e20e1d3e94b39287ca221ac71176aaa4868; STAGES=77c63b44149b1c153b327d796decbb42dbce2450ab4e2176dc81e7166bdb026d ;;
  *) echo "mode must be forward|rollback"; exit 2 ;;
esac
cd "$SRC"
test "$(git rev-parse HEAD)" = "$PIN" || { echo "FAIL: HEAD is not $PIN"; exit 1; }
if git symbolic-ref -q HEAD >/dev/null; then echo "FAIL: HEAD is on a branch, expected detached"; exit 1; fi
test -z "$(git status --porcelain --ignored --untracked-files=all)" || { echo "FAIL: tree not pristine:"; git status --porcelain --ignored --untracked-files=all; exit 1; }
SUMS="$(mktemp)"
cat > "$SUMS" <<SUMSEOF
83ce2be3c56ff16b7e46eb5b10b2faa7fcd6df17d9351af3cbbd38aa2ecef726  supabase/functions/_shared/notification-recipients.ts
c853f6820058ef277dc2de853403349d8aa302fe654d1f628350f4563d3c172c  supabase/functions/_shared/notifications.ts
7555787d8fa86bdfce997851951ab67fbdcdafe3e5109fc8156dcfb1ae3aae40  supabase/functions/twilio-voice-inbound/failure.ts
a7fe08178a2b7ca995af09d94d702f6d89ab0bb79d7298e605d1cf767b4bbcf1  supabase/functions/twilio-voice-inbound/index.ts
${PLANNER}  supabase/functions/twilio-voice-inbound/planner.ts
3df94b4567fe28b69fcbec23f48bc28a866a9313e393179a845c4d88eb98fba1  supabase/functions/twilio-voice-inbound/request.ts
da1724c407bcaef17bd52ae29f26aec2d17e8a175d88cebe4efb0a83cd207627  supabase/functions/twilio-voice-inbound/routing.ts
a1b47ad960cea5193555d2aaf5eb2220cf7bd532f3ad39f73bc1afe7e619fdab  supabase/functions/twilio-voice-inbound/settings.ts
${STAGES}  supabase/functions/twilio-voice-inbound/stages.ts
87afd997166bb48d23a1b2113082014bb3b0b537305f0a567430a5d21dca4f80  supabase/functions/twilio-voice-inbound/twiml.ts
SUMSEOF
shasum -a 256 -c "$SUMS"
GOT=$(sed 's#  supabase/functions/#  functions/#' "$SUMS" | LC_ALL=C sort -k2,2 | shasum -a 256 | cut -d' ' -f1); rm -f "$SUMS"
test "$GOT" = "$MANIFEST" || { echo "FAIL: manifest $GOT != $MANIFEST"; exit 1; }
test "$(ls -1A supabase/functions/twilio-voice-inbound | LC_ALL=C sort | tr '\n' ' ')" = "failure.ts index.ts planner.ts request.ts routing.ts settings.ts stages.ts twiml.ts " || { echo "FAIL: unexpected entries in function dir"; exit 1; }
for f in supabase/functions/twilio-voice-inbound/deno.json supabase/functions/twilio-voice-inbound/deno.jsonc supabase/functions/twilio-voice-inbound/import_map.json supabase/functions/twilio-voice-inbound/package.json supabase/functions/import_map.json; do
  test ! -e "$f" || { echo "FAIL: $f exists (CLI would use/upload it)"; exit 1; }; done
test -z "$(find supabase/functions/twilio-voice-inbound supabase/functions/_shared -type l)" || { echo "FAIL: symlink present"; exit 1; }
test "$(shasum -a 256 supabase/config.toml | cut -d' ' -f1)" = cc673901b72e41449fe470ebffb31e043432b49e9d39edcd8da98a2b89f8b8c2 || { echo "FAIL: config.toml differs"; exit 1; }
echo "PREFLIGHT OK ($MODE @ $PIN, manifest $MANIFEST)"
EOF
cat > "$WORK/readback.sh" <<'EOF'
set -euo pipefail
RB="$1"; MODE="$2"
case "$MODE" in forward) MANIFEST=22c56d17063660705f8edae0e47a172bb740925b274617c420991e461b0d42f3 ;; rollback) MANIFEST=6aeaeee6dc11dc05bd311c9fac0e0466bb3e1881fafd80367b71aca6d4116e79 ;; *) exit 2 ;; esac
cd "$RB"
find . -type f ! -path './supabase/.temp/*' -print0 | xargs -0 shasum -a 256 \
  | sed -E 's#  (.*/)?functions/#  functions/#' | LC_ALL=C sort -k2,2 > "$RB.manifest"
cat "$RB.manifest"
N=$(wc -l < "$RB.manifest" | tr -d ' '); GOT=$(shasum -a 256 < "$RB.manifest" | cut -d' ' -f1)
echo "files=$N manifest=$GOT"
{ test "$N" = 10 && test "$GOT" = "$MANIFEST" && echo "READBACK OK ($MODE)"; } || { echo "READBACK FAIL (want 10 files, $MANIFEST)"; exit 1; }
EOF
guard_fn() {  # usage: guard_fn <slug> <expected live version>   (read-only)
  curl -fsS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    "https://api.supabase.com/v1/projects/$PROJECT_REF/functions/$1" > "$WORK/live.$1.v$2.json" || { echo "STOP: guard read failed ($1)"; return 1; }
  node -e 'const f=require(process.argv[1]);console.log(JSON.stringify({slug:f.slug,version:f.version,status:f.status,verify_jwt:f.verify_jwt,import_map:f.import_map,entrypoint_path:f.entrypoint_path,ezbr_sha256:f.ezbr_sha256}));if(f.slug!==process.argv[3]||f.version!==Number(process.argv[2])||f.status!=="ACTIVE"||f.verify_jwt!==false){console.error("STOP: expected "+process.argv[3]+" v"+process.argv[2]+" ACTIVE verify_jwt=false");process.exit(1)}console.log("GUARD OK "+process.argv[3]+" v"+process.argv[2])' "$WORK/live.$1.v$2.json" "$2" "$1"
}
guard() {  # usage: guard <expected live version of twilio-voice-inbound>
  curl -fsS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    "https://api.supabase.com/v1/projects/$PROJECT_REF/functions/twilio-voice-inbound" > "$WORK/live.v$1.json" || { echo "STOP: guard read failed"; return 1; }
  node -e 'const f=require(process.argv[1]);console.log(JSON.stringify({version:f.version,status:f.status,verify_jwt:f.verify_jwt,import_map:f.import_map,entrypoint_path:f.entrypoint_path,ezbr_sha256:f.ezbr_sha256}));if(f.slug!=="twilio-voice-inbound"||f.version!==Number(process.argv[2])||f.status!=="ACTIVE"||f.verify_jwt!==false){console.error("STOP: expected v"+process.argv[2]+" ACTIVE verify_jwt=false");process.exit(1)}console.log("GUARD OK v"+process.argv[2])' "$WORK/live.v$1.json" "$1"
}
expected_uploads() { printf '%s\n' supabase/functions/_shared/notification-recipients.ts supabase/functions/_shared/notifications.ts \
  supabase/functions/twilio-voice-inbound/failure.ts supabase/functions/twilio-voice-inbound/index.ts supabase/functions/twilio-voice-inbound/planner.ts \
  supabase/functions/twilio-voice-inbound/request.ts supabase/functions/twilio-voice-inbound/routing.ts supabase/functions/twilio-voice-inbound/settings.ts \
  supabase/functions/twilio-voice-inbound/stages.ts supabase/functions/twilio-voice-inbound/twiml.ts | LC_ALL=C sort; }
upload_set_ok() {  # usage: upload_set_ok <deploy stderr file>
  sed -n 's/^Uploading asset (twilio-voice-inbound): //p' "$1" | LC_ALL=C sort | diff <(expected_uploads) - && echo "UPLOAD SET OK"
}
clone_pinned() {  # usage: clone_pinned <dir> <commit>; reuses an existing clone
  [ -d "$1/.git" ] || { git clone --no-checkout "$REPO_URL" "$1" && git -C "$1" -c advice.detachedHead=false checkout --detach "$2"; }
}

# ===== G. G5 readiness — run BEFORE the receiver (MCP) deployment (S1) and again at S5 =====
# Proves: pinned CLI, both pristine pinned clones, authentication (read-only list), live inbound still v45.
clone_pinned "$WORK/src-forward"  02b8ba5c91def63ebfe7670c33a4981dc452037b
clone_pinned "$WORK/src-rollback" d675a4b11d6f05f1cdf39414d274439358d1b877
mkdir -p "$WORK/probe/supabase"
if [ "${CLI_OK:-}" = 1 ] \
   && bash "$WORK/preflight.sh" "$WORK/src-forward" forward \
   && bash "$WORK/preflight.sh" "$WORK/src-rollback" rollback \
   && "$SB" --agent no --workdir "$WORK/probe" functions list --project-ref "$PROJECT_REF" > "$WORK/functions.list.txt" \
   && guard 45; then
  export G5_OK=1 G5_AT="$(date +%s)"; echo "G5 READY at $(utc) - keep this shell open"
else
  unset G5_OK G5_AT; echo "STOP: G5 NOT READY - deploy nothing (receiver included)"
fi

# ===== (a) FORWARD: twilio-voice-inbound v45 -> 02b8ba5 (only after the receiver's S3 read-back and S4 window, and G re-run at S5) =====
# RX_EXPECTED = the receiver version recorded at S3; set it before pasting ONLY if S3 recorded something other than 37.
# Block G must have passed within 10 minutes.
RX_EXPECTED="${RX_EXPECTED:-37}"
if [ "${CLI_OK:-}" = 1 ] && [ "${G5_OK:-}" = 1 ] \
   && [ $(( $(date +%s) - ${G5_AT:-0} )) -le 600 ] \
   && guard_fn twilio-recording-status "$RX_EXPECTED" \
   && bash "$WORK/preflight.sh" "$WORK/src-forward" forward \
   && guard 45; then
  unset G5_OK G5_AT   # one use per block G run
  echo "T_p0 upload start $(utc)"
  ( cd "$WORK/src-forward" && "$SB" --agent no --workdir "$WORK/src-forward" functions deploy twilio-voice-inbound \
      --project-ref "$PROJECT_REF" --use-api --no-verify-jwt ) > "$WORK/deploy.forward.stdout" 2> "$WORK/deploy.forward.stderr"
  rc=$?; echo "deploy exit=$rc upload end $(utc)"
  cat "$WORK/deploy.forward.stdout" "$WORK/deploy.forward.stderr"
  [ "$rc" = 0 ] || echo "NOTE: upload exited $rc - the post-deploy guard decides: still v45 = F17 (nothing deployed); v46 = continue to read-back; else F11"
  upload_set_ok "$WORK/deploy.forward.stderr" || echo "FAIL: upload set differs (F6 if live is v46)"
  guard 46 || echo "FAIL: post-deploy guard - F17 if live is still v45; F6 if v46 but not ACTIVE or verify_jwt!=false; else F11"
  mkdir -p "$WORK/dl-forward/supabase"
  "$SB" --agent no --workdir "$WORK/dl-forward" functions download twilio-voice-inbound --project-ref "$PROJECT_REF" --use-api \
    && bash "$WORK/readback.sh" "$WORK/dl-forward" forward || echo "FAIL: read-back (F6 if live is v46)"
else
  echo "STOP: forward preconditions failed (CLI, fresh G5, receiver v$RX_EXPECTED, preflight or inbound v45) - NOTHING DEPLOYED"
fi

# ===== (b) ROLLBACK (R-IN): twilio-voice-inbound -> v45 source (d675a4b), inbound-only =====
# Run only when the plan's failure table calls for R-IN. In a fresh shell (later R-IN) first re-run blocks 0-2.
# EXPECTED_LIVE = the version recorded at S7; set it before pasting ONLY if S7 recorded something other than 46
# (or on Chris's instruction). Any other live version is F11: stop.
# Arm it by hand with the reason, e.g.  R_IN_REASON=F6   (F6 | F7 | chris)
EXPECTED_LIVE="${EXPECTED_LIVE:-46}"
clone_pinned "$WORK/src-rollback" d675a4b11d6f05f1cdf39414d274439358d1b877
if [ "${CLI_OK:-}" = 1 ] \
   && case "${R_IN_REASON:-}" in F6|F7|chris) true ;; *) echo "STOP: R_IN_REASON not set"; false ;; esac \
   && bash "$WORK/preflight.sh" "$WORK/src-rollback" rollback \
   && guard "$EXPECTED_LIVE"; then
  echo "R-IN upload start $(utc) reason=$R_IN_REASON"; unset R_IN_REASON
  ( cd "$WORK/src-rollback" && "$SB" --agent no --workdir "$WORK/src-rollback" functions deploy twilio-voice-inbound \
      --project-ref "$PROJECT_REF" --use-api --no-verify-jwt ) > "$WORK/deploy.rollback.stdout" 2> "$WORK/deploy.rollback.stderr"
  rc=$?; echo "deploy exit=$rc upload end $(utc)"
  cat "$WORK/deploy.rollback.stdout" "$WORK/deploy.rollback.stderr"
  [ "$rc" = 0 ] || echo "FAIL: rollback upload exited $rc (F15)"
  upload_set_ok "$WORK/deploy.rollback.stderr" || echo "FAIL: upload set differs (F15)"
  guard "$((EXPECTED_LIVE + 1))" || echo "FAIL: post-rollback guard (F15)"
  mkdir -p "$WORK/dl-rollback/supabase"
  "$SB" --agent no --workdir "$WORK/dl-rollback" functions download twilio-voice-inbound --project-ref "$PROJECT_REF" --use-api \
    && bash "$WORK/readback.sh" "$WORK/dl-rollback" rollback || echo "FAIL: rollback read-back (F15)"
else
  echo "STOP: rollback preconditions failed - NOTHING DEPLOYED"
fi

# ===== Teardown — only at the END of the recovery-availability period (plan §12.4 G5) =====
unset SUPABASE_ACCESS_TOKEN   # then revoke the scoped PAT in Dashboard > Account > Access Tokens
```

### 12.10 Verification reporting

Four statuses are reported separately, each `pending` until its own evidence exists:
1. **Deployed and source-verified.** Per function: version, ezbr, a read-back of every file, `verify_jwt`, entrypoint.
2. **Agent voicemail stored.** A `new_agent` callback answered 200 by the new receiver, with a `voicemails` row
   (`recipient_kind='agent'`, `status='stored'`, `source_cleanup_state='deleted'`) and `calls.voicemail_id` set.
3. **Correct recipient and notification verified.** `recipient_agent_id` equals the expected agent, `notified_at` is
   set, and a `type='voicemail'` notification exists for that agent.
   - **With an attempt,** the expected agent is `voicemail_agent_id`, then `owner_agent_id`.
   - **Without an attempt** (planner failure or the no-attempt fallback), it is `resolveOwnerCandidate`'s precedence:
     the direct line's `phone_numbers.assigned_to`, then the contact's assigned agent. `calls.missed_for_agent_id` is
     used as a cross-check when it is set, and a NULL there is reported as "recipient unverified", not as a mismatch.
   - The callback's own `mailbox_agent_id` is never the reference.
4. **Playback confirmed by the recipient.** The recipient agent confirms the voicemail is listed and plays. An Admin's
   playback does not count.

Until those exist, the status is **production verification pending**. Checks run only while a session is active.
Nothing monitors production while no session is active, and no report implies otherwise.

### 12.11 Chris's production approval, verbatim (2026-09-30)

```text
I approve the exact Phase 2 production packages below, subject to these
execution conditions. This is not approval to skip unresolved conditions
or change the source.

No additional broad audit or implementation cycle is requested.

SOURCE AND PACKAGES

Source:
02b8ba5c91def63ebfe7670c33a4981dc452037b

Project:
jncvvsvckxhqgqvkppmj

First: twilio-recording-status
Manifest:
125a3cd85b8d6cf562903fc88565e3000a1bab8e5c2b6328b5a073f2b2fbd81a
Payload:
5b33d169f431db89b64993c75c32dce31715e8e05ac4bf26487aab3ed30efc92

Second: twilio-voice-inbound
Manifest:
22c56d17063660705f8edae0e47a172bb740925b274617c420991e461b0d42f3
Payload:
31d1cf5ab0cc87281d01c8ac8339343f50a2bc076f0e0d7365c94a85e3da45e1

Both retain verify_jwt=false.

DEPLOYMENT METHOD

Use option B: MCP for recording-status and file-based CLI upload for
voice-inbound.

Before deploying either function, confirm who will run the CLI upload,
that authentication is ready, and that the same operator can execute the
inbound rollback. Do not start the first deployment while the second
deployment or recovery still depends on unavailable access.

Do not ask me to paste access tokens into chat, source code or commits.
Do not substitute a manually transcribed inbound upload without approval.

Use isolated checkouts pinned to exact commits. Never use a moving main
checkout as the recovery source.

RECORD THE EXECUTION PLAN FIRST

Re-read AGENT_RULES.md, VISION.md and the newest WORK_LOG.md for conflicts.

The only repository edits authorized here are:
- docs/plans/2026-09-30-agent-voicemail-callback-repair/implementation_plan.md
- WORK_LOG.md

List these before editing, record this authorization and the corrected
release procedure before deployment, and preserve unrelated content.

No application-source changes are authorized. Any necessary source change
requires a revised file list, plan and my explicit approval before editing.

FRESH PRODUCTION GATES

Immediately before EACH forward deployment:
- Confirm no actively handled calls, fresh active dialing sessions or
  ringing reservations under the established read-only preflight.
- Distinguish known stale rows from genuinely active calls; do not close
  or modify them.
- Retrieve the complete current live function and verify the approved
  preimage and recovery artifact.
- Verify the approved source manifest and package.
- Stop on unexplained drift; never overwrite intervening work.

Deploy recording-status first, verify every file, then perform the stated
15-minute observation. Zero traffic is "no evidence," not a passed test.

Recheck the gates before deploying voice-inbound, then verify all 10 files.
Preserve entrypoints, complete dependency files and verify_jwt.

RECOVERY CORRECTIONS — REQUIRED BEFORE EXECUTION

Do not classify old/new callback formats solely by calls.created_at.
An earlier call can receive newly generated voicemail TwiML after cutover.
Use actual callback-format evidence where available; otherwise classify it
as unknown.

Replace the created-after-deployment drain filter with a conservative set
of ALL calls that could have received new-form voicemail instructions,
including:
- calls already in progress at cutover;
- later voicemail stage transitions;
- legitimate attempt-less fallback paths;
- delayed or retried recording callbacks.

Fifteen minutes is a minimum wait, not proof that the set is drained.
A stored voicemail row alone is not proof that all callback/cleanup work
has finished. Missing evidence does not mean "nothing owed."

I do not approve a blanket waiver of AGENT_RULES #32.
A release-specific exclusion may cover only individually identified old
stalled records positively shown unable to produce new-form callbacks.
Unknown or relevant outstanding work blocks restoring the old receiver.

Keep the new compatible recording-status handler by default after an
inbound-only rollback. If you cannot establish safe receiver restoration,
stop and escalate rather than acknowledge and lose pending new-form calls.

Prepare ONE consistent failure/action table before execution:
- A producer fault may trigger the exact inbound-only rollback.
- A retryable downstream recording 503 is investigated with source
  preservation and retries intact; it is not automatically evidence that
  the URL repair should be undone.
- A receiver boot failure, corrupt deployment or verified regression in
  previously working recording paths follows receiver-specific recovery,
  subject to compatibility/drain conditions.
- Unrelated live-version drift means stop, not overwrite.
- A changing status mix alone is not proof of a regression.

If these conditions cannot be satisfied with read-only checks and
documentation corrections, stop before deployment and identify the
specific unresolved condition.

APPROVED RECOVERY ARTIFACTS

Recording-status v36 source:
Manifest:
0893d95c57bce335589524bb2e6c57c5f5e30ed07dbaefb3b015b717165ae975
Payload:
73e1f28fc370758f1107c9acc989887c6e044711dfd588f793aade420677a42e

Voice-inbound v45 source:
Manifest:
6aeaeee6dc11dc05bd311c9fac0e0466bb3e1881fafd80367b71aca6d4116e79
Payload:
f3c1f0e1c1b7adbeeaec5807cf15ea7c057300bbb6a8242579c4e204d7d16289

Use live-version guards and full read-back on recovery too.
Source-byte parity is not proof of an identical dependency runtime.

VERIFICATION AND SCOPE

No controlled call or test-lead reassignment.
Use natural traffic and bounded read-only checks during the active session.
Do not imply monitoring continues while the session is inactive.

Report separately:
- deployed and source-verified;
- agent voicemail stored;
- correct recipient and notification verified;
- playback confirmed by the recipient.

Until the necessary evidence exists, report production verification pending.

Preserve signature validation, organization_id/RLS, call ownership,
device.connect(), re-entrancy guards, duration, dispositions, notifications
and recording policy. Ordinary verified-store source cleanup remains
existing product behavior; no manual historical recovery/deletion.

Keep the recorded TypeScript, exact-Deno, SQL and regression results with
their baseline limitations. No claim of a clean pass where errors remain.
Any subsequently approved code change requires npx tsc --noEmit, the
meaningful application typecheck and affected tests; use .maybeSingle()
where appropriate, Zod for forms/modals and Tailwind for UI. No exposed
secrets or production mock data; schema changes require migrations.

Run read-only Supabase advisors after deployment; do not mutate unrelated
findings.

Append a newest-first WORK_LOG entry with actual results and commit/push
only the two documentation files to the Phase 2 branch.

No PR/merge, migration, unrelated data change, historical recording
recovery, unfinished-attempt cleanup or Task A activation is authorized.

End with the actual live versions, verification evidence, any recovery
performed, remaining blockers and the next step for Task A.
```
