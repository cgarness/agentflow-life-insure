# Implementation Plan — Permanent AgentFlow inbound calling and agent voicemail (rev 3)

**Label:** BUGFIX (Alexa's missed inbound call) + Chris's settled decisions D1–D13.
**Repository:** `cgarness/agentflow-life-insure` · planning branch `claude/agentflow-inbound-plan-fkl6zi` · base `main` @ `1b93f89` (unchanged; `origin/main` has not moved) · previous planning commits `2f9d500` (rev 1), `5536fd9` (rev 2).
**Status:** PLAN FOR REVIEW — rev 3 resolves the seven concrete gaps Chris raised against rev 2. **Documentation-only.** No application code, migration, RLS, Edge Function, Twilio setting, or production row was changed. **STOP point: Chris's explicit approval of this plan is required before any application edit or backend command. No RLS approval token has been granted; §7.7 states the exact scope that will need one.**
**Authored:** 2026-09-10 (rev 1) · 2026-09-10 (rev 2) · 2026-09-10 (rev 3).

> Decision namespace. D1–D13 are Chris's settled decisions. The 2026-08 inbound plan reused `D1…D8` for its own defaults in code comments (`twiml.ts:3`, `routing.ts:3`, `index.ts:434`, migration `20260823222528`); new comments/docs write `INB-D4` etc. **P1–P17** are supporting defaults that need Chris's explicit yes; nothing in P is treated as approved.

---

## 0. What changed in rev 3 (the seven gaps)

| Gap | Resolution | Where |
|---|---|---|
| 1 Immediate offline forwarding | One private SQL routine `commit_owner_mobile` is used by both entry points: `plan_inbound_route` (attempt created **directly in `owner_mobile`**) and `advance_to_owner_mobile` (`owner_browser → owner_mobile` only). Eligibility re-check, reservation, destination snapshot, the D13 mark and durable recipients commit in one transaction **before** mobile TwiML exists. Duplicate requests re-emit the persisted stage's TwiML; a zero-row CAS re-reads and follows the persisted stage; if the D13 transaction fails, the handler serves voicemail TwiML, never the mobile `<Dial>`. The stage enum has no `initial`. | §8.1, §8.3, §7.3 |
| 2 Durable intended recipient | New `calls.missed_recipient_ids uuid[]` (snapshot written by every missed commit) + `calls.missed_for_agent_id`/`missed_reason`. `resolveMissedCallRecipientsFromDb` gains **tier 0**: when `missed_recipient_ids` is non-empty the tiers 1–4 are never consulted. `twilio-voice-status`'s two `calls` projections add the three columns; that function is therefore in the file list and must be deployed **before** any org is switched to v2. Scenario A/B specified and tested. | §3.2, §7.3, §11, §14 |
| 3 Durable recovery | The undefined `missed_mark_pending`/`notification_pending` flags are gone. Persisted state = `calls.missed_notified_at` and `voicemails.notified_at` (NULL = owed). Retry ownership = (a) in-request ×3, (b) convergence by any later handler for the same call, (c) a pg_cron SQL sweep every 2 minutes (`sweep_inbound_notifications`) that inserts from the durable snapshot with `ON CONFLICT DO NOTHING` and stamps completion. The D13 mark is never "pending": it is inside the reservation transaction, and mobile TwiML is only emitted after it commits. Voicemail notifications retry after the Twilio source is deleted because the media is stored first and the sweep works from the `voicemails` row. `voicemails.attempt_id` is written only when the signed callback carries an id that exists (else NULL); no lazy attempt creation. | §3.4, §7.3, §7.4, §10 |
| 4 Presence generations | Registration identity is an in-memory `registration_id` minted at every Device `registered` event (never stored in `sessionStorage`), plus a per-registration monotonic `seq`. The RPC upserts only the caller's `(agent_id, registration_id)` row and ignores any write whose `seq` is not greater than the stored one. Duplicate tab, reload, delayed `pagehide`, reordered heartbeat and logout cases are specified. | §6.2, §7.1 |
| 5 Bridge evidence | The invented "≥ 2 s beyond the whisper" rule is removed. Connected-conversation evidence is the parent `<Dial action>` field `DialBridged=true` (documented Dial action parameter per Chris's Dial reference); absence ⇒ `mobile_bridge_evidence='unconfirmed'`, no attribution, no guessing. Child-leg `<Number statusCallback>` events (`initiated/ringing/answered/completed`, child `CallSid`, child `CallDuration`) record the leg lifecycle and end the busy reservation but never prove bridging. Short conversations are preserved; acceptance stays separate. | §9, §8.3, §13 |
| 6 Twenty-second ring | Requirement restated as **20 seconds**, not "at least 20". Provider knob is `timeout="20"` (integer seconds; the only control). Twilio documents up to five extra seconds; the plan measures the agent-perceived ring (browser `incoming`→`cancel`) and the server span (TwiML served → `<Dial action>`), reports both, and asks Chris to decide between keeping `timeout="20"` (agent hears 20 s plus up to 5 s of provider buffer) or calibrating a lower value from measurements. No 20–25 s acceptance band is assumed. | §8.2, P17 |
| 7 Rollback drain | Drain gate covers **every** outstanding v2 obligation regardless of age: non-terminal attempts (any age), v2 `calls` with `ended_at IS NULL`, voicemails not `stored`/`purged` or with `notified_at IS NULL`, missed calls with `missed_notified_at IS NULL`, plus a 30-minute quiet period after the last v2 obligation closes. Compatible handlers stay deployed whenever the gate cannot be established. Verification adds a 30-minute active call, a failed recording, and a late callback during drain. | §14, §13 |
| — | Reconciled: four migrations (M8 removed), RPC contracts, file list (adds `twilio-voice-status`), deployment order (`twilio-voice-status` and `twilio-recording-status` before `twilio-voice-inbound`, all before any v2 flag), verification matrix; server-side group validation (1–10 distinct, same-org, Active, identity-bearing agents) by trigger + RPC; INSERT-only workflow-trigger limitation left documented. | §7.2, §11, §14, §3.2 |

Rev 2 corrections A–H (explicit group, Press 1 only, per-registration presence, atomic reservation, Twilio limits, voicemail access, cutover gate, explicit defaults) remain in force.

---

## 1. Inspection basis (unchanged; see rev 1/rev 2 and WORK_LOG 2026-09-10)

Live production (read-only) still matches: Edge Functions `inbound-call-claim` v38, `twilio-voice-status` v40, `twilio-voice-inbound` v44, `twilio-recording-status` v34, `repair-twilio-number-ownership` v3; newest migration `20260823222926`; `calls.status` CHECK `ringing|connected|completed|failed|no-answer`; `notifications.type` CHECK lacks `voicemail`; `profiles.availability_status` exists (`Available`/`Offline` only) with a column-scoped UPDATE grant; home org `all-ring` with `voicemail_enabled=false`; `recording_retention_days=7`; `call-recordings` org-wide readable; `voicemail-assets` public; pg_cron and pg_net enabled (existing cron jobs call Edge Functions through `net.http_post` with private secret tables). Tooling: `npx tsc --noEmit` exit 0; app-config baseline **81** errors on `main`; ten focused inbound suites 139/139; `deno` absent; Twilio documentation unreachable from this environment (facts are marked SDK-verified, per Chris's references, or verify live).

## 2. Pinned findings (unchanged; all ten CONFIRMED — see rev 1 §2)

Incident `0bb30fa8…` (2026-09-09 20:31 UTC): five `<Client>` legs ended ≈0.23 s after TwiML with `DialCallStatus=no-answer`, no claim, greeting + hangup. Strong evidence of no registered Device; not proof; attribution unproven.

---

## 3. D13 — "Missed in AgentFlow" is separate from the mobile outcome

### 3.1 Rule (unchanged)
Mark the parent `calls` row missed (`is_missed=true`, `missed_reason='forwarded_to_mobile'`, `missed_for_agent_id=<owner>`, `missed_recipient_ids=[owner]`) **in the same transaction that reserves the mobile stage**, before any mobile TwiML; insert one notification (`event_key=missed_call:<call_id>`) to the intended agent at that point. Never cleared by acceptance, bridging or a connected conversation. Provider `status`/`duration` stay Twilio-authoritative and accurate (`outcome='forwarded_answered'` + `answered_by_agent_id` are recorded alongside). Counted once per parent call; a later voicemail adds only a `voicemail:<call_id>` notification. Label: **"Missed in AgentFlow — forwarded to mobile."**

### 3.2 Writer and reader audit (rev 3 additions in bold)

| Site | Today | Change |
|---|---|---|
| `finalize_inbound_call_terminal` external-answer branch (`20260823222805:225-238`) | retracts `is_missed=false` | M6 `CREATE OR REPLACE` removes the retraction; rest verbatim. |
| `markMissedAndNotify` (`twilio-voice-inbound/index.ts:680-724`) | marks + notifies at voicemail/hangup | Becomes a thin caller of the SQL commit (`mark_inbound_missed`, §7.3) which writes `is_missed`, `missed_reason`, `missed_for_agent_id`, **`missed_recipient_ids`**, then notifies via tier 0. |
| `twilio-voice-status` (`index.ts:244, 433` projections; `:478` notify) | selects `…agent_id, is_missed, direction, caller_id_used, routed_agent_ids` and resolves recipients through tiers 1–4 | **Both projections add `missed_for_agent_id, missed_reason, missed_recipient_ids`** so its convergence path resolves through tier 0. Duration/ladder logic untouched. **Deployment dependency:** must be live before any org's `routing_engine='v2'`. |
| `resolveMissedCallRecipientsFromDb` (`notification-recipients.ts:174-373`) | tiers 1–4 | **Tier 0**: if `call.missed_recipient_ids` is non-empty → validate those ids (same org; `status='Active'`); recipients = the valid subset; if none is Active → tier 4 (managers) only; **tiers 1–3 are never consulted when the snapshot is present**. Legacy rows (empty snapshot) keep tiers 1–4. |
| `buildMissedCallNotificationRows` | one body | D13 body/label when `missed_reason='forwarded_to_mobile'`; `metadata.reason`. |
| Readers `MissedCallsWidget.tsx:50-59`, `DashboardDetailModal.tsx:414-418` | `agent_id = userId` for non-admins (never matches a missed row — pre-existing defect) | `.or('agent_id.eq.<uid>,missed_for_agent_id.eq.<uid>,missed_recipient_ids.cs.{<uid>},routed_agent_ids.cs.{<uid>}')` with UUID validation before interpolation. |
| Contact history items | no missed label | `describeInboundCallOutcome(row)` helper (`src/lib/inbound-call-labels.ts`). |
| `record_inbound_mobile_accept` / `record_inbound_mobile_bridge` | (rev 1 cleared `is_missed`) | Neither touches `is_missed`; SQL-tested. |
| `handle_call_workflow_events` / `trg_workflow_call_created` (`baseline:10251`, AFTER INSERT only) | — | **Documented limitation kept as is:** a D13 `UPDATE` dispatches no workflow event; no automation redesign in this plan. |
| RLS Phase 1 `calls` policies | — | Unchanged; all writes are service-role RPCs. |

**Scenario that must hold (tested in SQL and live): offline contact owner A, dialed-number owner B, no browser targets.** `plan_inbound_route` creates the attempt in `owner_mobile`, writes `missed_recipient_ids=[A]`, and the handler inserts `missed_call:<call_id>` for A. Later the parent `completed` callback reaches `twilio-voice-status`; it sees durable `is_missed`, calls the shared helper, tier 0 returns `[A]`, the upsert is a no-op. B never appears in any tier because tiers 1–4 are skipped. If the first insert failed, the sweep or the next handler inserts for A (still tier 0). If the lead is reassigned to C afterward, the snapshot still says A. Only if A is no longer Active does the notification go to org Admins.

### 3.3 Invariant #30 wording change (narrow, unchanged from rev 2)
`is_missed` is monotonic once written by an accepted guarded writer; the mobile forward marks it at the forward commit with `missed_reason`, `missed_for_agent_id` and `missed_recipient_ids`; the external answer proof and `answered_by_agent_id` are recorded alongside and never retract it; the finalize RPC's retraction is removed by M6. Ownership, signatures, tenant scoping, terminal freezing untouched. No backfill.

### 3.4 Durable recovery of notifications (gap 3)
- **State:** `calls.missed_notified_at timestamptz` (set by whichever writer first inserts ≥1 notification row for the call) and `voicemails.notified_at timestamptz`. NULL means "owed". No other pending flags exist.
- **Owners of the retry:** (a) the handler that created the obligation retries the insert up to 3× in-request; (b) every later handler touching the same call (`<Dial action>` stage returns, the parent status callback in `twilio-voice-status`, the recording callback) calls `converge_inbound_notifications(p_call_row_id)` (service-role SQL; idempotent); (c) `public.sweep_inbound_notifications()` scheduled by pg_cron every 2 minutes (M6; `cron.unschedule` guard makes the migration re-runnable), selecting at most 100 rows per run: `calls` where `direction='inbound' AND is_missed AND cardinality(missed_recipient_ids) > 0 AND missed_notified_at IS NULL AND created_at > now()-interval '7 days'`, and `voicemails` where `status='stored' AND notified_at IS NULL AND created_at > now()-interval '7 days'`. The sweep builds the same rows as the Edge helper (title/body/action_url/metadata/event_key/organization_id/user_id/type) and inserts `ON CONFLICT (user_id, event_key) DO NOTHING`, then stamps the timestamp. A row older than 7 days without completion is logged once (`sweep_gave_up`) and left; no deletion.
- **Completion condition:** the stamp is set only after the insert statement succeeded (a zero-row conflict counts as success because the row exists).
- **D13 mark is never pending:** it is written inside the reservation transaction; if that transaction fails the handler does not forward (§8.3).
- **Voicemail after source deletion:** the recording pipeline stores media and metadata first (`status='stored'`), deletes the Twilio source, then attempts the notification; a failure leaves `notified_at NULL` and the callback answers **200** (the obligation is now owned by the sweep, so a Twilio redelivery is unnecessary and would find the source already gone). A redelivered callback still converges (tier 0 from the row).
- **No attempt row:** recovery never needs one. `voicemails.attempt_id` is a nullable FK written only when the signed `attempt_id` resolves to an existing row; otherwise NULL. Missed-call recovery keys on `calls`.

---

## 4. Design overview (unchanged shape)

```
initial → resolve DID/org → ingest_inbound_call → plan_inbound_route (ONE transaction):
   owner|group · eligibility · reservation · attempt row · (immediate) commit_owner_mobile incl. D13
owner:  DND → owner_voicemail | busy → owner_voicemail | not connected → owner_mobile (D13 committed) |
        owner_browser 20 s → advance_to_owner_mobile (re-check, D13 committed) → owner_mobile → not accepted/not bridged → owner_voicemail
group:  eligible (explicit ≤10) → one wave 20 s → group_voicemail | empty → group_voicemail
after hours: identical (D8). routing_engine='legacy' until the §14 gate flips an org to 'v2'.
```

---

## 5. Decisions and supporting defaults

### 5.1 D1–D13 mapping — unchanged from rev 2 §5.1, except D4 (see §8.2) and D13 (§3).

### 5.2 Supporting defaults (explicit approval needed)
P1 direct-line precedence · P2 explicit group of 1–10 (validated server-side, §7.2) · P3 shared-mailbox membership/history access · P4 ineligible owner ⇒ group · P5 mobile ring 20 s · P6 Press 1 only · P7 mobile caller ID unset · P8 busy ceilings (ringing reservations 5 min; accepted mobile until leg-end/Dial-action, cap 4 h; `calls` rows 4 h) · P9 presence 3 min / 45 s · P10 retire legacy routing knobs under v2 · P11 retire per-number overrides except `is_direct_line` · P12 `answered_by_agent_id` · P13 voicemail retention: separate `voicemail_retention_days` DEFAULT 30 + 90-day unheard cap (reusing the 7-day recording setting would purge unheard voicemail) · P14 availability CHECK · P15 `routing_engine` cutover flag · P16 ten-target posture (Conference/TaskRouter are separate designs) · **P17 (new, gap 6) ring-timeout calibration: keep `timeout="20"` and accept Twilio's documented up-to-5-second buffer, or calibrate a lower value after live measurement — Chris decides.**

---

## 6. Change set A — Browser

### 6.1 Device lifetime — unchanged from rev 2 (UI destroy paths removed; provider-owned teardown; readiness truth; `destroying` promise; recovery only while idle; `IncomingCallModal.tsx` deleted).

### 6.2 Presence with registration generations (gap 4)
- **Identity of a registration is minted in memory**, never persisted: on every Device `registered` event the provider creates `registration_id = crypto.randomUUID()` and resets `seq = 0`. A duplicated tab (which copies `sessionStorage` from its opener) starts its own Device and therefore its own `registration_id`; a reload does the same; the previous registration's row simply expires or is closed by its own unregister write.
- **Every write carries `(registration_id, seq)`** with `seq` incremented before each send (heartbeat, state change, unregister). `heartbeat_phone_registration` upserts **only the caller's own `(auth.uid(), registration_id)` row** and applies the write only when `p_seq > stored seq`; otherwise it returns `{applied:false, reason:'stale_seq'}` and changes nothing. Consequences: a delayed `pagehide` unregister for an old registration cannot touch the new registration (different id); a reordered older heartbeat for the same registration cannot re-open a closed one (lower `seq`); two tabs can never overwrite each other (different ids).
- **Cadence:** heartbeat every 45 s while registered; immediate writes on `registered`/`unregistered`/`error`, on `visibilitychange`→visible and `online`. Hidden-tab timer throttling (≥1/min) still lands ≥2 beats inside the 3-minute freshness window.
- **Logout:** `AuthContext.logout()` issues a `keepalive` fetch to the RPC (`p_registered=false`, current id, next seq) **before** awaiting `signOut()`; `pagehide`/`beforeunload` do the same for the current registration. Other tabs of the same user receive `SIGNED_OUT` and unregister their own registrations; any that fail expire within 3 minutes.
- **Identity change in one tab:** the provider's identity-loss teardown unregisters the old identity's registration (its own id/seq); the new identity mints a new registration on `registered`.
- **Protections preserved:** nothing in the presence path reads or writes `availability_status`; the presence heartbeat never triggers Device re-init; recovery (§6.1) is skipped while `callStateRef.current !== 'idle'` or `isDialingRef.current`.
- Server view: `is_phone_connected(agent_id)` = `EXISTS (registration WHERE registered AND last_seen_at ≥ now() - interval '3 minutes')`. Rows older than 24 h are deleted for the caller's own agent inside the RPC.

### 6.3 Availability, 6.4 ringtone/alerts, 6.5 settings and surfaces — unchanged from rev 2.

---

## 7. Change set B — Database (four new migrations M4–M7; applied files untouched)

### 7.1 M4 `…_inbound_agent_settings_and_registrations.sql`
`agent_inbound_settings` as rev 2. `agent_phone_registrations` keyed **`(agent_id, registration_id)`** with `seq bigint NOT NULL DEFAULT 0`, `registered`, `registered_at`, `last_seen_at`, `last_state`, `last_detail (≤64)`, timestamps; index `(organization_id, agent_id, registered, last_seen_at)`.
```sql
CREATE FUNCTION public.heartbeat_phone_registration(p_registration_id uuid, p_seq bigint, p_registered boolean, p_state text, p_detail text DEFAULT NULL)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$ … $$;
  -- v_agent := auth.uid(); v_org := get_org_id(); raise 42501 if either is NULL; validate p_state/p_detail;
  -- INSERT … VALUES (v_agent, p_registration_id, v_org, p_registered, CASE WHEN p_registered THEN now() END, now(), p_state, p_detail, p_seq)
  -- ON CONFLICT (agent_id, registration_id) DO UPDATE SET registered = EXCLUDED.registered, seq = EXCLUDED.seq,
  --   registered_at = CASE WHEN EXCLUDED.registered AND NOT r.registered THEN now() ELSE r.registered_at END,
  --   last_seen_at = now(), last_state = EXCLUDED.last_state, last_detail = EXCLUDED.last_detail, updated_at = now()
  --   WHERE r.organization_id = v_org AND EXCLUDED.seq > r.seq;            -- stale/reordered writes are ignored
  -- GET DIAGNOSTICS v_rows; DELETE own rows older than 24 h; RETURN jsonb {applied: v_rows>0, reason}
CREATE FUNCTION public.is_phone_connected(p_agent_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER …;
```
Grants: `REVOKE ALL FROM PUBLIC, anon`; `GRANT SELECT` to `authenticated` on both; `GRANT INSERT, UPDATE ON agent_inbound_settings TO authenticated`; `GRANT ALL TO service_role`; RPC EXECUTE to `authenticated` + `service_role`.

### 7.2 M5 `…_inbound_routing_v2_settings.sql`
Columns as rev 2 (`routing_engine`, `inbound_group_agent_ids`, `browser_ring_seconds`, `mobile_ring_seconds`, `voicemail_retention_days`, CHECKs `inbound_group_size ≤ 10`, `inbound_v2_requires_group`), `profiles_availability_status_check` (P14). **Server-side group validation (explicit):**
- `CREATE FUNCTION private.validate_inbound_group(p_org uuid, p_ids uuid[]) RETURNS uuid[]` — raises `22023` unless: `p_ids` non-null, `1 ≤ cardinality ≤ 10` **after** `SELECT DISTINCT`, no NULL element, and **every** id matches `profiles` where `organization_id = p_org AND status = 'Active' AND btrim(coalesce(twilio_client_identity,'')) <> ''`; returns the distinct array.
- `CREATE TRIGGER trg_inbound_routing_settings_validate BEFORE INSERT OR UPDATE OF inbound_group_agent_ids, routing_engine ON public.inbound_routing_settings` — when `NEW.routing_engine='v2'` or the array is non-empty, `NEW.inbound_group_agent_ids := private.validate_inbound_group(NEW.organization_id, NEW.inbound_group_agent_ids)`; so a direct PostgREST write by an Admin cannot store duplicates, foreign-org ids, inactive agents, or agents without a client identity, and cannot activate v2 with an invalid group.
- `CREATE FUNCTION public.set_inbound_group(p_ids uuid[]) RETURNS jsonb SECURITY DEFINER` (Admin/Super Admin of `get_org_id()` per `profiles`, not the JWT) and `public.activate_inbound_routing_v2() RETURNS jsonb` (same authorization; re-validates the group; returns the checklist of §14 prerequisites it can check in SQL — group valid, ≥1 fresh registration in the org, every group member's/owner's settings row state — and only then sets `routing_engine='v2'`). EXECUTE to `authenticated` (authorization inside) + `service_role`.

### 7.3 M6 `…_inbound_route_attempts_d13_and_recovery.sql`
```sql
CREATE TABLE public.inbound_route_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL UNIQUE REFERENCES public.calls(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('owner','group')),
  owner_agent_id uuid, owner_source text CHECK (owner_source IN ('contact','direct_line')),
  eligibility_reason text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('owner_browser','owner_mobile','owner_voicemail','group_browser','group_voicemail','done')),
  stage_started_at timestamptz NOT NULL DEFAULT now(),
  reserved_agent_ids uuid[] NOT NULL DEFAULT '{}',
  mobile_number_dialed text, mobile_child_call_sid text,
  mobile_accepted_at timestamptz, mobile_accept_result text CHECK (mobile_accept_result IN ('accepted','accepted_after_hangup','no_digit','wrong_digit')),
  mobile_bridged_at timestamptz, mobile_bridge_evidence text CHECK (mobile_bridge_evidence IN ('dial_bridged','not_bridged','unconfirmed')),
  mobile_leg_ended_at timestamptz,
  voicemail_kind text CHECK (voicemail_kind IN ('agent','group')), voicemail_agent_id uuid, voicemail_group_ids uuid[],
  missed_marked_at timestamptz,
  provider_outcomes jsonb NOT NULL DEFAULT '[]'::jsonb,       -- bounded to the last 20 entries
  final_outcome text, terminal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ON public.inbound_route_attempts USING gin (reserved_agent_ids) WHERE NOT terminal;
CREATE INDEX ON public.inbound_route_attempts (organization_id, terminal, created_at);
ALTER TABLE public.calls
  ADD COLUMN answered_by_agent_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN missed_reason text CHECK (missed_reason IN ('no_answer','busy','dnd','offline_no_mobile','forwarded_to_mobile','group_empty')),
  ADD COLUMN missed_for_agent_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN missed_recipient_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN missed_notified_at timestamptz;
CREATE INDEX ON public.calls (missed_for_agent_id, created_at DESC) WHERE is_missed;
CREATE INDEX ON public.calls USING gin (missed_recipient_ids) WHERE is_missed;
CREATE INDEX ON public.calls (created_at) WHERE is_missed AND missed_notified_at IS NULL;
CREATE OR REPLACE FUNCTION public.finalize_inbound_call_terminal(uuid, uuid, text, boolean, boolean) … ;   -- retraction removed, otherwise verbatim
```
Private routine (not callable by clients): **`private.commit_owner_mobile(p_attempt_id, p_call_row_id, p_org_id, p_owner uuid, p_mobile text)`** — assumes the owner's advisory lock is held by the caller; re-evaluates DND (`availability_status IN ('On Break','Do Not Disturb')`) and busy (`is_agent_busy(p_org_id, p_owner, p_call_row_id)`); on refusal returns `{forward:false, reason:'dnd'|'busy'}` without writing; otherwise in the **same transaction**: `UPDATE inbound_route_attempts SET stage='owner_mobile', stage_started_at=now(), reserved_agent_ids=ARRAY[p_owner], mobile_number_dialed=p_mobile, missed_marked_at=now() WHERE id=p_attempt_id AND NOT terminal AND stage IN ('owner_browser','owner_mobile')` *(the `owner_mobile` self-transition is the immediate-forward insert path, see below)* and `UPDATE calls SET is_missed=true, missed_reason='forwarded_to_mobile', missed_for_agent_id=p_owner, missed_recipient_ids=ARRAY[p_owner], updated_at=now() WHERE id=p_call_row_id AND organization_id=p_org_id AND direction='inbound' AND agent_id IS NULL`; returns `{forward:true, mobile:p_mobile}`.

RPCs (`SECURITY DEFINER`, `search_path = public, pg_temp`, `REVOKE FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE TO service_role`):
- **`plan_inbound_route(p_call_row_id, p_org_id, p_owner_agent_id, p_owner_source, p_candidate_group_ids uuid[]) → jsonb`.** Locks (`pg_advisory_xact_lock(hashtext('inbound_agent:'||id))`, sorted) the owner or all candidates; evaluates availability, `is_phone_connected`, `is_agent_busy(…, p_call_row_id)`; decides the first stage; `INSERT INTO inbound_route_attempts … ON CONFLICT (call_id) DO NOTHING`. **If the first stage is `owner_mobile` (owner not connected, Available, not busy, mobile configured)** the insert is made with `stage='owner_mobile'` and the same transaction calls `private.commit_owner_mobile` (which performs the D13 writes and snapshots the destination). If the mobile is not configured/enabled ⇒ first stage `owner_voicemail` with `mark_inbound_missed(reason='offline_no_mobile')` in the same transaction. Returns `{created, attempt, stage, targets, reasons}`. **Duplicate initial webhook:** `created=false`, the existing attempt is returned and the handler re-emits the TwiML for the persisted stage (idempotent).
- **`advance_to_owner_mobile(p_attempt_id, p_org_id, p_call_row_id)` → jsonb.** Locks the owner; requires `stage='owner_browser' AND NOT terminal`; loads the mobile from `agent_inbound_settings`; calls `private.commit_owner_mobile`. **Zero rows / CAS miss:** returns `{updated:false, stage:<current>, terminal}` after re-reading; the handler then serves the TwiML that matches the persisted stage (`owner_mobile` ⇒ the same mobile `<Dial>` from the snapshot; `owner_voicemail` ⇒ voicemail; `done` ⇒ hangup). If the refusal is `dnd|busy`, the handler advances to `owner_voicemail` (`advance_inbound_route_stage` + `mark_inbound_missed(reason)`).
- **`mark_inbound_missed(p_call_row_id, p_org_id, p_reason, p_recipient_ids uuid[], p_for_agent_id uuid)` → jsonb.** The one missed writer besides `commit_owner_mobile`: sets `is_missed=true`, `missed_reason` (first writer keeps its reason), `missed_for_agent_id` (COALESCE), `missed_recipient_ids` (COALESCE non-empty), guarded `agent_id IS NULL AND outcome IS DISTINCT FROM 'forwarded_answered'`. Idempotent.
- **`advance_inbound_route_stage(p_attempt_id, p_org_id, p_from_stage, p_to_stage, p_patch jsonb)`** — CAS as rev 2; returns the persisted stage on miss.
- **`record_inbound_mobile_accept(p_attempt_id, p_org_id, p_call_row_id, p_agent_id, p_child_call_sid, p_digits)`** — as rev 2 (`accepted` | `accepted_after_hangup` when the parent is terminal or `ended_at` set | `no_digit` | `wrong_digit`); touches nothing on `calls`.
- **`record_inbound_mobile_bridge(p_attempt_id, p_org_id, p_call_row_id, p_agent_id, p_dial_bridged boolean, p_dial_call_status text, p_dial_call_sid text, p_dial_call_duration int)`** — requires `mobile_accept_result='accepted'`; if `p_dial_bridged IS TRUE` ⇒ `mobile_bridged_at=now()`, evidence `dial_bridged`, and `UPDATE calls SET outcome='forwarded_answered', answered_by_agent_id=COALESCE(answered_by_agent_id,p_agent_id), provider_session_id=COALESCE(provider_session_id,p_dial_call_sid), status=CASE WHEN status='ringing' THEN 'connected' ELSE status END, updated_at=now() WHERE … agent_id IS NULL …`; if `p_dial_bridged IS FALSE` ⇒ evidence `not_bridged`; if NULL (field absent) ⇒ evidence `unconfirmed`, **no `calls` write**. Never writes `is_missed` or `duration`.
- **`record_inbound_mobile_leg_end(p_attempt_id, p_org_id, p_child_call_sid, p_call_status, p_call_duration)`** — sets `mobile_leg_ended_at`, appends the provider outcome; ends the reservation.
- **`is_agent_busy(p_org_id, p_agent_id, p_exclude_call_id)`** `STABLE` — predicate as rev 2 §7.3 (calls 4 h; ringing reservations 5 min; accepted mobile until `mobile_leg_ended_at`/terminal with a 4 h cap), excluding `p_exclude_call_id`.
- **`converge_inbound_notifications(p_call_row_id)`** and **`sweep_inbound_notifications()`** — §3.4; `cron.schedule('inbound-notify-sweep', '*/2 * * * *', $$SELECT public.sweep_inbound_notifications()$$)` guarded by `cron.unschedule` if present.
Policies: RLS on, zero policies (service-role only).

### 7.4 M7 `…_voicemails.sql`
As rev 2 plus `voicemails.notified_at timestamptz` and `voicemails.attempt_id uuid REFERENCES public.inbound_route_attempts(id) ON DELETE SET NULL` (nullable; written only when the signed id exists). `upsert_voicemail_from_recording(p_recording_sid, p_call_row_id, p_org_id, p_attempt_id uuid /*nullable*/, p_mailbox text, p_storage_path, p_duration, p_status)` validates `p_attempt_id` against the table before use (NULL otherwise). `can_access_voicemail`, policies, bucket, `notifications_type_check`, `voicemails_expired_batch` as rev 2.

### 7.5 Generated types — regenerate after M4–M7; RPC typings match SQL signatures (AGENT_RULES #30 rev 8(b)).

### 7.6 (M8 removed — no comment-only migration.)

### 7.7 Exact RLS approval scope (token **not granted**) — unchanged from rev 2
`agent_inbound_settings` (self select/insert/update + admin select) · `agent_phone_registrations` (self select + org select; no client writes) · `inbound_route_attempts` (RLS on, zero policies) · `voicemails` (`voicemails_select`, `voicemails_update_listened`) · `storage.objects` `voicemail_objects_select` on bucket `voicemails`. No existing policy on `calls`, `profiles`, `notifications`, `phone_numbers`, `inbound_routing_settings`, `call-recordings` is modified; RLS Phase 1 postconditions stay satisfied.

---

## 8. Change set C — Server routing (`twilio-voice-inbound`)

### 8.1 Planner (`planner.ts`) — atomic reservation incl. immediate forwarding (gap 1)
`handleInitialInbound`: legacy engine unchanged unless `routing_engine='v2'`. v2: owner resolution → candidate group → **`plan_inbound_route`** (one transaction). Then, by returned stage: `owner_browser`/`group_browser` ⇒ `persistRoutedAgents` (R14) ⇒ `<Client>` TwiML; **`owner_mobile` ⇒ the D13 commit and destination snapshot already happened inside the RPC ⇒ notify (tier 0) ⇒ mobile TwiML**; `owner_voicemail`/`group_voicemail` ⇒ notify ⇒ voicemail TwiML. If `plan_inbound_route` fails after 3 retries ⇒ **safe path**: voicemail TwiML with the mailbox in the signed recording URL and `mark_inbound_missed(reason='no_answer', recipients=[owner] or group)`; never a mobile `<Dial>`. No lazy attempt creation.

### 8.2 The 20-second browser ring (gap 6)
- **Requirement:** the owner's browser rings for **20 seconds** (D4). Provider configuration: `<Dial timeout="20">` — Twilio accepts integer seconds only, so the knob is exactly 20. **Twilio documents that the actual ring may exceed the timeout by up to five seconds** (per Chris's Dial reference; unverifiable from here). There is no provider setting that guarantees exactly 20 s.
- **Measurement:** (i) agent-perceived ring = browser `incoming` event → `cancel` event (ring-buffer timestamps, reported in the connection diagnostics and in the registration `last_detail` as `ring:<ms>`); (ii) server span = TwiML served → `<Dial action>` received (attempt `stage_started_at` and `provider_outcomes[].at`); (iii) reported per live test call, with the SDK's ringtone start delay noted separately (the SDK waits up to 2 s for ringtone playback before emitting `incoming`, `device.js:1358-1378` SDK-verified — this shortens the audible ring relative to the provider window).
- **What is uncertain and needs Chris's decision (P17):** with `timeout="20"` the agent may hear roughly 20 s and the provider may hold the leg up to ≈25 s; if the requirement is an audible 20 s from the agent's perspective, a calibrated lower `timeout` (e.g. 18 or 19) could be chosen **after** live measurements — but that can only be decided from data. The plan implements `timeout="20"`, measures, and reports; no 20–25 s band is treated as accepted.
- **Ten `<Client>` limit and signed checks** — unchanged from rev 2 (group ≤ 10 validated server-side; every mobile callback cross-checked against the persisted attempt; the Client identity validator is never used for a number).

### 8.3 Stage handlers (gap 1, gap 5)
- `owner_browser` return, no answer ⇒ `advance_to_owner_mobile`: `{forward:true}` ⇒ notify tier 0 ⇒ mobile TwiML from the snapshot; `{forward:false, reason}` ⇒ `advance_inbound_route_stage(→owner_voicemail)` + `mark_inbound_missed` ⇒ voicemail TwiML; `{updated:false}` ⇒ TwiML for the persisted stage (idempotent re-emission for duplicate Dial-action deliveries). **If any of these writes fails after retries, the handler serves voicemail TwiML with the mailbox in the signed URL — never the mobile `<Dial>`.**
- `owner_mobile` return (parent `<Dial action>`): parse `DialCallStatus`, `DialCallSid`, `DialCallDuration`, **`DialBridged`**; call `record_inbound_mobile_bridge`; `dial_bridged` ⇒ `done` + finalize `completed`; `not_bridged`/`unconfirmed` ⇒ `owner_voicemail` (no new missed mark; `is_missed` already true). A machine pickup that never pressed 1 was hung up by the whisper TwiML before bridging and arrives here as not bridged.
- `group_browser`, `voicemail_done`, legacy handlers — as rev 2.

### 8.4 Busy correctness — as rev 2 (reservations, stage ceilings, two end signals for bridged conversations).

### 8.5 Signed callback contracts — as rev 2 (all mobile callbacks carry `call_row_id`, `org_id`, `attempt_id`, `agent_id`; cross-checked against the attempt; `<Dial action>` URLs gain the retry fragment, honoring of overrides on `action` URLs to verify live).

### 8.6 Response policy — as rev 2 §8.6, with one clarification from gap 3: the voicemail recording callback answers **200** once media and metadata are stored and the source deleted even if the notification insert failed (the sweep owns it); it answers **503** only while storage/metadata persistence is incomplete.

---

## 9. Change set D — Mobile handoff (gap 5)

TwiML as rev 2 (`<Dial timeout={mobile_ring_seconds} action={stage=owner_mobile}><Number url={stage=mobile_whisper} statusCallback={stage=mobile_leg_status} statusCallbackEvent="initiated ringing answered completed">…`), no recording attributes ever; whisper `<Gather numDigits="1" timeout="5">…Press 1…</Gather><Hangup/>`.

**Facts and their sources.** (a) **Acceptance** = signed Gather action `Digits=1` (Twilio-issued request; parent/child/attempt/destination cross-checks) → `record_inbound_mobile_accept`. (b) **Bridging** = the parent `<Dial action>` request's **`DialBridged`** boolean (documented parameter of the Dial action request per Chris's Dial reference) → `record_inbound_mobile_bridge`; `DialCallStatus`/`DialCallSid`/`DialCallDuration` are recorded as provider evidence but never used to infer bridging (a machine-answered whisper ends `completed` without bridging). (c) **Child-leg lifecycle** = `<Number statusCallback>` events (`initiated`, `ringing`, `answered`, `completed`, with child `CallSid`, `CallStatus`, `CallDuration` on completion, per Chris's Number reference) → provider outcomes + `record_inbound_mobile_leg_end`; the child's duration includes the whisper and proves nothing about bridging. (d) **Insufficient evidence** (no `DialBridged` field) ⇒ `unconfirmed`: no attribution, no `outcome` write, the call stays "Missed in AgentFlow — forwarded to mobile" with provider status/duration intact; a one-second genuine conversation with `DialBridged=true` is attributed normally.
**Remaining live verification cases:** `DialBridged` present and `true` for accept+bridge; `false` (or absent) for machine pickup without Press 1, for `no_digit` timeout, for Press 1 after the caller hung up; `DialCallStatus` values in each; `<Number statusCallbackEvent>` delivery and the child `CallDuration` semantics; whether `<Hangup/>` in the whisper prevents bridging; default caller ID (P7); whether connection overrides apply to `action` URLs.

---

## 10. Change set E — Voicemail (gap 3 alignment)
As rev 2 with: `notified_at` on `voicemails`; the callback answers 200 after verified storage + source deletion regardless of notification success; `attempt_id` nullable and validated; recovery via `converge_inbound_notifications`/sweep; mailbox always from the signed query; playback for unlinked callers via notification drawer and dashboard rows; retention per P13; conversation recordings untouched.

---

## 11. Files to touch (reconciled)
**Frontend (edit):** as rev 2 (`TwilioContext.tsx`, `twilio-voice.ts`, `FloatingDialer.tsx`, `DialerPage.tsx`, `AuthContext.tsx` logout keepalive, `AgentStatusContext.tsx`, `TopBar.tsx`, `ProfileInfoCard.tsx`, `AgentModal.tsx`, `incomingCallAlerts.ts`, `InboundRoutingManager.tsx`, `inboundRoutingSchema.ts`, `CallRecordingSettings.tsx`, `MyProfile.tsx`, `MissedCallsWidget.tsx`, `DashboardDetailModal.tsx`, `ConversationThread.tsx`, `ConversationHistory.tsx`, `conversationTypes.ts`, `FullScreenContactView.tsx`, `NotificationRow.tsx` + drawer, `types.ts`, regenerated Supabase types, two test mocks). **Frontend (new):** `phonePresence.ts` (registration generations), `ringtoneOutputs.ts`, `voicemails.ts`, `inbound-call-labels.ts`, five settings cards, `VoicemailPlayer.tsx`, `ConnectionDiagnostics.tsx`. **Delete:** `IncomingCallModal.tsx`.
**Edge (edit):** `twilio-voice-inbound/index.ts`, `routing.ts`, `twiml.ts`; **`twilio-voice-status/index.ts` (the two `calls` projections only)**; `twilio-recording-status/index.ts`, `idempotency.ts`; `_shared/notifications.ts`, `_shared/notification-recipients.ts` (tier 0 + D13 row); `recording-retention-purge/index.ts`. **Edge (new):** `twilio-voice-inbound/planner.ts`, `stages.ts`. **Not modified:** `inbound-call-claim`, `twilio-voice-webhook`, `twilio-token`, `repair-twilio-number-ownership`, `_shared/twilioNumberConfig.ts`.
**Database (new):** M4–M7, rollback files, SQL suites, `scripts/run_inbound_sql_tests.sh` extended. **Docs:** `implementation_plan.md`, `WORK_LOG.md`, `AGENT_RULES.md` (§16).
**Explicitly NOT touched:** applied migrations; `calls`/`profiles`/`notifications` policies; `claim_inbound_call`; `dialer_sessions`; campaign calling windows; `business_hours` data; outbound `makeCall`/`device.connect()`; browser `.webm` outbound recording; `call-recordings` policies; Twilio number configuration; Supabase GitHub integration.

---

## 12. Tests (fail-first) and static gates
As rev 2, plus: `inboundStages.test.ts` — immediate-forward path (attempt born in `owner_mobile`), duplicate initial webhook re-emits the persisted stage, zero-row `advance_to_owner_mobile` follows the persisted stage, D13 failure ⇒ voicemail TwiML and never mobile TwiML, `DialBridged` true/false/absent handling; `missedRecipientTier0.test.ts` — the A/B scenario through the shared helper for both `twilio-voice-inbound` and `twilio-voice-status` call sites, failed first insert, repeated callbacks, ownership change; `phonePresence.test.ts` — in-memory registration id (never persisted), `seq` increments, duplicate-tab/reload/delayed-pagehide/reordered-heartbeat/logout sequences against a fake RPC; SQL: `inbound_route_attempts.sql` adds immediate-forward atomicity (D13 rows and attempt committed or neither), `commit_owner_mobile` refusal paths, `record_inbound_mobile_bridge` evidence matrix, `converge`/`sweep` idempotency and completion stamps; `inbound_registrations.sql` — `seq` guard, own-row-only writes; `inbound_group_validation.sql` — trigger rejects duplicates, >10, foreign-org, inactive, identity-less ids and v2 activation without a group. Static gates unchanged (`npx tsc --noEmit` exit 0; app-config multiset vs the 81-error baseline; eslint; build; esbuild per function; migration replay).

---

## 13. Verification matrix (additions in bold)
As rev 2, plus: **offline owner A / number owner B: A gets one missed notification, B none — also after a failed first insert, repeated parent callbacks, and reassignment of the contact**; **immediate offline forward: D13 mark visible before the mobile rings**; **duplicate initial webhook and duplicate Dial action deliveries**; **20-second ring: browser and server measurements reported per call (no band assumed)**; **`DialBridged` cases (accept+bridge, machine pickup, no digit, Press 1 after hangup) with the resulting evidence and label**; **presence: duplicate tab, reload, delayed pagehide, reordered heartbeat, logout, identity change**; **rollback drain: a v2 mobile conversation active for 30 minutes, a recording callback that failed processing, a late callback arriving after the flag flip**; **notification recovery by the sweep after a forced insert failure**. Waived/deferred items stay not passed; unexecuted live tests are reported as unproven.

---

## 14. Cutover gate, release order, rollback (gap 7)
**Deployment order (each step separately approved):** M4 → M5 → M6 → M7 applied and verified → types regenerated → **`twilio-voice-status` (projections + tier-0 helper)** → `twilio-recording-status` → `recording-retention-purge` → `twilio-voice-inbound` (both engines; every org still `legacy`) → frontend release → per-org prerequisites (fresh registrations observed, group validated by `activate_inbound_routing_v2`, mobile numbers or acknowledged voicemail-only, mailbox access verified) → `routing_engine='v2'` for that org (production settings write, approved per invariant #28).

**Rollback / recovery:**
1. Flip the org back to `legacy` (no deploy). New calls take the old path; the deployed functions keep serving `stage=`/`source=voicemail` callbacks for outstanding v2 work.
2. **Drain gate — all of the following, regardless of age:** (a) no `inbound_route_attempts` with `terminal=false` — an attempt whose parent call has `ended_at` set and whose obligations are complete may be closed by an approved ops SQL, never silently; (b) no v2-era `calls` with `ended_at IS NULL`; (c) no `voicemails` with `status IN ('pending','failed')` and none with `status='stored' AND notified_at IS NULL`; (d) no missed calls with `missed_notified_at IS NULL` owed to the sweep; (e) a **30-minute quiet period** after the last of these closes, covering Twilio's connection-override retries and late recording callbacks. Only then may `twilio-voice-inbound` v44 / `twilio-recording-status` v34 / `twilio-voice-status` v40 be restored (the old versions would treat `stage=` actions as new inbound calls, store `source=voicemail` recordings into `calls.recording_*`, and resolve recipients through tiers 1–4). **If the gate cannot be established, the compatible versions stay deployed with every org on `legacy`.**
3. Migrations are additive; M7 rollback gated on zero stored voicemails or an export; M6's finalize rollback restores the `20260823222805` body verbatim; the cron sweep is unscheduled in M6's rollback.
4. Frontend rollback = Vercel redeploy; presence/availability writes are best-effort and idempotent.

---

## 15. Invariant interactions — as rev 2 (§3.3 wording; R13 untouched; C13 audit unchanged; R14 extended; #8 sole duration writer — `twilio-voice-status` changes are projection-only; #9, #20, #25, #28, #31, §7 as before; RLS scope §7.7).

## 16. Proposed rule updates — as rev 2, with D13 recovery (§3.4) and registration generations (§6.2) added to the new invariant text.

## 17. Decisions still needed from Chris
Supporting defaults **P1–P17** (P17 = ring-timeout calibration posture); `#APPROVE_RLS_CHANGE` for exactly the §7.7 scope; the go-ahead to implement. D1–D13 are not re-asked.

## 18. Limits of this planning session
Twilio docs unreachable (egress) — Dial/Number facts are taken from Chris's references and marked for live verification; `deno` absent; automated adversarial subagent review blocked by the session limit (resets 2026-09-11 09:20 UTC); no live call or Twilio console; incident attribution remains unproven.
