# Implementation Plan — Inbound Call Flow Rebuild: canonical caller identity, exact WebRTC correlation, Twilio-authoritative answer claiming, routing/lifecycle/recording correctness

**Task branch:** `claude/inbound-call-flow-fix-auzk81` (from `main` @ `19c6a95` = PR #362 squash-merge)
**Date:** 2026-08-21 · **Revision 2:** 2026-08-22 — corrections 1–12 applied (rulings R1–R12). · **Revision 3:** 2026-08-22 — rulings R13–R18 added; R1–R12 preserved except the browser-trigger portion of R1, which R13 explicitly supersedes. · **Revision 4:** 2026-08-22 — rulings R19–R23 added; R1–R18 and the complete future-calls-only scope preserved. · **Revision 5:** 2026-08-22 — **closure corrections C1–C3 applied, R1–R23 preserved verbatim: C1 true zero-write claim idempotency (§4.2 first-write CAS + read-only duplicate path, byte-identical-row tests incl. `updated_at`); C2 `phone_last10(text)` added to the R23 ACL matrix with least-privilege grants that preserve expression-index maintenance, plus index-maintenance proof tests; C3 §11 heading corrected to R13–R23 coverage + consistency sweep.** · **Status:** **PLAN ONLY — AWAITING CHRIS'S FINAL APPROVAL. No application code, migration, test file, Edge Function change, or RLS policy file has been written; nothing deployed, merged, or applied to production. Production access in all sessions was strictly read-only.** · **Revision 6 (addendum):** 2026-08-23 — Revision 5 was approved and its development-only implementation pushed at `2fc5368`; Chris then ordered one narrow corrective round, **C4–C7** (see the Revision 6 addendum at the end of this document). **R1–R23 and C1–C3 are preserved verbatim.** Everything remains development-only: nothing deployed, applied, merged, or activated; no RLS authored. · **Revision 7 (addendum):** 2026-08-23 — after review of `3449d1b`, one final development-only corrective round, **C8–C12** (see the Revision 7 addendum at the end). **R1–R23 and C1–C7 are preserved.** Development-only *as of that revision*: nothing deployed, applied remotely, merged, activated, or reconciled against Twilio. *(Superseded — see the RLS Phase 1 status below.)* · **Revision 8 (closure):** 2026-08-23 — narrow closure patch **C13–C14** after review of `5c9349b` (see the Revision 8 closure note at the end). **R1–R23 and C1–C12 are preserved.** Development-only *as of that revision*. *(Superseded — see the RLS Phase 1 status below.)* · **RLS Phase 1 (2026-08-23):** Chris issued **`#APPROVE_RLS_CHANGE`** (authoring + local testing), then a **separate approval for remote application**. Phase 1 is **APPLIED to production** as version `20260823203257` and verified catalog-only at **18/18 postconditions**; **M1/M2/M3 are also applied** (`20260823222528` / `20260823222805` / `20260823222926`). Phase 2 remains out of scope and separately unapproved. **Nothing else has shipped:** no Edge Function deployed, no Twilio number reconciled, no frontend released, no TwiML activated, not merged — each remains separately gated (§15).

**Rulings (Chris, 2026-08-22 — Revision 2):** R1 claim RPC is service-role-only with database-authoritative profile checks *(its browser/JWT-wrapper answer-trigger portion is superseded by R13; everything else stands)* · R2 `provider_session_id` is first-writer-wins; a different child SID never replaces the first accepted leg · R3 empty/null `routed_agent_ids` ⇒ claim **fails closed** with actionable telemetry; `af_org_id` removed from TwiML params · R4 `get_inbound_call_identity` requires Active profile + routed-or-owner + live/recent state, not mere org membership · R5 `resolve_inbound_caller_display_name` is deprecated this release (unique-only compat wrapper), dropped in a later cleanup after bundle rollover · R6 idempotency index has **no timestamp predicate**; ingest is `ON CONFLICT DO NOTHING` + exact SELECT; a retry mutates **zero** rows · R7 status is fully monotonic `ringing → connected → terminal` (including `connected→ringing` suppression) · R8 one resolver only — no FloatingDialer phone probe; `campaign_leads` excluded from authoritative resolution; matchability metrics corrected · R9 auto-create serialized per (org, normalized phone) with in-lock re-resolve · R10 `last_agent` routing never consults `caller_id_used` · R11 RLS split into Phase 1 (command-split security repair) and Phase 2 (later privacy narrowing) · R12 presence-aware assigned-agent routing is out of scope (separate follow-up).

**Rulings (Chris, 2026-08-22 — Revision 3):**
- **R13 — Twilio-authoritative answer claiming.** `Call.accept()` returns void, so a browser-side "answer succeeded" gate proves nothing; the claim trigger is a **signed Twilio child-leg `answered` status callback**, not any browser request. The browser performs **no ownership write**; its accept event is UI state only. The legacy browser claim contract is disabled so stale bundles cannot write anything. (Supersedes only R1's browser/JWT-wrapper trigger; R1's service-role-only RPC + database-authoritative profile checks stand.)
- **R14 — Routed-agent persistence must precede ringing.** `append_call_routed_agents` is awaited and must report success **before** any `<Client>` TwiML for that wave is emitted — for the initial wave, direct-line, and every fallback wave. On failure: never dial agents; deterministic safe fallback (voicemail when enabled, else the documented terminal infrastructure-failure path) with actionable telemetry.
- **R15 — Phase 1 RLS is a mandatory production-release gate.** The live ALL policy lets any org member directly UPDATE-claim an unassigned inbound row, bypassing the authoritative claim flow — so this feature is **not production-ready until RLS Phase 1 (command-splitting, SELECT visibility preserved exactly, unassigned-inbound removed from authenticated UPDATE/DELETE) is approved and live**. *(Status 2026-08-23: `#APPROVE_RLS_CHANGE` was granted, the policy migration was authored, separately approved for remote application, applied as `20260823203257` and verified 18/18 — this gate is SATISFIED. The ruling itself stands: the feature is not production-ready until Phase 1 is live, and it now is.)*
- **R16 — Strict SID and ingest-collision validation.** Parent and child CallSids must match `^CA[0-9a-fA-F]{32}$`, validated in the Edge callback and again in the RPC before the CAS; blank/malformed rejected. A successful claim never leaves `provider_session_id` NULL. Param renamed `p_child_call_sid`. Ingest conflict lookups are SID + `direction='inbound'` + `organization_id = p_org_id`, with a DID (`caller_id_used` vs `p_to_number`) cross-check — same-SID cross-org or different-DID replays fail closed.
- **R17 — Recording and terminal persistence cannot be silently acknowledged.** Only a valid existing `recording_storage_path` is a success short-circuit (sentinels are recoverable failures, not successes); the calls-row update must be verified exact-row; the Twilio source recording is deleted **only after** storage upload AND verified DB persistence; failures preserve the Twilio source and use an explicit bounded retry (Twilio webhook connection-override retry policy — Twilio does **not** retry 5xx by default); unmatched callbacks never delete the provider recording. `finalize_inbound_call_terminal` failures are observable and retryable — never best-effort-swallowed — and the plan's stranding claim is stated honestly.
- **R18 — True two-stage `last_agent` fallback.** Tier 1: newest eligible same-org outbound call matching `p_contact_id` (when supplied). Tier 2 (**only when tier 1 finds no row** — including when `p_contact_id` was supplied but no historical row carries it): newest eligible same-org outbound call matching normalized `contact_phone`. Contact-ID matches outrank phone matches; `caller_id_used` is never consulted.

**Rulings (Chris, 2026-08-22 — Revision 4, final narrow correction):**
- **R19 — Claim delivery must survive retries and callback reordering.** Every per-agent `<Client>` claim-callback URL carries explicit bounded retry configuration (connection failures, read timeouts, HTTP 5xx — same channel class as the R17 recording callbacks). `statusCallbackEvent="answered completed"`: `CallStatus='in-progress'` is the primary answered proof; `CallStatus='completed'` is the **recovery proof** when the answered delivery was lost; child legs ending `canceled`/`busy`/`failed`/`no-answer` **never** claim. Transient DB/RPC failures return retryable **5xx**; valid business rejections and ignored losing-leg events return **2xx** (no pointless retries). A delayed authentic answered/completed callback **may enrich an already-terminal row** — setting `agent_id` + `provider_session_id` through the same first-writer CAS while **never** changing a terminal `status`, `ended_at`, `duration`, or other terminal metadata — still requiring exact row, parent SID, child SID, organization, Active identity, and persisted routing membership. The handler's live-row-only precheck is removed for this signed late-enrichment case.
- **R20 — RLS Phase 1 must precede activation, not follow it.** The Phase 1 migration must be approved, authored, reviewed, applied, and verified **before** deploying the new `twilio-voice-inbound` TwiML that activates authoritative callback claiming. M1/M2 and the inert callback endpoint may be prepared first; rollout **stops before activating the new inbound TwiML** unless Phase 1 is live; the Twilio staging matrix runs only after Phase 1 is applied. Phase 1 must **globally** exclude unassigned inbound rows from authenticated UPDATE and DELETE for **every** authenticated role — Agent, Team Leader, Admin, and Super Admin — not merely remove the regular-org-member branch; SELECT visibility preserved exactly; a full RLS authorization matrix is required. *(Status 2026-08-23: approval granted, migration authored and APPLIED as `20260823203257`, verified 18/18. The sequencing ruling stands and is satisfied — TwiML activation remains blocked only by the outstanding §15 deploy steps.)*
- **R21 — Invalid or anonymous ANI must never auto-create a lead.** Auto-create requires **both** `resolution='not_found'` **and** a non-null valid normalized ANI. When `phone_last10(p_from_number)` is NULL (`anonymous`, `unknown`, `restricted`, <10 digits): preserve the raw caller value on the call row, leave it unlinked with `contact_type=NULL`, route normally, take no advisory lock, create no lead.
- **R22 — DID replay comparison must use the complete number.** The ingest conflict check compares `caller_id_used` vs `p_to_number` as the exact trimmed Twilio E.164 value (or a full country-code-preserving E.164 canonicalization) — **never** `phone_last10`, which is insufficient as an organization/replay boundary.
- **R23 — Explicit function ACL matrix.** Every M1/M2 function ships an explicit ACL: service-only functions REVOKE PUBLIC/anon/authenticated + GRANT service_role only; `get_inbound_call_identity` REVOKE PUBLIC/anon + GRANT authenticated/service_role (in-body `auth.uid()` + Active/org checks retained; documented as an intentionally-authenticated, reviewed SECURITY DEFINER); the `resolve_inbound_caller_display_name` compat wrapper REVOKE PUBLIC/**anon** (its current production ACL includes anon) + GRANT authenticated/service_role; `peek_inbound_call_identity` REVOKE PUBLIC/anon, retaining only authenticated/service_role. SQL EXECUTE-matrix tests prove the whole table.

**Reading:** AGENT_RULES.md v5.0.0 (full) · VISION.md (full) · WORK_LOG.md — complete 8,956-line coverage (2026-04-18 → 2026-08-21) plus deployed bodies of `twilio-voice-inbound` v42, `twilio-voice-status` v39, `inbound-call-claim` v37 pulled via `get_edge_function` and **byte-diffed against the repo: identical** (invariant #4).
**Scope:** Fix the complete inbound-call flow **for new calls only**. No backfill; no repair of historical `contact_id`/names/statuses/notifications/recordings/agent ownership; existing inbound rows remain byte-identical. Migrations add only future-facing functions, indexes, and constraints — **zero historical cleanup, zero top-level backfill DML** (indexing existing rows reads them and alters nothing — R6). Single-leg Twilio Voice.js WebRTC architecture, Twilio signature validation, organization isolation, telemetry canon (`calls.duration` sole-writer), recording safeguards, and every TwilioContext re-entrancy guard (invariant #9) are preserved. **No RLS policy is authored or applied by this build (R11/R15); §9 defines the mandatory Phase 1 production gate and the later Phase 2, both requiring `#APPROVE_RLS_CHANGE`.**

---

## 1. Current-state findings (verified: repo @ `19c6a95` + live production read-only + deployed-function diffs, 2026-08-21/22)

### 1.1 Root cause confirmed, with production scale (metrics corrected per R8)

- `twilio-voice-inbound/resolveInboundContact` (`index.ts:160-237`) matches the normalized ANI against **raw stored `phone` text**: exact `.eq("phone", v)` for `v ∈ {last10, '1'+last10, '+1'+last10}`, then fuzzy `.ilike("phone", "%"+last10)`. Bare-digit stored forms therefore DO match; what cannot match is punctuation/spacing-formatted text like `(209) 840-2988` (neither variant-equal nor ending in the contiguous 10-digit string).
- **Corrected matchability metrics** (read-only, leads with ≥10-digit phones, 2026-08-22): total **1,088** · exact-matchable today **532** · fuzzy-only-matchable **0** · **unmatchable by the current webhook: 556 (51%)**. For reference, "non-E.164" is a *different* measure: **583** rows — 51 of those are bare-digit forms the webhook matches fine. The two metrics are reported separately from here on. clients: 1 formatted row (unmatchable); recruits: 0 rows ≥10 digits.
- **118 duplicate normalized-last-10 groups** exist in leads — the "many normalized-phone duplicates" premise is real, so any `LIMIT 1` link is a misattribution hazard.
- Damage shape on the 25 production inbound calls (read-only): **22/25 have `contact_id` NULL** — and all 22 carry **`contact_type='lead'` from the column DEFAULT** (`calls.contact_type text DEFAULT 'lead'`, baseline `:7042`), i.e. falsely classified; **25/25 have `agent_id` NULL** (claiming has *never* succeeded — see 1.3); **3/25 are stuck `status='ringing'` forever**; **0/25 have `provider_session_id`**.
- The fuzzy branch is `.limit(1).maybeSingle()` — an arbitrary pick; and the exact branch's `.maybeSingle()` **errors** when a variant matches >1 row, which is silently swallowed (`console.warn` + continue), so a duplicated exact-match phone falls through to fuzzy/auto-create.
- Split brain: the UI's `resolve_inbound_caller_display_name` RPC (baseline `:4924-5028`) **does** normalize stored text (`right(regexp_replace(phone,'[^0-9]','','g'),10)`), so it can resolve the very numbers the webhook cannot — a name renders while the call row stays unlinked. It also diverges in **type coverage** (leads → campaign_leads → clients; no recruits — webhook does leads → clients → recruits, no campaign_leads), and in **selection** (`ORDER BY updated_at DESC LIMIT 1` — newest-record guessing). FloatingDialer's recent-call enrichment (`FloatingDialer.tsx:353-460`) is a third divergent resolver: leads-only `.ilike` probe, first-match-wins per last-10, type invented from `leads.status === "Closed Won" ⇒ 'client'`, and it **overrides the display name even for rows that already have `contact_id`**.
- Conversation history is strictly `contact_id`-based (`dialer-api.ts getLeadHistory :180-231` — `contact_id.eq.<id>` with a `campaign_lead_id` OR-branch; contact views likewise). A NULL `contact_id` inbound call is invisible there — correct behavior, wrong input. **No phone-number fallback exists in history and none will be added.**

### 1.2 `twilio-voice-inbound` (1,325 lines; deployed v42 = repo byte-identical) — defect inventory

| Area | Behavior today (line cites) | Defect class |
|---|---|---|
| Initial insert | plain `INSERT` per webhook hit (`:1054-1070`); `twilio_call_sid` has only a **non-unique** index (`idx_calls_telnyx_call_control_id`, baseline `:9471`); no upsert key | Twilio retry of the initial webhook inserts a duplicate row (D) |
| Insert payload | `contact_phone: From` (customer ANI), `caller_id_used: To` (our DID) — **correct ordering here**; `contact_type` omitted → DEFAULT `'lead'` misclassifies unresolved calls | A |
| Contact enrich | overwrites `contact_phone` with the **CRM stored phone** on match (`:1092`) — destroys the Twilio ANI | A (requirement: ANI preserved in `contact_phone`) |
| Auto-create lead | fires whenever `resolvedContact` is null (`:1107`) — including when resolution *errored* or was ambiguous-and-swallowed; creates duplicate leads for formatted existing contacts; two **simultaneous** unknown calls from one number would create two leads (no serialization) | A |
| Ring timeout | hardcoded `<Dial timeout="30">` (`buildDialTwiml :769`) — `phone_settings.ring_timeout` (exists, default 30, 1 org has a non-default value) never read on inbound | C |
| all-ring | `resolveAllOrgIdentities` (`:484-501`) has **no `status='Active'` filter** (historical constraint "do not change all-ring", 2026-05-19 Phase 1g — now superseded by this task's explicit requirement) | C |
| assigned / direct-line | `resolveAssignedIdentity` (`:417-436`) looks up the profile by id only — **no org match, no Active check** | C |
| chain tiers | `resolveActiveRingTargetsByAgentIds` (`:530-546`) filters Active but **not organization**; tiers re-ring agents already rung in earlier waves (no exclusion); `last_agent` (`:548-576`) matches the caller's raw ANI variants against **raw stored `calls.contact_phone` text AND against `caller_id_used`** — formatted outbound `contact_phone` values miss, and `caller_id_used` is the agency DID, never the customer (R10/R18) | C |
| routed persistence | `recordRoutedAgents` is try/caught best-effort (`:462-482`) — **a persistence failure still emits agent-dialing TwiML**, which under R3's routed-membership claim requirement would connect an agent whose claim is guaranteed to fail (R14) | B/C |
| voicemail | `handleFallback`/`emitTerminalFallback` never consult `voicemail_enabled` — the default branch always records voicemail (`:1003-1012`, `:856-869`) | C |
| missed-marking | `emitTerminalFallback` marks `is_missed` + sends notifications **before** emitting the forward TwiML (`:826-853`); business-hours-closed path does the same before forwarding (`:1153-1175`) | D (forwarded-and-answered call is already "missed") |
| terminal state | no Dial-action path ever finalizes `status`; the Phase-4 build wrote `status='completed'`+`ended_at` on the missed path but that was lost in later rewrites — hence the 3 forever-`ringing` rows | D |
| `<Client>` TwiML | plain `<Client>identity</Client>` — **no `<Parameter>` nouns and no per-leg `statusCallback`**, so neither the browser nor the server can correlate a specific ringing leg to its call row (B/R13) | B |
| Recording | `<Dial record="record-from-answer-dual" recordingStatusCallback=…>` when org `recording_enabled` (null→true); voicemail `<Record>` always reports to `twilio-recording-status`; **forwarded `<Dial><Number>` has no record attrs — forwarded external legs are not recorded today** | E (documented in §7) |
| Signature/org | Twilio HMAC-SHA1 validation with canonical `SUPABASE_URL` base — sound; `phone_numbers` per-number override lookup is org-scoped (2026-05-26 hardening) — preserved as-is | — |

### 1.3 Correlation + claiming: structurally broken, non-atomic, org-unsafe — and browser answer is unprovable

- **The browser child SID can never match the row.** The webhook writes `twilio_call_sid` = **parent PSTN SID** and never writes `provider_session_id`. `TwilioContext.claimInboundCall("", sid)` (`:1404`, `:1855`) sends the **browser child-leg CallSid** as `provider_session_id` only. In `inbound-call-claim`, with `call_control_id` empty, both SID-match branches (including the "exactly-1 recent ringing" guess) are **skipped**, leaving only `.eq("provider_session_id", …)` — which matches nothing. Claim retries 18× and gives up. This is why **all 25 production inbound calls have `agent_id` NULL**: claiming has never once succeeded. (Corollary: there is no legacy-client compatibility burden on the *claim* path — no deployed bundle has a working claim to preserve, so the R13 disable of the legacy browser contract regresses nothing. The *display* path is different: old bundles do call `resolve_inbound_caller_display_name`, hence R5.)
- **Browser answer is not provable (R13 rationale):** Voice SDK 2.x `Call.accept()` returns **void** (`src/lib/twilio-voice.ts:210` — `call.accept();`); the repo's `async twilioAnswerCall()` wrapper resolves immediately after *initiating* acceptance, proving neither that media opened nor that this browser won the bridge. Any claim gated on it (including Revision 2's §4.4) is browser-authoritative and race-prone. The only authoritative answer signal is Twilio's own child-leg `answered` event.
- **Claim-on-ring, not on answer:** `wireTwilioCall` fires the claim the moment the browser starts ringing (`TwilioContext.tsx:1852-1861`), before anyone accepts; `answerIncomingCall` claims again (`:1402-1411`). Under all-ring, every ringing browser would race; a rejecting agent (with `activeCallIdRef` set) would also stamp `status='completed'` on the still-ringing row via `finalizeEnded → finalizeCallRecord` (`:1251-1286`).
- **Not atomic:** the claim is read-guard (`:146-151`) then unconditional `UPDATE … eq("id")` (`:153-162`) — no `agent_id IS NULL` predicate; two agents can both pass the guard and last-writer-wins, both told `claimed:true`.
- **Org safety violations:** SID lookups 1 and 3 are **not org-scoped** (service role); the claim UPDATE **overwrites `organization_id`** with the claimer's org (`:157`); no direction re-check, no state check (a completed call is claimable), no routing-eligibility check, no SID-format validation anywhere.
- **SID re-homing (two dormant paths):** `inbound-call-claim:131-136` rewrites `twilio_call_sid` to the browser SID when matched by session id; `TwilioContext.syncIdsToRow` (`:1676-1696`) writes the browser SID into **both** `twilio_call_sid` and `provider_session_id` on accept. Both are dormant only because claiming never succeeds; the moment claiming works, either would break every later parent-SID lookup (`twilio-voice-status`, `twilio-recording-status`).
- **`peek_inbound_call_identity`** (baseline `:4524-4619`): after an exact miss, unconditionally returns **the newest ringing inbound call in the org from the last 6 minutes** — under two simultaneous inbound calls, agent A's ringing UI can display caller B's identity. `TwilioContext` polls it at 350 ms (`:842-898`) and again in a 500 ms loop (`:1046-1063`). Both RPCs (`peek…`, `resolve_inbound_caller_display_name`) carry an inert-but-present `GRANT … TO anon`.
- **Inbound display field-ordering is inverted in TwilioContext (read side).** The webhook writes correctly, but the browser prefers the wrong column: `applyInboundAniFromCallsRow` uses `row.caller_id_used || row.contact_phone` (`:817`), the claimed-row read uses `caller_id_used || contact_phone` (`:574`), `reconcileIdentifiedContactFromCallsRow` likewise (`:725`, `:728`), and `hasAni` (`:978`) — for inbound rows `caller_id_used` is **our DID**, so the code then papers over it with the org-DID exclusion set (`inboundCallerExcludeRef`). `reconcileIdentifiedContactFromCallsRow` also collapses `contact_type` to `client`-else-`lead` (`:747-748`), losing recruits. The contact timeline's display contract is already correct (`CommunicationDetails`: "Contact number" ← `contact_phone`, "AgentFlow number" ← `caller_id_used`) — only the live-call read side is inverted.

### 1.4 `twilio-voice-status` (deployed v39 = repo byte-identical)

- Duration canon is healthy: `chooseDurationToWrite` monotonic guard, `CallDuration` → `DialCallDuration` preference, terminal-zero writes (invariant #8). **Untouched by this build except the status-ladder guard (R7).**
- **Gap: status is not monotonic.** The switch writes unconditionally (`:269-329`): a late/retried `ringing` callback rewrites a `connected` call back to `ringing`, and `ringing`/`in-progress` replays regress terminal rows. Duration cannot regress but status can, in both the connected and terminal stages.
- Lookup by parent then `DialCallSid` (`:247-249`) — works because nothing (yet) re-homes the parent SID; not org-scoped (unguessable SID; noted in §12 security review).
- For **outbound**, this function is also the `<Dial action>` target (maps `DialCallStatus`). For **inbound**, the Dial actions point at `twilio-voice-inbound` (`fallback=chain|voicemail|hangup`), and this function receives the parent-call lifecycle from the phone number's `statusCallback` (`_shared/twilioNumberConfig.ts` — canonical config). A lost parent `completed` callback currently leaves an inbound row `ringing` forever (the 3 stuck rows).

### 1.5 `twilio-recording-status` (deployed v33; repo authoritative)

- Flow: validate signature → skip non-`completed` → look up row by `twilio_call_sid` → download `.mp3` → upload to `call-recordings` (`upsert:true`) → write `recording_storage_path`/`recording_duration`/`recording_url = storage:<path>` → **DELETE the recording from Twilio**.
- **Retry non-idempotency is structural, and deletion precedes verified persistence:** the Twilio copy is deleted after upload **regardless of whether the DB metadata write succeeded** (`updateCallsRow` merely logs errors, `:87-97`), and after a successful first pass a duplicate callback's re-download 404s → writes `recording_url: "__recording_failed__"` **over** the good `storage:` token while `recording_storage_path` still points at the stored file (sentinel writes patch only `recording_url`). Across a UTC-midnight boundary a duplicate would even build a **new dated storage path** and overwrite `recording_storage_path` itself. The row update is keyed by bare `twilio_call_sid` with no org filter and would patch every row sharing the SID. Unmatched callbacks still download/upload to an `unmatched/` prefix **and still delete the Twilio source** — an unrecoverable orphan (R17). Every failure path returns 200, and **Twilio's default webhook retry policy does not retry 5xx anyway** — there is no retry channel at all today.
- **Browser recording has no inbound exclusion.** The `call.on("accept")` block (`TwilioContext.tsx:1763-1816`) starts browser recording for **both directions**; today it silently never starts for inbound only because the claim never yields a `rowId`. The moment claiming works, an answered inbound call gets **two writers** (Twilio dual-channel `.mp3` keyed by parent SID + browser `.webm` keyed by row UUID) racing on the same `recording_storage_path`/`recording_url` columns. Outbound recording is browser-side **only** by design (server-side Dial recording removed from `twilio-voice-webhook` 2026-04-20) — that stays untouched.

### 1.6 Database truth (live-verified)

- `calls`: schema = baseline + `routed_agent_ids uuid[]` (confirmed via `information_schema` — the WORK_LOG "types drift" note about `transport`/`from_number` is a stale-`types.ts` note, not DB). `contact_type` CHECK `IN ('lead','client','recruit')` **accepts NULL** — explicit-NULL is compatible. `status` CHECK: `ringing|connected|completed|failed|no-answer`. `direction` CHECK: `outbound|inbound`. **No unique constraint on `twilio_call_sid`** (plain btree only) and **zero duplicate inbound SIDs exist** (verified read-only) — the R6 unbounded partial unique index will build cleanly.
- RLS on `calls` (baseline `:11296-11300`): one ALL-commands policy `Calls Hierarchical Access`. Its USING branch `(get_org_id() IS NOT NULL AND organization_id = get_org_id() AND direction='inbound' AND agent_id IS NULL)` exposes **unassigned inbound calls org-wide, forever** — and because the policy is `ALL` and its `WITH CHECK` accepts `agent_id = auth.uid()`, **any org member can UPDATE-claim any unassigned inbound row directly via PostgREST**, bypassing every claim control **and able to block the real Twilio-confirmed winner** (their write lands `agent_id ≠ NULL`, so the authoritative CAS then fails). This is why Phase 1 RLS is a mandatory production gate (R15, §9) and why R3/R4 reject possession-of-UUID authority.
- Settings: `phone_settings.ring_timeout integer DEFAULT 30` (org-level; **no per-number ring-timeout column exists**). `inbound_routing_settings` (one row per org, `routing_mode CHECK ('assigned','all-ring','round_robin')`, `fallback_action CHECK ('voicemail','forward','hangup')`, `voicemail_enabled`, greetings, `forwarding_number`, `auto_create_lead`, `inbound_fallback_chain jsonb DEFAULT ["last_agent","campaign_agents","all_available"]`, after-hours SMS). Per-number overrides on `phone_numbers`: `inbound_routing_mode, voicemail_enabled, fallback_action, voicemail_greeting_text, voicemail_greeting_url, forwarding_number` (+ `is_direct_line`, inbound-display/routing only per invariant #18). `business_hours(organization_id, day_of_week)` indexed for the webhook.
- `campaign_leads` ↔ contacts (resolved per R8): `campaign_leads` carries **snapshot** `phone`/`first_name`/`last_name` copied verbatim at attach time (goes stale when the lead's phone is edited) and a **nullable `lead_id` FK → leads ON DELETE SET NULL**. `campaign_leads.id` is *never* a contact identity and **a campaign_lead id must never become `calls.contact_id`**. Since requiring the underlying lead's *current* phone to match the ANI would make a campaign_leads probe exactly redundant with the direct `leads` probe, **`campaign_leads` are excluded from authoritative resolution entirely** — the canonical resolver covers `leads`/`clients`/`recruits` (single `phone` column each; `clients.beneficiary_phone` is a different person — excluded).
- Migration ledger (MCP `list_migrations`): latest applied `20260820233402` (presence RPC); notifications migration **applied** as `20260819163413` (`routed_agent_ids` + `append_call_routed_agents` + `(user_id,event_key)` are live). New files in this build are stamped after `20260820233402`. House rule: file-on-disk ≠ applied; apply-time restamp is normal (invariant #5, #25).
- `append_call_routed_agents` (live): SECURITY INVOKER, `search_path=''`, EXECUTE service_role only, atomic org-scoped duplicate-free union inside one UPDATE, `RETURNS boolean` (true ⇔ a row was updated) — exactly the success signal R14 requires the webhook to await and enforce. The RPC itself is unchanged; **its call sites change from best-effort to mandatory-before-ring** (§5.4).
- Missed-call notification layer (2026-08-19, preserved verbatim): recipient tiers routed → number_owner → contact_agent → managers, fail-closed, `missed_call:<call_id>` event key, `(user_id, event_key)` unique arbiter, ignore-duplicates upsert. **This build does not modify `_shared/notifications.ts`, `_shared/notification-recipients.ts`, the notifications migration, or any historical notification row** — it only changes *when* the missed-marking call sites fire (§6).
- History constraints honored: `20260411190000_revert_inbound_calling_system` — the old fork-leg inbound build is not resurrected (single-leg TwiML preserved); Phase-11 contract (claim request contract changes **in lockstep** with `TwilioContext` — both sides are rewritten together here, and the legacy browser contract is disabled per R13); 2026-08-18 amendment 5 deploy sequencing (voice-writer pair deploys back-to-back after the migration; §15).
- Workflow triggers: the only trigger on `calls` is `trg_workflow_call_created` → `workflow_on_call_created` (swallowing wrapper, invariant #10), and it dispatches **only when `disposition_id` AND `contact_id` are both non-null** — inbound ingest inserts carry no disposition, so no workflow dispatch fires on inbound insert today, and the R6 zero-mutation retry cannot re-fire an INSERT trigger. Confirming this stays true is a §12 gate.
- Stored-phone reality by writer (why "normalize both sides" is mandatory): manual Add modals store `1XXXXXXXXXX` (`normalizePhoneNumber`), the `import-contacts` Edge function stores the **raw CSV string**, and inbound auto-create stores `+1XXXXXXXXXX` — three formats coexist per table.

---

## 2. Design overview — the new inbound pipeline

```
PSTN call → twilio-voice-inbound (signature-validated)
  1. resolve phone_numbers row → org  (unchanged)
  2. ingest_inbound_call RPC  (NEW, atomic, idempotent on parent CallSid):
       parent SID validated ^CA[0-9a-fA-F]{32}$ (R16)
       INSERT … ON CONFLICT DO NOTHING; conflict ⇒ exact SELECT by (SID, direction,
       organization_id) + EXACT-E.164 DID cross-check (never last-10 — R22) —
       cross-org / different-DID replay FAILS CLOSED (R16); retry mutates ZERO rows (R6)
       anonymous/unknown/short ANI ⇒ raw value preserved, unlinked, routed normally,
       NO advisory lock, NO auto-created lead (R21)
       row: { twilio_call_sid=parent SID, direction='inbound', status='ringing',
         contact_phone=ANI (never overwritten), caller_id_used=DID,
         contact_type=NULL explicit, agent_id=NULL }
       resolve_inbound_contact RPC (NEW, canonical; leads/clients/recruits only — R8):
         unique   → link contact_id/contact_type/contact_name (guarded, once)
         ambiguous→ leave unlinked (never newest/first)
         not_found→ auto-create lead only if org opted in, serialized per
                    (org, last10) with in-lock re-resolve (R9); never on ambiguous/error
  3. business hours (unchanged semantics) → routing
  4. routing waves: Active + same-org + identity-holding agents only; ring timeout from
     phone_settings.ring_timeout; every wave excludes already-rung agents; last_agent tier
     = two-stage contact_id-then-normalized-phone (R18), never caller_id_used (R10);
     append_call_routed_agents AWAITED and REQUIRED true BEFORE any <Client> is emitted —
     persistence failure ⇒ safe fallback, never an undialable-claim ring (R14)
  5. TwiML per routed agent:
       <Client statusCallback="…/inbound-call-claim?call_row_id=…&agent_id=…"
               statusCallbackEvent="answered completed" statusCallbackMethod="POST">
         <Identity>agent</Identity><Parameter name="af_call_row_id" value=…/>
       </Client>          (no af_org_id — R3; ids server-generated — R13; callback URL
                           carries bounded retry overrides for connect/read-timeout/5xx — R19)
  6. browser: reads call.customParameters → get_inbound_call_identity(row id) —
     authenticated + Active + routed-or-owner + live/recent state (R4); displays ANI
     (contact_phone) + authoritative row contact name; no guessing anywhere
  7. agent answers → TWILIO fires the signed child-leg callback to inbound-call-claim
     (R13/R19): validate Twilio signature + SID formats (R16); accept only
     CallStatus='in-progress' (answered proof) or 'completed' (lost-answered recovery);
     canceled/busy/failed/no-answer legs never claim; cross-check row↔ParentCallSid,
     org, Active profile whose twilio_client_identity matches the answered <Client>
     leg, agent ∈ persisted routed_agent_ids (fail closed — R3/R14); only then invoke
     the service-role-only CAS RPC; child CallSid stored in provider_session_id
     (first-writer-wins — R2; never NULL after success — R16). A delayed authentic
     callback ENRICHES an already-terminal row (agent_id + provider_session_id only —
     terminal status/ended_at/duration untouched — R19). Duplicate deliveries take a
     READ-ONLY idempotent-success path — zero row mutation, updated_at untouched (C1).
     Transient failures → 5xx (retryable); business rejections / losing legs → 2xx.
     The browser performs NO ownership write; its accept event is UI-only and it
     reads/polls the exact row (R13).
  8. Dial action / fallback paths: forward → voicemail/hangup honoring voicemail_enabled;
     missed marked only after the final attempt fails; finalize_inbound_call_terminal RPC
     (NEW) with observable, retried persistence — never best-effort-swallowed (R17)
  9. twilio-voice-status: unchanged duration canon + FULL monotonic status ladder
     ringing → connected → terminal (R7)
 10. twilio-recording-status: verified-persistence-before-delete pipeline with bounded
     Twilio-retry channel (R17); browser recording explicitly skips inbound
```

Historical rows are untouched: every new DB object is future-facing; every new write path is keyed to the specific new call row being processed; a webhook retry mutates nothing.

---

## 3. Change set A — canonical inbound identity

### 3.1 New SQL (migration M1, §8)

1. **`public.phone_last10(p text) RETURNS text` — IMMUTABLE STRICT** helper: `right(regexp_replace(p,'[^0-9]','','g'),10)` returning NULL when fewer than 10 digits. The one normalization rule for stored-CRM-phone matching.
2. **Expression indexes** (future-facing; indexing existing rows reads them and alters nothing — R6):
   `idx_leads_org_phone_last10 ON leads (organization_id, public.phone_last10(phone))`, same for `clients` and `recruits`; plus `idx_calls_org_outbound_contact_phone_last10 ON calls (organization_id, public.phone_last10(contact_phone)) WHERE direction = 'outbound'` for the R18 `last_agent` tier. (No `campaign_leads` index — that table is out of the resolver per R8.)
3. **`public.resolve_inbound_contact(p_org_id uuid, p_phone text) RETURNS jsonb`** — the ONE canonical resolver. `STABLE`, `SET search_path = pg_catalog, pg_temp`, schema-qualified, **EXECUTE: service_role only** (REVOKE PUBLIC/anon/authenticated — the browser never resolves independently).
   - Normalizes the ANI to last-10 (≥10 digits required; else `not_found`).
   - Candidate set = DISTINCT `(contact_type, contact_id)` over **`leads` ∪ `clients` ∪ `recruits`** (org + `phone_last10(phone)` match). **`campaign_leads` are excluded** (R8).
   - Returns `{resolution: 'unique'|'ambiguous'|'not_found', contact_id, contact_type, contact_name, match_count}`. `unique` ⇔ **exactly one** distinct candidate; ≥2 (within or across types) ⇒ `ambiguous` with NULL identity (D1, §14). Name built `trim(first_name||' '||last_name)`, sanitized server-side (never `"undefined undefined"` — 2026-08-11 canon).
4. **`public.ingest_inbound_call(p_twilio_call_sid text, p_org_id uuid, p_from_number text, p_to_number text, p_auto_create boolean) RETURNS jsonb`** — atomic, retry-silent, replay-safe ingest. Repo privileged-function standard: `SET search_path = pg_catalog, pg_temp`, schema-qualified, **EXECUTE: service_role only**.
   - **SID validation first (R16):** `p_twilio_call_sid` must match `^CA[0-9a-fA-F]{32}$`; blank/malformed ⇒ error result, nothing written.
   - `INSERT … ON CONFLICT (twilio_call_sid) WHERE direction = 'inbound' AND twilio_call_sid IS NOT NULL DO NOTHING` (arbiter = the R6 index). **On conflict (no row returned): exact SELECT by `twilio_call_sid = p_twilio_call_sid AND direction = 'inbound' AND organization_id = p_org_id`** — then **verify the existing row's `caller_id_used` equals `p_to_number` as the exact trimmed Twilio E.164 value** (a full country-code-preserving E.164 canonicalization is the only permitted alternative; **`phone_last10` is never used for DID identity** — two DIDs sharing trailing ten digits under different country codes must not compare equal — R22). A same-SID **cross-org replay** (SELECT finds nothing in `p_org_id`) or a **different-DID replay** (DID mismatch) **fails closed** with an error result — the RPC never returns another organization's row (R16). A genuine Twilio retry (same org, same DID) returns the existing row's state with **zero row mutation** — no `updated_at` bump, no trigger re-fire, no re-resolution, no auto-create (R6).
   - Insert values: `direction='inbound'`, `status='ringing'`, `contact_phone = p_from_number` (raw Twilio ANI — **preserved verbatim; never replaced by the CRM stored phone**), `caller_id_used = p_to_number`, `organization_id = p_org_id`, `agent_id = NULL`, **`contact_type = NULL` explicitly** (defeats the false `'lead'` default; CHECK accepts NULL), `contact_name = NULL`.
   - On fresh insert: call `resolve_inbound_contact`; if `unique`, link via guarded `UPDATE … SET contact_id, contact_type, contact_name WHERE id = v_id AND contact_id IS NULL` (races/retries converge; `contact_phone` untouched).
   - **Auto-create requires BOTH `p_auto_create` AND resolution = `not_found` AND a non-null valid normalized ANI (R21).** When `public.phone_last10(p_from_number)` is NULL — Twilio caller values like `anonymous`, `unknown`, `restricted`, or fewer than 10 digits — the RPC preserves the raw caller value in `contact_phone`, leaves the call unlinked with `contact_type = NULL`, routing proceeds normally, **no advisory lock is taken and no lead is ever created**. Only with a valid last-10 is auto-create serialized per (org, normalized phone) (R9): take `pg_advisory_xact_lock(hashtextextended('af_inbound_autocreate:' || p_org_id::text || ':' || v_last10, 0))`, **re-run `resolve_inbound_contact` inside the lock**, and only if still `not_found` insert the lead (E.164 phone, `first_name 'Inbound'`, `last_name 'Caller'`, `lead_source 'Inbound Call'`, `status 'New'`, `assigned_agent_id` NULL — deliberate, "answering agent can claim", 2026-05-19 canon) and link it via the same guarded update. Two simultaneous unknown calls from one number therefore converge on **one** lead. **`ambiguous` and any resolver error: no link, no auto-create, ever.**
   - Returns `{call_row_id, inserted, resolution, contact_id, contact_type, contact_name}` or `{error}` on the fail-closed branches (the Edge caller then refuses routing with safe terminal TwiML + telemetry — a fail-closed ingest never rings agents against a foreign or mismatched row).
5. **`public.find_last_agent_for_inbound(p_org_id uuid, p_contact_id uuid, p_last10 text) RETURNS uuid`** (R10/R18) — `STABLE`, repo-standard search_path, **EXECUTE: service_role only**. **Two sequential tiers**, because historical outbound rows may lack `contact_id`:
   - **Tier 1** (only when `p_contact_id` is non-null): newest same-org call with `direction='outbound' AND agent_id IS NOT NULL AND contact_id = p_contact_id`.
   - **Tier 2** (**runs whenever tier 1 finds no row** — including when `p_contact_id` was supplied): newest same-org call with `direction='outbound' AND agent_id IS NOT NULL AND public.phone_last10(contact_phone) = p_last10` (index-backed).
   - Contact-ID matches outrank phone matches; **`caller_id_used` is never consulted** — it is the agency DID, not the customer.

### 3.2 `twilio-voice-inbound` rewiring

- `handleInitialInbound` replaces the insert + enrich + auto-create blocks (`:1050-1142`) with one `ingest_inbound_call` RPC call (settings' `auto_create_lead` passed in). Resolution outcome is logged (`[twilio-voice-inbound] identity resolution`, with `resolution` + `match_count`). An `{error}` result (malformed SID / cross-org / DID-mismatch replay) refuses routing: safe terminal TwiML + telemetry, never a ring against a wrong row. Otherwise routing proceeds regardless of resolution result (best-effort identity, guaranteed routing — unchanged posture).
- `resolveInboundContact`, its variant builders, and the inline auto-create block are deleted from the Edge function (logic now lives in SQL where it is testable and indexed).
- `resolveLastAgentIdentities` is rewired to `find_last_agent_for_inbound` (passing the ingest result's `contact_id` when resolution was `unique`, plus the ANI last-10 always — the RPC applies the R18 two-stage order), then the existing Active-profile validation.

### 3.3 Browser consumes the authoritative call-row identity

- **New RPC `public.get_inbound_call_identity(p_call_row_id uuid) RETURNS jsonb`** (migration M2), tightened per R4: `STABLE SECURITY DEFINER`, `search_path = pg_catalog, pg_temp`, **EXECUTE: authenticated + service_role** (REVOKE PUBLIC/anon). This RPC *is* browser-invoked through PostgREST with the user's JWT, so `auth.uid()` is valid here (unlike the claim RPC — R1/R13). Requirements enforced in the body, all from database-authoritative `public.profiles`:
  - non-null `auth.uid()`; profile exists, **`status='Active'`**, org derived from the profile row;
  - target row: exact `id = p_call_row_id` AND `organization_id = v_org` AND `direction='inbound'`;
  - **authorization branch:** `agent_id = auth.uid()` (already the assigned agent), **or** — for a ringing identity request — `agent_id IS NULL AND status = 'ringing' AND created_at > now() - interval '15 minutes' AND auth.uid() = ANY(routed_agent_ids)` (fail-closed when `routed_agent_ids` is NULL/empty, consistent with R3).
  - Anything else ⇒ NULL. **Mere possession of a row UUID by an org member retrieves nothing.** Returns `{calls_row_id, contact_phone, caller_id_used, contact_name, contact_id, contact_type, status, agent_id}`. No fallback of any kind. Under R13 this read path is also how the answering browser confirms ownership: it polls/subscribes on the exact row until `agent_id` becomes its own uid (the routed branch covers the pre-claim window; the owner branch covers post-claim).
- `TwilioContext` incoming handler reads `call.customParameters.get("af_call_row_id")` (§4) and fetches identity by row id — replacing the 350 ms `peek` poll storm with one fetch + a short bounded retry. The Realtime `calls` subscription stays as the update channel for late enrichment and for the R13 ownership confirmation.
- **Field-ordering fix (inbound-only), all read sites:** prefer `contact_phone` (ANI) and treat `caller_id_used` as the AgentFlow number — `applyInboundAniFromCallsRow` (`:817`), the claimed-row read (`:574`), `reconcileIdentifiedContactFromCallsRow` (`:725`, `:728`), `hasAni` (`:978`). The org-DID exclusion set stays as a defensive backstop for SDK-supplied values, but stops being the primary mechanism. `reconcileIdentifiedContactFromCallsRow` supports `recruit` (drops the client-else-lead collapse; recruit lookups go to `recruits`).
- **Divergent name-only resolver — deprecated, NOT dropped (R5):** the `resolve_inbound_caller_display_name` effect (`:541-620`) is removed from the new frontend runtime path. Because migrations deploy before the new frontend and stale browser bundles may stay open, the RPC itself is **retained for this release as a deprecated compatibility wrapper**: migration M2 `CREATE OR REPLACE`s its body to delegate to the canonical resolver semantics — org-scoped, auth-required, returning a name **only on a unique canonical match** (never `ORDER BY updated_at LIMIT 1` guessing), NULL otherwise — with a `COMMENT` marking it deprecated. Its generated typing in `types.ts` is **kept**. The actual `DROP FUNCTION` happens in a later cleanup release after bundle rollover (tracked in §16).
- **Floating recent calls (R8 — no second resolver, no phone probing):** the current leads-only `.ilike` probe, the last-10 first-match map, and the `"Closed Won" ⇒ 'client'` type inference are **deleted, not extended**. Render identity comes from, in order: (1) `contact_id` + `contact_type` → batch resolve **by id** against the correct table (leads/clients/recruits `IN` queries); (2) the call-row `contact_name` snapshot when present; (3) the ANI (`contact_phone`), formatted. **Historical unlinked calls simply remain phone-only — that is accepted and correct.** Quick-call from a typed recent row passes the true `contact_type` (no `"lead"` default for typed rows).
- Conversation history: **no change** — it stays strictly `contact_id`-based; new inbound calls appear because `calls.contact_id` is now written correctly (test T8).

---

## 4. Change set B — exact WebRTC correlation and Twilio-authoritative answer claiming (R13)

> Revision-2's browser-triggered claim gate (claim after `twilioAnswerCall()` resolves) is **withdrawn as invalid**: `Call.accept()` returns void, so that promise proves initiation, not answer (§1.3). The authoritative answer signal is Twilio's own child-leg `answered` status callback.

### 4.1 Correlation + answer-callback mechanism (verified before use)

- **Display correlation (unchanged from Rev 2):** each `<Client>` noun carries `<Identity>` + `<Parameter name="af_call_row_id" value="{uuid}"/>` → surfaces as `call.customParameters` in Voice SDK 2.18.1 (house precedent: AI-testing `bridge_token`, 2026-06-02). **`af_org_id` is NOT passed (R3)** — org identity always comes from the database.
- **Answer authority (NEW — R13, delivery-hardened per R19):** each generated `<Client>` noun additionally sets
  `statusCallback="{SUPABASE_URL}/functions/v1/inbound-call-claim?call_row_id={uuid}&agent_id={uuid}" statusCallbackEvent="answered completed" statusCallbackMethod="POST"`
  — one URL **per routed agent**, generated server-side while building the wave (the same place `routed_agent_ids` was just durably persisted — R14). `call_row_id` and `agent_id` therefore **never originate from the browser**; they are server-issued and covered by the Twilio request signature (Twilio signs the full URL including the query string — the exact scheme the four voice webhooks already validate). Twilio fires these callbacks on the **child leg** with `CallSid` (child), `ParentCallSid`, `CallStatus`, and `To`/`Called` = `client:<identity>` of the leg. **Two proofs, ordered (R19):** the `answered` event (`CallStatus='in-progress'`) is the primary answered proof; the `completed` event (`CallStatus='completed'`) is the recovery proof when the answered delivery was lost — a leg that ended `canceled`/`busy`/`failed`/`no-answer` never claims. **Each claim-callback URL also carries the same bounded webhook connection-override retry configuration as the R17 recording callbacks** (retries on connection failure, read timeout, and HTTP 5xx — Twilio does not retry 5xx by default), so a transient claim-delivery failure is redelivered rather than lost.
- **Implementation-time verification gates:** (a) `<Client>` noun `statusCallback`/`statusCallbackEvent` attribute support and its exact callback parameter set confirmed against current Twilio TwiML docs; (b) `customParameters` arrival; both proven in staging scenario 1 before anything builds on them. Twilio webhook **connection-override** syntax for R17's retry channel is verified the same way (§7).
- Browser child-leg SID handling in the UI (`call.parameters.CallSid`) becomes display/telemetry-only. **Parent SID is never re-homed:** `twilio_call_sid` keeps the PSTN parent SID forever; `provider_session_id` is written exclusively by the claim path from **Twilio's** child `CallSid` — first-writer-wins (R2), never NULL after a successful claim (R16).

### 4.2 `public.claim_inbound_call(p_user_id uuid, p_call_row_id uuid, p_child_call_sid text, p_parent_call_sid text) RETURNS jsonb` (migration M2) — service-role-only CAS (R1 core, R13 trigger, R16 validation)

`SECURITY DEFINER` (repo standard), `SET search_path = pg_catalog, pg_temp`, schema-qualified, **EXECUTE: service_role ONLY** (REVOKE PUBLIC/anon/authenticated). Invoked exclusively by the Twilio-signed answer callback handler (§4.4) through the service-role client — never written around `auth.uid()`, never callable by authenticated users directly.

- **Input validation before anything else (R16):** `p_child_call_sid` and `p_parent_call_sid` must both match `^CA[0-9a-fA-F]{32}$` (blank/malformed ⇒ `{claimed:false, reason:'invalid_sid'}`); `p_user_id`/`p_call_row_id` non-null.
- **Profile checks (R1, database-authoritative):** `public.profiles` row for `p_user_id` must exist, be **`status='Active'`**, hold a non-null `twilio_client_identity`; org = the profile's `organization_id`.
- **One atomic FIRST-WRITE compare-and-swap UPDATE** (C1 — the only write the claim path ever issues). The first successful delivery sets ownership + session + the `ringing → connected` advance (or performs R19 terminal late enrichment) in one statement; the `agent_id IS NULL` term makes it fire **at most once per row**, so `updated_at` is bumped exactly once and update triggers fire exactly once:
  ```sql
  UPDATE public.calls SET
    agent_id            = p_user_id,
    provider_session_id = COALESCE(provider_session_id, p_child_call_sid),  -- first-writer-wins (R2)
    status              = CASE WHEN status = 'ringing' THEN 'connected' ELSE status END,
                                                -- a terminal status is NEVER changed (R7/R19);
                                                -- ended_at/duration/terminal metadata untouched
    updated_at          = now()
  WHERE id = p_call_row_id
    AND organization_id = v_org                 -- exact org match; NEVER updated
    AND twilio_call_sid = p_parent_call_sid     -- row↔ParentCallSid cross-check (R13/R16)
    AND direction = 'inbound'
    -- NO live-state predicate (R19): a delayed authentic answered/completed callback may
    -- ENRICH a row that already became terminal via the parent callback — same CAS,
    -- ownership fields only; the status CASE above leaves terminal states untouched.
    AND agent_id IS NULL                        -- FIRST WRITE ONLY (C1): an owned row is never
                                                -- re-written by this path; duplicates take the
                                                -- read-only classification below. (The first write
                                                -- always sets both agent_id and provider_session_id
                                                -- — the child SID is validated non-blank — so
                                                -- "agent_id set, session missing" is unreachable.)
    AND (provider_session_id IS NULL
         OR provider_session_id = p_child_call_sid)       -- same child leg only; a different SID
                                                          -- never replaces the first (R2)
    AND routed_agent_ids IS NOT NULL
    AND p_user_id = ANY (routed_agent_ids)      -- durably persisted routing eligibility REQUIRED;
                                                -- empty/null ⇒ FAIL CLOSED (R3, guaranteed persisted by R14)
  RETURNING id, agent_id, provider_session_id, status,
            contact_id, contact_type, contact_name, contact_phone, caller_id_used;
  ```
- **Read-only classification on 0 rows (C1)** — a single `SELECT` of the row by `id` (service role, no lock, **no UPDATE, no `updated_at` bump, no trigger fire, no column change of any kind**), classified in this exact order:
  1. row missing, `organization_id ≠ v_org`, or `direction ≠ 'inbound'` ⇒ `{claimed:false, reason:'cross_org_or_not_found'}`;
  2. `twilio_call_sid ≠ p_parent_call_sid` ⇒ `{claimed:false, reason:'parent_sid_mismatch'}`;
  3. `routed_agent_ids` NULL/empty ⇒ `{claimed:false, reason:'no_routed_agents'}`; `p_user_id ∉ routed_agent_ids` ⇒ `{claimed:false, reason:'not_routed'}`;
  4. **exact duplicate** — `agent_id = p_user_id AND provider_session_id = p_child_call_sid` (with 1–3 already satisfied: same row, parent SID, org, direction, agent, child SID, routed membership) ⇒ **`{claimed:true, idempotent:true}` — returned from the read alone; the entire row, `updated_at` included, stays byte-identical**;
  5. `agent_id = p_user_id AND provider_session_id ≠ p_child_call_sid` ⇒ `{claimed:false, reason:'sid_conflict'}`;
  6. `agent_id` non-null and ≠ `p_user_id` ⇒ `{claimed:false, reason:'already_claimed'}`.
  Concurrency: two simultaneous first deliveries serialize on the row lock — the winner's CAS commits; the loser's CAS then matches 0 rows (`agent_id` no longer NULL) and its classification returns `idempotent:true` (same agent/leg) or `already_claimed` (different agent). Reason codes (`invalid_sid` / `inactive_profile` from the preconditions, plus the six above) remain actionable telemetry logged by the handler.
- Success on an already-terminal row returns `{claimed:true, enriched_terminal:true}` (telemetry distinguishes late enrichment from a live claim); a duplicate of that enrichment takes the same read-only `idempotent:true` path. A **successful claim structurally cannot leave `provider_session_id` NULL** (R16): the SID is validated non-blank and the COALESCE has no NULL branch; the RPC additionally asserts the RETURNING value is non-null. A transient database error inside the RPC propagates as an error result so the handler can answer 5xx for Twilio redelivery (R19) — it is never converted into a business rejection; the 5xx-transient / 2xx-business response policy is unchanged.
- `organization_id` is structurally untouchable. Simultaneous calls cannot cross-claim: row id, parent SID, org, and routed membership are all checked. If availability under routing-persist failure is ever needed, a **signed per-agent short-TTL claim token** is a separate future design (§16) — under R14, an un-persisted wave is never rung at all, so that gap no longer occurs in normal operation.

### 4.3 Peek made exact-only

- Migration M2 `CREATE OR REPLACE public.peek_inbound_call_identity(p_provider_session_id, p_twilio_call_sid)` with the **6-minute newest-ringing fallback deleted** — exact match only (same signature; prefix-tolerance kept). `REVOKE … FROM anon` (function ACL hardening, not RLS). Old bundles get exact-or-null — strictly safer than today's cross-call bleed. The **"latest ringing" guess is removed from both peek and claim behavior everywhere**.

### 4.4 `inbound-call-claim` repurposed as the Twilio answer-claim webhook; browser performs no ownership write (R13)

- **The Edge function becomes a Twilio webhook, not a browser API:**
  1. Parse the form body; **validate the Twilio signature** against the actual request URL (including the server-issued `call_row_id`/`agent_id` query params) + sorted form params — the same HMAC-SHA1 scheme and canonical `SUPABASE_URL` base as the other four voice webhooks. Invalid ⇒ 403, nothing written.
  2. **Require an answer proof (R19):** accept `CallStatus='in-progress'` (the `answered` event — primary proof) or `CallStatus='completed'` (the `completed` event — recovery proof when the answered delivery was lost). A child leg reporting `canceled`, `busy`, `failed`, or `no-answer` **never claims** ⇒ 200 ack, no write (an ignored losing-leg event must not trigger retries).
  3. **Validate SIDs (R16):** child `CallSid` and `ParentCallSid` both present and `^CA[0-9a-fA-F]{32}$`.
  4. **Cross-checks before invoking the RPC** (all read via service role, org derived from the row + profile — never from the request): the row addressed by `call_row_id` exists, is `direction='inbound'`, and its `twilio_call_sid` equals `ParentCallSid`; the `agent_id` URL param's profile is Active, same-org as the row, and its `twilio_client_identity` **matches the leg's `Called`/`To` client identity** in the callback body; the agent is present in the durably persisted `routed_agent_ids`. **There is no live-row-only precheck (R19):** a signed, fully cross-checked callback that arrives after the parent already terminalized the row proceeds to the RPC as a late ownership enrichment.
  5. Only then call `claim_inbound_call(p_user_id := <agent_id from the signed URL>, p_call_row_id, p_child_call_sid := CallSid, p_parent_call_sid := ParentCallSid)`. **Response codes (R19):** transient failures (profile/row lookup errors, RPC exceptions, DB unavailability) ⇒ **5xx**, so the R19 retry-configured callback URL redelivers; valid business rejections (`not_routed`, `already_claimed`, `sid_conflict`, cross-org, mismatches) and ignored losing-leg events ⇒ **2xx** with the reason logged (`console.warn("[inbound-call-claim] rejected", {reason, call_row_id, agent_id, parentCallSid})` — R3 telemetry); invalid signature stays 403.
  - **Legacy browser contract disabled:** any request without a valid Twilio signature — which includes every legacy JWT browser request from stale bundles — is rejected with **no DB write of any kind** (those bundles' claims never succeeded anyway, §1.3; nothing regresses).
- **TwilioContext (browser = UI only):**
  - Incoming handler: store `af_call_row_id` from `customParameters`; **delete both claim invocations** (`:1852-1861` claim-on-ring and the `answerIncomingCall` claim at `:1402-1411`) and the `claimInboundCall` helper's write path entirely. **The browser performs no ownership write.**
  - `answerIncomingCall`: `twilioAnswerCall(call)` remains the media accept (UI state only). While waiting for the signed Twilio callback to land, the browser **reads** the exact row — Realtime on `calls` plus a short bounded poll of `get_inbound_call_identity(af_call_row_id)` — and treats `agent_id = my uid` as ownership confirmation: only then set `activeCallIdRef`/`inboundClaimedCallRowId`/`callIdsDbSyncedRef`. If the row shows a different `agent_id` (lost race) → "answered by another agent" UI + local teardown, no writes. If ownership never appears within the bound (lost callback) → the call still works; telemetry logs the anomaly; no browser write "repairs" it.
  - `syncIdsToRow` (`:1676-1696`): **skips inbound entirely** (the claim path owns `provider_session_id`; `twilio_call_sid` is parent-only). Outbound behavior byte-identical.
  - Rejecting/ignoring a ring leaves the row untouched (no `activeCallIdRef` ⇒ `finalizeCallRecord` no-ops).
  - Every re-entrancy ref in invariant #9 is preserved; no new refs beyond one `inboundCallRowIdRef` (cleared with the existing display-clear path).

---

## 5. Change set C — routing correctness (no architecture change)

All within `twilio-voice-inbound`; single-leg TwiML preserved; tier business meanings preserved.

1. **all-ring** (`resolveAllOrgIdentities`): adds `.eq("status","Active")` — same-org + Active + non-null `twilio_client_identity` only. (Supersedes the 2026-05-19 "do not change all-ring" scope freeze — explicitly required by this task; flagged in §14 D8.)
2. **assigned + direct-line** (`resolveAssignedIdentity`): lookup becomes org-scoped and Active-checked (`id = assigned_to AND organization_id = :org AND status='Active'`, identity non-null). A direct line whose owner is inactive/cross-org now falls to the terminal fallback rather than ringing a wrong/dead identity.
3. **round_robin**: already Active+org-filtered; unchanged.
4. **Routed persistence precedes ringing (R14):** for the initial wave, the direct-line wave, and **every** chain wave, the webhook **awaits `append_call_routed_agents` and requires `true`** before emitting any `<Client>`. On exception, `false`, or zero-row result: **no agent-dialing TwiML is returned for that wave.** Deterministic safe failure path: route to voicemail when `voicemail_enabled`, else the documented terminal infrastructure-failure path (the hangup branch), in both cases with actionable telemetry (`[twilio-voice-inbound] routed-persist FAILED — wave suppressed`, with call ids and wave key). This closes the R3 interaction where an agent could be rung whose claim is guaranteed to fail. Wave de-duplication is unchanged in intent: each step reads the row's `routed_agent_ids` and excludes already-rung agents; `resolveActiveRingTargetsByAgentIds` additionally gains `.eq("organization_id", orgId)`. The `append_call_routed_agents` RPC itself is byte-unchanged — only its call sites change from best-effort to mandatory-before-ring.
5. **`last_agent` tier fixed (R10/R18):** replaced with `find_last_agent_for_inbound` (§3.1.5) — **two sequential tiers**: newest same-org outbound call by `contact_id` (when the inbound call resolved one), and **only if that finds no row**, newest same-org outbound call by `phone_last10(contact_phone)` (index-backed). Historical outbound rows lacking `contact_id` are therefore still reachable through tier 2 even when a contact id was supplied. The raw ANI-variant `.or()` chain and the `caller_id_used` comparison are deleted. Tests cover formatted stored `contact_phone`, cross-org exclusion, and the supplied-contact-id-but-phone-linked-history case (§11).
6. **Ring timeout:** `loadPhoneSettings` also selects `ring_timeout`; `buildDialTwiml` takes `timeoutSec` = clamp(`phone_settings.ring_timeout` ?? 30, 5, 120) (bounds mirror the campaign-settings Zod canon) applied to **every** wave. Per-number override: none exists in schema (§1.6) — documented, not invented; the six existing per-number override columns keep their exact precedence (`numberOverrides ?? orgData ?? default`).
7. **Voicemail honored:** in `emitTerminalFallback`, `handleFallback`, and the business-hours-closed branch — when the effective `fallback_action` resolves to voicemail (explicitly or by default) **and `voicemail_enabled` is false**, emit the documented non-voicemail terminal behavior instead: the hangup branch (`<Say>{greeting}</Say><Hangup/>`) — no `<Record>` is ever emitted (D3, §14). `fallback_action='forward'`/`'hangup'` behave as configured today.
8. **Forwarding preserved:** `buildForwardTwiml` unchanged (still no recording attrs — §7 documents this as intentional). Forward return path per §6.
9. **Business-hours + after-hours SMS:** logic unchanged, except missed-marking timing (§6) and the voicemail_enabled check above.

---

## 6. Change set D — lifecycle, idempotency, missed-call semantics

### 6.1 Initial-CallSid idempotency (migration M1) — simplified per R6, replay-hardened per R16

- **Constraint audit (done):** no unique constraint/index exists on `twilio_call_sid`; **zero duplicate inbound SIDs exist in production** (verified read-only). The index is the simple, strong form — **no timestamp predicate**:
  `CREATE UNIQUE INDEX uq_calls_inbound_twilio_call_sid ON public.calls (twilio_call_sid) WHERE direction = 'inbound' AND twilio_call_sid IS NOT NULL;`
  Indexing existing rows is not a historical backfill and alters none of their data; the unbounded predicate keeps `ON CONFLICT` inference simple and guarantees that even a *late* retry of an old SID cannot create a second row. Pre-apply preflight (runbook, read-only): re-assert zero duplicate inbound SIDs so index creation cannot fail.
- `ingest_inbound_call` conflict semantics per §3.1.4: exact SELECT scoped by SID + `direction='inbound'` + `organization_id`, DID cross-check, cross-org/different-DID replay **fails closed**; a genuine retry performs **zero row mutation**.
- Outbound rows are structurally out of scope of the index and the RPC (test T28 pins outbound insert behavior unchanged).
- Retries therefore: same row id returned; status/recording lookups keyed by SID keep finding exactly one row; no duplicate workflow dispatch; no duplicate auto-created lead.

### 6.2 Terminal-state safety net (migration M2) — observable, retryable persistence (R17)

- **`public.finalize_inbound_call_terminal(p_call_row_id uuid, p_org_id uuid, p_status text, p_mark_missed boolean) RETURNS jsonb`** — `SECURITY DEFINER`, repo-standard search_path, **EXECUTE: service_role only**. Validates `p_status ∈ ('completed','no-answer','failed')`; one guarded UPDATE:
  `WHERE id = p_call_row_id AND organization_id = p_org_id AND direction = 'inbound' AND status NOT IN ('completed','failed','no-answer')` setting `status = p_status`, `ended_at = COALESCE(ended_at, now())`, `is_missed = is_missed OR p_mark_missed`, `updated_at = now()`. **Never writes `duration`** (invariant #8). Returns a **discriminated result**, not a bare boolean: `{updated:true}` · `{updated:false, reason:'already_terminal'}` (expected idempotent success — verified by reading the row's terminal status) · `{updated:false, reason:'not_found_or_mismatch'}` (error).
- **No best-effort-swallow at the call sites (R17):** each Dial-action/fallback handler in `twilio-voice-inbound` treats `already_terminal` as success, and treats an RPC error or `not_found_or_mismatch` as a **persistence failure** that is (a) retried with a small bounded in-request retry (up to 3 attempts with short backoff — the TwiML to return does not depend on the result, so retrying before responding is safe within the webhook budget), and (b) on ultimate failure emitted as **structured, actionable telemetry** (`[twilio-voice-inbound] TERMINAL-FINALIZE FAILED`, with call id, org, target status, reason) — never a silent `catch`+ack. Convergence remains multi-writer by design: the parent status callback (`twilio-voice-status`) independently writes the same terminal state when it arrives.
- Call sites (unchanged list): chain-step `DialCallStatus ∈ (completed|answered)` → `completed` · forward-return answered → `completed` (answered forward ⇒ **not** missed) · voicemail entry → mark missed + notify, then the `<Record>` action (`fallback=hangup` ack) → `completed` · hangup terminal (incl. voicemail-disabled path) → mark missed + notify → `no-answer`.
- **Honest reliability claim (R17):** this build makes a stranded-`ringing` row require **both** independent terminal writers (the Dial-action finalize with its bounded retry, and the parent status callback) to fail — with every failure observable in telemetry rather than swallowed. It does not claim absolute impossibility. (Side benefit: the contact timeline's no-disposition fallback renders raw `calls.status` — `CallHistoryItem.tsx:60-62` — so permanently-`ringing` rows currently leak "Ringing" cards into history; finalization ends that for new calls.)

### 6.3 `twilio-voice-status` — full monotonic status ladder (R7)

- Status progression is defined and enforced as **`ringing → connected → terminal (completed | no-answer | failed)`**, extracted into a pure, vitest-tested module (`terminal-guard.ts`, the `duration.ts` pattern). Before applying the switch's `patch`:
  - stored `connected` + incoming `ringing` ⇒ **status write dropped** (the `connected→ringing` hole is closed);
  - stored terminal + incoming `ringing`/`in-progress` ⇒ status/started_at writes dropped;
  - stored terminal + incoming terminal ⇒ status write dropped (first accepted terminal state stands);
  - in every suppressed case, **permitted monotonic enrichment still applies**: `duration` via the existing `chooseDurationToWrite` guard, `ended_at` set only when NULL, `shaken_stir`/metadata.
- Twilio remains the **only** duration writer — the ladder never adds a duration write path and never blocks the monotonic duration guard. Everything else in the function — including the missed-notification call — is byte-preserved.

### 6.4 Missed-call semantics

- **Removed:** the premature `is_missed`+notify in `emitTerminalFallback` *before* emitting forward TwiML, and the equivalent in the business-hours-closed branch when the after-hours action is forward.
- **Rules going forward (new calls only):** a call is marked missed (and notifications fan out) only when (a) it enters voicemail after all agent/forward attempts failed, (b) it hits the hangup terminal, or (c) a forward attempt returns unanswered. A forwarded call answered by the external number is finalized `completed`, never missed. Business-hours-closed with voicemail/hangup actions still mark missed at entry (nobody will be rung — semantics preserved).
- **Notification layer untouched:** recipient priority, fail-closed resolution, `(user_id,event_key)` idempotency, and every historical notification row stay exactly as shipped in PR #361. `twilio-voice-status`'s notify condition is unchanged (its `is_missed` inputs simply become accurate).

---

## 7. Change set E — recording safety (one authoritative recorder per direction; verified persistence before deletion — R17)

- **Inbound = Twilio server-side only** (existing `<Dial record="record-from-answer-dual">` + voicemail `<Record>` — preserved). **Browser recording explicitly skips inbound:** the `call.on("accept")` recording block gains an `isVoiceSdkInboundDirection(getCallDirection(call))` early-return. **Outbound = browser-side only, byte-unchanged** (T28).
- **`twilio-recording-status` — reliability pipeline (R17):**
  1. **Idempotency short-circuit:** only an existing **valid `recording_storage_path`** on the matched row is success ⇒ log + 200 ack, no download/upload/write/delete. **Failure sentinels are NOT success** — a row whose `recording_url` carries `__recording_failed__`/`__recording_upload_failed__` (with NULL `recording_storage_path`) is a *recoverable* state and proceeds through the pipeline again.
  2. **Verified persistence:** after storage upload, the calls-row metadata update must **provably succeed exact-row** — `.update({recording_storage_path, recording_duration, recording_url}).eq("id", rowId).eq("organization_id", orgId).select("id")` and treat error or zero rows as failure (no more log-and-continue `updateCallsRow`).
  3. **Delete only after commit:** the Twilio source recording is deleted **only after** storage upload AND the verified DB update have both succeeded. On download, upload, lookup, or DB-update failure, the Twilio source is preserved.
  4. **Bounded retry channel:** recoverable failures return **HTTP 5xx**, and — because **Twilio's default webhook retry policy does not retry 5xx responses** — every generated `recordingStatusCallback` URL carries Twilio's **webhook connection-override** retry configuration enabling bounded retries for 5xx/connect/read-timeout failures (exact override syntax verified against current Twilio docs at implementation, per the §4.1 gate pattern; overrides live in the URL fragment, which Twilio strips before requesting, so signature validation is unaffected). Sentinel writes still happen (guarded `…AND recording_storage_path IS NULL`) so the UI reflects the pending-failure state, but they no longer terminate recovery: the preserved Twilio source + retry channel converge to success, at which point the guarded success write replaces the sentinel.
  5. **Unmatched callbacks** (no calls row for the SID): log + ack **without downloading, uploading, or deleting** — the recording stays intact at Twilio (recoverable), and no orphaned `unmatched/` object is created.
- Nothing deletes or rewrites existing stored recordings; storage path scheme unchanged; row updates are row-id + org-scoped (never bare-SID).
- **Forwarded external legs are NOT recorded — intentional, documented:** `buildForwardTwiml` carries no recording attributes and this build adds none (compliance-sensitive; expanding requires separate approval). Voicemail `<Record>` continues to report to `twilio-recording-status` regardless of `recording_enabled` (existing behavior — it is the voicemail message itself).
- Known accepted quirk (documented, unchanged): dial-recording and voicemail-recording for one call are practically disjoint; with idempotency, the first completed recording wins the row columns.

---

## 8. Migrations authored — **APPLIED to production 2026-08-23** (see §8.1 for the authored-version → production-version map)

| File | Contents | Historical-data footprint |
|---|---|---|
| `supabase/migrations/20260823222528_inbound_identity_foundation.sql` (M1) | `phone_last10` fn · 3 contact-table expression indexes + the `calls` outbound last-agent expression index · partial unique `uq_calls_inbound_twilio_call_sid` (**no timestamp predicate** — R6) · `resolve_inbound_contact` · `ingest_inbound_call` (SID-validated; DO-NOTHING ingest; R16 replay checks with the **R22 exact-E.164 DID comparison**; **R21 invalid-ANI auto-create gate**; R9 advisory-lock auto-create) · `find_last_agent_for_inbound` (R18 two-stage) · COMMENTs · explicit ACLs per the R23 matrix | **None.** DDL only; indexes read rows, modify none. No UPDATE/DELETE/INSERT of user data anywhere. |
| `supabase/migrations/20260823222805_inbound_claim_lifecycle.sql` (M2) | `claim_inbound_call(p_user_id, p_call_row_id, p_child_call_sid, p_parent_call_sid)` (SID regex validation — R16; **no live-state predicate — late terminal enrichment per R19**) · `get_inbound_call_identity` (R4 authorization body) · `finalize_inbound_call_terminal` (discriminated result — R17) · `CREATE OR REPLACE peek_inbound_call_identity` (fallback removed) · `CREATE OR REPLACE resolve_inbound_caller_display_name` as the **deprecated unique-only compat wrapper** (R5 — NOT dropped) · explicit ACLs per the R23 matrix | **None.** Function DDL + ACLs only. |
| `supabase/migrations/20260823203257_rls_phase1_calls_command_split.sql` (RLS Phase 1) | §9 — authored under `#APPROVE_RLS_CHANGE`, separately approved for remote application, **applied to production 2026-08-23** and verified 18/18; **remains the mandatory prerequisite for activating the new inbound TwiML** (R20) | **None.** Policy DDL only; zero table DML, zero backfill. |

### 8.1 Authored-version → production-version map (repository timestamp alignment, 2026-08-23)

Supabase restamps each migration with its apply time, so the four repository files were renamed with
`git mv` to match production exactly (SQL bytes untouched — blob hashes unchanged). Chronological
file order now equals production apply order.

| # | Authored filename (original) | Production / current filename | Git blob (unchanged) |
|---|---|---|---|
| RLS Phase 1 | `20260823120000_rls_phase1_calls_command_split.sql` | `20260823203257_rls_phase1_calls_command_split.sql` | `b83d95d4` |
| M1 | `20260822120000_inbound_identity_foundation.sql` | `20260823222528_inbound_identity_foundation.sql` | `f37d6569` |
| M2 | `20260822120100_inbound_claim_lifecycle.sql` | `20260823222805_inbound_claim_lifecycle.sql` | `51b4d220` |
| M3 | `20260822120200_recording_source_sid.sql` | `20260823222926_recording_source_sid.sql` | `e80565e9` |

The rollback SQL deliberately KEEPS its original name,
`supabase/migrations/rollback/20260823120000_rls_phase1_calls_command_split.rollback.sql`: the
applied Phase 1 migration's header points at that exact path, and its bytes must not change.

**Explicit function ACL matrix (R23)** — stated in both migration files, proven by SQL EXECUTE-matrix tests (§11):

| Function | PUBLIC | anon | authenticated | service_role |
|---|---|---|---|---|
| `resolve_inbound_contact` · `ingest_inbound_call` · `find_last_agent_for_inbound` · `claim_inbound_call` · `finalize_inbound_call_terminal` | REVOKE | REVOKE | REVOKE | GRANT |
| **`phone_last10(text)`** (C2 — IMMUTABLE expression-index helper): least-privilege that **preserves index maintenance** — PostgreSQL evaluates expression-index functions with the DML executor's privileges, so every role that legitimately writes `leads`/`clients`/`recruits`/`calls` needs EXECUTE. That is `authenticated` (app writes under RLS) and `service_role` (Edge writers); `anon` never passes those tables' `TO authenticated` write policies, so it never reaches index evaluation and holds no grant. | REVOKE | REVOKE | GRANT | GRANT |
| `get_inbound_call_identity` — **intentionally authenticated SECURITY DEFINER, reviewed**: in-body `auth.uid()` + Active-profile + org + routed-or-owner checks are the authorization (§3.3) | REVOKE | REVOKE | GRANT | GRANT |
| `resolve_inbound_caller_display_name` (compat wrapper — **current production ACL includes `anon`; that grant is removed**) | REVOKE | REVOKE | GRANT | GRANT |
| `peek_inbound_call_identity` (exact-only replacement) | REVOKE | REVOKE | GRANT | GRANT |

The matrix covers **every** M1/M2 function — none is left to the platform's implicit PUBLIC default. The `phone_last10` hardening ships with **index-maintenance proof tests** (§11): after applying the ACL, an `authenticated`-role INSERT and UPDATE on each of the four expression-indexed tables must still succeed and be visible through the index — proving the helper's REVOKEs cannot break normal writes.

Static self-checks shipped with the build (§12): migrations contain no top-level `UPDATE`/`DELETE`/`INSERT INTO` targeting existing user data; `supabase/tests/*.sql` suites run them on a disposable localhost stack under `BEGIN…ROLLBACK`. Timestamps are > `20260820233402`; apply-time restamp expected per house convention.

---

## 9. RLS — diagnosis; Phase 1 is a MANDATORY gate that PRECEDES TwiML activation (R15/R20); Phase 2 is later privacy narrowing (R11).

> **STATUS UPDATE (2026-08-23): Phase 1 is APPLIED to production and verified.**
> `#APPROVE_RLS_CHANGE` authorized authoring and local testing; a **separate approval** then
> authorized remote application. Phase 1 is authored as
> `supabase/migrations/20260823203257_rls_phase1_calls_command_split.sql` with exact rollback SQL at
> `supabase/migrations/rollback/20260823120000_rls_phase1_calls_command_split.rollback.sql`, and is
> proven locally by `supabase/tests/rls_phase1_{harness,matrix}.sql` via
> `scripts/run_rls_phase1_tests.sh` (6-role authorization matrix, SELECT truth-table equality,
> catalog/security assertions, rollback restore, zero-residue transactional replay, fail-closed
> re-apply). **Verifier correction (2026-08-23, V1–V3):** the runner previously wrapped two psql
> pipelines in `| grep … || true`, which swallowed psql's exit code — a failed post-migration
> authorization matrix could still print OK (reproduced, then fixed). Every psql call now goes
> through capture helpers that record the real exit status, print the captured output on failure and
> return nonzero, with NOTICE filtering applied only after success; the runner proves its own
> plumbing (a known-bad statement and the post matrix run against the pre-Phase-1 policy must both be
> detected) and an injected unexpected failure aborts the whole script. The local apply now uses
> `psql --single-transaction`, with a proof that a failure injected after the policy DDL leaves the
> original two-policy topology intact. Role coverage was completed: Team Leader, the legacy
> `Team Lead` alias and Super Admin DELETE cases, the Team Leader non-downline denial, and cross-org
> UPDATE/DELETE denials on assigned rows (plus peer-read being SELECT-only); the catalog assertion now
> pins each named policy's exact command, permissive mode and `{authenticated}` role list. The
> migration's SELECT/INSERT/UPDATE/DELETE logic was NOT changed — no corrected test exposed a defect
> in it. **It WAS separately approved and APPLIED to production on 2026-08-23** as version
> `20260823203257`. The pre-apply read-only catalog preflight confirmed production still carried
> exactly the reviewed **pre-Phase-1** topology (one PERMISSIVE ALL `Calls Hierarchical Access` plus
> the independent `Calls Agency Group Peer Read` SELECT policy, RLS enabled/not forced, grants
> unchanged). Post-apply catalog verification passed **18/18 postconditions**: the ALL policy is
> gone; exactly five PERMISSIVE `{authenticated}` policies exist with the exact commands; the SELECT
> USING and INSERT WITH CHECK expressions are byte-identical to the originals; UPDATE and DELETE
> both carry the NULL-safe unassigned-inbound exclusion; and peer-read, table grants, RLS
> enabled/forced state, helper definitions and helper ACLs are unchanged. M1/M2/M3 were then
> separately approved and applied (`20260823222528` / `20260823222805` / `20260823222926`).
> **Phase 2 remains out of scope and separately unapproved.** Edge deploys, Twilio reconciliation,
> the frontend release and TwiML activation are all still **outstanding**, each separately gated
> (§15).

**Diagnosis.** `Calls Hierarchical Access` (ALL-commands) USING includes `(get_org_id() IS NOT NULL AND organization_id = get_org_id() AND direction='inbound' AND agent_id IS NULL)`:
1. Every org member can read **all** unassigned inbound calls **forever** — customer ANIs and CRM names included.
2. Because the branch sits in an ALL policy whose `WITH CHECK` accepts `agent_id = auth.uid()`, any org member can **directly UPDATE-claim** any unassigned inbound row via PostgREST — bypassing the authoritative Twilio-confirmed claim flow entirely, and **capable of blocking the real winner** (a squatter's `agent_id` write makes the legitimate CAS fail its `agent_id IS NULL` predicate).

**Phase 1 — mandatory gate BEFORE activation (R15, sequenced per R20):**
- Split the single ALL policy into command-specific policies (`FOR SELECT` / `FOR INSERT` / `FOR UPDATE` / `FOR DELETE`).
- **Preserve today's SELECT visibility exactly** — no reader loses anything they can see now (dashboards, notification deep links, recent-call lists keep working unchanged).
- **Globally exclude unassigned inbound rows (`direction='inbound' AND agent_id IS NULL`) from authenticated UPDATE and DELETE for EVERY authenticated role — Agent, Team Leader, Admin, and Super Admin alike (R20)** — not merely by deleting the explicit regular-org-member branch: the Admin, Team Leader/downline, and super-admin-own-org branches must also carry the exclusion, so no authenticated path can preempt the Twilio-confirmed winner. Claiming becomes possible only through the service-role-only claim path.
- **Required RLS authorization matrix (R20 — acceptance tests of the Phase 1 migration when authored):** (a) Agent, Team Leader, Admin, and Super Admin each **cannot** directly claim/update/delete an unassigned inbound row; (b) the service-role-only claim RPC **can**; (c) every currently permitted update to an **already-assigned** row (own-row agent updates, Admin org updates, TL downline updates) remains intact byte-for-byte.
- **Sequencing (R20):** Phase 1 must be approved, authored, reviewed, applied, and verified **before the new `twilio-voice-inbound` TwiML that activates authoritative callback claiming is deployed**. M1/M2 and the inert callback endpoint may be prepared and deployed first; rollout stops before TwiML activation unless Phase 1 is live; the staging matrix (§13) runs only after Phase 1 is applied. **Status (2026-08-23): this prerequisite is SATISFIED** — Phase 1 was approved, authored, reviewed, applied (`20260823203257`) and verified 18/18; the policy file is `supabase/migrations/20260823203257_rls_phase1_calls_command_split.sql`. TwiML activation nevertheless remains blocked until the outstanding §15 steps run.

**Phase 2 — later privacy narrowing (separate, after consumer inventory):**
- Restrict unassigned-inbound SELECT visibility **only after** every consumer has an explicit, tested access rule: missed-call dashboard widgets, notification deep links, dialed-number owners, contact-assigned agents, and routed agents. **Noted flaw in the withdrawn earlier draft:** a ringing-only routed-agents SELECT policy would prevent routed agents from opening the *terminal* missed calls they were just notified about — Phase 2 must cover the post-terminal read path, which is exactly why it ships later with its own tests.

Both phases remain gated on Chris's explicit `#APPROVE_RLS_CHANGE`, each with its own review.

---

## 10. Files to touch (complete list)

**Migrations (new):** M1 + M2 per §8.
**Edge Functions (modified):** `supabase/functions/twilio-voice-inbound/index.ts` (+ new extracted pure modules `routing.ts`, `twiml.ts`, `lifecycle.ts` — Deno-free, vitest-testable per the `duration.ts` house pattern) · `supabase/functions/inbound-call-claim/index.ts` (**Twilio-signed answer-claim webhook per §4.4; legacy browser contract disabled** — R13) · `supabase/functions/twilio-voice-status/index.ts` (+ `terminal-guard.ts` pure module) · `supabase/functions/twilio-recording-status/index.ts` (+ `idempotency.ts` pure module, R17 pipeline).
**Untouched Edge Functions:** `twilio-voice-webhook` (outbound), `twilio-token`, `twilio-sms*`, `_shared/notifications.ts`, `_shared/notification-recipients.ts`, `recording-retention-purge`, all others.
**Frontend:** `src/contexts/TwilioContext.tsx` (inbound-only surgical diffs per §3.3/§4.4/§7 — no ownership writes remain; task-authorized exception to the standing freeze; all invariant-#9 refs preserved) · `src/components/layout/FloatingDialer.tsx` (recent-calls identity — probe removal per R8) · `src/lib/webrtcInboundCaller.ts` / `src/components/layout/inboundCallerDisplay.ts` (ordering + doc updates as needed) · `src/integrations/supabase/types.ts` (surgical: new RPC typings added; **`resolve_inbound_caller_display_name` typing KEPT until the later drop** — R5) · `src/components/dialer/IncomingCallModal.tsx` only if display props change (expected: none — context feeds it).
**Tests:** per §11. **Docs:** `WORK_LOG.md` entry + `AGENT_RULES.md` new invariant (inbound identity/claim canon) in the same commit as the code (house §9 rule).

---

## 11. Test plan — fail-first; original 28 scenarios preserved; R13–R23 coverage added

House conventions: SQL suites in `supabase/tests/` (disposable localhost PG, `BEGIN…ROLLBACK`, `_sim/_expect`-style helpers, run red first); vitest for Deno-free pure modules and UI (`TZ=UTC` + `TZ=America/Los_Angeles`, placeholder `VITE_SUPABASE_*`; suites live under `src/**` importing function modules by relative path — the `twilioStatusDuration.test.ts` pattern); esbuild bundle check per Edge function (no Deno in this container).

**SQL — `supabase/tests/inbound_identity_resolution.sql`:** T1 formatted `(209) 840-2988` lead ↔ `+12098402988` unique · T2 formatted client unique · T3 formatted recruit unique · T4 no match ⇒ `not_found` · T5 two contacts sharing last-10 ⇒ `ambiguous`, no link · T6 ambiguous ⇒ **no** auto-created lead (with `p_auto_create=true`) · T7 unique ⇒ `contact_id`+`contact_type`+`contact_name` populated, `contact_phone` still the raw ANI · **[R8]** a `campaign_leads`-only phone match resolves `not_found`; a campaign_lead id can never appear in `calls.contact_id` · <10-digit ANI ⇒ `not_found` · `contact_type` NULL (not `'lead'`) on unresolved ingest.
**SQL — `supabase/tests/inbound_ingest_idempotency.sql`:** T23 same-CallSid double ingest ⇒ one row, same id, no second lead · **[R6]** the retry mutates **zero** columns (`updated_at` byte-identical) and `inserted=false` · ON CONFLICT arbitration against the unbounded partial index · **[R16]** blank SID rejected · malformed SID (`CA`-prefix wrong length / non-hex) rejected · **same-SID cross-org replay fails closed** (never returns the other org's row) · **same-SID different-DID replay fails closed** · **[R22]** two DIDs sharing the same trailing ten digits under **different country codes** ⇒ the replay DID comparison fails closed (exact-E.164, never last-10) · **[R21]** with `p_auto_create=true`, caller values `anonymous`, `unknown`, `restricted`, and a <10-digit number each produce: **zero** leads created, no advisory lock taken, raw caller value preserved in `contact_phone`, `contact_type` NULL, and a normally-routable unlinked row · **[R9]** two *different* CallSids from the same unknown number with `p_auto_create=true`, driven concurrently ⇒ exactly **one** lead, both calls linked to it.
**SQL — `supabase/tests/inbound_claim.sql`:** T12 first claim wins atomically (agent_id set, status connected) · T13 loser returns `claimed:false` + reason, row unchanged · T14 cross-org claim rejected · T15 non-routed and inactive-profile claims rejected · **[R3]** NULL/empty `routed_agent_ids` ⇒ rejected `no_routed_agents` (fail closed) · T16 parent SID preserved in `twilio_call_sid`, child SID lands in `provider_session_id`, `organization_id` untouched · **[R13/C1]** zero-write duplicate proofs — snapshot the **entire row** (every column, `updated_at` included) after the first successful claim, then: a duplicate `answered` delivery ⇒ `{claimed:true, idempotent:true}` with the row **byte-identical**; a duplicate `completed` delivery ⇒ same; the `answered` → `completed` sequence ⇒ same (first write only on `answered`, `completed` read-only); no update trigger fires on any duplicate · **[R2]** a **different child SID** for the same row is rejected (`sid_conflict`) and `provider_session_id` keeps the first value · a **different agent's** retry returns `already_claimed`, row untouched · **[R16]** blank/malformed child or parent SID rejected before the CAS (`invalid_sid`) · **wrong `p_parent_call_sid`** (row↔parent mismatch) rejected · **a successful claim never leaves `provider_session_id` NULL** (asserted on RETURNING) · **[R19]** an authentic claim against an **already-terminal** row succeeds as ownership **enrichment**: `agent_id` + `provider_session_id` set, `{enriched_terminal:true}`, and terminal `status`/`ended_at`/`duration` byte-unchanged; a duplicate of that enrichment takes the C1 read-only path (row byte-identical) · **[R23/C2]** EXECUTE matrix proven by **exact signature** for **every** M1/M2 function per the §8 table: the five service-only functions reject `PUBLIC`/`anon`/`authenticated`; **`phone_last10(text)`**, `get_inbound_call_identity`, the display-name compat wrapper, and `peek_inbound_call_identity` reject `PUBLIC`/`anon` and accept `authenticated`/`service_role` — including the assertion that the compat wrapper's **legacy `anon` grant is gone** · **[C2]** index-maintenance proof: with the `phone_last10` ACL applied, an `authenticated`-role INSERT and UPDATE on each of `leads`/`clients`/`recruits`/`calls` (the expression-indexed tables) succeeds and the new/changed row is found via the expression index — the helper's hardening cannot break normal writes · **[R1]** all profile checks run against `p_user_id`.
**SQL — `supabase/tests/inbound_terminal_lifecycle.sql`:** T24 finalize RPC closes a `ringing` row with `ended_at`, no duration write · T25 late `ringing`/`in-progress`/zero-duration inputs cannot regress a terminal row · **[R7]** `connected` + late `ringing` ⇒ status stays `connected` · terminal + different terminal ⇒ first stands, duration/ended_at still enrich monotonically · **[R17]** finalize returns `{updated:false, reason:'already_terminal'}` on an already-terminal row (idempotent success) and `{updated:false, reason:'not_found_or_mismatch'}` on a wrong id/org (observable error — distinguishable) · missed flag only ORs upward · **[R4]** `get_inbound_call_identity` matrix: routed agent on live ring ⇒ payload; assigned agent post-claim ⇒ payload; same-org non-routed member with the row UUID ⇒ NULL; inactive profile ⇒ NULL; stale (>15 min) unassigned ring ⇒ NULL; empty `routed_agent_ids` ⇒ NULL · **[R5]** deprecated `resolve_inbound_caller_display_name` wrapper returns a name only on a unique canonical match, NULL on ambiguous · **[R18/R10]** `find_last_agent_for_inbound`: formatted stored outbound `contact_phone` matches by normalization · contact-id match outranks phone match · **`p_contact_id` supplied but NO outbound row linked by contact id, while a formatted historical `contact_phone` matches ⇒ tier 2 returns that agent** · cross-org rows never returned · `caller_id_used` never matches.
**Vitest — pure Edge modules:** T17 all-ring target filter (Active-only) · T18 assigned/direct-line validation (org + Active) · T19 `buildDialTwiml` timeout attr from settings (+clamp) · T20 voicemail-disabled ⇒ hangup TwiML, no `<Record>` · T21 wave exclusion (no agent repeated across chain steps) · T22 forward-answered ⇒ not-missed decision; forward-unanswered ⇒ missed · TwiML: `<Client>` carries `<Identity>` + `<Parameter af_call_row_id>` + **per-agent signed `statusCallback` with `statusCallbackEvent="answered completed"`**, **no `af_org_id`**, and **[R19] the bounded retry connection-override configuration present on every generated claim-callback URL** (R13/R3/R19) · **[R14]** wave-builder unit tests: routed-persist exception ⇒ no `<Client>` TwiML for the wave, safe-fallback TwiML chosen (voicemail when enabled, else terminal), telemetry emitted; `false`/zero-row result ⇒ same; failure on the **initial** wave and on a **fallback** wave each suppress only that dialing and take the safe path; a retried/subsequent successful wave accumulates `routed_agent_ids` and rings normally · **[R13/R19]** claim-callback handler units: invalid Twilio signature ⇒ 403 no-write; **`CallStatus='in-progress'` claims; a lost answered delivery followed by the `completed` event still claims; `canceled`/`busy`/`failed`/`no-answer` legs ⇒ 2xx ack, never claim**; wrong parent SID / wrong row / wrong agent / identity-mismatch ⇒ 2xx business rejection with reason; **transient DB/RPC failure ⇒ 5xx, then the retried delivery succeeds**; legacy JWT-browser-shaped request ⇒ rejected, zero writes · terminal-guard module (R7 full-ladder table incl. `connected→ringing` suppression and enrichment passthrough) · **[R17]** recording idempotency/pipeline module: valid `recording_storage_path` ⇒ short-circuit; **sentinel `recording_url` with NULL path ⇒ NOT a short-circuit (recoverable)**; download-fail ⇒ 5xx + Twilio source preserved ⇒ retry-success path completes; upload-fail ⇒ same; DB-update-fail ⇒ **no Twilio delete**, 5xx, retry-success completes; unmatched row ⇒ ack, no download/upload/delete, no orphan; duplicate success ⇒ ack, no rewrite; **delete-only-after-commit ordering asserted**; callback URL carries the retry-policy connection overrides.
**Vitest — frontend:** T9 inbound display prefers `contact_phone` over `caller_id_used` · T10 two simultaneous inbound rings resolve independent identities by row id (no newest-ringing bleed) · **T11 (reshaped per R13): `call.accept()` alone does not claim; the browser accept event does not claim; the browser issues zero ownership writes end-to-end (spy: no `calls` update, no claim POST); ownership UI state flips only when the row shows `agent_id = uid`; lost-race row (`agent_id` = other) ⇒ teardown with no writes** · T26 browser recording gated off for inbound, unchanged for outbound · T28 outbound `makeCall`/recording path snapshot tests pinning current behavior byte-for-byte · **[R8]** FloatingDialer: linked rows resolve by `contact_id`/`contact_type`; unlinked rows render snapshot-name-else-ANI; **no phone-probe query is issued at all** (spy asserts zero `leads` ilike calls); typed quick-call passes true `contact_type` · T8 history: `getLeadHistory`/contact history queries remain `contact_id`-keyed and pick up a newly linked inbound call.
Fail-first: every suite is written and run red against the unmodified tree before implementation lands.

---

## 12. Verification gates (all must pass before handoff; nothing deploys)

1. Focused new suites (SQL + vitest) green; 2. affected integration suites (dialer render-stability, notifications, conversation-history) green; 3. **full `npx vitest run`** under both TZs; 4. `npx tsc --noEmit` (multiset-compared to the clean-main 73-error baseline); 5. `npx eslint` on touched files; 6. `npm run build`; 7. esbuild bundle/syntax check per touched Edge function; 8. migration static checks (no top-level backfill/cleanup DML; grep-audited + localhost replay under rollback); 9. **adversarial review: organization scoping** — every new/changed lookup and write carries an explicit org predicate or proven org-derivation; no org identity, user identity, or claim authority is ever read from a browser request or TwiML-visible parameter (R1/R3/R13 — the answer-callback's ids are server-issued and signature-covered); 10. **adversarial review: simultaneous all-ring** — two-ring race walkthrough of the Twilio-answered-callback claim CAS, customParameters row-pinning, exact-peek, reject-path no-writes, SID first-writer-wins, losing-leg cancel behavior; 11. **adversarial review: Twilio retry ordering** — initial-webhook retry (zero-mutation), cross-org/different-DID SID replays incl. the R22 country-code case (fail closed), duplicate answered **and** completed callbacks (idempotent — R19), **lost-answered → completed recovery claim and answered-after-parent-terminal enrichment (R19: ownership set, terminal status/ended_at/duration untouched)**, duplicate status callback per R7 ladder state, duplicate/failed recording callbacks across the full R17 pipeline (incl. delete-after-commit ordering and the 5xx retry channel), out-of-order Dial-action vs status callback, concurrent auto-create (R9), invalid/anonymous ANI never auto-creating (R21); 12. **adversarial review: zero historical mutation** — no code path or migration statement can write to a pre-existing inbound row except the always-allowed forward-only paths that already exist today; notifications history untouched; 13. audit `trg_workflow_call_created` under the new ingest (no dispatch on inbound insert; zero-mutation retry cannot re-fire); 14. telemetry review — every claim rejection, suppressed wave (R14), finalize failure (R17), and recording-pipeline failure emits an actionable structured log, and the claim handler's response-code policy (transient ⇒ 5xx retryable, business/losing-leg ⇒ 2xx — R19) is verified per path; 15. **R13/R19 mechanism gate** — `<Client>` `statusCallback`/`statusCallbackEvent="answered completed"` support, callback parameter set, and the webhook connection-override retry syntax (applied to BOTH claim and recording callback URLs) verified against current Twilio documentation before the dependent code is written; 16. **R23/C2 ACL gate** — the §8 EXECUTE matrix (now covering every M1/M2 function including `phone_last10(text)`) is asserted by exact-signature SQL tests and re-checked in review, including removal of the compat wrapper's legacy `anon` grant, the documented intentional `authenticated` exposure of `get_inbound_call_identity`, and the C2 index-maintenance proofs that authenticated writes to the four expression-indexed tables still succeed under the hardened helper ACL.

---

## 13. Manual Twilio staging matrix (run on staging numbers **only after RLS Phase 1 is applied and the activation deploys complete** — R20; expected results)

| # | Scenario | Expected |
|---|---|---|
| 1 | Known contact stored as `(209) 840-2988` calls in | Row linked (unique), name + ANI shown ringing and after answer; call in that contact's conversation history. (Also proves `customParameters` + `<Client>` answered-statusCallback arrival — §4.1/§12 gate.) |
| 2 | Unknown caller | `not_found`; lead auto-created only if org opted in; otherwise unlinked with `contact_type` NULL |
| 3 | Caller whose last-10 matches 2 CRM records | Ambiguous: no link, no auto-create, ANI-only display; call still routes/answers normally |
| 4 | All-ring, agent B answers | Twilio's signed answered callback claims for B (`agent_id`, child SID in `provider_session_id`); browser made no ownership write; status connected→completed, duration from Twilio |
| 5 | Two simultaneous inbound calls, two agents | Each browser shows its own caller; claims land on the correct rows via per-leg callbacks; no cross-talk |
| 6 | No answer → voicemail | Waves per chain, no repeated agent, missed marked at voicemail entry, recording stored once, terminal completed |
| 7 | Voicemail disabled | Hangup terminal with greeting; **no** `<Record>`; missed + no-answer finalized |
| 8 | Forward answered | Not missed; finalized completed; no notification |
| 9 | Forward unanswered → voicemail | Missed marked only after forward fails; voicemail per settings |
| 10 | Browser refresh during ring | No claim, no stray row writes; other agents can still answer; row finalizes via callbacks/Dial actions |
| 11 | Duplicate status callback (replay terminal event) | No status/duration regression; single notification (event-key) |
| 12 | Duplicate recording callback | Storage path intact; no sentinel overwrite of success; single stored file; Twilio copy deleted exactly once, only after verified persistence |

---

## 14. Decisions — resolved rulings and remaining defaults

**Resolved by Chris (2026-08-22, Rev 2 + Rev 3 + Rev 4):** claim trigger = **Twilio-authoritative signed answered callback; browser performs no ownership write** (R13, superseding R1's browser-trigger portion; R1's service-role-only RPC + DB-authoritative checks stand) · claim delivery survives retries and reordering — retry-configured callback URLs, `answered completed` events, losing legs never claim, 5xx-transient/2xx-business response policy, late terminal **enrichment** without status regression (R19) · routed persistence **precedes** ringing with deterministic safe fallback (R14) · **RLS Phase 1 precedes TwiML activation** and globally excludes unassigned-inbound from authenticated UPDATE/DELETE for every role (R15 + R20; still requires `#APPROVE_RLS_CHANGE` to author) · strict SID validation + replay-safe ingest (R16) with **exact-E.164 DID identity, never last-10** (R22) · **invalid/anonymous ANI never auto-creates a lead** (R21) · verified-persistence recording pipeline + observable terminal finalization (R17) · two-stage `last_agent` (R18) · **explicit function ACL matrix, compat wrapper's `anon` grant removed** (R23) · fail-closed empty routing (R3) · first-writer-wins child SID (R2) · tightened identity RPC (R4) · deprecate-don't-drop display-name RPC (R5) · unbounded idempotency index + zero-mutation retry (R6) · full monotonic ladder (R7) · single resolver, no campaign_leads, no phone probes (R8) · serialized auto-create (R9) · contact-first last-agent matching, never `caller_id_used` (R10) · two-phase RLS structure (R11) · presence-aware routing out of scope (R12).

**Standing defaults (approved with the overall direction; veto/adjust freely):**
- **D1 — Ambiguity is strict:** ≥2 distinct candidates (within or across lead/client/recruit) ⇒ unlinked. No type-priority tiebreak.
- **D2 — Auto-created lead shape** stays `Inbound` / `Caller` / `lead_source 'Inbound Call'` / unassigned, created inside the ingest RPC under the R9 lock.
- **D3 — Voicemail-disabled terminal behavior** = greeting + hangup.
- **D7 — Forwarded external legs stay unrecorded** (compliance-sensitive; §7). Any change is a separate approval.
- **D8 — all-ring gains the `status='Active'` filter**, superseding the 2026-05-19 scope freeze — called out since it changes who rings for orgs relying on the old behavior.

---

## 15. Implementation sequence (after plan approval; deploy/apply remain separately gated)

1. Fail-first test suites (red) → 2. M1 + M2 authored; localhost replay + SQL suites green → 3. Edge pure-module extraction + rewires (incl. the R13/R19 claim-callback handler and R17 pipeline); esbuild checks → 4. TwilioContext/FloatingDialer changes → 5. full verification battery (§12, incl. the R13/R19/R17 Twilio-docs mechanism gate) → 6. WORK_LOG + AGENT_RULES entries → 7. commit/push to `claude/inbound-call-flow-fix-auzk81` → **STOP.**
**Production rollout (each step separately approved by Chris; ordered per R20):**

**✅ COMPLETE (2026-08-23) — database only:**
- Read-only preflights (`list_migrations`, zero-duplicate-inbound-SID check, catalog preflight).
- **RLS Phase 1 gate (R15/R20) — SATISFIED.** `#APPROVE_RLS_CHANGE` was issued, the command-split migration was **separately approved for remote application, applied** as `20260823203257`, and verified catalog-only at **18/18 postconditions**.
- **M1 → M2 → M3 applied** (`20260823222528` / `20260823222805` / `20260823222926`), each verified before the next; zero historical rows modified, zero backfill.
- **`repair-twilio-number-ownership` DEPLOYED (2026-08-24), v2 → v3, `verify_jwt=false`** — the reviewed repair + C10 reconciliation implementation, packaged as exactly six files (`index.ts`, `ownership.ts`, `repair.ts`, `reconcile.ts`, `_shared/twilioOutboundCreds.ts`, `_shared/twilioNumberConfig.ts`), all verified byte-identical to the repository. **`reconcile_callbacks` has NOT been invoked** — deploying the entry point changes no Twilio number and no database row; the fleet still carries its pre-C7 status callbacks until the reconciliation is separately approved and run. Zero Twilio API calls, zero reconciliation events, zero database mutations (`phone_numbers` unchanged, 0 rows at `trust_hub_status='pending'`).
- **`inbound-call-claim` DEPLOYED (2026-08-24), v37 → v38, `verify_jwt=false`** — the reviewed implementation, **still INERT**: nothing generates its signed callbacks until the new TwiML ships, and legacy browser requests are rejected by fail-closed Twilio signature validation with zero writes. Both deployed files (`index.ts`, `claim-callback.ts`) verified byte-identical to the repository; the four protected functions and the `calls` fingerprint were unchanged. *Outstanding on this step:* the synthetic unsigned-request 403 probe could not be executed from the deploying session (egress policy blocked `jncvvsvckxhqgqvkppmj.supabase.co:443`); the `bad_signature` → 403 path is covered by unit tests but not yet confirmed live.

**✅ COMPLETE (2026-08-25) — inbound voice pair activation (Edge Functions only; no Twilio, no SQL, no frontend):**
- **INBOUND VOICE PAIR ACTIVATED (2026-08-25) — `twilio-voice-status` v39 → v40 and `twilio-voice-inbound` v42 → v44, both `verify_jwt=false`, both ACTIVE.** Each package is exactly five files (the three package files plus the shared `_shared/notifications.ts` → `_shared/notification-recipients.ts` closure), every file verified byte-identical to branch HEAD `500cb9a8` by `git hash-object` against a freshly re-pulled deployment. `ezbr_sha256`: status `4d2425e2727e7b36d6ffeb0c64155106474158e7b479ceb3daa391ff44e5aef1`, inbound `4e0b95da360a78fb4029cc1780eaf6dc164f1ed201c6038bd059b9176d601d4c`. An intermediate inbound v43 was published with an 81-byte comment-only defect (27 `─` padding characters missing from four banner comment lines, caused by miscounted `\u2500` escapes in the deploy payload); it was diagnosed by exact diff, Chris approved correcting forward rather than restoring both baselines, and v44 is byte-exact. No executable code ever differed. **Twilio callback reconciliation (`reconcile_callbacks`) was WAIVED by Chris; not executed successfully; not passed** — so **existing-number callback retry configuration remains UNVERIFIED**. Zero database writes (`calls` 719 / `phone_numbers` 16 / migrations 272 / 5 `calls` policies, all identical before and after; 0 rows touched in the surrounding 60 minutes). Protected functions unchanged: `inbound-call-claim` v38, `repair-twilio-number-ownership` v3, `twilio-recording-status` v33. **Live inbound validation has NOT been performed** — no call was placed or simulated, and no post-deployment invocation has occurred, so no post-deployment boot log exists for either function.
**✅ COMPLETE (2026-08-25) — `twilio-recording-status` deployed (final Edge Function):**
- **`twilio-recording-status` v33 → v34, `verify_jwt=false`, ACTIVE, `ezbr_sha256=a56a0620bb9f10b0066c1d05291d8350fe5e49bb852c13be6eed31c17f59d967`.** Package is exactly two files — `index.ts` (`544af73b…`) and its new `idempotency.ts` (`8c4340f8…`) — both verified byte-identical to branch HEAD `444814cb` against a freshly re-pulled deployment; sole external `esm.sh/@supabase/supabase-js@2`. The deployment payload was staged by mechanical copy from the repository and machine-encoded (no manual retyping), and verified byte-exact on the first attempt. M3's `calls.recording_source_sid` is present, so the C6 hard reference resolves. Zero database writes: `calls` 719 / `d6842990…`, `phone_numbers` 16, migrations 272, 5 `calls` policies and the recording-field fingerprint `414adc15…` are all identical before and after, with 0 rows touched in the surrounding 60 minutes. **No synthetic recording callback and no Twilio API request were issued.** A byte-verified v33 rollback package was preserved (proven identical to merge-base blob `8737ac52…`) and was not needed.

**⛔ REMAINING. NEXT GATE = step 1:**
1. **Live inbound validation — DEFERRED by Chris; NOT PASSED.** No live inbound call has validated the production deployment. Place a normal inbound test call from a saved contact and confirm caller-name matching and conversation history. Until this passes, the inbound fix is DEPLOYED and RELEASED but **NOT production-validated**.
2. **Revisit Twilio callback reconciliation — WAIVED by Chris; not executed successfully; NOT PASSED.** Existing Twilio numbers still carry whatever `statusCallback` they had, without the C9 5xx retry override, so **existing-number callback retry configuration remains UNVERIFIED** — **residual risk: transient callback failures may affect missed-call state or notifications until reconciliation is revisited.** When run, it must return HTTP 200 with `failures: []`; STOP on any 409 or reported failure.
3. **Unsigned `inbound-call-claim` live probe — WAIVED by Chris; NOT PASSED.** The `bad_signature` → 403 path remains covered only by unit tests.
4. **Re-enable Supabase production deployment — BLOCKED on the baseline history consolidation.** The Supabase GitHub integration's **Deploy to production** option is **temporarily DISABLED** (turned off by Chris, 2026-08-25). **Automatic preview branching remains ENABLED** — each PR still gets its ephemeral preview project. It was disabled because **seven legacy repository migrations carried versions that did not match the versions recorded in production's `supabase_migrations.schema_migrations`**, so a production deployment run would treat them as unapplied and attempt to apply them against the live database. **Six of the seven are now reconciled** by repository-only `git mv` rename (2026-08-25, branch `claude/supabase-migration-history-reconciliation-g4kz4u`) — each proven 100% similarity with its Git blob and bytes unchanged, and each matching its production-recorded statement byte-for-byte:
   `20260807165600` → `20260811200920_campaign_leads_membership_uniqueness_and_attachment_core` · `20260807165610` → `20260811201250_import_campaign_creation_and_retry` · `20260807165620` → `20260811201401_dialer_session_campaign_access` · `20260812000000` → `20260812042319_client_policy_sold_draft_payment_fields` · `20260819000000` → `20260819163413_notifications_idempotency_recipients_security` · `20260820213208` → `20260820233402_get_dialer_campaign_presence_rpc`
   **`20260806000000_baseline_production_schema` remains the SOLE pending migration.** It has no production-recorded counterpart of any kind — no row at `20260806000000`, no row matching `%baseline%`, and nothing recorded between `20260805090000` and `20260811200920`. It therefore **cannot be reconciled by renaming**: the only defined procedure is the separately gated **baseline history consolidation** (`supabase/rollback/20260806_baseline_history_reconciliation_runbook.md` §S1 — mark the 262 pre-baseline versions reverted, then mark `20260806000000` applied, metadata-only via `supabase migration repair`), which remains **NOT PERFORMED and BLOCKED on Chris's explicit approval**. **Deploy to production must stay OFF until that consolidation completes** — no rename round can clear it, and the baseline additionally sorts *before* the lowest matched remote version, which the CLI refuses as an out-of-order pending migration. Until then, production schema and Edge Function changes are applied deliberately via the Supabase MCP `apply_migration` / `deploy_edge_function` path, never by a git merge.
5. **Run the required staging/live verification matrix (§13).**
6. **Historical cleanup** (deprecated `resolve_inbound_caller_display_name` wrapper drop after bundle rollover). **No historical inbound calls were backfilled or modified at any point in this rollout.**
Stale-bundle safety throughout: their claim path never worked and is now inert by signature rejection; exact-only peek returns null instead of wrong identities; the deprecated `resolve_inbound_caller_display_name` wrapper keeps serving them names (unique-only) until the later cleanup release drops it after bundle rollover.

---

## 16. Explicit exclusions (documented, NOT done in this build)

- **Presence-aware assigned-agent routing (R12):** ring-in-app-when-online / forward-to-personal-phone-when-offline is **NOT implemented or partially implemented by this repair**, and this release must not be described as delivering it. Separate follow-up (needs a server-authoritative presence source and its own routing design).
- **Signed per-agent short-TTL TwiML claim token** — separate future design; under R14 an un-persisted wave is never rung, so the availability gap it would address does not occur in normal operation.
- **RLS Phase 2** (§9) — **still excluded and separately unapproved**: later privacy narrowing, with its own consumer inventory and tests. **Phase 1 is no longer an exclusion** — it was approved, authored, applied to production (`20260823203257`) and verified on 2026-08-23, and remains the mandatory prerequisite that **precedes activation of the new inbound TwiML** (R15/R20).
- **Dropping `resolve_inbound_caller_display_name`** — deferred to a later cleanup release after bundle rollover (R5); its `types.ts` entry is kept until then.
- **Historical backfill/cleanup of any kind** — no repair of old `contact_id`/names/statuses/notifications/recordings/agent ownership; no duplicate-notification cleanup (separately deferred, 2026-08-18 D9); no watchdog/cleanup job; no historical conversation phone fallback.
- **No campaign_leads authoritative matching** (R8) — permanently, unless separately re-approved with a current-phone design.
- **Forwarded-leg recording**, per-number ring-timeout schema, presence-based round-robin improvements, `webhook_debug_log`/`app_config` RLS findings, and the master-creds-per-subaccount webhook cleanup — all pre-existing deferred items, untouched.

**Confirmations (current, 2026-08-23):** no previous inbound call rows, notifications, or recordings are modified by any part of this plan — the production `calls` id+`updated_at` fingerprint was unchanged across all four applies, with zero backfill and zero historical mutation. **Applied to production:** RLS Phase 1 (`20260823203257`) and M1/M2/M3 (`20260823222528` / `20260823222805` / `20260823222926`). **NOT done:** no Edge Function deployed, no Twilio number reconciled, no frontend released, no TwiML activated, not merged, and the RLS rollback not executed.

*(Historical plan context: when this section was first drafted it read "nothing has been deployed, merged, or applied; no application code, migration, test, or Edge Function change has been written; this document (and its git history) is the only artifact of these sessions" — accurate at drafting time, superseded by the implementation rounds and the production applies recorded in WORK_LOG.)*


---

## Revision 6 addendum (2026-08-23) — corrective round C4–C7

Ordered by Chris after review of the `2fc5368` implementation. Development-only; R1–R23 and C1–C3
stand unchanged. Each correction was implemented fail-first (regression tests red, then green).

- **C4 — Claim-callback identity fails closed.** The rev-5 handler's
  `(answeredIdentity !== "" && …)` guard let a signed callback with missing/empty `Called`/`To`
  bypass the R13 identity cross-check. Corrected: the answered client identity (first nonempty of
  `Called`, `To`, `client:`-stripped, trimmed) must be present AND exactly equal to the Active
  profile's nonempty `twilio_client_identity` (`checkAnsweredClientIdentity`, claim-callback.ts).
  Missing/malformed/mismatched ⇒ 2xx business rejection with zero RPC/write activity and reason
  telemetry; invalid-signature 403 and transient 5xx behavior unchanged. There remains exactly one
  claim-RPC call site, after every rejection path.

- **C5 — Realtime processing is exact-row scoped.** The org-wide `calls` Realtime handler's
  `assignedMine` term let an UNRELATED inbound row assigned to the same user repaint the current
  ring's ANI/name/contact. Corrected: `classifyRealtimeInboundRow` (inboundCallOwnership.ts) gates
  every event to the exact row named by `inboundCallRowIdRef.current` — ignore anything else (even
  rows with `agent_id = me`); the exact row keeps unassigned-ring display, mine/lost ownership
  observation (lost = observe-only, never a repaint), and late enrichment. Session/control/browser-SID
  matching no longer authorizes any reconciliation; with no known `af_call_row_id` nothing is
  processed (no newest-ringing/phone/org-wide fallback keys, per R13/T10).

- **C6 — Recording deletion failure gets a durable retry path.** The rev-5 pipeline swallowed
  `deleteSource` errors and reported success ("ops tooling" recovery did not exist), stranding the
  Twilio copy after a transient DELETE failure. Corrected: migration **M3**
  (`20260823222926_recording_source_sid.sql`) adds the nullable future-facing column
  `calls.recording_source_sid`; the source RecordingSid (validated `^RE[0-9a-fA-F]{32}$`) is
  persisted ATOMICALLY inside the verified exact-row metadata update. A non-404 DELETE failure after
  persistence now returns retryable 5xx with structured `{rowId, callSid, recordingSid, httpStatus}`
  telemetry (`stored_cleanup_failed`); the redelivered callback — matched by EXACT RecordingSid
  equality against the stored source SID — runs CLEANUP ONLY (`runCleanupRetry`: one DELETE; 2xx/404
  = success; no download/upload/metadata rewrite; failures stay 5xx + observable). A callback with a
  DIFFERENT RecordingSid never deletes that distinct source (first completed recording wins,
  preserved at Twilio); rows with a stored path but NULL source SID never trigger deletion; unmatched
  callbacks still never download/upload/persist/delete.

- **C7 — Suppressed late statuses never emit missed-call notifications.** twilio-voice-status
  derived notification from the RAW incoming status (and stored `is_missed`) independent of the R7
  ladder, so a late no-answer/busy/canceled after `completed` could notify; notification could also
  follow a failed row update. Corrected: `shouldEmitMissedCallNotification` (terminal-guard.ts)
  emits ONLY when the ladder ACCEPTED the terminal write AND the exact-row update (now `.eq("id")` +
  verified `.select`) succeeded AND the raw status is no-answer/busy/canceled on an inbound org row;
  a stored `is_missed` flag alone never re-notifies (the marking writer owns its notification; the
  notifications `(user_id, event_key)` upsert remains the exactly-once backstop). The same
  stale/reordered-action audit hardened twilio-voice-inbound: `markMissedAndNotify` is now an
  atomically-guarded UPDATE (`agent_id IS NULL` AND status ∉ {connected, completed}; notify only
  when it lands — `canMarkRowMissed` in routing.ts mirrors the predicate), and
  `finalize_inbound_call_terminal` (M2) refuses a non-completed finalize on a CLAIMED row with the
  new discriminated `claimed_active` skip and never applies mark-missed to a claimed row (SQL test
  F10); the Edge caller treats `claimed_active` as idempotent success.

**Rev-6 test additions:** vitest `claimIdentityFailClosed`, `realtimeExactRowScope`,
`recordingCleanupRetry`, `missedNotificationGuard` (the superseded "delete failure is non-fatal"
pin in `recordingIdempotency` updated to the C6 contract); SQL F9 (M3 column present/nullable/text)
and F10 (stale finalize refused on claimed rows) in `inbound_terminal_lifecycle.sql`; the committed
runner and the transaction/rollback replay now apply M1+M2+M3.

**Rev-6 refinements (applied after an independent five-lens adversarial verification of the C4–C7
diff; the C4 lens returned clean, C5/C6/C7 each surfaced real gaps that are now closed):**

- **C5·1 — deferred writes re-validate the ring.** Exact-row gating held only for each handler's
  synchronous prefix. Both bounded polls now re-run `classifyRealtimeInboundRow` on the row that
  RESOLVED (not the one requested) before any paint, `reconcileIdentifiedContactFromCallsRow`
  carries a `stillCurrent()` guard at every `setIdentifiedContact` (its CRM fetches await), and
  `applyInboundAniFromCallsRow` gained an exact-row entry guard — a ring that re-keys mid-flight can
  no longer be painted with the previous ring's ANI/CRM identity.
- **C5·2 — ownership arms only on a leg this browser answered.** A second registered tab observing
  `agent_id = me` (written by the other tab's answer) used to arm `activeCallIdRef`, so its
  Twilio `cancel` finalized the LIVE row. The `mine` branch now requires `callState === "active"`.
- **C5·3 — a new ring cancels the previous call's pending 200 ms cosmetic reset**, which otherwise
  idled the state and cleared the new ring's `af_call_row_id`.
- **C6·1 — first-writer-wins persistence.** The verified metadata update is now a CAS
  (`recording_storage_path IS NULL`); the storage object is keyed by CallSid **and** RecordingSid so
  concurrent distinct recordings cannot upsert over each other; a CAS loser removes only its own
  object (winner-path compared first, since same-SID duplicates share a path) and keeps its source.
- **C6·2 — malformed RecordingSid never promises a dead-end retry** (delete skipped with telemetry,
  source preserved), and a matched row with **NULL `organization_id`** is preserve-acked before any
  download/upload/write/delete (org isolation).
- **C7·1 — convergence restored.** Gating strictly on the accepted transition removed the only
  writer that could re-attempt a notification whose fail-closed insert aborted. A row that is
  DURABLY `is_missed` now converges on any later successful callback (`storedIsMissed`), while a
  suppressed late status on a not-missed row still notifies nobody; the `(user_id, event_key)`
  upsert keeps it exactly-once.
- **C7·2 — answered-ness is `agent_id`, never the parent's status.** Blocking the missed mark on
  `connected`/`completed` would have dropped legitimate missed calls (an inbound parent reads
  `connected` merely because Twilio answered it to run TwiML; an abandoned caller lands `completed`
  first). The guard is now `agent_id IS NULL` alone — atomic with the claim CAS.
- **C7·3 — atomic terminal CAS + a redelivery channel.** The accepted status write compares against
  the status the ladder was evaluated on (R7 enforced in the database, not by event ordering), a
  transient update failure returns **503** instead of a silent 200, and
  `canonicalNumberConfig().statusCallback` gained the `#rc=3&rp=5xx,ct,rt` override so that 503 is
  actually redelivered.

**Residual risks recorded (not defects):** the number-level retry fragment reaches Twilio only when
a number is next provisioned or repaired via `canonicalNumberConfig` (existing numbers keep the bare
URL until then); `twilio-recording-status` hard-references `recording_source_sid`, so **M3 must be
applied before that function is deployed** (§15 ordering); and after Twilio's bounded `rc=3` budget
is exhausted on repeated cleanup failures the stored-but-undeleted provider copy is preserved at
Twilio with telemetry — no in-repo re-attempt exists (deliberately not claimed anywhere).

**Unchanged by this round:** every §16 exclusion, the RLS Phase 1 `#APPROVE_RLS_CHANGE` gate and
§15 activation sequence, zero backfill/historical mutation, and the development-only boundary.


---

## Revision 7 addendum (2026-08-23) — final corrective round C8–C12

Development-only. R1–R23 and C1–C7 stand unchanged; each correction was implemented fail-first.

- **C8 — the browser never auto-finalizes an inbound orphan.** The mount-time sweep selects "my
  newest ringing/connected call" agent-wide, untied to this browser's leg, so a second tab opened
  during a live inbound call completed the winning row. The query now selects `direction` and every
  write path routes through `classifyOrphanRecovery` (inboundCallOwnership.ts): inbound — and
  anything not provably outbound — is `surface_inbound_readonly`, i.e. **zero calls-row writes**: no
  stale-ringing cleanup, no silent finalize, and `hangUpOrphan` performs local SDK teardown only
  (`canBrowserFinalizeOrphanRow`). Inbound lifecycle stays provider/webhook authoritative; the
  surfaced orphan carries its direction so the UI can render it read-only. Outbound behavior is
  byte-identical (same 5-minute stale threshold, same silent finalize), now additionally
  `agent_id`-scoped on the stale-cleanup write. No newest-row/phone/SID/agent-wide replacement guess
  was introduced.

- **C9 — terminal + notification convergence in twilio-voice-status.** After a valid signature every
  transient failure is now a retryable **503** via one pure policy (`decideVoiceStatusResponse`):
  row-lookup error (previously logged inside `tryLookup`, then acked 200 as "no row"), exact-row
  update error, missed-notification failure, and any unexpected exception (the fatal catch returned
  200). Unmatched rows, business-ignored statuses and a CAS superseded by a concurrent writer stay
  2xx; invalid signature stays 403. Every ACCEPTED missed outcome — **no-answer, busy and canceled**
  — now persists `is_missed = true` in the same verified update (`shouldPersistMissedFlag`), so a
  redelivery against a frozen terminal row can still converge the idempotent notification. A CAS
  zero-row result **re-reads the exact row** and converges only from what the winner durably
  recorded, never from the raw callback status. `insertMissedCallNotifications` now returns a
  discriminated `MissedNotificationResult` so a non-converged attempt can answer 503. STIR/SHAKEN
  enrichment is wrapped so a transient Twilio API failure can no longer abandon the terminal write.
  Status and duration monotonicity are unchanged.

- **C10 — the existing number fleet actually gets the retry policy.** `canonicalNumberConfig` only
  reaches numbers purchased or repaired later, so today's fleet would never retry C9's 5xx. New pure
  `reconcileNumberCallbacks` (repair-twilio-number-ownership/reconcile.ts) enumerates active
  voice-capable numbers, skips those already canonical (idempotent, zero Twilio writes), configures
  the rest, and **reads each one back** to verify the persisted voice/SMS/status-callback
  configuration (reusing `numberConfigMatches` and `sanitizeTwilioFailure`). Cross-account numbers
  are never configured; rows without a `twilio_sid` are reported, never guessed at; any failure makes
  the whole run **not-ok** and the entry point answers 409. It is exposed only as
  `{"action":"reconcile_callbacks"}` on the existing `repair-twilio-number-ownership` function,
  behind its service-role / workflow-secret gate — no public or browser-callable bulk mutation.
  Newly purchased (`twilio-buy-number`) and individually repaired numbers already read the same
  canonical config, so they inherit the fragment automatically. **Not executed against production
  this round.**

- **C11 — a blank recording path stays recoverable.** `classifyRecordingRow` treated `''` as
  recoverable while the metadata CAS used `recording_storage_path IS NULL`, so such a row looped on
  503 forever. One predicate now governs classification, the sentinel guard and the CAS
  (`isUnstoredRecordingPath` = NULL or trimmed-empty), and the CAS compares against the **exact
  observed prior value** (`recordingPathCas` / `applyRecordingPathCas`): NULL → `IS NULL`, `''` /
  whitespace / any value → equality. Blank paths converge through download → upload → verified
  persistence → deletion, while a concurrent writer that stored a real path still makes the loser's
  update match zero rows. No historical cleanup or backfill.

- **C12 — externally forwarded answered calls are protected.** "agent_id proves answered" holds only
  for `<Client>` legs; an external `<Number>` forward completes with `agent_id` NULL, so a replayed
  earlier-wave action could mark a successfully forwarded call missed. A durable monotonic proof —
  `calls.outcome = 'forwarded_answered'` — is recorded when an ANSWERED forward return is accepted
  (`shouldRecordExternalAnswerProof`, i.e. `DialCallStatus` answered **and** `forwarded=1`), through
  the finalize RPC's new `p_external_answer` parameter so it lands in the same write. Both writers
  honor it: `markMissedAndNotify`'s UPDATE excludes proof-carrying rows with a **NULL-safe** filter
  (`outcome.is.null,outcome.neq.…` — a bare `<>` would drop every NULL-outcome row and silently lose
  legitimate missed calls), and `finalize_inbound_call_terminal` refuses non-completed finalize and
  mark-missed when either proof exists, with discriminated `externally_answered` /
  `claimed_active` / `external_answer_already_recorded` skips. Recording the proof also retracts
  `is_missed` on an unclaimed call (it was answered), and a claimed row is never touched — the client
  claim is the stronger, earlier proof. A bare parent `status='completed'` is still never accepted as
  proof: an abandoned caller produces exactly that and remains a missed call.

**Rev-7 test additions:** vitest `inboundOrphanSafety`, `voiceStatusConvergence`,
`numberReconciliation` (mocked Twilio: complete success, partial failure, verification mismatch,
idempotent retry, cross-account protection, internal-auth ordering), `recordingBlankPath`,
`forwardAnsweredProof`; SQL **F11** (proof recorded, stale action refused, idempotent replay, late
proof winning monotonically, claimed row untouched) in `inbound_terminal_lifecycle.sql`. Two rev-6
source pins that encoded superseded behavior were updated to the C11 contract.

### §15 rollout order — updated (C10 gate)

The activation sequence gains a number-reconciliation gate. Unchanged: the database/RLS gates come
first and nothing below is authorized by this document.

1. RLS **Phase 1** approved (`#APPROVE_RLS_CHANGE`) and live — unchanged, still mandatory.
2. Apply migrations **M1 → M2 → M3** (M3 before `twilio-recording-status` is deployed: that function
   hard-references `recording_source_sid`).
3. **Deploy the reviewed repair/reconciliation implementation** (`repair-twilio-number-ownership`
   with the C10 entry point).
4. **Reconcile and read-back verify every existing active voice number**
   (`{"action":"reconcile_callbacks"}` with service-role authorization; optionally per organization).
5. **STOP if any number retains the bare callback** — the run answers 409 and lists the exact
   phone-number SIDs and database rows that did not converge. Do not proceed until it answers 200
   with `failures: []`.
6. Only then deploy `twilio-voice-inbound` + `twilio-voice-status` back-to-back (the activation
   step), then `twilio-recording-status`, then the frontend release.

**Residual risks recorded:** whether Twilio persists and returns the URL fragment verbatim on
`status_callback` is proven only at step 4 — if it normalizes the value, the read-back verification
fails closed (409) and the rollout stops there by design, with no silent half-configured fleet; and
`reconcileNumberCallbacks` writes to Twilio only, never to the database, so it can be re-run freely.


---

## Revision 8 closure note (2026-08-23) — C13–C14

Narrow closure patch. All prior rulings (R1–R23, C1–C12) stand; both corrections were implemented
fail-first.

- **C13 — the checked-in RPC typing matches the SQL signature.** C12 gave M2's
  `finalize_inbound_call_terminal` a fifth parameter (`p_external_answer boolean DEFAULT false`) but
  `src/integrations/supabase/types.ts` still declared only four, so a five-argument call site would
  not type-check against the generated `Database` types. The typing now carries
  **`p_external_answer?: boolean`** — optional, because the SQL parameter defaults to `false` and
  existing four-argument callers remain valid. Pinned three ways: **compile-time** literals in
  `finalizeRpcTyping.test.ts` (both the four- and five-argument shapes must type-check, so drift
  fails `tsc --noEmit`), a source contract asserting the Args block declares exactly the five SQL
  parameters, and SQL **F12**, which proves a clean M1→M2→M3 application creates **exactly one**
  `finalize_inbound_call_terminal` — argument types `uuid, uuid, text, boolean, boolean`, exactly one
  defaulted argument, `p_external_answer` trailing — so **no stale four-argument overload** can
  exist. The ACL/COMMENT lines and the K9 ACL assertion reference only the five-argument signature.

- **C14 — no inbound browser lifecycle writes remain.** C8 closed the mount-time orphan sweep, but
  `finalizeCallRecord` still wrote `status:'completed'` + `ended_at` once `activeCallIdRef` had been
  armed for a CLAIMED inbound call — contradicting the Revision 7 invariant and able to preempt the
  server-side terminal (the R7 ladder freezes the FIRST terminal, so a premature browser `completed`
  would permanently win over the real outcome and could mask a missed call). `finalizeCallRecord` now
  **captures the direction before clearing the call refs** and returns without any `calls` write for
  inbound/incoming (and for unknown direction — fail closed); status, outcome, is_missed, ended_at,
  duration and provider metadata are left entirely to `twilio-voice-status` and
  `finalize_inbound_call_terminal`. `call_logs` telemetry and all UI-only cleanup are unchanged for
  both directions, and the outbound finalize payload is byte-identical. One predicate now governs
  every browser terminal write — `canBrowserFinalizeCallRow`, which `canBrowserFinalizeOrphanRow`
  delegates to — so C8's read-only inbound orphan handling and this path cannot drift apart.
  **Static audit (enforced by test):** all six browser `calls` mutation sites are enumerated and each
  must sit behind `classifyOrphanRecovery` / `canBrowserFinalizeOrphanRow` /
  `canBrowserFinalizeCallRow` / `shouldSyncIdsToRow`, or be the outbound-creating `makeCall` INSERT;
  no `calls` payload may contain `outcome`, `is_missed`, `duration`, `provider_error_code` or
  `shaken_stir`. A new ungated write fails CI. Misleading comments claiming "no inbound writes" were
  corrected to state the enforced rule and name the audit.

**Rev-8 test additions:** vitest `finalizeRpcTyping` (7) and `inboundBrowserLifecycleWrites` (17);
SQL **F12**. No migration file changed; no schema change.
