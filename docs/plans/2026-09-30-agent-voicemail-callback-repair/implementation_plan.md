# Implementation Plan — Agent-voicemail recording callback repair (B1 Phase 2) — rev 2, APPROVED FOR LOCAL IMPLEMENTATION (2026-09-30)

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
> cherry-picks of `7d5bc36`/`49253a5`, and the Phase 2 changes to §4 files 1–4 and 7–11.
> - **NOT deployed and NOT verified in production.**
> - No backend command, deployment, migration or production data change has run. Production access was read-only only.
> - The verification record is in §11. The commit SHA and push state are in the WORK_LOG entry.
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

**Classifying recording-status 403s:** by the call's `created_at` relative to the `twilio-voice-inbound` deploy
timestamp.
- **Before:** legacy in-flight, expected. The window is the greeting, plus up to 120 s of recording, plus Twilio
  processing.
- **After:** a new-form failure.

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
  `calls.missed_for_agent_id` when there is no attempt);
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
- **R5 — first proof is a real caller.** If the repair failed, that message would be missing from the app, as today. No
  failure path (403, a rejected query, 503) deletes the Twilio source recording; only a verified store does. Recovering
  such a recording is separately unapproved.
- **R6 — ownership hardening not included** (§3.3). Chris rules on it in §10.
- **R7 — out of scope.** The 4 lost recordings, the 12 unfinished voicemail-stage attempts, recording recovery or
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
  - merge only after both MCP deployments and their read-backs pass;
  - merge only with a separate approval;
  - re-confirm the integration state from the dashboard first.
  
  Until the merge, production equals the branch head, not `main`, and the WORK_LOG records this.

## 9. Production release packet (prepared after implementation and review; nothing deployed)
1. **Source commit.**
2. **Exact changed files.**
3. **`twilio-voice-inbound` package:** 10 files, per-file sha256, payload sha256 and manifest.
4. **`twilio-recording-status` package:** 2 files, the same detail.
5. **Recovery packages:** the per-file bytes read from live v36 and v45 by a read-only `get_edge_function`, cross-checked
   both ways against `main` @ `d675a4b`. They are re-parsed with `edge_payload.mjs verify`, the mechanism a restore would
   use (#29), and re-proved immediately before deploying.
6. **`verify_jwt = false`** for both, unchanged.
7. **Order:** `twilio-recording-status` → read-back → 15-min check → `twilio-voice-inbound` → read-back → inbound checks.
8. **Byte-for-byte read-back of every file.**
9. **Stop conditions** (§6.2 decision table and checks).
10. **Recovery:**
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
