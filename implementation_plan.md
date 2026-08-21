# Implementation Plan — Inbound Call Flow Rebuild: canonical caller identity, exact WebRTC correlation, answer-based claiming, routing/lifecycle/recording correctness

**Task branch:** `claude/inbound-call-flow-fix-auzk81` (from `main` @ `19c6a95` = PR #362 squash-merge)
**Date:** 2026-08-21 · **Status:** **PLAN ONLY — AWAITING CHRIS'S EXPLICIT APPROVAL. No application code, Edge Function, or migration has been written or changed; nothing deployed, merged, or applied to production. Production access in this session was strictly read-only** (MCP `list_migrations`, `list_edge_functions`, `get_edge_function`, read-only `execute_sql` aggregates).
**Reading:** AGENT_RULES.md v5.0.0 (full) · VISION.md (full) · WORK_LOG.md — complete 8,956-line coverage (all entries 2026-04-18 → 2026-08-21, including the Phase 4 inbound build, the 2026-05-21 fallback-chain rewrite, the 2026-05-26 inbound-routing safety pass, the 2026-08-06 emergency telephony repair, and the 2026-08-18/19 notifications rebuild) plus the deployed bodies of `twilio-voice-inbound` v42, `twilio-voice-status` v39, `inbound-call-claim` v37 pulled via `get_edge_function` and **byte-diffed against the repo: identical** (drift check per invariant #4).
**Scope:** Fix the complete inbound-call flow **for new calls only**. No backfill; no repair of historical `contact_id`/names/statuses/notifications/recordings/agent ownership; existing inbound rows remain byte-identical. Migrations add only future-facing functions, indexes, and constraints — **zero historical cleanup, zero top-level backfill DML**. Single-leg Twilio Voice.js WebRTC architecture, Twilio signature validation, organization isolation, telemetry canon (`calls.duration` sole-writer), recording safeguards, and every TwilioContext re-entrancy guard (invariant #9) are preserved. **No RLS policy is edited or applied by this build; §9 is a separate proposal gated on `#APPROVE_RLS_CHANGE`.**

---

## 1. Current-state findings (verified: repo @ `19c6a95` + live production read-only + deployed-function diffs, 2026-08-21)

### 1.1 Root cause confirmed, with production scale

- `twilio-voice-inbound/resolveInboundContact` (`index.ts:160-237`) matches the normalized ANI against **raw stored `phone` text**: exact `.eq("phone", <E164-ish variants>)`, then `.ilike("phone", "%<last10>")`. A stored `(209) 840-2988` has punctuation between digit groups, so **neither** the exact variants nor the trailing-`ilike` can match `+12098402988`. Matching fails for every formatted stored phone.
- Production scale (read-only aggregate, 2026-08-21): **leads: 1,088 rows with ≥10-digit phones, 583 of them non-E.164 (54%)**; clients: 1 (non-E.164); recruits: 0. **118 duplicate normalized-last-10 groups** exist in leads — the "many normalized-phone duplicates" premise is real, so any `LIMIT 1` link is a misattribution hazard.
- Damage shape on the 25 production inbound calls (read-only): **22/25 have `contact_id` NULL** — and all 22 carry **`contact_type='lead'` from the column DEFAULT** (`calls.contact_type text DEFAULT 'lead'`, baseline `:7042`), i.e. falsely classified; **25/25 have `agent_id` NULL** (claiming has *never* succeeded — see 1.3); **3/25 are stuck `status='ringing'` forever**; **0/25 have `provider_session_id`**.
- The fuzzy branch is also `.limit(1).maybeSingle()` — an arbitrary pick; and the exact branch's `.maybeSingle()` **errors** when a variant matches >1 row, which is silently swallowed (`console.warn` + continue), so a duplicated exact-match phone falls through to fuzzy/auto-create.
- Split brain: the UI's `resolve_inbound_caller_display_name` RPC (baseline `:4924-5028`) **does** normalize stored text (`right(regexp_replace(phone,'[^0-9]','','g'),10)`), so it can resolve the very numbers the webhook cannot — a name renders while the call row stays unlinked. It also diverges in **type coverage** (leads → campaign_leads → clients; no recruits — webhook does leads → clients → recruits, no campaign_leads), and in **selection** (`ORDER BY updated_at DESC LIMIT 1` — newest-record guessing). FloatingDialer's recent-call enrichment (`FloatingDialer.tsx:353-460`) is a third divergent resolver: leads-only `.ilike` probe, first-match-wins per last-10, and it **overrides the display name even for rows that already have `contact_id`**.
- Conversation history is strictly `contact_id`-based (`dialer-api.ts getLeadHistory :180-231` — `contact_id.eq.<id>` with a `campaign_lead_id` OR-branch; contact views likewise). A NULL `contact_id` inbound call is invisible there — correct behavior, wrong input. **No phone-number fallback exists in history and none will be added.**

### 1.2 `twilio-voice-inbound` (1,325 lines; deployed v42 = repo byte-identical) — defect inventory

| Area | Behavior today (line cites) | Defect class |
|---|---|---|
| Initial insert | plain `INSERT` per webhook hit (`:1054-1070`); `twilio_call_sid` has only a **non-unique** index (`idx_calls_telnyx_call_control_id`, baseline `:9471`); no upsert key | Twilio retry of the initial webhook inserts a duplicate row (D) |
| Insert payload | `contact_phone: From` (customer ANI), `caller_id_used: To` (our DID) — **correct ordering here**; `contact_type` omitted → DEFAULT `'lead'` misclassifies unresolved calls | A |
| Contact enrich | overwrites `contact_phone` with the **CRM stored phone** on match (`:1092`) — destroys the Twilio ANI | A (requirement: ANI preserved in `contact_phone`) |
| Auto-create lead | fires whenever `resolvedContact` is null (`:1107`) — including when resolution *errored* or was ambiguous-and-swallowed; creates duplicate leads for formatted existing contacts | A |
| Ring timeout | hardcoded `<Dial timeout="30">` (`buildDialTwiml :769`) — `phone_settings.ring_timeout` (exists, default 30, 1 org has a non-default value) never read on inbound | C |
| all-ring | `resolveAllOrgIdentities` (`:484-501`) has **no `status='Active'` filter** (historical constraint "do not change all-ring", 2026-05-19 Phase 1g — now superseded by this task's explicit requirement) | C |
| assigned / direct-line | `resolveAssignedIdentity` (`:417-436`) looks up the profile by id only — **no org match, no Active check** | C |
| chain tiers | `resolveActiveRingTargetsByAgentIds` (`:530-546`) filters Active but **not organization**; tiers re-ring agents already rung in earlier waves (no exclusion) | C |
| voicemail | `handleFallback`/`emitTerminalFallback` never consult `voicemail_enabled` — the default branch always records voicemail (`:1003-1012`, `:856-869`) | C |
| missed-marking | `emitTerminalFallback` marks `is_missed` + sends notifications **before** emitting the forward TwiML (`:826-853`); business-hours-closed path does the same before forwarding (`:1153-1175`) | D (forwarded-and-answered call is already "missed") |
| terminal state | no Dial-action path ever finalizes `status`; the Phase-4 build wrote `status='completed'`+`ended_at` on the missed path but that was lost in later rewrites — hence the 3 forever-`ringing` rows | D |
| `<Client>` TwiML | plain `<Client>identity</Client>` — **no `<Parameter>` nouns**, so the browser has no way to know which call row is ringing it | B |
| Recording | `<Dial record="record-from-answer-dual" recordingStatusCallback=…>` when org `recording_enabled` (null→true); voicemail `<Record>` always reports to `twilio-recording-status`; **forwarded `<Dial><Number>` has no record attrs — forwarded external legs are not recorded today** | E (documented in §7) |
| Signature/org | Twilio HMAC-SHA1 validation with canonical `SUPABASE_URL` base — sound; `phone_numbers` per-number override lookup is org-scoped (2026-05-26 hardening) — preserved as-is | — |

### 1.3 Correlation + claiming: structurally broken, non-atomic, org-unsafe

- **The browser child SID can never match the row.** The webhook writes `twilio_call_sid` = **parent PSTN SID** and never writes `provider_session_id`. `TwilioContext.claimInboundCall("", sid)` (`:1404`, `:1855`) sends the **browser child-leg CallSid** as `provider_session_id` only. In `inbound-call-claim`, with `call_control_id` empty, both SID-match branches (including the "exactly-1 recent ringing" guess) are **skipped**, leaving only `.eq("provider_session_id", …)` — which matches nothing. Claim retries 18× and gives up. This is why **all 25 production inbound calls have `agent_id` NULL**: claiming has never once succeeded. (Corollary: there is no legacy-client compatibility burden — no deployed bundle has a working claim to preserve.)
- **Claim-on-ring, not on answer:** `wireTwilioCall` fires the claim the moment the browser starts ringing (`TwilioContext.tsx:1852-1861`), before anyone accepts; `answerIncomingCall` claims again (`:1402-1411`). Under all-ring, every ringing browser would race; a rejecting agent (with `activeCallIdRef` set) would also stamp `status='completed'` on the still-ringing row via `finalizeEnded → finalizeCallRecord` (`:1251-1286`).
- **Not atomic:** the claim is read-guard (`:146-151`) then unconditional `UPDATE … eq("id")` (`:153-162`) — no `agent_id IS NULL` predicate; two agents can both pass the guard and last-writer-wins, both told `claimed:true`.
- **Org safety violations:** SID lookups 1 and 3 are **not org-scoped** (service role); the claim UPDATE **overwrites `organization_id`** with the claimer's org (`:157`); no direction re-check, no state check (a completed call is claimable), no routing-eligibility check.
- **SID re-homing (two dormant paths):** `inbound-call-claim:131-136` rewrites `twilio_call_sid` to the browser SID when matched by session id; `TwilioContext.syncIdsToRow` (`:1676-1696`) writes the browser SID into **both** `twilio_call_sid` and `provider_session_id` on accept. Both are dormant only because claiming never succeeds; the moment claiming works, either would break every later parent-SID lookup (`twilio-voice-status`, `twilio-recording-status`).
- **`peek_inbound_call_identity`** (baseline `:4524-4619`): after an exact miss, unconditionally returns **the newest ringing inbound call in the org from the last 6 minutes** — under two simultaneous inbound calls, agent A's ringing UI can display caller B's identity. `TwilioContext` polls it at 350 ms (`:842-898`) and again in a 500 ms loop (`:1046-1063`). Both RPCs (`peek…`, `resolve_inbound_caller_display_name`) carry an inert-but-present `GRANT … TO anon`.
- **Inbound display field-ordering is inverted in TwilioContext (read side).** The webhook writes correctly, but the browser prefers the wrong column: `applyInboundAniFromCallsRow` uses `row.caller_id_used || row.contact_phone` (`:817`), the claimed-row read uses `caller_id_used || contact_phone` (`:574`), `reconcileIdentifiedContactFromCallsRow` likewise (`:725`, `:728`), and `hasAni` (`:978`) — for inbound rows `caller_id_used` is **our DID**, so the code then papers over it with the org-DID exclusion set (`inboundCallerExcludeRef`). `reconcileIdentifiedContactFromCallsRow` also collapses `contact_type` to `client`-else-`lead` (`:747-748`), losing recruits.

### 1.4 `twilio-voice-status` (deployed v39 = repo byte-identical)

- Duration canon is healthy: `chooseDurationToWrite` monotonic guard, `CallDuration` → `DialCallDuration` preference, terminal-zero writes (invariant #8). **Untouched by this build except one addition.**
- **Gap: no terminal-status regression guard.** A late/retried `ringing` or `in-progress` callback after `completed`/`no-answer`/`failed` rewrites `status` backwards (`:269-329` switch writes unconditionally). Duration cannot regress but status can.
- Lookup by parent then `DialCallSid` (`:247-249`) — works because nothing (yet) re-homes the parent SID; not org-scoped (unguessable SID; noted in §12 security review).
- For **outbound**, this function is also the `<Dial action>` target (maps `DialCallStatus`). For **inbound**, the Dial actions point at `twilio-voice-inbound` (`fallback=chain|voicemail|hangup`), and this function receives the parent-call lifecycle from the phone number's `statusCallback` (`_shared/twilioNumberConfig.ts` — canonical config). A lost parent `completed` callback currently leaves an inbound row `ringing` forever (the 3 stuck rows).

### 1.5 `twilio-recording-status` (deployed v33; repo authoritative)

- Flow: validate signature → skip non-`completed` → look up row by `twilio_call_sid` → download `.mp3` → upload to `call-recordings` (`upsert:true`) → write `recording_storage_path`/`recording_duration`/`recording_url = storage:<path>` → **DELETE the recording from Twilio**.
- **Retry non-idempotency is structural:** after a successful first pass the Twilio copy is deleted, so a duplicate callback's re-download 404s → writes `recording_url: "__recording_failed__"` **over** the good `storage:` token while `recording_storage_path` still points at the stored file (sentinel writes patch only `recording_url`). Across a UTC-midnight boundary a duplicate would even build a **new dated storage path** and overwrite `recording_storage_path` itself. The row update is keyed by bare `twilio_call_sid` with no org filter and would patch every row sharing the SID.
- **Browser recording has no inbound exclusion.** The `call.on("accept")` block (`TwilioContext.tsx:1763-1816`) starts browser recording for **both directions**; today it silently never starts for inbound only because the claim never yields a `rowId`. The moment claiming works, an answered inbound call gets **two writers** (Twilio dual-channel `.mp3` keyed by parent SID + browser `.webm` keyed by row UUID) racing on the same `recording_storage_path`/`recording_url` columns. Outbound recording is browser-side **only** by design (server-side Dial recording removed from `twilio-voice-webhook` 2026-04-20) — that stays untouched.

### 1.6 Database truth (live-verified)

- `calls`: schema = baseline + `routed_agent_ids uuid[]` (confirmed via `information_schema` — the WORK_LOG "types drift" note about `transport`/`from_number` is a stale-`types.ts` note, not DB). `contact_type` CHECK `IN ('lead','client','recruit')` **accepts NULL** — explicit-NULL is compatible. `status` CHECK: `ringing|connected|completed|failed|no-answer`. `direction` CHECK: `outbound|inbound`. **No unique constraint on `twilio_call_sid`** (plain btree only) and **zero duplicate SIDs exist today** (verified) — a future-facing partial unique index will build cleanly.
- RLS on `calls` (baseline `:11296-11300`): one ALL-commands policy `Calls Hierarchical Access`. Its USING branch `(get_org_id() IS NOT NULL AND organization_id = get_org_id() AND direction='inbound' AND agent_id IS NULL)` exposes **unassigned inbound calls org-wide, forever** (the documented limitation) — and because the policy is `ALL` and its `WITH CHECK` accepts `agent_id = auth.uid()`, **any org member can UPDATE-claim any unassigned inbound row directly via PostgREST**, bypassing every claim control. Diagnosis + narrow replacement in §9 (gated; the functional fix does not depend on it).
- Settings: `phone_settings.ring_timeout integer DEFAULT 30` (org-level; **no per-number ring-timeout column exists**). `inbound_routing_settings` (one row per org, `routing_mode CHECK ('assigned','all-ring','round_robin')`, `fallback_action`, `voicemail_enabled`, greetings, `forwarding_number`, `auto_create_lead`, `inbound_fallback_chain jsonb DEFAULT ["last_agent","campaign_agents","all_available"]`, after-hours SMS). Per-number overrides on `phone_numbers`: `inbound_routing_mode, voicemail_enabled, fallback_action, voicemail_greeting_text, voicemail_greeting_url, forwarding_number` (+ `is_direct_line`, inbound-display/routing only per invariant #18). `business_hours(organization_id, day_of_week)` indexed for the webhook.
- `campaign_leads` ↔ contacts (required confirmation): `campaign_leads` carries **snapshot** `phone`/`first_name`/`last_name` and a **nullable `lead_id` FK → leads ON DELETE SET NULL**. `campaign_leads.id` is *never* a contact identity (invariant #22 canon; `dashboard-contact-identity` enforces the same). Conversation history can authoritatively link only `leads`/`clients`/`recruits` ids. Therefore the canonical resolver may use `campaign_leads` **only as a pointer**: a phone-matched campaign_lead contributes its non-null, org-matched `lead_id` as a *lead candidate* (deduped) — never itself. Phone columns per table: `leads.phone`, `clients.phone`, `recruits.phone` (single each; `clients.beneficiary_phone` is a different person — excluded).
- Migration ledger (MCP `list_migrations`): latest applied `20260820233402` (presence RPC); notifications migration **applied** as `20260819163413` (`routed_agent_ids` + `append_call_routed_agents` + `(user_id,event_key)` are live). New files in this build are stamped after `20260820233402`. House rule: file-on-disk ≠ applied; apply-time restamp is normal (invariant #5, #25).
- Missed-call notification layer (2026-08-19, preserved verbatim): recipient tiers routed → number_owner → contact_agent → managers, fail-closed, `missed_call:<call_id>` event key, `(user_id, event_key)` unique arbiter, ignore-duplicates upsert. **This build does not modify `_shared/notifications.ts`, `_shared/notification-recipients.ts`, the notifications migration, or any historical notification row** — it only changes *when* the missed-marking call sites fire (§6).
- History constraints honored: `20260411190000_revert_inbound_calling_system` — the old fork-leg inbound build is not resurrected (this plan keeps the single-leg TwiML flow); Phase-11 contract (claim request body keys must change **in lockstep** with `TwilioContext` — both sides are rewritten together here); 2026-08-18 amendment 5 deploy sequencing (voice-writer pair deploys back-to-back after the migration; §15).
- Workflow triggers: the only trigger on `calls` is `trg_workflow_call_created` → `workflow_on_call_created` (swallowing wrapper, invariant #10), and it dispatches **only when `disposition_id` AND `contact_id` are both non-null** — inbound ingest inserts carry no disposition, so no workflow dispatch fires on inbound insert today, and the idempotent ingest (§6) keeps retries as conflict-updates that cannot re-fire an INSERT trigger. Confirming this stays true is a §12 gate.
- Stored-phone reality by writer (why "normalize both sides" is mandatory): manual Add modals store `1XXXXXXXXXX` (`normalizePhoneNumber`), the `import-contacts` Edge function stores the **raw CSV string**, and inbound auto-create stores `+1XXXXXXXXXX` — three formats coexist per table. `campaign_leads.phone` is copied verbatim from `leads.phone` at attach time and currently has **no phone index at all**.

---

## 2. Design overview — the new inbound pipeline

```
PSTN call → twilio-voice-inbound (signature-validated)
  1. resolve phone_numbers row → org  (unchanged)
  2. ingest_inbound_call RPC  (NEW, atomic, idempotent on parent CallSid):
       insert-or-reuse calls row  { twilio_call_sid=parent SID, direction='inbound',
         status='ringing', contact_phone=ANI (never overwritten), caller_id_used=DID,
         contact_type=NULL explicit, agent_id=NULL }
       resolve_inbound_contact RPC (NEW, canonical): unique | ambiguous | not_found
         unique   → link contact_id/contact_type/contact_name (guarded, once)
         ambiguous→ leave unlinked (never newest/first)
         not_found→ auto-create lead only if org opted in (never on ambiguous/error)
  3. business hours (unchanged semantics) → routing
  4. routing waves: Active + same-org + identity-holding agents only; ring timeout from
     phone_settings.ring_timeout; every wave excludes already-rung agents; routed_agent_ids
     accumulates via append_call_routed_agents (unchanged RPC)
  5. TwiML <Dial timeout=N …><Client><Identity>agent</Identity>
       <Parameter name="af_call_row_id" value=…/><Parameter name="af_org_id" value=…/></Client>
  6. browser: reads call.customParameters → fetches exact identity by row id (no guessing);
     displays ANI (contact_phone) + authoritative row contact name
  7. agent answers → claim_inbound_call RPC (NEW, atomic single UPDATE):
       auth + same-org + Active + direction + live-state + routing-eligibility +
       (agent_id IS NULL OR = me); writes agent_id + provider_session_id (child SID);
       never touches organization_id or twilio_call_sid
  8. Dial action / fallback paths: forward → voicemail/hangup honoring voicemail_enabled;
     missed marked only after the final attempt fails; finalize_inbound_call_terminal RPC
     (NEW, idempotent, never regresses) closes rows even if the status callback is lost
  9. twilio-voice-status: unchanged duration canon + NEW terminal-status regression guard
 10. twilio-recording-status: first-successful-writer wins; retries ack without clobbering;
     browser recording explicitly skips inbound (server-side recording is authoritative)
```

Historical rows are untouched: every new DB object is future-facing; every new write path is keyed to the specific new call row being processed.

---

## 3. Change set A — canonical inbound identity

### 3.1 New SQL (migration M1, §8)

1. **`public.phone_last10(p text) RETURNS text` — IMMUTABLE STRICT** helper: `right(regexp_replace(p,'[^0-9]','','g'),10)` returning NULL when fewer than 10 digits. The one normalization rule for stored-CRM-phone matching (same rule `resolve_inbound_caller_display_name` already proved on this data).
2. **Expression indexes** (future-facing, build on existing data without modifying it):
   `idx_leads_org_phone_last10 ON leads (organization_id, public.phone_last10(phone))`, same for `clients`, `recruits`, `campaign_leads` — turns the resolver's per-call scans into index lookups (the display-name RPC's regexp scans are the current anti-pattern).
3. **`public.resolve_inbound_contact(p_org_id uuid, p_phone text) RETURNS jsonb`** — the ONE canonical resolver. `STABLE`, `SET search_path = pg_catalog, pg_temp`, schema-qualified, **EXECUTE: service_role only** (REVOKE PUBLIC/anon/authenticated — the browser never resolves independently).
   - Normalizes the ANI to last-10 (≥10 digits required; else `not_found`).
   - Candidate set = DISTINCT `(contact_type, contact_id)` over:
     `leads` (org + last10 match) ∪ `clients` ∪ `recruits` ∪ (`campaign_leads` org + last10 match `WHERE lead_id IS NOT NULL` → contributes `('lead', lead_id)` where that lead row exists in the same org — pointer semantics per §1.6).
   - Returns `{resolution: 'unique'|'ambiguous'|'not_found', contact_id, contact_type, contact_name, match_count}`. `unique` ⇔ **exactly one** distinct candidate; ≥2 (within or across types) ⇒ `ambiguous` with NULL identity (D1, §14). Name built `trim(first_name||' '||last_name)`, sanitized server-side (never `"undefined undefined"` — 2026-08-11 canon).
4. **`public.ingest_inbound_call(p_twilio_call_sid text, p_org_id uuid, p_from_number text, p_to_number text, p_auto_create boolean) RETURNS jsonb`** — atomic ingest. `SECURITY DEFINER` is unnecessary (service-role caller) but it follows the repo privileged-function standard anyway: `SET search_path = pg_catalog, pg_temp`, schema-qualified, **EXECUTE: service_role only**.
   - `INSERT … ON CONFLICT` on the new partial unique index (§6.1) `DO UPDATE SET updated_at = now()` `RETURNING id, (xmax = 0) AS inserted` — a Twilio retry **reuses** the row.
   - Insert values: `direction='inbound'`, `status='ringing'`, `contact_phone = p_from_number` (raw Twilio ANI — **preserved verbatim; never replaced by the CRM stored phone**), `caller_id_used = p_to_number`, `organization_id = p_org_id`, `agent_id = NULL`, **`contact_type = NULL` explicitly** (defeats the false `'lead'` default; CHECK accepts NULL), `contact_name = NULL`.
   - On fresh insert: call `resolve_inbound_contact`; if `unique`, link via guarded `UPDATE … SET contact_id, contact_type, contact_name WHERE id = v_id AND contact_id IS NULL` (races/retries converge; `contact_phone` untouched). If `not_found` **and** `p_auto_create`: insert the lead (E.164 phone via the existing normalization, `first_name 'Inbound'`, `last_name 'Caller'`, `lead_source 'Inbound Call'`, `status 'New'`, `assigned_agent_id` NULL — deliberate, "answering agent can claim", 2026-05-19 canon) and link it the same guarded way. **`ambiguous` and any resolver error: no link, no auto-create, ever.**
   - On conflict-reuse: returns the existing row's identity **without** re-resolving or re-writing (idempotent; no duplicate lead, no duplicate workflow dispatch).
   - Returns `{call_row_id, inserted, resolution, contact_id, contact_type, contact_name}`.

### 3.2 `twilio-voice-inbound` rewiring

- `handleInitialInbound` replaces the insert + enrich + auto-create blocks (`:1050-1142`) with one `ingest_inbound_call` RPC call (settings' `auto_create_lead` passed in). Resolution outcome is logged (`[twilio-voice-inbound] identity resolution`, with `resolution` + `match_count` — telemetry for the staging matrix). Routing proceeds regardless of resolution result (best-effort identity, guaranteed routing — unchanged posture).
- `resolveInboundContact`, its variant builders, and the inline auto-create block are deleted from the Edge function (logic now lives in SQL where it is testable and indexed).

### 3.3 Browser consumes the authoritative call-row identity

- **New RPC `public.get_inbound_call_identity(p_call_row_id uuid) RETURNS jsonb`** (migration M2): `STABLE SECURITY DEFINER`, `search_path = pg_catalog, pg_temp`, **EXECUTE: authenticated + service_role** (REVOKE PUBLIC/anon). Requires `auth.uid()`; org from `public.profiles` (DB-authoritative); returns `{calls_row_id, contact_phone, caller_id_used, contact_name, contact_id, contact_type, status, agent_id}` for that exact row **only when** `organization_id = caller's org AND direction='inbound'`. No fallback of any kind.
- `TwilioContext` incoming handler reads `call.customParameters.get("af_call_row_id")` (§4) and fetches identity by row id — replacing the 350 ms `peek` poll storm with one fetch + a short bounded retry (identity enrich may land ~100 ms after TwiML). The Realtime `calls` subscription stays as the update channel for late enrichment.
- **Field-ordering fix (inbound-only), all read sites:** prefer `contact_phone` (ANI) and treat `caller_id_used` as the AgentFlow number — `applyInboundAniFromCallsRow` (`:817`), the claimed-row read (`:574`), `reconcileIdentifiedContactFromCallsRow` (`:725`, `:728`), `hasAni` (`:978`). The org-DID exclusion set stays as a defensive backstop for SDK-supplied values, but stops being the primary mechanism. `reconcileIdentifiedContactFromCallsRow` supports `recruit` (drops the client-else-lead collapse; recruit lookups go to `recruits`).
- **Divergent name-only resolver removed:** the `resolve_inbound_caller_display_name` effect (`:541-620`) is deleted; the RPC itself is dropped in migration M2 (`DROP FUNCTION`) after a repo-wide caller check (`TwilioContext.tsx` is the only runtime caller; `inboundCallerDisplay.ts` doc-comment updated; generated types entry removed). Future-facing DDL only — no data touched. (D6, §14.)
- **Floating recent calls** (`FloatingDialer.tsx:353-460`): rows with `contact_id + contact_type` are batch-resolved **by id** against the correct table (3 `IN` queries max — leads, clients, recruits) and never overridden by phone probing; snapshot `contact_name` is the render fallback. Phone-probe enrichment survives **only** for legacy rows with NULL `contact_id`, extended to all three tables, and applies a name **only on an exactly-one cross-table match** (else snapshot/phone). The current leads-only probe's type inference (`leads.status === "Closed Won" ⇒ 'client'`) is removed — types come from `contact_type` or the actual matched table. Quick-call from a recent row passes the true `contact_type` (no `"lead"` default for typed rows).
- Conversation history: **no change** — it stays strictly `contact_id`-based; new inbound calls appear because `calls.contact_id` is now written correctly (test T8).

---

## 4. Change set B — exact WebRTC correlation and answer-based atomic claiming

### 4.1 Correlation mechanism (verified before use)

- TwiML `<Client>` with nested `<Identity>` + `<Parameter>` nouns delivers custom key/values to Twilio Voice.js as **`call.customParameters` (a Map)** — supported by `@twilio/voice-sdk` 2.x (repo pins **2.18.1**); this is also existing house practice (AI-testing passes `bridge_token` via `<Parameter>`, 2026-06-02). `buildDialTwiml` changes from `<Client>identity</Client>` to:
  `<Client><Identity>{identity}</Identity><Parameter name="af_call_row_id" value="{uuid}"/><Parameter name="af_org_id" value="{org}"/></Client>`
  for every wave (primary, chain, direct-line). **Implementation-time verification gate:** confirm `<Identity>`+`<Parameter>` parsing against the Twilio TwiML docs and prove `customParameters` arrival in the staging matrix's first scenario before building on it; fallback plan if a Twilio limitation surfaces: signed short-TTL claim token in the parameter value (same plumbing, HMAC over row id + org + expiry with an Edge secret).
- Browser child-leg SID comes from `call.parameters.CallSid` (existing `getCallSid`). **Parent SID is never re-homed:** `twilio_call_sid` keeps the PSTN parent SID forever; the child SID is stored only in `provider_session_id` by the claim RPC.

### 4.2 `public.claim_inbound_call(p_call_row_id uuid, p_browser_call_sid text) RETURNS jsonb` (migration M2)

`SECURITY DEFINER`, `SET search_path = pg_catalog, pg_temp`, schema-qualified, REVOKE PUBLIC/anon, **GRANT EXECUTE: authenticated, service_role**.

- Preconditions (fail → `{claimed:false, reason}`): non-null `auth.uid()`; caller profile fetched from `public.profiles` — must exist, be **`status='Active'`**, hold a non-null `twilio_client_identity`, and yield the org (never a parameter, never the JWT claim alone).
- **One atomic compare-and-swap UPDATE** (row lock serializes; no read-then-write):
  ```sql
  UPDATE public.calls SET
    agent_id            = auth.uid(),
    provider_session_id = COALESCE(NULLIF(btrim(p_browser_call_sid), ''), provider_session_id),
    status              = CASE WHEN status = 'ringing' THEN 'connected' ELSE status END,
    updated_at          = now()
  WHERE id = p_call_row_id
    AND organization_id = v_org                -- exact org match; NEVER updated
    AND direction = 'inbound'
    AND status IN ('ringing','connected')      -- live-state only; terminal rows unclaimable
    AND (agent_id IS NULL OR agent_id = auth.uid())   -- one winner; idempotent re-claim
    AND ( routed_agent_ids IS NULL OR cardinality(routed_agent_ids) = 0
          OR auth.uid() = ANY (routed_agent_ids) )    -- routing eligibility (D4, §14)
  RETURNING id, contact_id, contact_type, contact_name, contact_phone, caller_id_used;
  ```
  0 rows ⇒ lost race / cross-org / non-routed / terminal ⇒ `{claimed:false}`. `organization_id` is structurally untouchable. Simultaneous calls cannot cross-claim: the row id is exact, org-checked, and state-checked.
- Returns the authoritative identity payload so the answering browser needs no further resolution round-trip.

### 4.3 Peek made exact-only

- Migration M2 `CREATE OR REPLACE public.peek_inbound_call_identity(p_provider_session_id, p_twilio_call_sid)` with the **6-minute newest-ringing fallback deleted** — exact `provider_session_id` / `twilio_call_sid` match only (same signature; prefix-tolerance kept). `REVOKE … FROM anon` on it (function ACL hardening, not RLS). Old bundles that still call it get exact-or-null — strictly safer than today's cross-call bleed, and those bundles' claim path never worked anyway (§1.3). The **"latest ringing" guess is removed from both peek and claim behavior everywhere**.

### 4.4 `inbound-call-claim` Edge function + TwilioContext rewiring

- **Edge function** is rewritten as a thin authenticated wrapper: body `{call_row_id, browser_call_sid}` → validates the JWT (unchanged pattern) → calls `claim_inbound_call` → relays `{id, claimed}`. All legacy behavior deleted: legacy body keys (Phase-11 lockstep contract satisfied — both sides ship together), the recency guess, the SID re-home, the `organization_id` write, the unscoped lookups. (D5 alternative — retiring the Edge function and calling the RPC directly from the browser — in §14; the wrapper is recommended to keep the deploy surface familiar and the RPC un-exposed to direct PostgREST enumeration until RLS work lands.)
- **TwilioContext:**
  - Incoming handler: store `af_call_row_id` from `customParameters`; **delete the claim-on-ring block** (`:1852-1861`); display identity per §3.3.
  - `answerIncomingCall`: claim fires **only after `twilioAnswerCall(call)` resolves** (Voice.js accept — the agent has actually answered; media is up). On `claimed:true`: set `activeCallIdRef`/`inboundClaimedCallRowId`/`callIdsDbSyncedRef` exactly as today. On `claimed:false`: surface "This call was answered by another agent", tear down the local leg — no row writes (Twilio cancels the losing leg independently).
  - `syncIdsToRow` (`:1676-1696`): **skips inbound entirely** (claim RPC owns `provider_session_id`; `twilio_call_sid` is parent-only). Outbound behavior byte-identical.
  - Rejecting/ignoring a ring leaves the row untouched (no `activeCallIdRef` ⇒ `finalizeCallRecord` no-ops) — fixes the reject-stamps-completed hazard as a structural consequence.
  - Every re-entrancy ref in invariant #9 is preserved; no new refs beyond one `inboundCallRowIdRef` (cleared with the existing display-clear path).

---

## 5. Change set C — routing correctness (no architecture change)

All within `twilio-voice-inbound`; single-leg TwiML preserved; tier business meanings preserved.

1. **all-ring** (`resolveAllOrgIdentities`): adds `.eq("status","Active")` — same-org + Active + non-null `twilio_client_identity` only. (Supersedes the 2026-05-19 "do not change all-ring" scope freeze — explicitly required by this task; flagged for Chris in §14 D8 for visibility.)
2. **assigned + direct-line** (`resolveAssignedIdentity`): lookup becomes org-scoped and Active-checked (`id = assigned_to AND organization_id = :org AND status='Active'`, identity non-null). A direct line whose owner is inactive/cross-org now falls to the terminal fallback rather than ringing a wrong/dead identity.
3. **round_robin**: already Active+org-filtered; unchanged (still excluded-by-default from waves via #4 like everyone else).
4. **Wave de-duplication:** `handleChainStep` (and the primary-wave entry into it) reads the call row's `routed_agent_ids` once per step and passes an exclusion set into `resolveTier`; every tier filters out already-rung agents. `resolveActiveRingTargetsByAgentIds` additionally gains `.eq("organization_id", orgId)` (defense in depth for tier-collected ids). `routed_agent_ids` keeps accumulating via the existing `append_call_routed_agents` RPC — unchanged, still notification-targeting + audit truth.
5. **Ring timeout:** `loadPhoneSettings` also selects `ring_timeout`; `buildDialTwiml` takes `timeoutSec` = clamp(`phone_settings.ring_timeout` ?? 30, 5, 120) (bounds mirror the campaign-settings Zod canon) applied to **every** wave. Per-number override: none exists in schema (§1.6) — documented, not invented; the six existing per-number override columns keep their exact precedence (`numberOverrides ?? orgData ?? default`).
6. **Voicemail honored:** in `emitTerminalFallback`, `handleFallback`, and the business-hours-closed branch — when the effective `fallback_action` resolves to voicemail (explicitly or by default) **and `voicemail_enabled` is false**, emit the documented non-voicemail terminal behavior instead: the hangup branch (`<Say>{greeting}</Say><Hangup/>`) — no `<Record>` is ever emitted (D3, §14). `fallback_action='forward'`/`'hangup'` behave as configured today.
7. **Forwarding preserved:** `buildForwardTwiml` unchanged (still no recording attrs — §7 documents this as intentional). Forward return path per §6.
8. **Business-hours + after-hours SMS:** logic unchanged, except missed-marking timing (§6) and the voicemail_enabled check above.

---

## 6. Change set D — lifecycle, idempotency, missed-call semantics

### 6.1 Initial-CallSid idempotency (migration M1)

- **Constraint audit (done):** no unique constraint/index exists on `twilio_call_sid`; production has zero duplicate SIDs; the only index is the plain btree. Safe choice: **partial unique index**
  `uq_calls_inbound_twilio_call_sid ON public.calls (twilio_call_sid) WHERE direction = 'inbound' AND twilio_call_sid IS NOT NULL AND created_at >= '<M1 authoring timestamp literal>'`
  — future-facing by predicate: it cannot conflict with (or touch) any historical row, and it is the `ON CONFLICT` arbiter for `ingest_inbound_call`. Pre-apply preflight (runbook, read-only): assert zero post-cutoff duplicates so index creation cannot fail.
- Outbound rows are structurally out of scope of the index and the RPC (test T28 pins outbound insert behavior unchanged).
- Retries therefore: same row id returned; status/recording lookups keyed by SID keep finding exactly one row; no duplicate `call_created` workflow dispatch; no duplicate auto-created lead.

### 6.2 Terminal-state safety net (migration M2)

- **`public.finalize_inbound_call_terminal(p_call_row_id uuid, p_org_id uuid, p_status text, p_mark_missed boolean) RETURNS boolean`** — `SECURITY DEFINER`, repo-standard search_path, **EXECUTE: service_role only**. Validates `p_status ∈ ('completed','no-answer','failed')`; one guarded UPDATE:
  `WHERE id = p_call_row_id AND organization_id = p_org_id AND direction = 'inbound' AND status NOT IN ('completed','failed','no-answer')` setting `status = p_status`, `ended_at = COALESCE(ended_at, now())`, `is_missed = is_missed OR p_mark_missed`, `updated_at = now()`. **Never writes `duration`** (invariant #8 — Twilio callback stays the sole duration writer); never regresses a terminal state; idempotent by predicate.
- Call sites in `twilio-voice-inbound` (each after its TwiML decision, best-effort try/catch — persistence failure never alters TwiML):
  - `handleChainStep` receiving `DialCallStatus ∈ (completed|answered)` → finalize `completed`.
  - `handleFallback` forward-return with `DialCallStatus ∈ (completed|answered)` → finalize `completed` (answered forward ⇒ **not** missed).
  - Voicemail entry (all agent/forward attempts exhausted) → mark missed + notify (existing helper), then on the `<Record>` action (`fallback=hangup` ack) → finalize `completed`.
  - Hangup terminal (incl. voicemail-disabled path) → mark missed + notify → finalize `no-answer`.
  So a lost parent status callback can no longer strand a call in `ringing`; when the callback does arrive, it remains authoritative for duration and (if it arrives first) its terminal status is not overwritten backwards. (Side benefit: the contact timeline's no-disposition fallback renders raw `calls.status` — `CallHistoryItem.tsx:60-62` — so permanently-`ringing` rows currently leak "Ringing" cards into history; finalization ends that for new calls.)

### 6.3 `twilio-voice-status` terminal-regression guard

- Before applying the switch's `patch`: if `existing.status ∈ ('completed','failed','no-answer')` and the incoming effective status maps to `ringing`/`in-progress`, **drop the status/started_at fields** from the patch (still allow `shaken_stir`, monotonic `duration`, and `ended_at` when null). Terminal→terminal rewrites are also suppressed (first terminal wins; duration/ended_at still converge). Late/duplicate callbacks can no longer regress status **or** duration (duration guard already existed). Everything else in the function — including the duration canon and the missed-notification call — is byte-preserved.

### 6.4 Missed-call semantics

- **Removed:** the premature `is_missed`+notify in `emitTerminalFallback` *before* emitting forward TwiML, and the equivalent in the business-hours-closed branch when the after-hours action is forward.
- **Rules going forward (new calls only):** a call is marked missed (and notifications fan out) only when (a) it enters voicemail after all agent/forward attempts failed, (b) it hits the hangup terminal, or (c) a forward attempt returns unanswered. A forwarded call answered by the external number is finalized `completed`, never missed. Business-hours-closed with voicemail/hangup actions still mark missed at entry (nobody will be rung — semantics preserved).
- **Notification layer untouched:** recipient priority, fail-closed resolution, `(user_id,event_key)` idempotency, and every historical notification row stay exactly as shipped in PR #361. `twilio-voice-status`'s notify condition is unchanged (its `is_missed` inputs simply become accurate).

---

## 7. Change set E — recording safety (one authoritative recorder per direction)

- **Inbound = Twilio server-side only** (existing `<Dial record="record-from-answer-dual">` + voicemail `<Record>` — preserved). **Browser recording explicitly skips inbound:** the `call.on("accept")` recording block gains an `isVoiceSdkInboundDirection(getCallDirection(call))` early-return (today it's only accidentally inert for inbound; §1.5). `stopAndUploadBrowserRecording` already no-ops when recording never started. **Outbound = browser-side only, byte-unchanged** (T28).
- **`twilio-recording-status` retry idempotency:** the row lookup now also selects `recording_storage_path, recording_url, organization_id`; if `recording_storage_path` is already set → log + ack 200 **without** downloading, uploading, or writing (first-successful-writer wins; the post-success Twilio DELETE makes any retry's download 404 — that must not, and no longer can, write a failure sentinel over a success). Failure sentinels (`__recording_failed__`/`__recording_upload_failed__`) are written **only** via a guarded update (`…AND recording_storage_path IS NULL`). Row updates move from bare `.eq("twilio_call_sid", sid)` to row-id + `organization_id`-scoped. Nothing deletes or rewrites existing stored recordings; storage path scheme unchanged.
- **Forwarded external legs are NOT recorded — intentional, documented here:** `buildForwardTwiml` carries no recording attributes today and this build does not add any (recording a forwarded PSTN-to-PSTN leg is compliance-sensitive; expanding it requires Chris's separate approval). Voicemail `<Record>` continues to report to `twilio-recording-status` regardless of `recording_enabled` (existing behavior, preserved — it is the voicemail message itself).
- Known accepted quirk (documented, unchanged): dial-recording and voicemail-recording for one call are practically disjoint (voicemail only happens when no dial leg was answered); with idempotency, the first completed recording wins the row columns.

---

## 8. Migrations authored (files only — **NOT applied**; production apply is a separately-approved gate)

| File | Contents | Historical-data footprint |
|---|---|---|
| `supabase/migrations/20260821<hhmmss>_inbound_identity_foundation.sql` (M1) | `phone_last10` fn · 4 expression indexes · partial unique `uq_calls_inbound_twilio_call_sid` (future-dated predicate) · `resolve_inbound_contact` · `ingest_inbound_call` · COMMENTs · REVOKE/GRANT per repo standard | **None.** DDL only; indexes read rows, modify none; unique index predicate excludes all pre-cutoff rows. No UPDATE/DELETE/INSERT of user data anywhere. |
| `supabase/migrations/20260821<hhmmss+1>_inbound_claim_lifecycle.sql` (M2) | `claim_inbound_call` · `get_inbound_call_identity` · `finalize_inbound_call_terminal` · `CREATE OR REPLACE peek_inbound_call_identity` (fallback removed) · `DROP FUNCTION resolve_inbound_caller_display_name` · anon-EXECUTE revokes on peek | **None.** Function DDL + ACLs only. |
| *(only if `#APPROVE_RLS_CHANGE` is given)* `…_inbound_calls_rls_narrowing.sql` (M3) | §9 policy replacement | None (policy DDL only) — **not authored until approved** |

Static self-checks shipped with the build (§12): migrations contain no top-level `UPDATE`/`DELETE`/`INSERT INTO` targeting existing user data; `supabase/tests/*.sql` suites run them on a disposable localhost stack under `BEGIN…ROLLBACK`. Timestamps are > `20260820233402`; apply-time restamp expected per house convention.

---

## 9. RLS limitation — diagnosis and separate, gated proposal (needs `#APPROVE_RLS_CHANGE`; the functional fix above does not depend on it)

**Diagnosis.** `Calls Hierarchical Access` (ALL-commands) USING includes `(get_org_id() IS NOT NULL AND organization_id = get_org_id() AND direction='inbound' AND agent_id IS NULL)`:
1. Every org member can read **all** unassigned inbound calls **forever** (not just currently-ringing ones routed to them) — customer ANIs and CRM names included.
2. Because the branch sits in an ALL policy whose `WITH CHECK` accepts `agent_id = auth.uid()`, any org member can **directly UPDATE-claim** any unassigned inbound row via PostgREST — bypassing answer-based claiming, routing eligibility, and atomicity entirely. (The new claim RPC is SECURITY DEFINER and does not need this branch.)

**Proposed narrow replacement (for Chris's separate approval, not implemented here):** split the policy into explicit per-command policies; replace the unassigned-inbound branch with a SELECT-only branch scoped to *exact routed ringing visibility*:
`direction='inbound' AND agent_id IS NULL AND status='ringing' AND organization_id=get_org_id() AND auth.uid() = ANY(routed_agent_ids) AND created_at > now() - interval '15 minutes'`
and **remove** unassigned-inbound rows from direct UPDATE eligibility (claims only via `claim_inbound_call`). Enumerated consumers that would lose reads and need review before approval: FloatingDialer recent-calls' unclaimed-inbound branch (`agent_id.is.null` OR-arm), dashboard missed-call widgets for non-admin agents, and any agent-facing unassigned-inbound history. Admin/TL org-wide branches are unaffected. **Decision + timing belong to Chris; M3 is authored only after `#APPROVE_RLS_CHANGE`.** Interim risk is unchanged from today (this build makes it no worse, and the RPC path never relies on it).

---

## 10. Files to touch (complete list)

**Migrations (new):** M1 + M2 per §8.
**Edge Functions (modified):** `supabase/functions/twilio-voice-inbound/index.ts` (+ new extracted pure modules `routing.ts`, `twiml.ts`, `lifecycle.ts` — Deno-free, vitest-testable per the `duration.ts` house pattern) · `supabase/functions/inbound-call-claim/index.ts` (thin RPC wrapper rewrite) · `supabase/functions/twilio-voice-status/index.ts` (+ `terminal-guard.ts` pure module) · `supabase/functions/twilio-recording-status/index.ts` (+ `idempotency.ts` pure module).
**Untouched Edge Functions:** `twilio-voice-webhook` (outbound), `twilio-token`, `twilio-sms*`, `_shared/notifications.ts`, `_shared/notification-recipients.ts`, `recording-retention-purge`, all others.
**Frontend:** `src/contexts/TwilioContext.tsx` (inbound-only surgical diffs per §3.3/§4.4/§7 — task-authorized exception to the standing freeze; all invariant-#9 refs preserved) · `src/components/layout/FloatingDialer.tsx` (recent-calls identity) · `src/lib/webrtcInboundCaller.ts` / `src/components/layout/inboundCallerDisplay.ts` (ordering + doc updates as needed) · `src/integrations/supabase/types.ts` (surgical: new RPC typings; drop `resolve_inbound_caller_display_name`) · `src/components/dialer/IncomingCallModal.tsx` only if display props change (expected: none — context feeds it).
**Tests:** new files per §11. **Docs:** `WORK_LOG.md` entry + `AGENT_RULES.md` new invariant (inbound identity/claim canon) in the same commit as the code (house §9 rule).

---

## 11. Test plan — fail-first, mapped to the 28 required scenarios

House conventions: SQL suites in `supabase/tests/` (disposable localhost PG, `BEGIN…ROLLBACK`, `_sim/_expect`-style helpers, run red first); vitest for Deno-free pure modules and UI (`TZ=UTC` + `TZ=America/Los_Angeles`, placeholder `VITE_SUPABASE_*`); esbuild bundle check per Edge function (no Deno in this container).

**SQL — `supabase/tests/inbound_identity_resolution.sql`:** T1 formatted `(209) 840-2988` lead ↔ `+12098402988` unique · T2 formatted client unique · T3 formatted recruit unique · T4 no match ⇒ `not_found` · T5 two contacts sharing last-10 ⇒ `ambiguous`, no link · T6 ambiguous ⇒ **no** auto-created lead (with `p_auto_create=true`) · T7 unique ⇒ `contact_id`+`contact_type`+`contact_name` populated, `contact_phone` still the raw ANI · plus: campaign_leads-pointer candidate dedupe; <10-digit ANI ⇒ not_found; `contact_type` NULL (not `'lead'`) on unresolved ingest.
**SQL — `supabase/tests/inbound_ingest_idempotency.sql`:** T23 same-CallSid double ingest ⇒ one row, same id returned, no second lead, `inserted=false` on retry · post-cutoff unique-index arbitration · historical-shape rows (pre-cutoff timestamps) unaffected by the index.
**SQL — `supabase/tests/inbound_claim.sql`:** T12 first claim wins atomically (agent_id set, status connected) · T13 loser's claim returns `claimed:false`, row unchanged · T14 cross-org claim rejected · T15 non-routed / inactive-profile claim rejected · T16 parent SID preserved in `twilio_call_sid`, child SID lands in `provider_session_id`, `organization_id` untouched · idempotent same-user re-claim · terminal row unclaimable · empty-`routed_agent_ids` policy per D4.
**SQL — `supabase/tests/inbound_terminal_lifecycle.sql`:** T24 finalize RPC closes a `ringing` row (Dial-action path) with `ended_at`, no duration write · T25 late `ringing`/`in-progress`/zero-duration inputs cannot regress a terminal row (pairs with the vitest guard tests) · finalize never overwrites an existing terminal status · missed flag only ORs upward.
**Vitest — pure Edge modules:** T17 all-ring target filter (Active-only) · T18 assigned/direct-line validation (org + Active) · T19 `buildDialTwiml` timeout attr from settings (+clamp) · T20 voicemail-disabled ⇒ hangup TwiML, no `<Record>` · T21 wave exclusion (no agent repeated across chain steps) · T22 forward-answered ⇒ not-missed decision; forward-unanswered ⇒ missed · T26-adjacent TwiML: `<Client>` carries `<Identity>`+`<Parameter af_call_row_id>` · terminal-guard module (T25 unit) · recording idempotency module (T27 unit: existing `recording_storage_path` ⇒ skip; sentinel only when path null).
**Vitest — frontend:** T9 inbound display prefers `contact_phone` over `caller_id_used` (ordering fix, `webrtcInboundCaller`/context helpers) · T10 two simultaneous inbound rings resolve independent identities by row id (no newest-ringing bleed; peek-exact + customParameters path) · T11 no claim invocation on ring; claim only after answer resolves (context wiring test) · T26 browser recording start is gated off for inbound and unchanged for outbound · T28 outbound `makeCall`/recording path snapshot tests pinning current behavior byte-for-byte · FloatingDialer recent-calls prefers `contact_id`, supports client+recruit, ambiguous phone probe applies no name · T8 history: `getLeadHistory`/contact history queries remain `contact_id`-keyed and pick up a newly linked inbound call (lib-level; plus the SQL-side link assertion in T7).
Fail-first: every suite is written and run red against the unmodified tree (SQL suites against the pre-change functions where they exist, structural-red where the object is new — house precedent) before implementation lands.

---

## 12. Verification gates (all must pass before handoff; nothing deploys)

1. Focused new suites (SQL + vitest) green; 2. affected integration suites (dialer render-stability, notifications, conversation-history suites) green; 3. **full `npx vitest run`** under both TZs; 4. `npx tsc --noEmit` (multiset-compared to the clean-main 73-error baseline); 5. `npx eslint` on touched files; 6. `npm run build` (production); 7. esbuild bundle/syntax check for each touched Edge function; 8. migration static checks (no top-level backfill/cleanup DML; grep-audited + localhost replay under rollback); 9. **adversarial review: organization scoping** — every new/changed lookup and write in the four Edge functions + three new RPCs carries an explicit org predicate or a proven org-derivation; 10. **adversarial review: simultaneous all-ring** — two-ring race walkthrough of claim CAS, customParameters row-pinning, exact-peek, reject-path no-writes; 11. **adversarial review: Twilio retry ordering** — initial-webhook retry, duplicate status callback (each state), duplicate recording callback (pre/post delete, midnight boundary), out-of-order Dial-action vs status callback; 12. **adversarial review: zero historical mutation** — diff-audit that no code path or migration statement can write to a pre-existing inbound row except the always-allowed forward-only paths that already exist today (status callbacks for still-open old calls), and that notifications history is untouched; 13. audit `handle_call_workflow_events`/`workflow_on_call_created` firing under the new ingest (no duplicate dispatch on retry; swallowing wrappers intact).

---

## 13. Manual Twilio staging matrix (run by Chris/agent on staging numbers after deploy approval — expected results)

| # | Scenario | Expected |
|---|---|---|
| 1 | Known contact stored as `(209) 840-2988` calls in | Row linked (unique), name + ANI shown ringing and after answer; call in that contact's conversation history |
| 2 | Unknown caller | `not_found`; lead auto-created only if org opted in; otherwise unlinked with `contact_type` NULL |
| 3 | Caller whose last-10 matches 2 CRM records | Ambiguous: no link, no auto-create, ANI-only display; call still routes/answers normally |
| 4 | All-ring, agent B answers | B owns the row (`agent_id`), status connected→completed, duration from Twilio |
| 5 | Two simultaneous inbound calls, two agents | Each browser shows its own caller; claims land on the correct rows; no cross-talk |
| 6 | No answer → voicemail | Waves per chain, no repeated agent, missed marked at voicemail entry, recording stored once, terminal completed |
| 7 | Voicemail disabled | Hangup terminal with greeting; **no** `<Record>`; missed + no-answer finalized |
| 8 | Forward answered | Not missed; finalized completed; no notification |
| 9 | Forward unanswered → voicemail | Missed marked only after forward fails; voicemail per settings |
| 10 | Browser refresh during ring | No claim, no stray row writes; other agents can still answer; row finalizes via callbacks/Dial actions |
| 11 | Duplicate status callback (replay terminal event) | No status/duration regression; single notification (event-key) |
| 12 | Duplicate recording callback | Storage path intact; no `__recording_failed__` overwrite; single stored file |

Plus the §4.1 gate: scenario 1 first verifies `customParameters` arrival end-to-end.

---

## 14. Decisions for Chris (defaults chosen; veto/adjust freely)

- **D1 — Ambiguity is strict:** ≥2 distinct candidates (within or across lead/client/recruit) ⇒ unlinked. No type-priority tiebreak (the dashboard's "clients win" precedent is a display-layer heuristic; for authoritative linking we recommend never guessing). Alternative: per-type priority with uniqueness inside the winning type.
- **D2 — Auto-created lead shape** stays `Inbound` / `Caller` / `lead_source 'Inbound Call'` / unassigned (existing semantics), created inside the ingest RPC for atomicity.
- **D3 — Voicemail-disabled terminal behavior** = greeting + hangup (recommended); alternative: forward-if-configured-else-hangup.
- **D4 — Claim eligibility when `routed_agent_ids` is empty/null** (routing-persist failure is best-effort by design): allow same-org Active identity-holding agents to claim (recommended — availability over strictness; Twilio only rings routed identities anyway); alternative: reject.
- **D5 — Keep `inbound-call-claim` as a thin wrapper** over the RPC (recommended) vs. retiring it for a direct browser RPC call.
- **D6 — `resolve_inbound_caller_display_name` is DROPPED** in M2 (sole runtime caller removed in the same release). Alternative: deprecate one release, drop later.
- **D7 — Forwarded external legs stay unrecorded** (compliance-sensitive; documented in §7). Any change is a separate approval.
- **D8 — all-ring gains the `status='Active'` filter**, superseding the 2026-05-19 scope freeze — called out since it changes who rings for orgs relying on the old behavior.
- **D9 — RLS narrowing (§9)** — proceed only with `#APPROVE_RLS_CHANGE`; main fix ships without it.

---

## 15. Implementation sequence (after approval; deploy/apply remain separately gated)

1. Fail-first test suites (red) → 2. M1 + M2 authored; localhost replay + SQL suites green → 3. Edge pure-module extraction + rewires; esbuild checks → 4. TwilioContext/FloatingDialer changes → 5. full verification battery (§12) → 6. WORK_LOG + AGENT_RULES entries → 7. commit/push to `claude/inbound-call-flow-fix-auzk81` → **STOP.** Production rollout (when Chris separately approves): read-only preflights (`list_migrations`, post-cutoff duplicate check, `get_edge_function` fresh pulls) → apply M1, M2 → deploy `twilio-voice-inbound` + `twilio-voice-status` **back-to-back** (amendment-5 precedent), then `twilio-recording-status` + `inbound-call-claim` → frontend release → staging matrix (§13). Old bundles remain safe throughout: their claim path already never succeeds, exact-only peek returns null instead of wrong identities, and the webhook/TwiML changes are server-side.

**Confirmations:** no previous inbound call rows, notifications, or recordings are modified by any part of this plan; nothing has been deployed, merged, or applied; this document is the only artifact of this session.
