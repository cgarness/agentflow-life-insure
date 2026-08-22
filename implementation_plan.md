# Implementation Plan — Inbound Call Flow Rebuild: canonical caller identity, exact WebRTC correlation, Twilio-authoritative answer claiming, routing/lifecycle/recording correctness

**Task branch:** `claude/inbound-call-flow-fix-auzk81` (from `main` @ `19c6a95` = PR #362 squash-merge)
**Date:** 2026-08-21 · **Revision 2:** 2026-08-22 — corrections 1–12 applied (rulings R1–R12). · **Revision 3:** 2026-08-22 — **CHANGES-REQUIRED review applied: rulings R13–R18 added; R1–R12 preserved except the browser-trigger portion of R1, which R13 explicitly supersedes.** · **Status:** **PLAN ONLY — AWAITING CHRIS'S REVIEW. No application code, migration, test file, or Edge Function change has been written; nothing deployed, merged, or applied to production. Production access in all sessions was strictly read-only.**

**Rulings (Chris, 2026-08-22 — Revision 2):** R1 claim RPC is service-role-only with database-authoritative profile checks *(its browser/JWT-wrapper answer-trigger portion is superseded by R13; everything else stands)* · R2 `provider_session_id` is first-writer-wins; a different child SID never replaces the first accepted leg · R3 empty/null `routed_agent_ids` ⇒ claim **fails closed** with actionable telemetry; `af_org_id` removed from TwiML params · R4 `get_inbound_call_identity` requires Active profile + routed-or-owner + live/recent state, not mere org membership · R5 `resolve_inbound_caller_display_name` is deprecated this release (unique-only compat wrapper), dropped in a later cleanup after bundle rollover · R6 idempotency index has **no timestamp predicate**; ingest is `ON CONFLICT DO NOTHING` + exact SELECT; a retry mutates **zero** rows · R7 status is fully monotonic `ringing → connected → terminal` (including `connected→ringing` suppression) · R8 one resolver only — no FloatingDialer phone probe; `campaign_leads` excluded from authoritative resolution; matchability metrics corrected · R9 auto-create serialized per (org, normalized phone) with in-lock re-resolve · R10 `last_agent` routing never consults `caller_id_used` · R11 RLS split into Phase 1 (command-split security repair) and Phase 2 (later privacy narrowing) · R12 presence-aware assigned-agent routing is out of scope (separate follow-up).

**Rulings (Chris, 2026-08-22 — Revision 3):**
- **R13 — Twilio-authoritative answer claiming.** `Call.accept()` returns void, so a browser-side "answer succeeded" gate proves nothing; the claim trigger is a **signed Twilio child-leg `answered` status callback**, not any browser request. The browser performs **no ownership write**; its accept event is UI state only. The legacy browser claim contract is disabled so stale bundles cannot write anything. (Supersedes only R1's browser/JWT-wrapper trigger; R1's service-role-only RPC + database-authoritative profile checks stand.)
- **R14 — Routed-agent persistence must precede ringing.** `append_call_routed_agents` is awaited and must report success **before** any `<Client>` TwiML for that wave is emitted — for the initial wave, direct-line, and every fallback wave. On failure: never dial agents; deterministic safe fallback (voicemail when enabled, else the documented terminal infrastructure-failure path) with actionable telemetry.
- **R15 — Phase 1 RLS is a mandatory production-release gate.** The live ALL policy lets any org member directly UPDATE-claim an unassigned inbound row, bypassing the authoritative claim flow — so this feature is **not production-ready until RLS Phase 1 (command-splitting, SELECT visibility preserved exactly, unassigned-inbound removed from authenticated UPDATE/DELETE) is approved and live**. No RLS approval is granted by the review; no policy is authored or modified yet; rollout stops at an explicit `#APPROVE_RLS_CHANGE` gate before production.
- **R16 — Strict SID and ingest-collision validation.** Parent and child CallSids must match `^CA[0-9a-fA-F]{32}$`, validated in the Edge callback and again in the RPC before the CAS; blank/malformed rejected. A successful claim never leaves `provider_session_id` NULL. Param renamed `p_child_call_sid`. Ingest conflict lookups are SID + `direction='inbound'` + `organization_id = p_org_id`, with a DID (`caller_id_used` vs `p_to_number`) cross-check — same-SID cross-org or different-DID replays fail closed.
- **R17 — Recording and terminal persistence cannot be silently acknowledged.** Only a valid existing `recording_storage_path` is a success short-circuit (sentinels are recoverable failures, not successes); the calls-row update must be verified exact-row; the Twilio source recording is deleted **only after** storage upload AND verified DB persistence; failures preserve the Twilio source and use an explicit bounded retry (Twilio webhook connection-override retry policy — Twilio does **not** retry 5xx by default); unmatched callbacks never delete the provider recording. `finalize_inbound_call_terminal` failures are observable and retryable — never best-effort-swallowed — and the plan's stranding claim is stated honestly.
- **R18 — True two-stage `last_agent` fallback.** Tier 1: newest eligible same-org outbound call matching `p_contact_id` (when supplied). Tier 2 (**only when tier 1 finds no row** — including when `p_contact_id` was supplied but no historical row carries it): newest eligible same-org outbound call matching normalized `contact_phone`. Contact-ID matches outrank phone matches; `caller_id_used` is never consulted.

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
       organization_id) + DID cross-check — cross-org / different-DID replay FAILS
       CLOSED (R16); retry mutates ZERO rows (R6)
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
               statusCallbackEvent="answered" statusCallbackMethod="POST">
         <Identity>agent</Identity><Parameter name="af_call_row_id" value=…/>
       </Client>                                   (no af_org_id — R3; ids server-generated — R13)
  6. browser: reads call.customParameters → get_inbound_call_identity(row id) —
     authenticated + Active + routed-or-owner + live/recent state (R4); displays ANI
     (contact_phone) + authoritative row contact name; no guessing anywhere
  7. agent answers → TWILIO fires the signed child-leg answered callback to
     inbound-call-claim (R13): validate Twilio signature + event + SID formats (R16);
     cross-check row↔ParentCallSid, org, live inbound state, Active profile whose
     twilio_client_identity matches the answered <Client> leg, agent ∈ persisted
     routed_agent_ids (fail closed — R3/R14); only then invoke the service-role-only
     CAS RPC; child CallSid stored in provider_session_id (first-writer-wins — R2;
     never NULL after success — R16). The browser performs NO ownership write; its
     accept event is UI-only and it reads/polls the exact row while waiting (R13).
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
   - `INSERT … ON CONFLICT (twilio_call_sid) WHERE direction = 'inbound' AND twilio_call_sid IS NOT NULL DO NOTHING` (arbiter = the R6 index). **On conflict (no row returned): exact SELECT by `twilio_call_sid = p_twilio_call_sid AND direction = 'inbound' AND organization_id = p_org_id`** — then **verify the existing row's `caller_id_used` matches `p_to_number`** (normalized DID comparison). A same-SID **cross-org replay** (SELECT finds nothing in `p_org_id`) or a **different-DID replay** (DID mismatch) **fails closed** with an error result — the RPC never returns another organization's row (R16). A genuine Twilio retry (same org, same DID) returns the existing row's state with **zero row mutation** — no `updated_at` bump, no trigger re-fire, no re-resolution, no auto-create (R6).
   - Insert values: `direction='inbound'`, `status='ringing'`, `contact_phone = p_from_number` (raw Twilio ANI — **preserved verbatim; never replaced by the CRM stored phone**), `caller_id_used = p_to_number`, `organization_id = p_org_id`, `agent_id = NULL`, **`contact_type = NULL` explicitly** (defeats the false `'lead'` default; CHECK accepts NULL), `contact_name = NULL`.
   - On fresh insert: call `resolve_inbound_contact`; if `unique`, link via guarded `UPDATE … SET contact_id, contact_type, contact_name WHERE id = v_id AND contact_id IS NULL` (races/retries converge; `contact_phone` untouched).
   - **Auto-create (only when `p_auto_create` and resolution = `not_found`) is serialized per (org, normalized phone)** (R9): take `pg_advisory_xact_lock(hashtextextended('af_inbound_autocreate:' || p_org_id::text || ':' || v_last10, 0))`, **re-run `resolve_inbound_contact` inside the lock**, and only if still `not_found` insert the lead (E.164 phone, `first_name 'Inbound'`, `last_name 'Caller'`, `lead_source 'Inbound Call'`, `status 'New'`, `assigned_agent_id` NULL — deliberate, "answering agent can claim", 2026-05-19 canon) and link it via the same guarded update. Two simultaneous unknown calls from one number therefore converge on **one** lead. **`ambiguous` and any resolver error: no link, no auto-create, ever.**
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
- **Answer authority (NEW — R13):** each generated `<Client>` noun additionally sets
  `statusCallback="{SUPABASE_URL}/functions/v1/inbound-call-claim?call_row_id={uuid}&agent_id={uuid}" statusCallbackEvent="answered" statusCallbackMethod="POST"`
  — one URL **per routed agent**, generated server-side while building the wave (the same place `routed_agent_ids` was just durably persisted — R14). `call_row_id` and `agent_id` therefore **never originate from the browser**; they are server-issued and covered by the Twilio request signature (Twilio signs the full URL including the query string — the exact scheme the four voice webhooks already validate). Twilio fires this callback on the **child leg** when it is answered, with `CallSid` (child), `ParentCallSid`, `CallStatus=in-progress`, and `To`/`Called` = `client:<identity>` of the answered leg.
- **Implementation-time verification gates:** (a) `<Client>` noun `statusCallback`/`statusCallbackEvent` attribute support and its exact callback parameter set confirmed against current Twilio TwiML docs; (b) `customParameters` arrival; both proven in staging scenario 1 before anything builds on them. Twilio webhook **connection-override** syntax for R17's retry channel is verified the same way (§7).
- Browser child-leg SID handling in the UI (`call.parameters.CallSid`) becomes display/telemetry-only. **Parent SID is never re-homed:** `twilio_call_sid` keeps the PSTN parent SID forever; `provider_session_id` is written exclusively by the claim path from **Twilio's** child `CallSid` — first-writer-wins (R2), never NULL after a successful claim (R16).

### 4.2 `public.claim_inbound_call(p_user_id uuid, p_call_row_id uuid, p_child_call_sid text, p_parent_call_sid text) RETURNS jsonb` (migration M2) — service-role-only CAS (R1 core, R13 trigger, R16 validation)

`SECURITY DEFINER` (repo standard), `SET search_path = pg_catalog, pg_temp`, schema-qualified, **EXECUTE: service_role ONLY** (REVOKE PUBLIC/anon/authenticated). Invoked exclusively by the Twilio-signed answer callback handler (§4.4) through the service-role client — never written around `auth.uid()`, never callable by authenticated users directly.

- **Input validation before anything else (R16):** `p_child_call_sid` and `p_parent_call_sid` must both match `^CA[0-9a-fA-F]{32}$` (blank/malformed ⇒ `{claimed:false, reason:'invalid_sid'}`); `p_user_id`/`p_call_row_id` non-null.
- **Profile checks (R1, database-authoritative):** `public.profiles` row for `p_user_id` must exist, be **`status='Active'`**, hold a non-null `twilio_client_identity`; org = the profile's `organization_id`.
- **One atomic compare-and-swap UPDATE:**
  ```sql
  UPDATE public.calls SET
    agent_id            = p_user_id,
    provider_session_id = COALESCE(provider_session_id, p_child_call_sid),  -- first-writer-wins (R2)
    status              = CASE WHEN status = 'ringing' THEN 'connected' ELSE status END,
    updated_at          = now()
  WHERE id = p_call_row_id
    AND organization_id = v_org                 -- exact org match; NEVER updated
    AND twilio_call_sid = p_parent_call_sid     -- row↔ParentCallSid cross-check (R13/R16)
    AND direction = 'inbound'
    AND status IN ('ringing','connected')       -- live-state only; terminal rows unclaimable
    AND (agent_id IS NULL OR agent_id = p_user_id)        -- one winner; idempotent duplicate callback
    AND (provider_session_id IS NULL
         OR provider_session_id = p_child_call_sid)       -- same child leg only; a different SID
                                                          -- never replaces the first (R2)
    AND routed_agent_ids IS NOT NULL
    AND p_user_id = ANY (routed_agent_ids)      -- durably persisted routing eligibility REQUIRED;
                                                -- empty/null ⇒ FAIL CLOSED (R3, guaranteed persisted by R14)
  RETURNING id, agent_id, provider_session_id,
            contact_id, contact_type, contact_name, contact_phone, caller_id_used;
  ```
  0 rows ⇒ `{claimed:false, reason}` with a **diagnosed reason code** (`invalid_sid` / `inactive_profile` / `cross_org_or_not_found` / `parent_sid_mismatch` / `terminal_state` / `already_claimed` / `sid_conflict` / `not_routed` / `no_routed_agents`) derived from a follow-up read of the row's non-sensitive state — actionable telemetry, logged by the callback handler. A **successful claim structurally cannot leave `provider_session_id` NULL** (R16): the SID is validated non-blank and the COALESCE has no NULL branch; the RPC additionally asserts the RETURNING value is non-null.
- `organization_id` is structurally untouchable. Duplicate `answered` callbacks are idempotent (same agent + same child SID re-match the CAS). Simultaneous calls cannot cross-claim: row id, parent SID, org, state, and routed membership are all checked. If availability under routing-persist failure is ever needed, a **signed per-agent short-TTL claim token** is a separate future design (§16) — under R14, an un-persisted wave is never rung at all, so that gap no longer occurs in normal operation.

### 4.3 Peek made exact-only

- Migration M2 `CREATE OR REPLACE public.peek_inbound_call_identity(p_provider_session_id, p_twilio_call_sid)` with the **6-minute newest-ringing fallback deleted** — exact match only (same signature; prefix-tolerance kept). `REVOKE … FROM anon` (function ACL hardening, not RLS). Old bundles get exact-or-null — strictly safer than today's cross-call bleed. The **"latest ringing" guess is removed from both peek and claim behavior everywhere**.

### 4.4 `inbound-call-claim` repurposed as the Twilio answer-claim webhook; browser performs no ownership write (R13)

- **The Edge function becomes a Twilio webhook, not a browser API:**
  1. Parse the form body; **validate the Twilio signature** against the actual request URL (including the server-issued `call_row_id`/`agent_id` query params) + sorted form params — the same HMAC-SHA1 scheme and canonical `SUPABASE_URL` base as the other four voice webhooks. Invalid ⇒ 403, nothing written.
  2. **Require the answered event:** `CallStatus ∈ ('in-progress','answered')` (the `answered` statusCallbackEvent delivery); anything else ⇒ 200 ack, no write.
  3. **Validate SIDs (R16):** child `CallSid` and `ParentCallSid` both present and `^CA[0-9a-fA-F]{32}$`.
  4. **Cross-checks before invoking the RPC** (all read via service role, org derived from the row + profile — never from the request): the row addressed by `call_row_id` exists, is `direction='inbound'`, live (`ringing`/`connected`), and its `twilio_call_sid` equals `ParentCallSid`; the `agent_id` URL param's profile is Active, same-org as the row, and its `twilio_client_identity` **matches the answered leg's `Called`/`To` client identity** in the callback body; the agent is present in the durably persisted `routed_agent_ids`.
  5. Only then call `claim_inbound_call(p_user_id := <agent_id from the signed URL>, p_call_row_id, p_child_call_sid := CallSid, p_parent_call_sid := ParentCallSid)` and ack 200. Rejections log the reason code (`console.warn("[inbound-call-claim] rejected", {reason, call_row_id, agent_id, parentCallSid})` — R3 telemetry).
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

## 8. Migrations authored (files only — **NOT applied**; production apply is a separately-approved gate)

| File | Contents | Historical-data footprint |
|---|---|---|
| `supabase/migrations/20260822<hhmmss>_inbound_identity_foundation.sql` (M1) | `phone_last10` fn · 3 contact-table expression indexes + the `calls` outbound last-agent expression index · partial unique `uq_calls_inbound_twilio_call_sid` (**no timestamp predicate** — R6) · `resolve_inbound_contact` · `ingest_inbound_call` (SID-validated, DO-NOTHING ingest, R16 replay checks, R9 advisory-lock auto-create) · `find_last_agent_for_inbound` (R18 two-stage) · COMMENTs · REVOKE/GRANT per repo standard (all functions: service_role only) | **None.** DDL only; indexes read rows, modify none. No UPDATE/DELETE/INSERT of user data anywhere. |
| `supabase/migrations/20260822<hhmmss+1>_inbound_claim_lifecycle.sql` (M2) | `claim_inbound_call(p_user_id, p_call_row_id, p_child_call_sid, p_parent_call_sid)` (**EXECUTE: service_role only** — R1/R13; SID regex validation — R16) · `get_inbound_call_identity` (authenticated; R4 authorization body) · `finalize_inbound_call_terminal` (service_role only; discriminated result — R17) · `CREATE OR REPLACE peek_inbound_call_identity` (fallback removed; anon EXECUTE revoked) · `CREATE OR REPLACE resolve_inbound_caller_display_name` as the **deprecated unique-only compat wrapper** (R5 — NOT dropped) | **None.** Function DDL + ACLs only. |
| *(not authored — R11/R15)* RLS Phase 1 migration | §9 — **authored only after `#APPROVE_RLS_CHANGE`**, as its own reviewed task; **mandatory before production readiness** (R15) | — |

Static self-checks shipped with the build (§12): migrations contain no top-level `UPDATE`/`DELETE`/`INSERT INTO` targeting existing user data; `supabase/tests/*.sql` suites run them on a disposable localhost stack under `BEGIN…ROLLBACK`. Timestamps are > `20260820233402`; apply-time restamp expected per house convention.

---

## 9. RLS — diagnosis; Phase 1 is a MANDATORY production-release gate (R15); Phase 2 is later privacy narrowing (R11). Nothing is authored in this build; `#APPROVE_RLS_CHANGE` still required.

**Diagnosis.** `Calls Hierarchical Access` (ALL-commands) USING includes `(get_org_id() IS NOT NULL AND organization_id = get_org_id() AND direction='inbound' AND agent_id IS NULL)`:
1. Every org member can read **all** unassigned inbound calls **forever** — customer ANIs and CRM names included.
2. Because the branch sits in an ALL policy whose `WITH CHECK` accepts `agent_id = auth.uid()`, any org member can **directly UPDATE-claim** any unassigned inbound row via PostgREST — bypassing the authoritative Twilio-confirmed claim flow entirely, and **capable of blocking the real winner** (a squatter's `agent_id` write makes the legitimate CAS fail its `agent_id IS NULL` predicate).

**Phase 1 — mandatory production gate (R15):**
- Split the single ALL policy into command-specific policies (`FOR SELECT` / `FOR INSERT` / `FOR UPDATE` / `FOR DELETE`).
- **Preserve today's SELECT visibility exactly** — no reader loses anything they can see now (dashboards, notification deep links, recent-call lists keep working unchanged).
- **Remove the unassigned-inbound branch from authenticated UPDATE and DELETE eligibility** — claiming becomes possible only through the controlled, Twilio-authoritative claim path.
- **This feature is NOT production-ready until Phase 1 is approved, authored, applied, and verified.** The non-RLS implementation (code, migrations M1/M2, tests) may be fully prepared and locally verified first, but the §15 rollout **stops at an explicit RLS approval gate** before production. No RLS approval is granted by the current review; no policy file exists yet.

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

## 11. Test plan — fail-first; original 28 scenarios preserved; R13–R18 coverage added

House conventions: SQL suites in `supabase/tests/` (disposable localhost PG, `BEGIN…ROLLBACK`, `_sim/_expect`-style helpers, run red first); vitest for Deno-free pure modules and UI (`TZ=UTC` + `TZ=America/Los_Angeles`, placeholder `VITE_SUPABASE_*`; suites live under `src/**` importing function modules by relative path — the `twilioStatusDuration.test.ts` pattern); esbuild bundle check per Edge function (no Deno in this container).

**SQL — `supabase/tests/inbound_identity_resolution.sql`:** T1 formatted `(209) 840-2988` lead ↔ `+12098402988` unique · T2 formatted client unique · T3 formatted recruit unique · T4 no match ⇒ `not_found` · T5 two contacts sharing last-10 ⇒ `ambiguous`, no link · T6 ambiguous ⇒ **no** auto-created lead (with `p_auto_create=true`) · T7 unique ⇒ `contact_id`+`contact_type`+`contact_name` populated, `contact_phone` still the raw ANI · **[R8]** a `campaign_leads`-only phone match resolves `not_found`; a campaign_lead id can never appear in `calls.contact_id` · <10-digit ANI ⇒ `not_found` · `contact_type` NULL (not `'lead'`) on unresolved ingest.
**SQL — `supabase/tests/inbound_ingest_idempotency.sql`:** T23 same-CallSid double ingest ⇒ one row, same id, no second lead · **[R6]** the retry mutates **zero** columns (`updated_at` byte-identical) and `inserted=false` · ON CONFLICT arbitration against the unbounded partial index · **[R16]** blank SID rejected · malformed SID (`CA`-prefix wrong length / non-hex) rejected · **same-SID cross-org replay fails closed** (never returns the other org's row) · **same-SID different-DID replay fails closed** · **[R9]** two *different* CallSids from the same unknown number with `p_auto_create=true`, driven concurrently ⇒ exactly **one** lead, both calls linked to it.
**SQL — `supabase/tests/inbound_claim.sql`:** T12 first claim wins atomically (agent_id set, status connected) · T13 loser returns `claimed:false` + reason, row unchanged · T14 cross-org claim rejected · T15 non-routed and inactive-profile claims rejected · **[R3]** NULL/empty `routed_agent_ids` ⇒ rejected `no_routed_agents` (fail closed) · T16 parent SID preserved in `twilio_call_sid`, child SID lands in `provider_session_id`, `organization_id` untouched · **[R13]** duplicate answered-callback claims are idempotent (same agent + same child SID ⇒ success, no second mutation) · **[R2]** a **different child SID** for the same row is rejected (`sid_conflict`) and `provider_session_id` keeps the first value · **[R16]** blank/malformed child or parent SID rejected before the CAS (`invalid_sid`) · **wrong `p_parent_call_sid`** (row↔parent mismatch) rejected · **a successful claim never leaves `provider_session_id` NULL** (asserted on RETURNING) · terminal row unclaimable · **[R1]** EXECUTE matrix: `authenticated` has no EXECUTE on `claim_inbound_call`; all profile checks run against `p_user_id`.
**SQL — `supabase/tests/inbound_terminal_lifecycle.sql`:** T24 finalize RPC closes a `ringing` row with `ended_at`, no duration write · T25 late `ringing`/`in-progress`/zero-duration inputs cannot regress a terminal row · **[R7]** `connected` + late `ringing` ⇒ status stays `connected` · terminal + different terminal ⇒ first stands, duration/ended_at still enrich monotonically · **[R17]** finalize returns `{updated:false, reason:'already_terminal'}` on an already-terminal row (idempotent success) and `{updated:false, reason:'not_found_or_mismatch'}` on a wrong id/org (observable error — distinguishable) · missed flag only ORs upward · **[R4]** `get_inbound_call_identity` matrix: routed agent on live ring ⇒ payload; assigned agent post-claim ⇒ payload; same-org non-routed member with the row UUID ⇒ NULL; inactive profile ⇒ NULL; stale (>15 min) unassigned ring ⇒ NULL; empty `routed_agent_ids` ⇒ NULL · **[R5]** deprecated `resolve_inbound_caller_display_name` wrapper returns a name only on a unique canonical match, NULL on ambiguous · **[R18/R10]** `find_last_agent_for_inbound`: formatted stored outbound `contact_phone` matches by normalization · contact-id match outranks phone match · **`p_contact_id` supplied but NO outbound row linked by contact id, while a formatted historical `contact_phone` matches ⇒ tier 2 returns that agent** · cross-org rows never returned · `caller_id_used` never matches.
**Vitest — pure Edge modules:** T17 all-ring target filter (Active-only) · T18 assigned/direct-line validation (org + Active) · T19 `buildDialTwiml` timeout attr from settings (+clamp) · T20 voicemail-disabled ⇒ hangup TwiML, no `<Record>` · T21 wave exclusion (no agent repeated across chain steps) · T22 forward-answered ⇒ not-missed decision; forward-unanswered ⇒ missed · TwiML: `<Client>` carries `<Identity>` + `<Parameter af_call_row_id>` + **per-agent signed `statusCallback` with `statusCallbackEvent="answered"`** and **no `af_org_id`** (R13/R3) · **[R14]** wave-builder unit tests: routed-persist exception ⇒ no `<Client>` TwiML for the wave, safe-fallback TwiML chosen (voicemail when enabled, else terminal), telemetry emitted; `false`/zero-row result ⇒ same; failure on the **initial** wave and on a **fallback** wave each suppress only that dialing and take the safe path; a retried/subsequent successful wave accumulates `routed_agent_ids` and rings normally · **[R13]** answer-callback handler units: invalid Twilio signature ⇒ 403 no-write; non-answered event ⇒ ack no-write; wrong parent SID / wrong row / wrong agent / identity-mismatch ⇒ rejected reasons; legacy JWT-browser-shaped request ⇒ rejected, zero writes · terminal-guard module (R7 full-ladder table incl. `connected→ringing` suppression and enrichment passthrough) · **[R17]** recording idempotency/pipeline module: valid `recording_storage_path` ⇒ short-circuit; **sentinel `recording_url` with NULL path ⇒ NOT a short-circuit (recoverable)**; download-fail ⇒ 5xx + Twilio source preserved ⇒ retry-success path completes; upload-fail ⇒ same; DB-update-fail ⇒ **no Twilio delete**, 5xx, retry-success completes; unmatched row ⇒ ack, no download/upload/delete, no orphan; duplicate success ⇒ ack, no rewrite; **delete-only-after-commit ordering asserted**; callback URL carries the retry-policy connection overrides.
**Vitest — frontend:** T9 inbound display prefers `contact_phone` over `caller_id_used` · T10 two simultaneous inbound rings resolve independent identities by row id (no newest-ringing bleed) · **T11 (reshaped per R13): `call.accept()` alone does not claim; the browser accept event does not claim; the browser issues zero ownership writes end-to-end (spy: no `calls` update, no claim POST); ownership UI state flips only when the row shows `agent_id = uid`; lost-race row (`agent_id` = other) ⇒ teardown with no writes** · T26 browser recording gated off for inbound, unchanged for outbound · T28 outbound `makeCall`/recording path snapshot tests pinning current behavior byte-for-byte · **[R8]** FloatingDialer: linked rows resolve by `contact_id`/`contact_type`; unlinked rows render snapshot-name-else-ANI; **no phone-probe query is issued at all** (spy asserts zero `leads` ilike calls); typed quick-call passes true `contact_type` · T8 history: `getLeadHistory`/contact history queries remain `contact_id`-keyed and pick up a newly linked inbound call.
Fail-first: every suite is written and run red against the unmodified tree before implementation lands.

---

## 12. Verification gates (all must pass before handoff; nothing deploys)

1. Focused new suites (SQL + vitest) green; 2. affected integration suites (dialer render-stability, notifications, conversation-history) green; 3. **full `npx vitest run`** under both TZs; 4. `npx tsc --noEmit` (multiset-compared to the clean-main 73-error baseline); 5. `npx eslint` on touched files; 6. `npm run build`; 7. esbuild bundle/syntax check per touched Edge function; 8. migration static checks (no top-level backfill/cleanup DML; grep-audited + localhost replay under rollback); 9. **adversarial review: organization scoping** — every new/changed lookup and write carries an explicit org predicate or proven org-derivation; no org identity, user identity, or claim authority is ever read from a browser request or TwiML-visible parameter (R1/R3/R13 — the answer-callback's ids are server-issued and signature-covered); 10. **adversarial review: simultaneous all-ring** — two-ring race walkthrough of the Twilio-answered-callback claim CAS, customParameters row-pinning, exact-peek, reject-path no-writes, SID first-writer-wins, losing-leg cancel behavior; 11. **adversarial review: Twilio retry ordering** — initial-webhook retry (zero-mutation), cross-org/different-DID SID replays (fail closed), duplicate answered callbacks (idempotent), duplicate status callback per R7 ladder state, duplicate/failed recording callbacks across the full R17 pipeline (incl. delete-after-commit ordering and the 5xx retry channel), out-of-order Dial-action vs status callback, concurrent auto-create (R9); 12. **adversarial review: zero historical mutation** — no code path or migration statement can write to a pre-existing inbound row except the always-allowed forward-only paths that already exist today; notifications history untouched; 13. audit `trg_workflow_call_created` under the new ingest (no dispatch on inbound insert; zero-mutation retry cannot re-fire); 14. telemetry review — every claim rejection, suppressed wave (R14), finalize failure (R17), and recording-pipeline failure emits an actionable structured log; 15. **R13 mechanism gate** — `<Client>` `statusCallback`/`statusCallbackEvent` support, callback parameter set, and the webhook connection-override retry syntax verified against current Twilio documentation before the dependent code is written.

---

## 13. Manual Twilio staging matrix (run on staging numbers after deploy approval — expected results)

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

**Resolved by Chris (2026-08-22, Rev 2 + Rev 3):** claim trigger = **Twilio-authoritative signed answered callback; browser performs no ownership write** (R13, superseding R1's browser-trigger portion; R1's service-role-only RPC + DB-authoritative checks stand) · routed persistence **precedes** ringing with deterministic safe fallback (R14) · **RLS Phase 1 is a mandatory production gate** (R15; still requires `#APPROVE_RLS_CHANGE` to author) · strict SID validation + replay-safe ingest (R16) · verified-persistence recording pipeline + observable terminal finalization (R17) · two-stage `last_agent` (R18) · fail-closed empty routing (R3) · first-writer-wins child SID (R2) · tightened identity RPC (R4) · deprecate-don't-drop display-name RPC (R5) · unbounded idempotency index + zero-mutation retry (R6) · full monotonic ladder (R7) · single resolver, no campaign_leads, no phone probes (R8) · serialized auto-create (R9) · contact-first last-agent matching, never `caller_id_used` (R10) · two-phase RLS structure (R11) · presence-aware routing out of scope (R12).

**Standing defaults (approved with the overall direction; veto/adjust freely):**
- **D1 — Ambiguity is strict:** ≥2 distinct candidates (within or across lead/client/recruit) ⇒ unlinked. No type-priority tiebreak.
- **D2 — Auto-created lead shape** stays `Inbound` / `Caller` / `lead_source 'Inbound Call'` / unassigned, created inside the ingest RPC under the R9 lock.
- **D3 — Voicemail-disabled terminal behavior** = greeting + hangup.
- **D7 — Forwarded external legs stay unrecorded** (compliance-sensitive; §7). Any change is a separate approval.
- **D8 — all-ring gains the `status='Active'` filter**, superseding the 2026-05-19 scope freeze — called out since it changes who rings for orgs relying on the old behavior.

---

## 15. Implementation sequence (after plan approval; deploy/apply remain separately gated)

1. Fail-first test suites (red) → 2. M1 + M2 authored; localhost replay + SQL suites green → 3. Edge pure-module extraction + rewires (incl. the R13 answer-callback handler and R17 pipeline); esbuild checks → 4. TwilioContext/FloatingDialer changes → 5. full verification battery (§12, incl. the R13/R17 Twilio-docs mechanism gate) → 6. WORK_LOG + AGENT_RULES entries → 7. commit/push to `claude/inbound-call-flow-fix-auzk81` → **STOP.**
**Production rollout (each step separately approved by Chris):** read-only preflights (`list_migrations`, zero-duplicate-inbound-SID check, `get_edge_function` fresh pulls) → apply M1, M2 → deploy `inbound-call-claim` **first** (its URL is referenced by the new TwiML; legacy browser requests to it are already inert) → deploy `twilio-voice-inbound` + `twilio-voice-status` **back-to-back** (amendment-5 precedent) → `twilio-recording-status` → frontend release → staging matrix (§13) → **⛔ RLS Phase 1 gate (R15): the feature is not declared production-ready until Chris issues `#APPROVE_RLS_CHANGE`, and the Phase 1 command-split migration is separately authored, reviewed, applied, and verified.** Rollout stops here without that approval.
Stale-bundle safety throughout: their claim path never worked and is now inert by signature rejection; exact-only peek returns null instead of wrong identities; the deprecated `resolve_inbound_caller_display_name` wrapper keeps serving them names (unique-only) until the later cleanup release drops it after bundle rollover.

---

## 16. Explicit exclusions (documented, NOT done in this build)

- **Presence-aware assigned-agent routing (R12):** ring-in-app-when-online / forward-to-personal-phone-when-offline is **NOT implemented or partially implemented by this repair**, and this release must not be described as delivering it. Separate follow-up (needs a server-authoritative presence source and its own routing design).
- **Signed per-agent short-TTL TwiML claim token** — separate future design; under R14 an un-persisted wave is never rung, so the availability gap it would address does not occur in normal operation.
- **RLS Phases 1 and 2** (§9) — not authored here; Phase 1 is a mandatory production gate (R15) requiring `#APPROVE_RLS_CHANGE`; Phase 2 is later privacy narrowing with its own inventory and tests.
- **Dropping `resolve_inbound_caller_display_name`** — deferred to a later cleanup release after bundle rollover (R5); its `types.ts` entry is kept until then.
- **Historical backfill/cleanup of any kind** — no repair of old `contact_id`/names/statuses/notifications/recordings/agent ownership; no duplicate-notification cleanup (separately deferred, 2026-08-18 D9); no watchdog/cleanup job; no historical conversation phone fallback.
- **No campaign_leads authoritative matching** (R8) — permanently, unless separately re-approved with a current-phone design.
- **Forwarded-leg recording**, per-number ring-timeout schema, presence-based round-robin improvements, `webhook_debug_log`/`app_config` RLS findings, and the master-creds-per-subaccount webhook cleanup — all pre-existing deferred items, untouched.

**Confirmations:** no previous inbound call rows, notifications, or recordings are modified by any part of this plan; nothing has been deployed, merged, or applied; no application code, migration, test, or Edge Function change has been written; this document (and its git history) is the only artifact of these sessions.
