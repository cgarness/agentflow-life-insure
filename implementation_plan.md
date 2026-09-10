# Implementation Plan — Permanent AgentFlow inbound calling and agent voicemail (rev 2, corrective pass)

**Label:** BUGFIX (Alexa's missed inbound call) + the routing/voicemail behavior Chris decided (D1–D13).
**Repository:** `cgarness/agentflow-life-insure` · planning branch `claude/agentflow-inbound-plan-fkl6zi` · base `main` @ `1b93f89` (unchanged; `origin/main` has not moved) · previous planning commit `2f9d500`.
**Status:** PLAN FOR REVIEW — rev 2 supersedes rev 1 (`2f9d500`) after Chris's corrective prompt. **Documentation-only.** No application code, migration, RLS, Edge Function, Twilio setting, or production row was changed while preparing it. **STOP point: Chris's explicit approval of this corrected plan is required before any application edit or backend command. No RLS approval token has been granted; §7.7 states the exact scope that will need one.**
**Authored:** 2026-09-10 (rev 1) · revised 2026-09-10 (rev 2).

> Decision namespace. D1–D13 are Chris's settled decisions from the brief and the corrective prompt. The 2026-08 inbound plan reused `D1…D8` for its own defaults and those labels sit in code comments (`twiml.ts:3`, `routing.ts:3`, `index.ts:434`, migration `20260823222528`); new comments/docs write `INB-D4` etc. **P1–P16** are supporting defaults that need Chris's explicit yes; nothing in P is treated as approved.

---

## 0. What changed in rev 2 (summary of corrections)

| Ref | Correction | Where |
|---|---|---|
| D13 | New decision: every mobile forward = one "Missed in AgentFlow — forwarded to mobile"; missed mark + one notification at the forward commit; never cleared by a later mobile answer; provider outcome/duration kept accurate; counted once per parent call. Writer **and reader** audit done; the reader filter `agent_id = userId` is proven to hide missed rows and is fixed; the finalize RPC's `is_missed=false` retraction is removed by a new migration; invariant #30 wording revised narrowly. | §3, §7.4, §8.3, §10, §15 |
| A | The silent `all_active` default group is **removed**. Routing v2 cannot activate for an organization until an admin has explicitly configured the group (`inbound_group_agent_ids` non-empty, ≤ 10 members) — enforced by the cutover flag's CHECK. | §5.2 P2, §7.2, §14 |
| B | Press 1 is the only acceptance mode (the `auto` option is removed from scope). Acceptance (signed Gather `Digits=1`) and bridging (Twilio `DialBridged`/timing evidence on the `<Dial action>`) are separate facts; neither clears D13; Press 1 after the caller hung up is classified `accepted_after_hangup`, never a connected conversation. | §9, §7.4 |
| C | Presence is **per registration** (`agent_phone_registrations`, key `(agent_id, session_id)`), not one last-writer row: closing one tab cannot hide another; a stale tab cannot refresh another's freshness; logout/pagehide write with `keepalive`; identity changes write their own row; background throttling covered by 45 s heartbeats inside a 3-minute window; recovery never touches availability and never runs while a call is dialing/ringing/active. | §6.2, §7.1 |
| D | Eligibility + reservation is **one SQL transaction** (`plan_inbound_route`, per-agent advisory locks in sorted order) that excludes the current call's own attempt; busy and deliberate unavailability are re-evaluated atomically at the browser→mobile transition (`advance_to_owner_mobile`); freshness ceilings are per stage and a bridged mobile conversation is kept busy by two end signals, not a timer. | §8.1, §8.4, §7.3 |
| E | 20-second browser ring specified with Twilio's up-to-5-second timeout buffer and a measurement/acceptance method; the 10-`<Client>` limit per `<Dial>` is handled by capping the configured group at 10 with the alternative architectures stated; signed parent/child/attempt/destination checks on every mobile callback; the Client identity validator is never used for a number. | §8.2, §8.3, §9, §12 |
| F | Authorized voicemail playback for unlinked callers via existing notification/dashboard surfaces with no contact record and no lead creation; explicit table/storage/function grants; attempt-persistence failure path resolved (mailbox travels in the signed recording callback, `voicemails` row does not depend on the attempt); recording sources preserved until verified persistence. | §10, §7.5, §8.5 |
| G | Explicit cutover gate (`inbound_routing_settings.routing_engine = 'v2'`, per org, with prerequisites) instead of order-independent releases; rollback = flag flip first, then a verified drain before any function-version restore (old versions cannot handle `stage=`/`source=voicemail` callbacks); the 200-on-failure policy is reconciled with invariant #30 request by request. | §14, §8.6 |
| H | Direct-line precedence, retirement of per-number routing, shared-mailbox membership/history access and voicemail retention are explicit approval items; reusing `recording_retention_days` (7 days on the home org) would purge voicemails after seven days including unheard ones, so a separate retention default is proposed. | §5.2 P1, P11, P3, P13 |
| — | File list, schema/RPC contracts, tests, verification matrix, release/rollback sequence and invariant table updated consistently. | §11–§16 |

---

## 1. Inspection basis (read-only; unchanged from rev 1 except where noted)

**Repository.** `AGENT_RULES.md` (invariants #8, #9, #20, #25, #28, #30, #31), `VISION.md`, `WORK_LOG.md` (through 2026-09-01 and the 2026-08-22 → 08-25 inbound release trail), the 2026-08 approved inbound plan (`git show 81df588:implementation_plan.md`), full reads of `TwilioContext.tsx`, `twilio-voice.ts`, `FloatingDialer.tsx`, `DialerPage.tsx` (relevant regions), `TopBar.tsx`, `AgentStatusContext.tsx`, `incomingCallAlerts.ts`, `NotificationContext.tsx`, `InboundRoutingManager.tsx` + `inbound-routing/*`, the five inbound Edge Functions, `_shared/notifications.ts`, `_shared/notification-recipients.ts`, the four inbound migrations, the notifications migration, baseline DDL for `calls`/`profiles`/`phone_numbers`/`phone_settings`/`inbound_routing_settings`/`business_hours`/`notifications`/`dialer_sessions`/storage, Voice SDK 2.18.1 sources. **Rev 2 additionally read:** every `is_missed`/`outcome`/`forwarded_answered` writer and reader (§3.2), the full `finalize_inbound_call_terminal` body, `terminal-guard.ts`, `routing.ts:100-146`, the notification row builder, `handle_call_workflow_events`/`trg_workflow_call_created`, and the `keepalive` RPC pattern in `useDialerSession.ts:81-98`.

**Live production (read-only).** Edge Functions at the brief's versions (`inbound-call-claim` v38, `twilio-voice-status` v40, `twilio-voice-inbound` v44, `twilio-recording-status` v34, `repair-twilio-number-ownership` v3; hashes byte-verified per WORK_LOG); newest migration `20260823222926`; `calls.status` CHECK = `ringing|connected|completed|failed|no-answer`; `notifications.type` CHECK lacks `voicemail`; `profiles.availability_status` exists (`Available` ×6, `Offline` ×5, no CHECK) with a column-scoped UPDATE grant to `authenticated`; home org `routing_mode='all-ring'`, chain `[last_agent, all_available]`, `fallback_action='voicemail'` **with `voicemail_enabled=false`**, `auto_create_lead=false`; `phone_settings.ring_timeout=15`, `recording_enabled=true`, `recording_retention_days=7`; `call-recordings` bucket private with org-wide read; `voicemail-assets` public; 5 non-terminal `calls` rows, none with `agent_id`.

**Tooling baseline here.** `npx tsc --noEmit` exit 0; `tsc -p tsconfig.app.json` = **81** pre-existing errors on `main` (multiset baseline for "zero new"); ten focused inbound vitest suites 139/139 green; `deno` absent; `esbuild`, `psql`, `docker` present (local PostgreSQL for SQL suites still to be proven). **Twilio documentation is blocked by the egress proxy**: Twilio platform facts are marked (SDK-verified) when read from the 2.18.1 package, (per Chris's references) when stated in the corrective prompt, or (verify live) otherwise.

---

## 2. Revalidation of the pinned findings (unchanged verdicts; see rev 1 for full evidence)

| # | Finding | Verdict | Key evidence |
|---|---|---|---|
| 1 | Closing the floating panel destroys the Device | CONFIRMED, worse: also mid-ring and on first mount | `FloatingDialer.tsx:306-316`, `:666-672`, `:132` |
| 2 | Ending a campaign session destroys the Device | CONFIRMED | `DialerPage.tsx:2370` |
| 3 | Unregistration leaves `isReady` true | CONFIRMED | `TwilioContext.tsx:1968-1970`, `:2356`, `:2312` |
| 4 | Availability is local-only | CONFIRMED for TopBar; app-wide there are two disconnected sources (`profiles.availability_status` written by `ProfileInfoCard.tsx:124-131`; TopBar `useState(0)`) | `TopBar.tsx:69, 289-292` |
| 5 | Eligibility ignores presence | CONFIRMED | `index.ts:430-448`, `routing.ts:25-42` |
| 6 | "assigned" = number owner | CONFIRMED | `index.ts:1089-1098` |
| 7 | Forwarding is org/number-level; no per-agent tables | CONFIRMED | `index.ts:371`, `twiml.ts:134-143` |
| 8 | Ringtone hooks are no-ops; priming ≠ audibility | CONFIRMED; SDK swallows ringtone play failures (`device.js:1358-1378`) | `incomingCallAlerts.ts:57-85, 150-154` |
| 9 | Claim validates Client identities | CONFIRMED | `claim-callback.ts:37-67`, `index.ts:204-224` |
| 10 | One recording source per row; voicemail undistinguished | CONFIRMED; a second `RecordingSid` is acked and abandoned at Twilio | `idempotency.ts:69-86`, `index.ts:249-262` |

Incident (`0bb30fa8…`, 2026-09-09 20:31 UTC): five `<Client>` legs ended ≈0.23 s after TwiML was served with `DialCallStatus=no-answer`, no claim, caller then heard the greeting and was hung up (voicemail disabled). Strong evidence of no registered Device for any of the five identities; **not proof** (no per-browser delivery or child-leg records). Attribution stays unproven.

---

## 3. D13 — "Missed in AgentFlow" is separate from the mobile outcome

### 3.1 Rule
- **When** the server commits to mobile forwarding — the `owner_mobile` stage, including an immediate forward for an offline/not-connected owner — the canonical parent `calls` row is marked `is_missed = true` with `missed_reason = 'forwarded_to_mobile'` and `missed_for_agent_id = <owner>` in the **same transaction** as the stage reservation (§7.3 `advance_to_owner_mobile`), and **one** idempotent notification (`event_key = missed_call:<call_id>`, tier-0 recipient = the owner) is inserted **at that point**, not at voicemail.
- **Never cleared.** A later Press 1, bridge, or connected mobile conversation never sets `is_missed = false`, never removes the row from missed lists/counts, and never suppresses the already-inserted notification. The two-proof rule stays: `outcome = 'forwarded_answered'` (bridge evidence) and `answered_by_agent_id` are recorded **alongside** the missed classification.
- **Accurate outcomes.** `calls.status`/`duration` stay Twilio-authoritative from the parent leg (`twilio-voice-status`); a bridged mobile conversation ends `completed` with its real duration and `outcome='forwarded_answered'` — it is never turned into a provider `no-answer`. `provider_outcomes` on the attempt keep each child-leg result.
- **Counted once.** `is_missed` lives on the parent row only; child legs, retries, the whisper, the Gather and the voicemail have no `calls` rows. The missed notification is unique per `(user_id, missed_call:<call_id>)`; a later voicemail inserts its own `voicemail:<call_id>` notification (§10) and never a second missed call.
- **Label.** Everywhere the row is shown: **"Missed in AgentFlow — forwarded to mobile."** (+ "Answered on mobile by {agent}" when bridge evidence exists; + "Voicemail" when a stored voicemail exists.)

### 3.2 Writer and reader audit (every site, what changes)

| Site | Today | D13 change |
|---|---|---|
| `finalize_inbound_call_terminal` external-answer branch (`20260823222805:225-238`) | sets `is_missed = false` when an external forward answers | **New migration `CREATE OR REPLACE`**: the retraction line is removed; the branch still records `outcome='forwarded_answered'`, freezes terminal status, sets `ended_at` if null. The guarded terminal branch (`:260-273`) is unchanged: it never *retracts* (`COALESCE(is_missed,false) OR …`). |
| `finalize_inbound_call_terminal` refusal reasons `externally_answered` / `claimed_active` | refuse a *non-completed* finalize or a mark-missed after an answer proof | Unchanged. Under D13 the missed mark precedes the mobile leg, so no later call path needs to mark a forwarded call missed; a stale earlier-wave action is still correctly refused. |
| `twilio-voice-inbound` `markMissedAndNotify` (`index.ts:680-724`) + `canMarkRowMissed` (`routing.ts:140-146`) | mark + notify at voicemail entry or hangup, guarded `agent_id IS NULL AND outcome ≠ forwarded_answered` | Reused as the one missed-marking helper; gains `{ reason, forAgentId, preferredRecipientIds }`. Called at the forward commit (reason `forwarded_to_mobile`), at owner-voicemail entry for DND/busy/no-mobile paths (reasons `dnd`, `busy`, `no_answer`, `offline_no_mobile`), and at group voicemail (`no_answer`/`group_empty`). Idempotent: the row is already missed on the voicemail path after a forward, so the second call is a no-op update and the notification upsert converges. |
| `twilio-voice-status` (`index.ts:349, 368, 379`) `shouldPersistMissedFlag` | sets `is_missed=true` for `no-answer|busy|canceled`; never sets false | Unchanged (monotonic). A parent `completed` after a forwarded, bridged conversation keeps `is_missed=true` from the forward commit. |
| `twilio-voice-status` `shouldEmitMissedCallNotification` (`terminal-guard.ts:68-86`) | notify on fresh miss or durable `is_missed` | Unchanged; converges on the same event key — the notification inserted at the forward commit is not duplicated. |
| Proposed `record_inbound_mobile_accept` / `record_inbound_mobile_bridge` (§7.3) | (rev 1 set `is_missed=false` in the accept RPC) | **Removed.** Neither RPC touches `is_missed`; SQL tests pin it. |
| `insertMissedCallNotifications` / `resolveMissedCallRecipientsFromDb` (`notification-recipients.ts:174-373`) | tiers routed → number owner → contact agent → managers | Adds a **tier 0**: explicit `preferredRecipientIds` (validated Active, same org) so D7/D11/forward paths where no browser wave rang still reach the intended agent; row body gains the D13 label with `metadata.reason='forwarded_to_mobile'`. Type stays `missed_call` (no constraint change). |
| `MissedCallsWidget.tsx:50-59` | `direction=inbound AND is_missed=true AND created_at ≥ 24h`, plus **`agent_id = userId`** for non-Admins / Admin "my" toggle | **Pre-existing defect surfaced by the audit:** a missed row is by definition unclaimed (`agent_id IS NULL`), so the filtered view can never show any missed call today. Reader becomes `.or('agent_id.eq.<uid>,missed_for_agent_id.eq.<uid>,routed_agent_ids.cs.{<uid>}')` (UUID-validated before interpolation, as `dashboard-callbacks.ts` does), so owner-mode misses (incl. D13 forwards) and group misses appear for the agents they concern. |
| `DashboardDetailModal.tsx:414-418` (`missed_calls`) | same filter shape | Same `.or(...)` predicate; label from the shared helper. |
| Conversation history call items (`ConversationThread.tsx`, `dialer/ConversationHistory.tsx`, `contacts/conversation-history/*`, `FullScreenContactView.tsx:527`) | no missed label at all (only direction/duration/disposition) | Select `is_missed, missed_reason, answered_by_agent_id, outcome, voicemail_id`; render via one helper `describeInboundCallOutcome(row)` in `src/lib/inbound-call-labels.ts` (pure, tested): D13 label, "Answered on mobile by …", "Voicemail". |
| `notifications` retention cron / `NotificationRow.tsx:18` | 30-day retention; `missed_call` icon | Unchanged; the D13 body text is carried in the row. |
| Reports RPCs (`get_org_leaderboard_stats`, `get_trusted_today_dialer_stats`, `reports_performance_rpcs`) | outbound-only or no `is_missed` use | Unchanged (no missed-call metric exists there). |
| `handle_call_workflow_events` (`baseline:3441-3492`) | reads `is_missed` but is **not** wired to any trigger; `trg_workflow_call_created` (`baseline:10251`) fires `workflow_on_call_created` **AFTER INSERT** only | A D13 `UPDATE` dispatches no workflow event. Stated so no one expects automation on forward. |
| RLS Phase 1 `calls` UPDATE policy | excludes unassigned inbound rows from authenticated UPDATE | Unchanged; all D13 writes are service-role RPCs. |

### 3.3 Invariant #30 wording change (narrow)
Rev 7(b) keeps "answered-ness has exactly two durable proofs" and adds: *"`calls.is_missed` records **missed in AgentFlow** and is monotonic once written by an accepted guarded writer. A mobile forward (D13) marks it at the forward commit with `missed_reason='forwarded_to_mobile'` and `missed_for_agent_id`; the external answer proof (`outcome='forwarded_answered'`) and `answered_by_agent_id` are recorded alongside and **never retract it**. The former `is_missed=false` retraction in `finalize_inbound_call_terminal`'s external-answer branch is removed by migration M6."* Ownership (`agent_id`, claim CAS), signature validation, tenant scoping and terminal-state freezing are not touched. **No historical backfill** of existing rows.

---

## 4. Design overview

```
initial webhook → resolve DID/org → ingest_inbound_call (resolve_inbound_contact unchanged)
  → plan_inbound_route (ONE SQL transaction, §8.1): owner | group; eligibility; reservation; attempt row
  ┌ owner ───────────────────────────────────────────────────────────────────────┐
  │ availability ∈ {On Break, DND} → owner_voicemail                (D11; missed reason dnd)
  │ busy (calls / reserved attempt) → owner_voicemail               (D7;  missed reason busy)
  │ not connected → owner_mobile (immediate forward)                (D3;  D13 mark at commit)
  │ owner_browser <Client> timeout=20 (+≤5 s buffer) — no answer →  recheck DND/busy atomically →
  │      owner_mobile (D13 mark) | owner_voicemail
  │ owner_mobile <Number url=whisper> mobile_ring_seconds, Press 1 → accepted → bridged?
  │      not accepted / not bridged → owner_voicemail               (D6;  no new missed mark)
  │ owner_voicemail: agent greeting + <Record> → voicemails (mailbox = owner)
  └──────────────────────────────────────────────────────────────────────────────┘
  ┌ group (explicit, ≤10 members) ───────────────────────────────────────────────┐
  │ eligible = configured ∩ Active ∩ identity ∩ Available ∩ connected ∩ ¬busy (D5, D10)
  │ empty → group_voicemail (P3) | one simultaneous wave, 20 s → no answer → group_voicemail
  └──────────────────────────────────────────────────────────────────────────────┘
After hours: identical plan (D8); only the after-hours SMS stays hours-gated.
routing_engine='legacy' (default) keeps today's behavior until the cutover gate (§14) flips an org to 'v2'.
```

Signals kept separate: **intent** = `profiles.availability_status`; **reachability** = per-registration heartbeats; **occupancy** = derived in SQL from `calls` rows and reserved attempts; **answered-ness** = `agent_id` or `outcome='forwarded_answered'`; **missed-in-AgentFlow** = `is_missed` (+ reason, + intended agent), monotonic.

---

## 5. Decisions → mechanism; supporting defaults for review

### 5.1 D1–D13 (settled)
| D | Mechanism |
|---|---|
| D1 | Provider-owned Device registration (§6.1) + per-registration presence (§6.2) + `availability_status='Available'` + not busy; evaluated server-side in `plan_inbound_route`. |
| D2 | Owner = `leads|clients|recruits.assigned_agent_id` by the ingested `(contact_id, contact_type)` — never a second phone probe. |
| D3 | `owner_mobile` uses `agent_inbound_settings.mobile_forward_number`; reached on not-connected or after an unanswered 20 s browser ring. |
| D4 | `browser_ring_seconds` DEFAULT 20 → `<Dial timeout="20">`; Twilio may ring up to ≈5 s longer (§8.2). |
| D5 | Explicit `inbound_group_agent_ids` (≤ 10), required before v2 activation (A). |
| D6 | Mobile unanswered / not accepted / not bridged ⇒ `owner_voicemail`, mailbox = owner. |
| D7 | Busy ⇒ `owner_voicemail` immediately; browser SDK `allowIncomingWhileBusy=false` left as is (SDK-verified `device.js:97, 317-320`). |
| D8 | After-hours branch removed; same plan; SMS unchanged; no calendar/outbound-window change. |
| D9 | `ringtoneOutputs` module: default all concrete outputs via `ringtoneDevices.set([...])` (SDK-verified accepts `string[]`); honest unsupported fallback; gesture-driven `ringtoneDevices.test(incomingUrl)`; `speakerDevices` untouched. |
| D10 | One simultaneous `<Client>` wave over eligible members (≤ 10). No round robin, no member mobiles. |
| D11 | `On Break`/`Do Not Disturb` ⇒ voicemail directly; excluded from group waves; rechecked before any mobile forward. |
| D12 | `buildMobileForwardTwiml` cannot emit `record*`; source audit; no call-level recording API; voicemail `<Record>` independent of `recording_enabled`. |
| D13 | §3. |

### 5.2 Supporting defaults (explicit approval needed for each)
| P | Proposal |
|---|---|
| **P1 Direct-line precedence** | `is_direct_line=true` ⇒ `phone_numbers.assigned_to` is the owner for the whole owner pipeline regardless of the caller's contact assignment. |
| **P2 Explicit group only** (A) | `inbound_group_agent_ids uuid[]`, CHECK `cardinality(...) BETWEEN 1 AND 10` when `routing_engine='v2'`; no automatic enrollment; the Settings UI blocks activation until configured. |
| **P3 Shared mailbox membership/history access** | Group voicemails readable by the eligible-member snapshot ∪ the configured group at read time ∪ org Admin/Super Admin; history rows of group calls visible per existing `calls` RLS; no Team-Leader downline read (TL downline authority is fail-closed today, AGENT_RULES #26). |
| **P4 Ineligible owner** | Missing/Inactive/Pending/Deleted/cross-org owner ⇒ group path. |
| **P5 Mobile ring** | `mobile_ring_seconds` DEFAULT 20 (5–120). |
| **P6 Press 1** (B) | Whisper `<Gather numDigits="1" timeout="5">`; only mode. |
| **P7 Mobile caller ID** | `<Dial callerId>` unset (Twilio default for a `<Dial>` inside an inbound call presents the caller's number — verify live); whisper announces AgentFlow. |
| **P8 Busy ceilings** (D) | ringing stages 5 min; accepted-but-unended mobile 4 h (Twilio's default max call length); `calls` rows 4 h. |
| **P9 Presence freshness** (C) | connected = any registration with `registered AND last_seen_at ≥ now()-3 min`; heartbeat 45 s (the proven `dialer_sessions` pair). |
| **P10 Retire legacy routing knobs** | `routing_mode`, `inbound_fallback_chain`, `voicemail_enabled`, `fallback_action` ignored under v2 (columns kept; UI hidden under v2). |
| **P11 Retire per-number routing overrides** | `phone_numbers.inbound_routing_mode/forwarding_number/voicemail_*` ignored under v2; `is_direct_line` remains. |
| **P12 Attribution column** | `calls.answered_by_agent_id` written only on bridge evidence; `agent_id` stays the Client-claim proof. |
| **P13 Voicemail retention** (H) | **Reusing `recording_retention_days` would delete voicemails after 7 days on the home org, unheard ones included.** Proposed instead: `inbound_routing_settings.voicemail_retention_days` DEFAULT 30, and unheard messages (`listened_at IS NULL`) retained until listened or 90 days, whichever first. |
| **P14 availability CHECK** | `CHECK (availability_status IN ('Available','On Break','Do Not Disturb','Offline'))` (preflight: only `Available`/`Offline` live). |
| **P15 Cutover flag** (G) | `inbound_routing_settings.routing_engine text CHECK ('legacy','v2') DEFAULT 'legacy'`; flipping requires the §14 prerequisites; rollback = flip back. |
| **P16 Twilio-limit posture** (E) | Group capped at 10; if a future org needs >10 simultaneous targets the stated alternatives are a Conference-based fan-out or TaskRouter — both separate designs. |

---

## 6. Change set A — Browser

### 6.1 Device lifetime (as rev 1, with the recovery guard from C)
Remove the two UI destroy paths (`FloatingDialer.tsx:303-316`, `DialerPage.tsx:2370`); add provider-owned teardown on identity loss/unmount via `destroyClientRef`; `onUnregistered` moves `status` to `connecting`; `handleOnline` re-inits when `!twilioVoiceReadyRef`; bounded recovery (one `initializeClient()` if still unregistered 30 s later) **only while `callStateRef.current === 'idle'` and `!isDialingRef.current`** — recovery never tears down an active, dialing or ringing call; `twilio-voice.ts` gains the `destroying` promise; `FloatingDialer` un-minimizes on `incoming`; `IncomingCallModal.tsx` deleted. All invariant #9 refs untouched; no new `.from("calls")` write.

### 6.2 Per-registration presence (`src/lib/phonePresence.ts` new) — correction C
- Each tab holds a `session_id` (`crypto.randomUUID()` in `sessionStorage`; regenerated on identity change). The browser calls `heartbeat_phone_registration(p_session_id, p_registered, p_state, p_detail)` — the RPC keys the row on `(auth.uid(), p_session_id)`, so **a tab can only ever write its own registration**: closing tab A marks A's row unregistered while B's row keeps the agent connected; a stale tab's heartbeat refreshes only its own row.
- Cadence: on `registered` ⇒ `registered=true`; on `unregistered`/`error`/`destroyClient` ⇒ `registered=false`; every **45 s** while registered (`setInterval`; hidden-tab throttling to ≥1/min still lands ≥2 beats in the 3-minute window); on `visibilitychange`→visible and `online` ⇒ one immediate beat. **Logout**: `AuthContext.logout()` calls a `keepalive` `fetch` to the RPC with `p_registered=false` **before** it awaits `signOut()` (the exact pattern of `bestEffortEndDialerSessionRpc`); **`pagehide`/`beforeunload`** do the same. Identity change (A→B in one tab) writes B's own row; A's row expires within 3 minutes (or was closed by A's logout write).
- Nothing in the presence path reads or writes `availability_status`; a reconnect can only change `registered`/`last_seen_at`.
- Identity from the `realProfile` alias; no call while `realProfile` is null. Failures are logged (bounded) and never affect the Device.
- Server view: `is_phone_connected(agent_id)` = `EXISTS (registration WHERE registered AND last_seen_at ≥ now() - interval '3 minutes')`. Stale rows (> 24 h) are deleted opportunistically inside the RPC for the caller's own agent id only.

### 6.3 Availability (as rev 1)
`AgentStatusProvider` owns `availability` from `realProfile.availability_status` and writes it through `updateProfile` (own row, existing column grant) only on explicit user action; `On a Call` derived from `callState`; TopBar picker limited to the three manual states, hidden under View As; `ProfileInfoCard` duplicate select and `AgentModal` phantom control removed; deactivate/delete paths unchanged.

### 6.4 Ringtone outputs and alerts (as rev 1)
`ringtoneOutputs.ts` policy/storage/apply/test; `twilio-voice.ts` `onDeviceReady` hook; audio priming and the sessionStorage flag deleted; desktop pop-ups gated on `Notification.permission` + `push_notifications_enabled`; `ProfileRingtoneOutputCard`; 50-entry readiness ring buffer + `last_state/last_detail` on the registration row (allow-listed codes, ≤ 64 chars).

### 6.5 Settings and surfaces
- Inbound Calls settings: explicit group editor (1–10 Active agents with availability/connected badges; **Activate routing v2** control disabled until group non-empty and the §14 checklist passes; shows which owners lack a mobile number), browser/mobile ring seconds, D2/D5/D8/D12 copy, D12 note in `CallRecordingSettings`; legacy knobs hidden under v2.
- My Profile → Inbound Calls card (mobile E.164 + enabled, greeting text/URL) and Ringtone output card.
- Voicemail surfaces (F): (1) the **notification drawer** row of type `voicemail` expands an inline `VoicemailPlayer` (authorized by `can_access_voicemail`, no contact needed); (2) `MissedCallsWidget` / `DashboardDetailModal` rows show a play control when `calls.voicemail_id` is set; (3) contact history items render the player when linked. Unlinked callers are fully served by (1) and (2); no lead is created and contact RLS is not widened.

---

## 7. Change set B — Database (five new migrations; applied files untouched)

Versions authored as `2026091HHHMMSS_*`, renamed to apply-time versions on apply. Additive DDL, no backfill, rollback SQL under `supabase/migrations/rollback/`.

### 7.1 M4 `…_inbound_agent_settings_and_registrations.sql`
```sql
CREATE TABLE public.agent_inbound_settings (
  agent_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mobile_forward_number text CHECK (mobile_forward_number IS NULL OR mobile_forward_number ~ '^\+[1-9][0-9]{7,14}$'),
  mobile_forward_enabled boolean NOT NULL DEFAULT true,
  voicemail_greeting_text text CHECK (voicemail_greeting_text IS NULL OR length(voicemail_greeting_text) <= 500),
  voicemail_greeting_url  text CHECK (voicemail_greeting_url IS NULL OR voicemail_greeting_url ~ '^https://'),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.agent_phone_registrations (               -- per registration (C)
  agent_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  registered boolean NOT NULL DEFAULT false, registered_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_state text NOT NULL DEFAULT 'unregistered' CHECK (last_state IN ('registered','unregistered','error')),
  last_detail text CHECK (last_detail IS NULL OR length(last_detail) <= 64),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, session_id));
CREATE INDEX ON public.agent_phone_registrations (organization_id, agent_id, registered, last_seen_at);
CREATE FUNCTION public.heartbeat_phone_registration(p_session_id uuid, p_registered boolean, p_state text, p_detail text DEFAULT NULL)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$ … $$;
  -- v_agent := auth.uid(); v_org := get_org_id(); raise 42501 if null; validate p_state/p_detail;
  -- INSERT … ON CONFLICT (agent_id, session_id) DO UPDATE SET registered = EXCLUDED.registered,
  --   registered_at = CASE WHEN EXCLUDED.registered AND NOT r.registered THEN now() ELSE r.registered_at END,
  --   last_seen_at = now(), last_state = …, last_detail = …, updated_at = now()
  --   WHERE r.organization_id = v_org;                       -- only the caller's own (agent, session) row
  -- DELETE FROM agent_phone_registrations WHERE agent_id = v_agent AND last_seen_at < now() - interval '24 hours';
CREATE FUNCTION public.is_phone_connected(p_agent_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER … ;
```
Grants: `REVOKE ALL FROM PUBLIC, anon`; `GRANT SELECT ON both TO authenticated`; `GRANT INSERT, UPDATE ON agent_inbound_settings TO authenticated`; `GRANT ALL ON both TO service_role`; RPC `EXECUTE` to `authenticated` + `service_role` only. Policies listed in §7.7.

### 7.2 M5 `…_inbound_routing_v2_settings.sql`
```sql
ALTER TABLE public.inbound_routing_settings
  ADD COLUMN routing_engine text NOT NULL DEFAULT 'legacy' CHECK (routing_engine IN ('legacy','v2')),
  ADD COLUMN inbound_group_agent_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN browser_ring_seconds integer NOT NULL DEFAULT 20 CHECK (browser_ring_seconds BETWEEN 5 AND 120),
  ADD COLUMN mobile_ring_seconds  integer NOT NULL DEFAULT 20 CHECK (mobile_ring_seconds BETWEEN 5 AND 120),
  ADD COLUMN voicemail_retention_days integer NOT NULL DEFAULT 30 CHECK (voicemail_retention_days BETWEEN 1 AND 365),
  ADD CONSTRAINT inbound_group_size CHECK (cardinality(inbound_group_agent_ids) <= 10),
  ADD CONSTRAINT inbound_v2_requires_group CHECK (routing_engine <> 'v2' OR cardinality(inbound_group_agent_ids) >= 1);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_availability_status_check
  CHECK (availability_status IN ('Available','On Break','Do Not Disturb','Offline'));   -- P14
```
Existing Admin-only insert/update + org select policies cover the new columns; no new policy.

### 7.3 M6 `…_inbound_route_attempts_and_d13.sql`
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
  reserved_agent_ids uuid[] NOT NULL DEFAULT '{}',              -- agents this attempt is holding (owner or group wave)
  mobile_number_dialed text, mobile_child_call_sid text,
  mobile_accepted_at timestamptz, mobile_accept_result text CHECK (mobile_accept_result IN ('accepted','accepted_after_hangup','no_digit','wrong_digit')),
  mobile_bridged_at timestamptz, mobile_bridge_evidence text,  -- 'dial_bridged' | 'timing' | NULL
  mobile_leg_ended_at timestamptz,
  voicemail_kind text CHECK (voicemail_kind IN ('agent','group')), voicemail_agent_id uuid, voicemail_group_ids uuid[],
  missed_marked_at timestamptz,                                -- D13 evidence
  provider_outcomes jsonb NOT NULL DEFAULT '[]'::jsonb,        -- bounded, last 20 entries
  final_outcome text, terminal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ON public.inbound_route_attempts USING gin (reserved_agent_ids) WHERE NOT terminal;
ALTER TABLE public.calls
  ADD COLUMN answered_by_agent_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,   -- P12
  ADD COLUMN missed_reason text CHECK (missed_reason IN ('no_answer','busy','dnd','offline_no_mobile','forwarded_to_mobile','group_empty')),
  ADD COLUMN missed_for_agent_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;    -- D13 intended agent
CREATE INDEX ON public.calls (missed_for_agent_id, created_at DESC) WHERE is_missed;
CREATE OR REPLACE FUNCTION public.finalize_inbound_call_terminal(uuid, uuid, text, boolean, boolean) … ;  -- §3.2: retraction removed, everything else verbatim
```
RPCs (all `SECURITY DEFINER`, `search_path = public, pg_temp`, `REVOKE FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE TO service_role`):
- **`plan_inbound_route(p_call_row_id, p_org_id, p_owner_agent_id, p_owner_source, p_candidate_group_ids uuid[])` → jsonb** (correction D). One transaction: `pg_advisory_xact_lock(hashtext('inbound_agent:' || id))` for the owner or for every candidate, **in sorted order** (deadlock-free); then, under the locks, compute per agent: `availability_status`, `is_phone_connected`, and **busy** = `EXISTS calls (org, (agent_id = a OR answered_by_agent_id = a), status IN ('ringing','connected'), ended_at IS NULL, created_at > now()-'4 hours')` **OR** `EXISTS inbound_route_attempts (org, NOT terminal, call_id <> p_call_row_id, a = ANY(reserved_agent_ids), (stage IN ('owner_browser','group_browser') AND stage_started_at > now()-'5 minutes') OR (stage='owner_mobile' AND mobile_accepted_at IS NULL AND stage_started_at > now()-'5 minutes') OR (stage='owner_mobile' AND mobile_accepted_at IS NOT NULL AND mobile_leg_ended_at IS NULL AND mobile_accepted_at > now()-'4 hours'))`. Decide the first stage, INSERT the attempt with `reserved_agent_ids` (`ON CONFLICT (call_id) DO NOTHING` — a duplicate initial webhook is read-only), and return `{attempt, stage, targets, reasons}`. Two simultaneous calls for the same agent serialize on the lock; the second sees the first's reservation. The current call never blocks itself (`call_id <> p_call_row_id`).
- **`advance_to_owner_mobile(p_attempt_id, p_org_id, p_call_row_id, p_mobile_number)`** → re-locks the owner, **re-evaluates DND/busy** (same predicates; excluding this attempt), and either (a) CAS `stage owner_browser|initial → owner_mobile`, sets `mobile_number_dialed`, marks the call missed (`is_missed=true, missed_reason='forwarded_to_mobile', missed_for_agent_id=owner, updated_at` WHERE `agent_id IS NULL`) and `missed_marked_at`, returning `{forward:true}`; or (b) returns `{forward:false, reason:'dnd'|'busy'}` so the handler goes to voicemail. The notification insert follows in the Edge Function (idempotent key); on notify failure the attempt keeps `missed_marked_at` and `notification_pending=true` for convergence by the next callback (§8.6).
- **`advance_inbound_route_stage(p_attempt_id, p_org_id, p_from_stage, p_to_stage, p_patch jsonb)`** — CAS on `stage = p_from_stage AND NOT terminal`; appends a bounded `provider_outcomes` entry; `done` sets `terminal`.
- **`record_inbound_mobile_accept(p_attempt_id, p_org_id, p_call_row_id, p_agent_id, p_child_call_sid, p_digits)`** — under the owner lock: requires `stage='owner_mobile' AND owner_agent_id = p_agent_id AND mobile_child_call_sid IS DISTINCT FROM other`; if the parent row is terminal or `ended_at IS NOT NULL` ⇒ `mobile_accept_result='accepted_after_hangup'` and `{accept:false}`; else sets `mobile_accepted_at`, result `accepted`; redelivery read-only. **Touches nothing on `calls`.**
- **`record_inbound_mobile_bridge(p_attempt_id, p_org_id, p_call_row_id, p_agent_id, p_evidence text, p_child_call_sid)`** — requires `mobile_accepted_at IS NOT NULL AND mobile_accept_result='accepted'`; sets `mobile_bridged_at`, evidence; `UPDATE calls SET outcome='forwarded_answered', answered_by_agent_id = COALESCE(answered_by_agent_id, p_agent_id), provider_session_id = COALESCE(provider_session_id, p_child_call_sid), status = CASE WHEN status='ringing' THEN 'connected' ELSE status END, updated_at = now() WHERE id AND organization_id AND direction='inbound' AND agent_id IS NULL AND (answered_by_agent_id IS NULL OR = p_agent_id)`. **Never writes `is_missed` or `duration`.** Idempotent.
- **`record_inbound_mobile_leg_end(p_attempt_id, p_org_id, p_child_call_sid, p_call_status, p_duration)`** — sets `mobile_leg_ended_at`, appends provider outcome; ends the busy reservation.
- **`is_agent_busy(p_org_id, p_agent_id, p_exclude_call_id uuid)`** `STABLE` — the shared predicate above, used by the planner and by tests.
Policies: RLS on, zero authenticated policies, service-role only (§7.7).

### 7.4 M7 `…_voicemails.sql`
As rev 1 (table, `calls.voicemail_id`, `notifications_type_check` + `voicemail`, private `voicemails` bucket, `can_access_voicemail(uuid)`, `voicemails_select`, `voicemails_update_listened` with column-scoped `GRANT UPDATE (listened_at)`, `voicemail_objects_select`), plus: `voicemails.attempt_id` nullable (F), `upsert_voicemail_from_recording(p_recording_sid, p_call_row_id, p_org_id, p_attempt_id, p_mailbox text, p_storage_path, p_duration, p_status)` service-role RPC keyed on `recording_sid` (idempotent, does **not** require the attempt row), `voicemails_expired_batch(p_org_id, p_cutoff_listened, p_cutoff_unheard, p_limit)` for P13. Function grants: `can_access_voicemail` `EXECUTE` to `authenticated` (policies evaluate as the caller) and `service_role`; all other RPCs service-role only; `REVOKE ALL ON public.voicemails FROM anon`.

### 7.5 M8 `…_voice_status_forward_awareness.sql` (small)
No schema; documents in SQL comments that `twilio-voice-status` remains the sole `duration` writer for forwarded calls. (Kept as a placeholder only if a comment-only migration is wanted; otherwise folded into M6.)

### 7.6 Generated types
Regenerate `src/integrations/supabase/types.ts` after M4–M7; every RPC typing matches its SQL signature (AGENT_RULES #30 rev 8(b)).

### 7.7 Exact RLS approval scope (token **not yet granted**)
| Object | Policies / grants that need `#APPROVE_RLS_CHANGE` |
|---|---|
| `agent_inbound_settings` | `self_select`, `self_insert`, `self_update` (`agent_id = auth.uid() AND organization_id = get_org_id()`, explicit `WITH CHECK`), `admin_select` (org Admin/Super Admin). |
| `agent_phone_registrations` | `self_select`, `org_select` (org-wide SELECT of registration timestamps for the group editor); **no** client write policies (RPC only). |
| `inbound_route_attempts` | RLS enabled, **zero** policies (service-role only). |
| `voicemails` | `voicemails_select`, `voicemails_update_listened` (both via `can_access_voicemail`). |
| `storage.objects` | `voicemail_objects_select` on bucket `voicemails`. |
| **Not modified** | every existing policy on `calls`, `profiles`, `notifications`, `phone_numbers`, `inbound_routing_settings`, `call-recordings`. RLS Phase 1 postconditions stay satisfied (no new ALL/UPDATE/DELETE policy on `calls`). |

---

## 8. Change set C — Server routing (`twilio-voice-inbound`)

### 8.1 Planner (`planner.ts` new) — atomic reservation (D)
`handleInitialInbound`: after ingest, if the org's `routing_engine <> 'v2'` ⇒ the **legacy path runs unchanged**. Otherwise: owner resolution (D2/P1/P4) → candidate group ids → **one** `plan_inbound_route` RPC (§7.3) that evaluates eligibility and reserves agents under per-agent locks and creates the attempt in the same transaction. The Edge Function then: `persistRoutedAgents(append_call_routed_agents)` for every `<Client>` target (R14, unchanged) → TwiML. If `plan_inbound_route` fails after 3 in-request retries: **safe path** = voicemail to the mailbox the planner already knows (owner or group) with the mailbox in the signed recording callback (§8.5) and `markMissedAndNotify(reason='no_answer')`; if even the owner/group cannot be determined (ingest failed) ⇒ today's hangup TwiML. Failure is logged as `attempt-persist FAILED` and the attempt is created lazily by the first stage return that can (`ON CONFLICT DO NOTHING`), so later evidence still has a home.

### 8.2 Ring duration and Twilio limits (E)
- `<Dial timeout="20">` for browser stages. Per Chris's reference (Twilio `<Dial>` docs, unreachable from here) Twilio may extend the actual ring by **up to five seconds**; the requirement is "at least 20 s of ring opportunity", so `timeout="20"` is kept and the buffer is accepted, not assumed away. **Measurement:** the attempt records `stage_started_at` (server) and the `<Dial action>` arrival time in `provider_outcomes`; the browser ring buffer records `invite→cancel` (client clock) and the registration row carries the latest `invite`/`cancel` detail; acceptance criterion in §13: measured audible ring **20–25 s** on a browser that was connected at plan time, over ≥ 5 live calls. If the browser leg ends in < 2 s the planner records `browser_unreached` (the Alexa signature) — evidence, not a busy decision.
- **`<Dial>` accepts at most ten simultaneous `<Client>` nouns** (per Chris's reference). The configured group is capped at 10 (`inbound_group_size` CHECK + UI). Because eligibility only filters, a wave never exceeds the configured size, so no member is ever silently dropped and no round robin is substituted. Alternatives if an org needs more than ten simultaneous targets: a `<Conference>`-based fan-out (each target dialed into a conference, first-answer wins by conference moderation) or Twilio TaskRouter — both are separate architectures and are **not** in this plan (P16).
- Every mobile callback is checked against signed `call_row_id`/`org_id`/`attempt_id`/`agent_id` **and** cross-checked against the persisted attempt (`owner_agent_id`, `mobile_number_dialed` vs `Called/To` last-10, `mobile_child_call_sid` vs `CallSid`, `ParentCallSid` vs `calls.twilio_call_sid`). The Client identity validator (`checkAnsweredClientIdentity`) and `claim_inbound_call` are never invoked for a number; a source audit test pins the absence of those imports in `stages.ts`.

### 8.3 Stage handlers and the D13 commit
- `owner_browser` return, no answer ⇒ `advance_to_owner_mobile` (re-evaluates DND/busy under the lock): `{forward:true}` ⇒ D13 mark already committed in SQL ⇒ `insertMissedCallNotifications(..., { preferredRecipientIds:[owner], reason:'forwarded_to_mobile' })` ⇒ mobile TwiML; `{forward:false}` ⇒ `owner_voicemail` with reason `dnd`/`busy`. Immediate forward for a not-connected owner takes the same RPC from the initial request.
- `owner_mobile` return: bridge evidence (`DialBridged=true` when Twilio sends it — verify live; else `DialCallStatus=completed AND mobile_accepted_at IS NOT NULL AND DialCallDuration ≥ 2 s beyond the whisper`) ⇒ `record_inbound_mobile_bridge` (attribution) ⇒ `done` + finalize `completed`; no bridge ⇒ `owner_voicemail` (no second missed mark; `is_missed` already true).
- `group_browser` return: answered ⇒ claim already set `agent_id` ⇒ `done` + finalize; unanswered ⇒ `group_voicemail` (`markMissedAndNotify` reason `no_answer`, tier-0 = wave members).
- `voicemail_done` ⇒ `done` + finalize `completed` (today's `fallback=hangup`).
- Legacy `fallback=chain|voicemail|hangup` handlers retained for in-flight legacy-engine calls and for the rollback drain (§14).

### 8.4 Busy correctness (D)
Reservation = `reserved_agent_ids` on a non-terminal attempt inside the stage-specific ceilings (§7.3). A ringing stage that lost its callback expires after 5 minutes; an accepted mobile conversation stays busy until either end signal — `record_inbound_mobile_leg_end` (child `<Number statusCallback completed>`, 503-retriable) or the parent `<Dial action>` — with a 4-hour ceiling equal to Twilio's default maximum call length, so a genuinely active call is never declared idle by a timer alone. Browser-answered calls are busy through `calls.agent_id` (claim CAS) and `ended_at`. Two inbound calls for the same owner: the second planner blocks on the advisory lock, sees the first reservation, and routes to voicemail (D7).

### 8.5 Signed callback contracts
| Emitted by | URL query (server-issued, signature-covered) | Handler | Retry fragment |
|---|---|---|---|
| `<Dial action>` (all stages) | `twilio-voice-inbound?stage=<s>&call_row_id&org_id&phone_number_id&attempt_id[&agent_id]` | stage return; CAS transitions | `#rc=3&rp=5xx,ct,rt` **added** (verify Twilio honors overrides on `action` URLs; harmless otherwise) |
| `<Client statusCallback>` | unchanged | `inbound-call-claim` (R13, unchanged) | present |
| `<Number url>` whisper | `…?stage=mobile_whisper&call_row_id&org_id&attempt_id&agent_id` | Gather TwiML after cross-checks; records child SID | none (TwiML) |
| `<Gather action>` | `…?stage=mobile_accept&…` | `record_inbound_mobile_accept`; `accepted` ⇒ `<Say>Connecting.</Say>`; else `<Hangup/>` | none (TwiML) |
| `<Number statusCallback>` | `…?stage=mobile_leg_status&…` `statusCallbackEvent="initiated ringing answered completed"` | provider outcome; `completed` ⇒ `record_inbound_mobile_leg_end`; transient ⇒ 503 | present |
| `<Record recordingStatusCallback>` | `twilio-recording-status?source=voicemail&call_row_id&org_id&attempt_id&mailbox=agent:<uuid>|group` | voicemail pipeline (§10) | present |
| `<Record action>` | `…?stage=voicemail_done&…` | finalize completed | present (as above) |

### 8.6 Response policy reconciled with invariant #30
Invariant #30 requires 5xx on every transient post-signature failure so the connection-override policy redelivers. Applied per request type:
- **Data-only callbacks** (`<Client>`/`<Number>` statusCallbacks, `recordingStatusCallback`): **503** on transient failure, exactly as today.
- **TwiML-bearing requests** (initial, `<Dial action>`, whisper, Gather, `<Record action>`): Twilio ends or degrades the caller's experience on a 5xx, so these answer **200 with the safe next TwiML** — but a failed write is **never acknowledged as success**: (1) each state write is retried 3× in-request; (2) a persistent failure is recorded (`attempt-persist FAILED`, `missed_mark_pending`, `notification_pending` flags on the attempt where the attempt exists) and **converged by the next callback** (the parent status callback's `shouldEmitMissedCallNotification` path, the stage returns, the recording callback); (3) the caller's durable facts never depend on that request: the voicemail recording callback and the parent status callback are 503-retriable; (4) with the retry fragment now on `action` URLs, a stage return may answer **503 only when the handler cannot even derive the next stage** (attempt row unreadable after retries) — Twilio then retries up to three times before failing the call, which is preferred to inventing a stage. The old fatal handler's empty-TwiML 200 is kept only for the initial request.

---

## 9. Change set D — Mobile handoff (B, E)

```xml
<Dial timeout="{mobile_ring_seconds}" action="{stage=owner_mobile}" method="POST">
  <Number url="{stage=mobile_whisper}" method="POST"
          statusCallback="{stage=mobile_leg_status}#rc=3&amp;rp=5xx,ct,rt"
          statusCallbackEvent="initiated ringing answered completed" statusCallbackMethod="POST">+1XXXXXXXXXX</Number>
</Dial>
```
- `buildMobileForwardTwiml` has no recording option; source audit asserts no `record` for any input and no `<Start>`/`<Record` outside `buildVoicemailTwiml`.
- Whisper: `<Gather numDigits="1" timeout="5" action="{stage=mobile_accept}"><Say>AgentFlow call from {escaped name | 'a caller'}. Press 1 to accept.</Say></Gather><Say>No answer. Goodbye.</Say><Hangup/>`. A personal-mobile voicemail never presses 1 and is hung up **before bridging**, so it cannot swallow the call; the parent then goes to AgentFlow voicemail.
- Acceptance ≠ bridging: `record_inbound_mobile_accept` is the human-acceptance fact; `record_inbound_mobile_bridge` (evidence on the `<Dial action>`) is the connected-conversation fact and the only writer of `answered_by_agent_id`/`outcome`. Press 1 after the caller disconnected ⇒ `accepted_after_hangup`, no attribution, no outcome change; D13 unaffected in every case.
- Loop guard: mobile ∉ org `phone_numbers`, ≠ dialed DID, ≠ caller ANI (last-10); E.164 by CHECK and Zod.
- Live verification items (docs unreachable): callee-side `url` TwiML runs before bridging and `<Hangup/>` there prevents bridging; bridging after the Gather action returns non-hangup TwiML; `DialCallStatus`/`DialBridged`/`DialCallDuration` values on the parent action for accepted, machine-answered and no-answer cases; `<Number statusCallbackEvent>` values; default caller ID on the mobile (P7).

---

## 10. Change set E — Voicemail (F)

- Branch in `twilio-recording-status` on the signed `source=voicemail` query (log if `RecordingSource` disagrees; the signed query wins). Pipeline order preserved from R17/C6: download `${RecordingUrl}.mp3` → upload to `voicemails/<org>/<call_row_id>/<RecordingSid>.mp3` → `upsert_voicemail_from_recording` (`status='stored'`, mailbox from the **signed query**, `attempt_id` if present, `calls.voicemail_id` set to the first stored) → **only then** `DELETE` the Twilio recording → `insertVoicemailNotifications` (`voicemail:<call_id>`, recipients = mailbox agent or group snapshot ∪ current group ∪ org Admins). Any failure before verified persistence ⇒ `status='failed'` sentinel + **503**; delete failure after persistence ⇒ 503 `stored_cleanup_failed` (exact-SID cleanup retry). Nothing is ever acknowledged as stored unless the row and object both exist.
- **Attempt-persistence failure** never loses the mailbox: the mailbox is chosen by the planner from data that exists before any attempt row and travels in the signed callback; `voicemails` does not depend on `inbound_route_attempts`.
- Playback for unlinked callers: notification drawer inline player + dashboard missed-call rows (§6.5); authorization is `can_access_voicemail` on both the row and the object; no contact record, no lead creation, no widening of contact RLS.
- Retention (P13): nightly purge via `voicemails_expired_batch` using `voicemail_retention_days` (listened) and a 90-day unheard cap; objects removed then `status='purged'`; never touches `call-recordings`.
- Conversation recordings (no `source` param) keep the untouched existing path.

---

## 11. Files to touch (revised) and explicit non-touches

**Frontend (edit):** `src/contexts/TwilioContext.tsx`, `src/lib/twilio-voice.ts`, `src/components/layout/FloatingDialer.tsx`, `src/pages/DialerPage.tsx`, `src/contexts/AgentStatusContext.tsx`, `src/contexts/AuthContext.tsx` (logout keepalive presence write only), `src/components/layout/TopBar.tsx`, `src/components/settings/profile/ProfileInfoCard.tsx`, `src/components/contacts/AgentModal.tsx`, `src/lib/incomingCallAlerts.ts`, `src/components/settings/InboundRoutingManager.tsx`, `src/components/settings/inbound-routing/inboundRoutingSchema.ts`, `src/components/settings/CallRecordingSettings.tsx`, `src/components/settings/MyProfile.tsx`, `src/components/dashboard/widgets/MissedCallsWidget.tsx`, `src/components/dashboard/DashboardDetailModal.tsx`, `src/components/conversations/ConversationThread.tsx`, `src/components/dialer/ConversationHistory.tsx`, `src/components/contacts/conversation-history/conversationTypes.ts`, `src/components/contacts/FullScreenContactView.tsx`, `src/components/notifications/NotificationRow.tsx` (+ drawer inline player), `src/lib/types.ts` (notification type union), `src/integrations/supabase/types.ts` (regenerated), test mocks `topBarViewAsShell.test.tsx`, `viewAsRouteAllowlist.test.tsx`.
**Frontend (new):** `src/lib/phonePresence.ts`, `src/lib/ringtoneOutputs.ts`, `src/lib/voicemails.ts`, `src/lib/inbound-call-labels.ts`, `src/components/settings/profile/ProfileRingtoneOutputCard.tsx`, `src/components/settings/profile/ProfileInboundCard.tsx`, `src/components/settings/inbound-routing/InboundGroupCard.tsx`, `src/components/settings/inbound-routing/RingDurationsCard.tsx`, `src/components/settings/inbound-routing/RoutingV2ActivationCard.tsx`, `src/components/ui/VoicemailPlayer.tsx`, `src/components/dialer/ConnectionDiagnostics.tsx`.
**Frontend (delete):** `src/components/dialer/IncomingCallModal.tsx`.
**Edge (edit):** `twilio-voice-inbound/index.ts`, `routing.ts`, `twiml.ts`; `twilio-recording-status/index.ts`, `idempotency.ts`; `_shared/notifications.ts`, `_shared/notification-recipients.ts`; `recording-retention-purge/index.ts`. **Edge (new):** `twilio-voice-inbound/planner.ts`, `stages.ts`. **Not modified:** `inbound-call-claim`, `twilio-voice-status`, `twilio-voice-webhook`, `twilio-token`, `repair-twilio-number-ownership`, `_shared/twilioNumberConfig.ts`.
**Database (new):** M4–M7 (+ optional M8) under `supabase/migrations/`, rollback files, SQL suites, `scripts/run_inbound_sql_tests.sh` extended.
**Docs:** `implementation_plan.md`, `WORK_LOG.md`, `AGENT_RULES.md` (§16).
**Explicitly NOT touched:** applied migrations; `calls`/`profiles`/`notifications` policies; `claim_inbound_call`; `dialer_sessions`; campaign calling windows; `business_hours` data; outbound `makeCall`/`device.connect()`; browser `.webm` outbound recording; `call-recordings` policies; Twilio number configuration; Supabase GitHub integration.

---

## 12. Tests (fail-first) and static gates

**Vitest:** `inboundPlanner.test.ts` (every §4 branch incl. legacy engine untouched), `inboundStages.test.ts` (stage machine × `DialCallStatus` × accepted/bridged; replay read-only; D13 mark exactly once; `owner_mobile` re-evaluation to voicemail), `inboundTwiml.test.ts` (extend: mobile builder never records; whisper/accept shapes; 20 s; signed params; retry fragments), `mobileAcceptCallback.test.ts` (signature-first, cross-checks, `accepted_after_hangup`, no Client validator import), `voicemailRecordingBranch.test.ts`, `voicemailNotifications.test.ts`, `missedInAgentFlowReaders.test.ts` (widget/modal predicates include `missed_for_agent_id`/`routed_agent_ids`; label helper), `phonePresence.test.ts` (own-session-only writes, keepalive on logout/pagehide, 45 s cadence), `ringtoneOutputs.test.ts`, `availabilityContext.test.tsx`, `deviceLifetime.test.tsx` (close/minimize/end-session never destroy; identity loss/unmount do; recovery skipped while a call is live), `topBarAvailability.test.tsx`, `profileRingtoneOutput.test.tsx`, source audits (`inboundBrowserLifecycleWrites` still 6 sites; `mobileLegNeverRecorded`; `mobilePathNeverUsesClientValidator`).
**SQL suites (localhost only):** `inbound_registrations.sql` (per-session rows; other tab cannot unregister; freshness), `inbound_route_attempts.sql` (planner atomicity with two concurrent sessions on one owner; self-exclusion; reservation ceilings; `advance_to_owner_mobile` re-check + D13 mark once; accept/bridge idempotency; `record_inbound_mobile_bridge` never touches `is_missed`/`duration`; leg-end clears busy), `inbound_finalize_d13.sql` (external-answer branch keeps `is_missed=true`; terminal branch unchanged), `inbound_voicemails.sql` (RLS matrix; storage predicate; group snapshot; retention batch), re-runs of the four existing suites and the RLS Phase 1 postconditions.
**Static gates:** `npx tsc --noEmit` exit 0; `tsc -p tsconfig.app.json` multiset-compared to the **81**-error `main` baseline (zero new — baseline results are reported separately from new-behavior tests); `eslint` on touched files; `npm run build`; esbuild bundle per touched Edge function; migration static checks + localhost replay.

---

## 13. Verification matrix (closeout evidence; live rows need Chris's authorized calls)

| Scenario | Proof | Not provable here |
|---|---|---|
| Panel closed/minimized; campaign ended | `deviceLifetime` + live inbound to the same browser | live |
| Other CRM route; background tab | live audible ring on selected outputs; pop-up while hidden; ring UI un-minimizes; **measured 20–25 s** | human audibility |
| Disconnected / expired / asleep | registration stale ⇒ immediate mobile (D13 marked); UI not green | live |
| Availability change / reload / reconnect | DND survives; server routes on DB | live |
| DND incl. after reconnect | no browser, no mobile; owner mailbox | live |
| Assigned contact | owner first; attempt `mode='owner'` | live |
| Browser unanswered | 20 s then mobile; D13 mark + one notification at forward | live |
| Mobile accepted / rejected / machine pickup / **Press 1 after caller hung up** | `accepted`, `no_digit`, machine ⇒ voicemail, `accepted_after_hangup` ⇒ no attribution; D13 never cleared | live (§9 TwiML facts) |
| Mobile bridged, recording on/off | no recording on any leg; duration from parent; `outcome='forwarded_answered'`; still "Missed in AgentFlow" | live |
| **Concurrent calls**: same owner ×2; group wave + owner call; two tabs | second call ⇒ voicemail; reservations serialize; only own tab writes presence | live + SQL concurrency |
| Multiple tabs: close one, keep one | agent stays connected; browser rings the remaining tab | live |
| After hours | same routing; SMS unchanged | live |
| Unknown caller / empty group / ambiguous contact | group wave or shared voicemail; playback from notification without a contact | live + RLS SQL |
| Callback reordering / retries / duplicates | SQL replay tests + controlled redelivery of captured signed callbacks | partial |
| Voicemail upload failure and retry | 503 path; recovery; access | staging |
| **D13 across surfaces** | widget, detail modal, contact history, notification body all show the label and count once; admin and agent views | live + unit |
| Ordinary outbound call | existing snapshot tests + live outbound | live |

Waived/deferred items (reconciliation, unsigned claim probe, earlier live validation) stay **not passed**; nothing here depends on them. Any live test not executed is reported as unproven, never as passed.

---

## 14. Cutover gate, release order, rollback and recovery (G)

**Cutover gate — routing v2 may be enabled for an organization only when all of the following hold (checked by the activation card and re-verified by Chris):**
1. M4–M7 applied and catalog-verified; types regenerated.
2. `twilio-recording-status` (voicemail branch) and `recording-retention-purge` deployed and byte-verified.
3. `twilio-voice-inbound` deployed with **both** engines; org still `legacy`.
4. Frontend released and **observed**: registrations from the org's agents are arriving (`agent_phone_registrations` fresh rows), availability writes work, ringtone test done by at least one agent.
5. Inbound group explicitly configured (1–10), every owner-eligible agent has either a mobile number or has acknowledged voicemail-only; mailbox access verified by the SQL matrix and one live playback.
6. Then flip `routing_engine='v2'` for that org (a settings write, separately approved for production per invariant #28). Legacy-engine orgs are unaffected.

**Rollback / recovery (in this order):**
1. **Flag flip back to `legacy`** — immediate, no deploy; new calls take the old path; the deployed functions still serve `stage=`/`source=voicemail` callbacks for in-flight v2 calls.
2. **Drain before any function-version restore**: wait until `inbound_route_attempts` has no non-terminal rows younger than 15 minutes and `voicemails.status='pending'` is zero (read-only checks); only then may `twilio-voice-inbound` v44 / `twilio-recording-status` v34 be restored — because v44 would treat a `stage=` action POST as a new inbound call (its dispatcher falls through to `handleInitialInbound`) and v34 would store a `source=voicemail` recording into `calls.recording_*`. If the drain cannot complete, keep the new versions deployed with the flag at `legacy`.
3. Migrations are additive; M7 rollback is gated on zero stored voicemails or an export; M6's `finalize_inbound_call_terminal` rollback restores the previous body verbatim from `20260823222805`.
4. Frontend rollback = Vercel redeploy; presence/availability writes are best-effort and idempotent.

---

## 15. Invariant interactions (flagged, not weakened)

| Invariant | Interaction | Resolution |
|---|---|---|
| #30 two answered-ness proofs | attribution added; `is_missed` becomes explicitly monotonic (D13) | narrow wording in §3.3; retraction removed by M6 |
| #30 R13 strict Client identity | PSTN legs never touch the validator/claim | separate handlers; source audit |
| #30 C13 zero browser inbound writes | presence writes go to `agent_phone_registrations` only | audit test unchanged at 6 sites |
| #30 R14 routed persistence before ringing | attempt + `append_call_routed_agents` precede TwiML | suppression path mirrors today |
| #30 5xx retry rule | reconciled per request type | §8.6 |
| #8 sole duration writer | no new writer | SQL tests pin |
| #9 refs | untouched; additive `destroyClientRef` | — |
| #20 profiles protection | no new column; one CHECK; own-row availability writes | — |
| #25 immutable migrations | new files only; `CREATE OR REPLACE` of the finalize function lives in M6 | — |
| #28 read-only production | every apply/deploy/flag flip separately approved; no backfill, no deletes | — |
| RLS gate | §7.7 scope; token not granted | — |
| #31 realProfile | presence, availability, prefs, diagnostics keyed on `realProfile`; View As hides/blocks | — |
| §7 component size | new UI in new files < 200 lines | — |

---

## 16. Proposed rule updates (authored with the change, after approval)
- **AGENT_RULES #32 (new)** — inbound routing v2: provider-owned Device lifetime; `profiles.availability_status` as the only manual availability; per-registration presence (3 min / 45 s); one `inbound_route_attempts` row per call created by the atomic planner before TwiML, stage transitions as CAS; `buildMobileForwardTwiml` cannot record; Press 1 = acceptance, bridge evidence = connection, `answered_by_agent_id` never `agent_id`; **D13**: mobile forward marks missed-in-AgentFlow at the commit and it is never cleared; voicemails in their own bucket/table with mailbox authorization; `routing_engine` cutover/rollback order.
- **AGENT_RULES #30 amendment** — §3.3 text.
- **WORK_LOG** — this revision is logged as a documentation-only entry; implementation, applies, deploys and verification get their own entries.

---

## 17. Remaining approval items (supporting defaults) and gates
P1 direct-line precedence · P2 explicit group only, ≤ 10 · P3 shared-mailbox membership/history access · P4 ineligible owner ⇒ group · P5 mobile ring 20 s · P6 Press 1 only · P7 mobile caller ID · P8 busy ceilings (5 min ringing / 4 h accepted / 4 h calls) · P9 presence 3 min / 45 s · P10 retire legacy routing knobs under v2 · P11 retire per-number overrides except `is_direct_line` · P12 `answered_by_agent_id` · **P13 voicemail retention: separate `voicemail_retention_days` DEFAULT 30 with a 90-day unheard cap (reusing the 7-day recording setting would purge unheard voicemail)** · P14 availability CHECK · P15 `routing_engine` cutover flag · P16 ten-target posture. Plus: `#APPROVE_RLS_CHANGE` for exactly the §7.7 scope (not granted), and the go-ahead to implement.

---

## 18. Limits of this planning session
Twilio docs unreachable (egress); `deno` absent; automated adversarial subagent review blocked by the session limit (resets 2026-09-11 09:20 UTC) — §3.2 and §15 come from direct code reads; no live call, Twilio console or child-leg records; incident attribution remains unproven.
