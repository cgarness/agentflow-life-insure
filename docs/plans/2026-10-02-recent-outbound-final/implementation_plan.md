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

## Exact integration file list — recorded before source edits

- `.github/workflows/recent-outbound-release-verify.yml`
- `WORK_LOG.md`
- `docs/plans/2026-09-30-agent-voicemail-callback-repair/implementation_plan.md`
- `docs/plans/2026-10-02-recent-outbound-final/implementation_plan.md`
- `scripts/edge_payload.mjs`
- `scripts/prepare_recent_outbound_release.py`
- `scripts/run_inbound_sql_tests.sh`
- `scripts/run_recent_outbound_activation_tests.sh`
- `scripts/run_recent_outbound_rollback_test.sh`
- `scripts/verify_inbound_generated_types.sh`
- `scripts/verify_inbound_generated_types/emit_check.mjs`
- `scripts/verify_inbound_generated_types_negative.sh`
- `scripts/verify_recent_outbound_release.py`
- `src/integrations/supabase/types.ts`
- `src/lib/__tests__/edgePayloadVerification.test.ts`
- `src/lib/__tests__/inboundStages.test.ts`
- `src/lib/__tests__/inboundV2Twiml.test.ts`
- `src/lib/__tests__/outboundDialEvidence.test.ts`
- `src/lib/__tests__/twilioVoiceStatusHandler.test.ts`
- `src/lib/__tests__/voiceStatusConvergence.test.ts`
- `src/lib/__tests__/voicemailCallbackContract.test.ts`
- `src/lib/__tests__/voicemailOwnershipRecovery.test.ts`
- `src/lib/__tests__/voicemailRecordingPipeline.test.ts`
- `supabase/functions/twilio-recording-status/idempotency.ts`
- `supabase/functions/twilio-recording-status/index.ts`
- `supabase/functions/twilio-voice-inbound/planner.ts`
- `supabase/functions/twilio-voice-inbound/stages.ts`
- `supabase/functions/twilio-voice-status/dial-evidence.ts`
- `supabase/functions/twilio-voice-status/index.ts`
- `supabase/migrations/20260927052736_inbound_recent_outbound_routing.sql`
- `supabase/migrations/rollback/20260927052736_inbound_recent_outbound_routing.rollback.sql`
- `supabase/ops/recent_outbound_disable.sql`
- `supabase/ops/recent_outbound_disable_org.sql`
- `supabase/ops/recent_outbound_enable_complete.sql`
- `supabase/ops/recent_outbound_enable_org.sql`
- `supabase/tests/inbound_recent_outbound.sql`
- `supabase/tests/inbound_v2_harness.sql`

Only the pinned source deltas, test reconciliation, one-org ops, verification infrastructure and additive records change. No production action.

## Integration result

Pinned source deltas reconciled; B1 and Task A runtime files retain exact source parity. Verification and production acceptance are still pending.

## Final verification — production approval still pending

{
  "baseline": "e04eb16dc6fc70734f85868ab5235186d0ce4813",
  "workflow_run": "37037364197",
  "checked_at": "2026-10-02T17:06:37.101841+00:00",
  "verification": {
    "base_root_tsc_exit": 0,
    "base_app_tsc": {
      "exit": 2,
      "diagnostics": 90
    },
    "candidate_root_tsc_exit": 0,
    "candidate_app_tsc": {
      "exit": 2,
      "diagnostics": 90
    },
    "new_app_errors": [],
    "focused": {
      "numTotalTests": 325,
      "numPassedTests": 325,
      "numFailedTests": 0,
      "numPendingTests": 0
    },
    "base_full": {
      "exit": 1,
      "numTotalTests": 3922,
      "numPassedTests": 3890,
      "numFailedTests": 1,
      "numPendingTests": 31
    },
    "candidate_full": {
      "exit": 1,
      "numTotalTests": 4154,
      "numPassedTests": 4122,
      "numFailedTests": 1,
      "numPendingTests": 31
    },
    "removed_assertions": [],
    "passed_assertion_regressions": [],
    "new_failed_assertions": [],
    "new_failed_files": [],
    "baseline_failed_files": [
      "src/components/contacts/__tests__/addLeadAssignmentGate.test.ts",
      "src/hooks/__tests__/dialerCampaignPresenceHook.test.ts",
      "src/lib/__tests__/clientMapping.test.ts",
      "src/lib/__tests__/contactName.test.ts",
      "src/lib/__tests__/contactScope.test.ts",
      "src/lib/__tests__/leadDisposition.test.ts",
      "src/lib/__tests__/recordingRetentionVoicemail.test.ts",
      "src/lib/__tests__/userLocalDayBounds.test.ts",
      "src/lib/caller-id-selection.test.ts",
      "src/lib/control-center/runtimeEventLogger.test.ts",
      "src/lib/custom-fields-settings.test.ts",
      "src/lib/dialer-api-attempt-cap.test.ts"
    ],
    "deno": {
      "twilio-voice-status": {
        "base": {
          "exit": 1,
          "diagnostics": 10
        },
        "candidate": {
          "exit": 1,
          "diagnostics": 10
        },
        "new_errors": []
      },
      "twilio-recording-status": {
        "base": {
          "exit": 1,
          "diagnostics": 2
        },
        "candidate": {
          "exit": 1,
          "diagnostics": 2
        },
        "new_errors": []
      },
      "twilio-voice-inbound": {
        "base": {
          "exit": 1,
          "diagnostics": 2
        },
        "candidate": {
          "exit": 1,
          "diagnostics": 2
        },
        "new_errors": []
      }
    },
    "packages": {
      "twilio-voice-status": {
        "payload_sha256": "660ee45d31cc8433df0e8c23a8674ddf1c289e10439b7ce99800d05417598f4c",
        "payload_bytes": 78634,
        "manifest_sha256": "3c628153db5147eab3d607c12b0a0bc10eceb0cd83c81decd387efc47545cff2",
        "files": [
          {
            "name": "functions/_shared/notification-recipients.ts",
            "bytes": 16093,
            "sha256": "83ce2be3c56ff16b7e46eb5b10b2faa7fcd6df17d9351af3cbbd38aa2ecef726"
          },
          {
            "name": "functions/_shared/notifications.ts",
            "bytes": 7702,
            "sha256": "c853f6820058ef277dc2de853403349d8aa302fe654d1f628350f4563d3c172c"
          },
          {
            "name": "functions/_shared/twilioOutboundCreds.ts",
            "bytes": 1026,
            "sha256": "f0e1eacded07d6223a9eb9f8221efd237d2526f07ffb7b5b35ed9c4936b19802"
          },
          {
            "name": "functions/twilio-voice-status/dial-evidence.ts",
            "bytes": 20562,
            "sha256": "6e9f30fdddcef5d7831526b71a1fe8471e7a28efefc0c8e625e458fce8d413a1"
          },
          {
            "name": "functions/twilio-voice-status/duration.ts",
            "bytes": 1283,
            "sha256": "aa13b7474934d9700a48a37fffc08adf700b6c8100604d9c570611c945e470ad"
          },
          {
            "name": "functions/twilio-voice-status/index.ts",
            "bytes": 23440,
            "sha256": "4b1b16e63093888b6c20fed6a17666d73016dc2de40f2ac580a4cee470b2a668"
          },
          {
            "name": "functions/twilio-voice-status/terminal-guard.ts",
            "bytes": 5395,
            "sha256": "d7ca4a9d7e47161e1fbc8188d7703184a0d97e05a7ea50017496949d1821038b"
          }
        ]
      },
      "twilio-recording-status": {
        "payload_sha256": "5b33d169f431db89b64993c75c32dce31715e8e05ac4bf26487aab3ed30efc92",
        "payload_bytes": 59398,
        "manifest_sha256": "125a3cd85b8d6cf562903fc88565e3000a1bab8e5c2b6328b5a073f2b2fbd81a",
        "files": [
          {
            "name": "functions/twilio-recording-status/idempotency.ts",
            "bytes": 23270,
            "sha256": "e8e55385180f11f58253fb84a0b6819dcaace2518129e4cc71e902682f3e44ce"
          },
          {
            "name": "functions/twilio-recording-status/index.ts",
            "bytes": 34091,
            "sha256": "03e7a05bd46b24e86ace236264f7ff3cd049e5f0c745be3a802886186719d7f1"
          }
        ]
      },
      "twilio-voice-inbound": {
        "payload_sha256": "31d1cf5ab0cc87281d01c8ac8339343f50a2bc076f0e0d7365c94a85e3da45e1",
        "payload_bytes": 214531,
        "manifest_sha256": "22c56d17063660705f8edae0e47a172bb740925b274617c420991e461b0d42f3",
        "files": [
          {
            "name": "functions/_shared/notification-recipients.ts",
            "bytes": 16093,
            "sha256": "83ce2be3c56ff16b7e46eb5b10b2faa7fcd6df17d9351af3cbbd38aa2ecef726"
          },
          {
            "name": "functions/_shared/notifications.ts",
            "bytes": 7702,
            "sha256": "c853f6820058ef277dc2de853403349d8aa302fe654d1f628350f4563d3c172c"
          },
          {
            "name": "functions/twilio-voice-inbound/failure.ts",
            "bytes": 5388,
            "sha256": "7555787d8fa86bdfce997851951ab67fbdcdafe3e5109fc8156dcfb1ae3aae40"
          },
          {
            "name": "functions/twilio-voice-inbound/index.ts",
            "bytes": 62220,
            "sha256": "a7fe08178a2b7ca995af09d94d702f6d89ab0bb79d7298e605d1cf767b4bbcf1"
          },
          {
            "name": "functions/twilio-voice-inbound/planner.ts",
            "bytes": 15564,
            "sha256": "9659164e7f0cdb618c88fb9a539847fc9843b9889a9d4c4fb3ca48d213ac22ee"
          },
          {
            "name": "functions/twilio-voice-inbound/request.ts",
            "bytes": 23464,
            "sha256": "3df94b4567fe28b69fcbec23f48bc28a866a9313e393179a845c4d88eb98fba1"
          },
          {
            "name": "functions/twilio-voice-inbound/routing.ts",
            "bytes": 6007,
            "sha256": "da1724c407bcaef17bd52ae29f26aec2d17e8a175d88cebe4efb0a83cd207627"
          },
          {
            "name": "functions/twilio-voice-inbound/settings.ts",
            "bytes": 29373,
            "sha256": "a1b47ad960cea5193555d2aaf5eb2220cf7bd532f3ad39f73bc1afe7e619fdab"
          },
          {
            "name": "functions/twilio-voice-inbound/stages.ts",
            "bytes": 30328,
            "sha256": "8f4ab0f3b07cc1a3701c05d985f388bfd80b721b28acb6d662cea5eaaf72ae58"
          },
          {
            "name": "functions/twilio-voice-inbound/twiml.ts",
            "bytes": 11101,
            "sha256": "87afd997166bb48d23a1b2113082014bb3b0b537305f0a567430a5d21dca4f80"
          }
        ]
      }
    },
    "failures": [],
    "result": "no_new_regressions"
  },
  "sql_sha256": {
    "supabase/migrations/20260927052736_inbound_recent_outbound_routing.sql": "348205ca4d8c860a04a68a23af840be35f2c2f57ad08d8f6a89262e86b429038",
    "supabase/migrations/rollback/20260927052736_inbound_recent_outbound_routing.rollback.sql": "7def919c2ed430caa0ee9d26c873a2099562d66a1f7f7244cbe649adaa2d62cd",
    "supabase/ops/recent_outbound_enable_complete.sql": "6aaf5291ac9cc4bde754d37bbe79ab8df01f8764013fd78d72e962da8341a330",
    "supabase/ops/recent_outbound_disable_org.sql": "839311ac6f19ae52afc4f9e8903b74e1b121e0066b7b8ee69511990595364735"
  },
  "production": "NOT APPLIED, DEPLOYED OR ACTIVATED"
}

