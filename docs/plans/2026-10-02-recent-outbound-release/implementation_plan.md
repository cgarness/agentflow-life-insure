# Recent-outbound callback routing: final integration and release

Status: implementation/verification preparation; NOT installed or activated in production.
Request: Chris asked ChatGPT to complete the existing task directly, not hand it back to Claude.

## Pinned inputs
- main: 5fc4649f45a323c1ddc0863ffb4ec7fd0bb3f326
- Task A: efa815144f893fafa43960f177a67ec90f92e4e1 (base 5d37e5f98dc16b08d11359b1506153aac014b25a)
- B1 source: 02b8ba5c91def63ebfe7670c33a4981dc452037b (base d675a4b11d6f05f1cdf39414d274439358d1b877)
- B1 deployment audit: c7e1fb24cc1526b224293725c5a3bc4e6aa06042

## Scope and authorization boundaries
Finish the previously implemented Task A, preserving current main and the deployed B1 repair. This preparation may run only isolated synthetic checks. No main push/merge, production SQL, deploy, controlled call, test-lead reassignment, historical recording action, or cleanup is authorized by the verification job. The exact production package and operations return to Chris for approval under AGENT_RULES #28. Requested fast-track waivers are not represented as passed checks.

A dedicated branch-only GitHub verification job addresses this ChatGPT container's unavailable repository/dependency network access. It has no production credentials or deployment commands. It may commit the tested integration and append the complete WORK_LOG on this branch only, with a fresh exact-parent guard. No existing workflow changes; no PR or main write.

## File list before application edits
Reuse B1's exact four function-source files, its five affected/new tests, and its two packaging files. Reuse Task A's exact migration/rollback, two voice-status files, two existing ops files, SQL fixture/test files, four test files, generated types and five test/type scripts. Shared files are integrated once. Specifically:
- supabase/functions/twilio-voice-inbound/{planner,stages}.ts (B1 unchanged)
- supabase/functions/twilio-recording-status/{index,idempotency}.ts (B1 unchanged)
- supabase/functions/twilio-voice-status/{index,dial-evidence}.ts (Task A unchanged)
- supabase/migrations/20260927052736_inbound_recent_outbound_routing.sql (unchanged)
- supabase/migrations/rollback/20260927052736_inbound_recent_outbound_routing.rollback.sql (unchanged)
- supabase/ops/recent_outbound_{enable_org,disable}.sql (historical operations retained unchanged)
- supabase/tests/{inbound_v2_harness,inbound_recent_outbound}.sql
- scripts/{edge_payload.mjs,run_inbound_sql_tests.sh,run_recent_outbound_rollback_test.sh,verify_inbound_generated_types.sh,verify_inbound_generated_types_negative.sh}
- scripts/verify_inbound_generated_types/emit_check.mjs
- src/integrations/supabase/types.ts (3-way integration; never replace newer main additions)
- src/lib/__tests__/{edgePayloadVerification,inboundStages,inboundV2Twiml,voicemailRecordingPipeline,voicemailOwnershipRecovery,voicemailCallbackContract,outboundDialEvidence,twilioVoiceStatusHandler,voiceStatusConvergence}.test.ts
- WORK_LOG.md (prepend; all previous main bytes preserved)
- docs/plans/2026-09-30-agent-voicemail-callback-repair/implementation_plan.md (carry forward with an explicit status correction, not erase history)
Additional release-specific files:
- docs/plans/2026-10-02-recent-outbound-release/implementation_plan.md (this file)
- .github/workflows/recent-outbound-release-verify.yml (branch-only synthetic verification, no production secrets)
- supabase/ops/recent_outbound_activate_home_org.sql (guarded both-outcome activation; not executed in production)
- supabase/ops/recent_outbound_disable_home_org.sql (one-org kill switch; not the historical global disable)
Root implementation_plan.md and AGENT_RULES.md remain untouched; proposed rule amendments and release waivers remain for exact approval.

## Integration
Apply source diffs from the pinned bases rather than overwriting current files. Preserve B1's new agent URL and all group/legacy/signature tests. Append Task A's recent-outbound-owner tests to B1's stage suite, changing only their callback URL assertions to mailbox=agent&mailbox_agent_id=<uuid>. Fail on any other conflict or unlisted path. Verify all B1 function bytes still match its approved package hashes and all Task A production-source bytes match its original commit.

## Requested final behavior
Direct-line owner, then saved-contact owner, then most recent eligible unsaved/non-campaign outbound agent from the same organization number within 168 hours, otherwise existing group. Answered and supported unanswered pairs are requested; busy, failed, absent/unverified evidence never qualify. Existing DND/Break/busy/browser/mobile/voicemail flow and attribution remain unchanged. No backfill; calls before evidence capture may retain group routing. No new outbound architecture, credential source, claim write or canonical duration writer.

## Verification
Synthetic PostgreSQL 17.6 on 127.0.0.1 only: existing inbound, voicemail, recent-outbound, concurrency, rollback, generated-type and negative-control suites. Execute new one-org operations on synthetic fixtures, including idempotence, unrelated-org preservation, disallowed preimage and unconfigured/missing-schema denial. Fresh focused and full Vitest comparison against pinned main; required root tsc plus meaningful app check; exact Deno imports with baseline error comparison; complete package build/verify. Nonzero baselines are not clean passes, missing/empty reports cannot pass, no production connection is used to unblock a check.

## Production sequence (separate exact approval)
Fresh live code/schema and call-free checks; proven current v42 status recovery; unchanged migration in one transaction; postconditions/ACL/advisors; complete voice-status package deploy with verify_jwt=false; full source readback; approved one-org activation. Keep inbound v46 and recording-status v37 unchanged. First recovery is the home-org disable; committed attempts keep their owner, evidence/history retained. Any broader rollback needs its own applicable approval and compatibility checks. Production runtime success is separate from deployment success; no automatic monitoring is implied.

## Current production evidence
Read-only 2026-10-02 15:24:48 UTC: no active calls/fresh sessions/ringing attempts; Task A absent; expected M6 planner and intended-recipient hashes; home organization on v2 and auto-create off. B1 has one observed group success but zero new agent voicemails; agent storage/playback are unverified, not failed and not passed. Do not replay an outdated B1 function while releasing Task A.
