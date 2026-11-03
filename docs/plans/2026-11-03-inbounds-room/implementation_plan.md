# Inbounds room V1 — approved build, production release pending

Chris approved the brighter interactive concept and said “proceed with build” on November 3, 2026. This authorizes branch implementation and local verification. No production SQL, Edge deployment, number reassignment, live test calls or merge is authorized by this build step.

## Product contract

- `/inbounds` opens in a new browser tab from the CRM sidebar, outside the CRM shell. One agency room, maximum ten joined agents. Join, pause, resume and leave are explicit; device disconnect and expired heartbeat make a session ineligible.
- Dedicated Inbounds-only numbers bypass assigned-contact priority and ordinary CRM ringing. Ring every eligible room agent simultaneously; first Twilio-confirmed answer owns the call. No round robin and no mobile forwarding. Unanswered calls use the existing group voicemail pipeline.
- A server session has a unique Twilio identity; normal CRM registrations never receive room calls. Same-agent duplicate room sessions cannot join concurrently. Server occupancy/reservations coordinate room calls and ordinary calls. An accepted room call remains unavailable until its canonical disposition receipt exists, including across refresh/logout/rejoin.
- Collapsible active scripts and dispositions read existing organization settings. No demo data in runtime. Required notes, callbacks, DNC and conversion/policy semantics use existing canonical disposition/sale operations.
- Agents see their own answered calls, disposition counts and missed/voicemail records where they were a recipient. Admin/Super Admin see organization-only room totals, answered/missed, voicemail, disposition counts and agent breakdown. View As is refused. Pending and active calls are separate from missed calls; voicemail is a subset, never added to missed totals. Counts are server aggregates of unique parent call rows, not ringing legs.
- Adopt approved dark navy surfaces, bright white text and green/blue/violet/amber highlights. Mobile stacks the panels. Settings configuration failure blocks join and disposition save; no fake empty/zero success.

## Implementation and intended files

1. Frontend: `src/pages/InboundsPage.tsx`; `src/components/inbounds/*`; `src/hooks/useInboundsRoom.ts`, `useInboundsVoice.ts`; `src/lib/inbounds/*`; `src/App.tsx`; `src/components/layout/Sidebar.tsx`; phone settings integration in `NumberManagementSection.tsx`; `src/lib/caller-id-selection.ts`, `src/contexts/TwilioContext.tsx` for dedicated-number exclusion.
2. Database: a pending migration for room number designation, sessions, immutable call/target snapshots, authenticated session/read RPCs and a service-only planner using existing call-row-first/agent-lock ordering. RLS and grants deny anonymous/cross-agency data. Reuse canonical disposition receipts rather than a browser-only flag. No existing production data rewritten.
3. Telephony: `twilio-token` room identity validation; `twilio-voice-inbound` room routing and frozen target identities; `inbound-call-claim` validates signed room identity against the frozen target; `twilio-voice-webhook` rejects dedicated numbers as outbound caller ID. Preserve JWT/signature validation, single-leg outbound path and canonical duration writers.
4. Tests: focused room state/identity/disposition/settings/render tests; SQL authorization, concurrent reservations, duplicate sessions, cross-tab busy and reload lock tests; legacy inbound/outbound regression suites. Run root TypeScript, application TypeScript comparison, scoped ESLint and production build. Desktop/mobile browser review uses synthetic fixtures isolated from runtime.
5. Documentation: this plan, root `implementation_plan.md`, `WORK_LOG.md`, release/verification record and narrow new invariant in `AGENT_RULES.md`.

## Release gates

Release-check follow-up: correct the stale clock in `src/lib/__tests__/dashboardMissedCalls.test.ts`, after reproducing the identical failure on the clean PR base. Freeze Date to the existing fixture day, restore it after each test, and retain an explicitly expired row to verify the real lookback remains enforced. This changes only test determinism; dashboard queries and runtime behavior stay intact.

Build/review first, feature flag off by default. Before production: approve exact migration plus backend bundle hashes, deploy compatible backend, verify advisors and controlled synthetic behavior, then separately approve frontend release/flag and exact experiment phone numbers. No configuration or build success is evidence that real ringing/audio has been tested.
