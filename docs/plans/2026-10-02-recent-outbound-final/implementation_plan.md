# Recent-outbound callback routing — final integration and release preparation

## Status and authority — 2026-10-02

Chris asked ChatGPT to complete Task A directly, then said Continue after an interrupted turn. This continues the previously requested integration and verification work; it is not a new telephony design. Local/isolated branch preparation, verification and preserving the existing implementations are in scope. Production SQL, the exact Edge package deployment, activation and release-gate waivers still require the final exact approval under AGENT_RULES #28. No production mutation, PR, main merge, controlled call, historical recovery, or cleanup is performed by this plan's verification workflow.

Read before preparation: current AGENT_RULES.md (including #28–#32 and workflow protocol), VISION.md, current WORK_LOG.md, Task A plan and work log, B1 Phase 2 plan and deployment record. Source-only verification does not prove runtime behavior.

## Pinned inputs

- Current main at preparation: `e04eb16dc6fc70734f85868ab5235186d0ce4813` (Reports policy/privacy release). Preserve its complete history and changes.
- Task A: `efa815144f893fafa43960f177a67ec90f92e4e1`, base `5d37e5f98dc16b08d11359b1506153aac014b25a`.
- B1 Phase 2 executable source: `02b8ba5c91def63ebfe7670c33a4981dc452037b`, base `d675a4b11d6f05f1cdf39414d274439358d1b877`.
- B1 production audit: `c7e1fb24cc1526b224293725c5a3bc4e6aa06042` (audit-message-only; its WORK_LOG/plan files remain stale).
- Live deployment last confirmed: recording-status v37, inbound v46, voice-status v42. Do not redeploy or replace B1 while preparing Task A.

Read-only database check 2026-10-02 16:26:38 UTC: PostgreSQL 17.6; Task A private tables absent; planner preimage `a3f59ba5a8d35ed98300d6f1dab38295`; recipient function preimage `7104284f7aa79c8d1ef270eb0fe82de2`; zero recent nonterminal calls, fresh dialer sessions, ringing attempts and lock waiters. One group voicemail stored since B1; no agent voicemail observed in that sample. These checks expire and must be repeated before any separately approved release.

## First preparation files (listed before editing)

1. This `implementation_plan.md`.
2. `.github/workflows/recent-outbound-release-verify.yml` — branch-only, isolated GitHub-hosted verification/source-artifact job, contents read-only, no production credentials and no deploy commands. This is necessary because the ChatGPT runtime cannot resolve github.com to clone the repo. It is not a production network-policy bypass. Source bundle and dependency artifacts contain no injected credentials.

The existing Task A and B1 file lists remain the intended source scope. Before integration writes, list their exact union and any narrowly necessary activation/test files here. Do not replace current full files with older branch copies when they have intervening changes. No frontend behavior change is planned; generated type additions are reconciled with current main.

## Required integration

1. Preserve main, copy/apply only the reviewed B1 and Task A deltas on this isolated branch. Keep package helper changes only once.
2. Keep B1 agent callback form `mailbox=agent&mailbox_agent_id=<uuid>` and valid legacy/group compatibility; signatures unchanged.
3. Reconcile Task A S6 tests with the repaired callback and valid UUID fixtures. Prove the recent-outbound owner remains the voicemail recipient.
4. Prepare a separate guarded one-org activation operation that explicitly sets `enabled=true`, `unanswered_eligible=true`, `did_allowlist=NULL` for `a0000000-0000-0000-0000-000000000001`. The old enable script leaves unanswered eligibility false and must not be described as a complete activation.
5. Prepare an exact one-org disable/recovery procedure. Keep the migration unchanged unless a concrete verified defect requires another explicit decision.
6. Update actual WORK_LOG.md newest-first, preserving every previous byte; do not substitute an empty-tree audit commit for the file update. Reconcile B1's deployed status in documentation without making a passed agent-playback claim.

## Behavior to preserve

Direct-line owner, then saved contact owner, then most recent eligible provider-verified unsaved/non-campaign dialer using the same organization DID within 168 hours, then the existing group. Existing browser/mobile/DND/Break/busy/voicemail behavior remains. Only supported answered and unanswered status pairs qualify. No busy/failed/unverified fallback, no historical backfill or lead assignment changes. Immediate callbacks may arrive before evidence; the committed group decision then stays on replay. Preserve organization_id, RLS, device.connect(), re-entrancy guards, canonical duration, dispositions, queues, caller-ID and recording policy.

## Verification

- Isolated synthetic PostgreSQL 17.6 with explicit localhost-only connection: inbound SQL, permission, concurrency, rollback/reapply and generated-type suites. No production tests.
- Affected B1/Task A tests plus same-base full Vitest comparison. Preserve known baseline failures, distinguish no-new-errors from clean passes.
- `npx tsc --noEmit` and meaningful app typecheck; root empty-project exit 0 is not an app pass.
- Exact Deno/import comparison and complete package closure/hash generation.
- Activation guards/idempotency, other-org preservation, disable, answered/unanswered behavior.
- Fresh source/live preimages and complete v42 recovery before a later approved deployment. Read-back every deployed file; advisors after approved security/database changes.

## Final release decision, not yet executed

Return the tested source commit, exact migration/hash and recovery, complete voice-status package/hash, exact activation/disable SQL and residual risks. Chris's requested fast-track waivers (no controlled call, no 24-hour evidence wait, no canary) must be explicit in the final approval, not represented as tests passed. B1 recipient playback remains unverified without evidence. Apply only after exact approval; preserve the already-deployed B1 functions. No automatic monitoring is installed.
