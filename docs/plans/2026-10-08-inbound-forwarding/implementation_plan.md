# AgentFlow incoming call forwarding implementation plan

Date: October 8, 2026. Status: Chris approved isolated implementation at 12:26 PDT, with Alexa’s save issue investigated first. Chris authorized continuing the reviewed publication and production release at 13:39 PDT after confirming Alexa found the forwarding save control.

## Confirmed behavior

| Agent state | Call Forwarding on with saved number | Call Forwarding off |
| --- | --- | --- |
| Available and connected | AgentFlow rings for 20 seconds, then mobile if unanswered | AgentFlow rings, then AgentFlow voicemail |
| Offline or browser disconnected | Mobile directly | AgentFlow voicemail |
| On Break | AgentFlow voicemail | AgentFlow voicemail |
| Do Not Disturb | AgentFlow voicemail | AgentFlow voicemail |
| Already on another call | AgentFlow voicemail | AgentFlow voicemail |

An unanswered mobile call continues to AgentFlow voicemail. Preserve the existing mobile acceptance prompt, 20-second mobile timeout, no mobile audio recording, and missed-in-AgentFlow classification. Unassigned callers retain the existing inbound-group routing.

## What the live inspection established

Production project: AGENTFLOW CRM / jncvvsvckxhqgqvkppmj. The agency uses v2 routing, with 20-second browser and mobile settings.

The normal production owner route already implements the confirmed policy. Online status does not prevent mobile forwarding after an unanswered browser call. The database rereads the forwarding toggle and rechecks Break, DND and other-call occupancy before reserving mobile.

Current enabled, configured agents are Chris Garness and Teo Hampton. Alexa Segura, Desiree Montgomery, Erik Flowers, Keenyun Williams and Will Harrison have no enabled forwarding configuration. No toggle was changed.

In the seven-day inspection window:
- Four online-owner browser calls reached the mobile decision and were refused as no_mobile; all four belonged to Will.
- Three offline-owner calls had no mobile configuration: one each for Will, Keenyun and Teo. Teo's event preceded his current forwarding setting update.
- Seven owner calls were classified busy by the routing engine. This establishes the decision taken, not independent proof of actual provider occupancy.
- One owner call reached the mobile stage.
- Group calls are a separate route and do not cascade to individual agents' mobiles.

A concrete additional gap exists in live inbound v47: if preparation of an owner's browser ring fails because routed-agent persistence returns false or no usable browser identity resolves, stages.ts sends the call directly to owner voicemail. It never tries the existing guarded mobile transition. The reviewed records do not establish that this branch caused the reported incidents; it is a code-confirmed gap in the requested fallback behavior.

## Proposed change

In clientDialOrVoicemail, only for a verified owner_browser attempt whose browser wave could not be prepared, call the existing advance_to_owner_mobile RPC before selecting voicemail. Reuse the normal owner-browser return decision logic rather than adding separate toggle or presence rules.

Emit a mobile Dial only after the database confirms the atomic transition and destination snapshot. Preserve all current parent-call, ownership, tenant, availability, busy and duplicate protections. A missing/uncertain commit must not trigger an untracked mobile call. Group failures remain group voicemail.

Record the browser-preparation failure and forwarding result using the existing provider-outcome mechanism. Do not add explanatory UI copy, new controls, browser-side call-row writes, automatic setting changes, historical data repair or routing-policy expansion.

## Files expected to change

- supabase/functions/twilio-voice-inbound/stages.ts: owner browser-preparation fallback and shared transition use.
- src/lib/__tests__/inboundForwardingFallback.test.ts: new focused handler regression tests.
- src/lib/__tests__/inboundStages.test.ts: existing policy matrix updates only if needed.
- docs/plans/2026-10-08-inbound-forwarding/implementation_plan.md: approved plan and verification record.
- WORK_LOG.md: newest-first implementation and release status.
- AGENT_RULES.md: proposed narrow clarification of the owner-browser failure fallback if implementation establishes a new invariant.
- supabase/functions/twilio-voice-inbound/planner.ts only if repository reconciliation is needed to preserve the existing live voicemail callback repair.

No database migration or RLS change is presently needed. No TwilioContext.tsx edit is planned; its inbound ownership/finalization boundaries and re-entrancy guards were inspected and must remain intact.

## Live and repository reconciliation

The inspected live v47 contains a voicemail callback repair in planner.ts/stages.ts: agent mailbox callbacks use mailbox=agent plus mailbox_agent_id. The inspected main source did not contain that repair. Reconcile current source before building and preserve the complete live repair; never redeploy an older main bundle over it.

Live plan_inbound_route includes the recent-outbound owner tier. Preserve it; do not replace the function with historical M6 SQL. Historical documents describing v2 as inactive are superseded by the Work Log activation record and live reads.

No open PR identified in the current open-PR inventory is an inbound forwarding implementation. Recheck concurrent changes before editing or releasing.

## Verification and release

Use synthetic local fixtures to exercise the real handler:
1. Online miss and offline owner both forward when enabled.
2. Browser persistence failure and missing identity invoke guarded mobile advancement.
3. Break, DND, actual other-call occupancy, disabled toggle and missing number do not forward.
4. Toggle-off or availability changes during browser ringing are honored at transition time.
5. Same-call occupancy does not block itself; another reserved call remains protected.
6. Browser already answered, caller ended, duplicate callbacks and uncertain database outcomes cannot create an extra mobile dial.
7. Group behavior, live voicemail callback encoding, no mobile recording and monotonic missed classification remain correct.
8. Verify call record creation, status handling, dispositions and logs remain unaffected by the inbound-only change.

Run focused existing inbound suites, Edge type checks, npx tsc --noEmit and the meaningful npx tsc -p tsconfig.app.json --noEmit comparison against current main. Preserve known baseline errors and report new diagnostics accurately.

After implementation review, obtain the exact production release approval required by AGENT_RULES.md. Retrieve the live function again, compare all files, preserve verify_jwt=false and custom Twilio signature validation, deploy the complete reviewed inbound bundle, and read it back byte-for-byte. Use the captured compatible live bundle as the recovery reference. Do not change provider callback configuration, schema, agent settings or historical records. Controlled live verification uses an owner-authorized test caller and confirms browser → mobile → AgentFlow voicemail plus the three exclusions.

## Copyable execution prompt

```text
BUGFIX: AgentFlow missed incoming call forwarding

Repo: cgarness/agentflow-life-insure
Production: jncvvsvckxhqgqvkppmj

Read AGENT_RULES.md, VISION.md and WORK_LOG.md, checking newest entries for concurrent work. Read the October 8 incoming-call implementation plan. Create/update docs/plans/2026-10-08-inbound-forwarding/implementation_plan.md and list exact files before edits. Wait for Chris's explicit approval of the plan before modifying application files or executing backend mutations; read-only diagnosis is allowed.

Implement the smallest owner-browser preparation fallback described in the plan. Reuse advance_to_owner_mobile and existing result handling. Forward only with an enabled saved number and confirmed server transition; On Break, DND and another call always exclude forwarding. Online/offline alone must not exclude an otherwise eligible owner. Preserve group behavior.

Read current TwilioContext.tsx, current live inbound function, callback helpers and live SQL before changing anything. Preserve v47's voicemail callback encoding repair, the live recent-outbound owner tier, organization_id scoping, RLS, signed callback binding, idempotency, canonical duration, atomic reservations, server-owned inbound telemetry and all re-entrancy guards. Keep outbound device.connect() single-leg WebRTC unchanged. No frontend service-role keys, secrets or production mock data. Use maybeSingle() where zero rows are possible, Zod for any forms and Tailwind only; no UI work is expected. Schema changes require a new migration and separate approval.

Run the focused handler and inbound regression matrix, Edge checks, npx tsc --noEmit and a meaningful app TypeScript baseline comparison. Append a newest-first WORK_LOG.md entry. Do not push main, merge, deploy, change production settings or run live calls without the relevant explicit approval. Retrieve and preserve full live Edge contents and verify_jwt before a separately approved complete-bundle release.

End with changes, decisions, tests, migrations/deploys, blockers and next steps. Distinguish the observed no_mobile settings cases from the browser-preparation code gap; do not claim the latter caused the incidents without evidence.
```

Suggested model: a coding model with high reasoning effort and repository/Supabase access.


## October 8 approval and Alexa investigation

Chris approved this implementation and asked to investigate Alexa Segura’s forwarding save first. Read-only checks confirm she has no settings row; her own settings GET succeeded at 19:25:08 UTC with an empty result. The inspected 24-hour logs contain no forwarding write request. Existing self-scoped INSERT/SELECT/UPDATE grants and RLS are present; this does not prove a real save succeeds. The UI has separate Save call forwarding and Save Preferences controls. No Alexa-specific failure is confirmed without the clicked control, attempted value, or visible validation/toast. Her settings remain unchanged, and no UI patch is included speculatively.

## Implementation status

The approved isolated implementation is complete. See verification.md for 267 inbound tests, 21 forwarding/profile tests, independent review, TypeScript results, live-bundle reconciliation and release limits. Chris subsequently confirmed Alexa found the separate save button; no UI or account-setting change is needed. The complete reviewed bundle was deployed as inbound v48 and all ten files read back exactly; see verification.md and PR #431 for the release record. Source closeout changes documentation only.
