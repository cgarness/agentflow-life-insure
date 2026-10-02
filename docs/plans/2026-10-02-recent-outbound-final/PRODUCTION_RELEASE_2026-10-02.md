# Recent-outbound callback routing — production release, October 2, 2026

**LIVE AND ENABLED for the approved agency. Real callback and recipient-playback acceptance remain pending.**

## Released scope and authority

Chris approved the exact release packet for source `1ec9cf8b546837d75215649f3d2783e4426736b1` and then explicitly confirmed Teo and Will were not dialing and instructed execution. This confirmation was treated as a release-specific exception for their two still-refreshing idle sessions and one unchanged stale ringing row. No session or call record was closed, reassigned, reset or otherwise edited to satisfy a gate. Repeated read-only checks found no new calls since 20:02:44.958836 UTC, no unexpected active call rows or other fresh sessions, no active inbound reservations, and no lock waiters before activation.

Branch: `chatgpt/recent-outbound-final-20261002`. Supabase project: `jncvvsvckxhqgqvkppmj`.
Approved organization: `a0000000-0000-0000-0000-000000000001`.
Main was independently at `b630bf0ba5c5b3cb166252ca59ed3284f3e3db2d`; its intervening Reports release record changes did not touch this release's runtime packages. No PR, merge, direct main push or Vercel production deployment was performed.

## Actual production changes

1. Applied `inbound_recent_outbound_routing` once, recorded by Supabase as **20261002203426**. The original SQL is 56,731 bytes; SHA-256 `348205ca4d8c860a04a68a23af840be35f2c2f57ad08d8f6a89262e86b429038`. The migration-history read-back reproduced that checksum. It created the private evidence/configuration objects and extended the existing planner without modifying historical CRM/call rows. Configuration initially remained empty and disabled.
2. Deployed `twilio-voice-status` from the approved package. The first upload, v43, contained two transcription differences: an extra comment in `_shared/notifications.ts` and `dropStartedAt=false` instead of the approved `true` in the backward-status branch of `terminal-guard.ts`. Read-back detected both before activation. The complete approved package was uploaded again as **v44** and every file was verified. This was a corrective re-upload of approved bytes, not a new source-code change or a rollback. No requests to the three monitored telephony functions were observed in the bounded 20:29:00–20:52:44 UTC log query; this is not a guarantee about unobserved activity.
3. Executed the exact approved one-organization activation at **2026-10-02 20:53:25.074188 UTC**. Read-backs at 20:53:51 and 20:57:20 confirmed `enabled=true`, `unanswered_eligible=true`, `did_allowlist=NULL`, and no other organization enabled. Agents were told they could resume dialing after release checks.

Canonical migration filename: `supabase/migrations/20261002203426_inbound_recent_outbound_routing.sql`.
Canonical rollback filename: `supabase/migrations/rollback/20261002203426_inbound_recent_outbound_routing.rollback.sql`.
The authored names use 20260927052736. Filename and executable-reference reconciliation preserves both complete SQL byte streams, including historical authored-name comments. SQL recovery is not the routine kill switch and was not invoked.

## Live functions and source verification

| Function | Live version | Result |
|---|---:|---|
| twilio-voice-status | 44 | Seven approved files; ACTIVE; verify_jwt=false; no import map |
| twilio-voice-inbound | 46 | Existing B1 repair unchanged |
| twilio-recording-status | 37 | Existing B1 repair unchanged |

The v44 entry module is `functions/twilio-voice-status/index.ts`.
Live v44 fingerprint: `af7fcfadcc5832443b7c11022b228a93d8e2b764926eb02609ee4e0014205fe1`.
Approved and read-back payload: 78,634 bytes, SHA-256 `660ee45d31cc8433df0e8c23a8674ddf1c289e10439b7ce99800d05417598f4c`.
Approved and read-back manifest: `3c628153db5147eab3d607c12b0a0bc10eceb0cd83c81decd387efc47545cff2`.

| File (under functions/) | Bytes | SHA-256 |
|---|---:|---|
| _shared/notification-recipients.ts | 16093 | 83ce2be3c56ff16b7e46eb5b10b2faa7fcd6df17d9351af3cbbd38aa2ecef726 |
| _shared/notifications.ts | 7702 | c853f6820058ef277dc2de853403349d8aa302fe654d1f628350f4563d3c172c |
| _shared/twilioOutboundCreds.ts | 1026 | f0e1eacded07d6223a9eb9f8221efd237d2526f07ffb7b5b35ed9c4936b19802 |
| twilio-voice-status/dial-evidence.ts | 20562 | 6e9f30fdddcef5d7831526b71a1fe8471e7a28efefc0c8e625e458fce8d413a1 |
| twilio-voice-status/duration.ts | 1283 | aa13b7474934d9700a48a37fffc08adf700b6c8100604d9c570611c945e470ad |
| twilio-voice-status/index.ts | 23440 | 4b1b16e63093888b6c20fed6a17666d73016dc2de40f2ac580a4cee470b2a668 |
| twilio-voice-status/terminal-guard.ts | 5395 | d7ca4a9d7e47161e1fbc8188d7703184a0d97e05a7ea50017496949d1821038b |

Verification method: the complete actual connector read-back text was copied into separate local files and hashed, because the connector exposed no raw-file binding. The approved source was not used to populate those read-back files. All seven file sizes/hashes and the reconstructed complete payload/manifest matched. Source-byte parity is not a snapshot of floating external dependencies or proof of live provider behavior.

## Database postconditions

| Function | Body MD5 |
|---|---|
| public.plan_inbound_route | 4af4a584ff92cf902c16afef865594e9 |
| private.intended_recipients_for_call | d74672de7b57e65c5fca97015732977a |
| private.recent_outbound_route_candidate | 2ba817a8cb950b43644b0cde248c42ca |
| public.record_outbound_dial_evidence | cc69b1fe2a97765254b9502b6a19d915 |

Owners, security modes, search paths and ACLs matched the approved migration. Both attempt constraints are validated. API roles anon/authenticated/service_role have no USAGE on `private`, no evidence-table SELECT and no configuration-table UPDATE. Only postgres and service_role can execute the public evidence writer. No RLS policy was loosened. No other agency's routing configuration was enabled.

The agency stays on inbound v2 with Auto-Create Leads off, browser ring 20 seconds and mobile ring 20 seconds. Sixteen active agency numbers were found. The test lead retains its original assignment. No caller-ID selection, browser device.connect(), queue lock, disposition, canonical duration or recording-policy change was made.

## Behavior now enabled

The existing direct-line and saved-contact owner routes retain priority. For an unknown, unambiguous caller, the planner may choose the most recent eligible Active same-organization agent with Twilio-verified evidence of dialing that person from the SAME agency number within 168 hours. The committed attempt retains that owner on replay. The owner then follows existing browser/mobile/voicemail and DND/Break/busy rules.

Supported answered and unanswered status pairs qualify. Busy, failed, unsupported, missing and unverified evidence do not. The destination and caller ID must be provider-verified; browser fields cannot qualify a call. Saved-but-unassigned, ambiguous and auto-created callers retain their existing route.

Evidence capture is forward-looking, not a backfill. An immediate callback arriving before evidence capture can take the group route and retain it. Unsaved/non-campaign state is checked at capture time, not reconstructed at dial start. Evidence capture is project-level but tenant-bound; routing activation is only for the approved agency. Capture is best-effort and does not gate the existing webhook response/status/duration/required notification. An already-started database request cannot be recalled by the outer eight-second bound.

## Verification and remaining acceptance

Pre-release exact-head CI run **37037364197** passed the combined release checks: 325 focused tests; candidate 4,122 passed versus baseline 3,890, with the same one failed assertion and 31 skipped/pending; no new failed files, removed assertions or passed-to-failed regressions. The same 12 pre-existing failed suites and application 90-error baseline remain. Real-import Deno checks added no errors (status 10 existing, receiver 2, inbound 2); root tsc checks no application files. These are baseline comparisons, not clean typecheck/full-suite passes.

Isolated PostgreSQL 17.6 tests passed: 22 activation/refusal/idempotency/one-agency recovery checks; full inbound authorization/concurrency/rollback/reapply; generated types and negative controls. Reference-reconciliation checks are recorded separately after execution; they do not retest real production traffic.

At 20:53:51 UTC, evidence and recent-outbound-route counts were zero; no new calls had arrived during maintenance. At 20:57:20, both counts were still zero and one post-activation call existed. Therefore deployment/configuration are verified, but provider evidence capture, actual recent-outbound routing, correct-agent voicemail notification and recipient playback are NOT claimed proven. A quiet period or one unrelated inbound call is not acceptance evidence.

Read-only security advisors ran after migration. Known RLS-disabled `public.app_config` and `public.webhook_debug_log` findings and other existing warnings remain untouched. No clean-security or complete before/after-advisor-delta claim is made.

## Recovery and exclusions

Approved first containment is `supabase/ops/recent_outbound_disable_org.sql`, SHA-256 `839311ac6f19ae52afc4f9e8903b74e1b121e0066b7b8ee69511990595364735`. It disables only this agency's future recent-outbound decisions, preserving evidence and already committed attempts. Approved activation SQL SHA-256 is `6aaf5291ac9cc4bde754d37bbe79ab8df01f8764013fd78d72e962da8341a330`.

If the status handler itself regresses, the guarded approved v42 source recovery has payload `f8276303acf7184f1903f0071a43eda5287161c8f8c9452ecb8efb2b672dc450` and manifest `9d8540cb9d79fabb4bcca9b9db8ab54d740da2db2ec98ef8f44447d3d8aa174f`. Preserve B1 v37/v46 and never overwrite an intervening deployment. Database rollback SHA-256 `7def919c2ed430caa0ee9d26c873a2099562d66a1f7f7244cbe649adaa2d62cd` is preserved, NOT authorized as routine containment, and was not run.

The controlled call, canary, 24-hour capture-only observation and evidence-volume prerequisite were explicitly waived for this fast-track release, not passed. B1 natural individual-agent playback is still pending. No historical recording recovery/deletion, stale-attempt cleanup, secret change, automated monitoring, customer test fixture, contact creation/reassignment, migration rollback or unrelated production mutation occurred. Ordinary product behavior continues; no follow-up job is running while the conversation is inactive.

The release is live from the task branch. A later PR/merge and reconciliation with intervening main changes require separate approval; do not replace main with this older branch tree.

## Filename/reference closeout verification

GitHub run 37065331283 passed the 22 activation/recovery tests, full inbound SQL and rollback proofs, generated types and negative controls on isolated PostgreSQL 17.6 with recorded filenames. The rebuilt status package retains the approved checksum. Root tsc checks no application files; earlier full-suite and application baseline results are not claimed rerun. No production access occurred. An earlier record-only run passed these checks but its push was refused because GITHUB_TOKEN cannot modify workflow files; publication now excludes that file, which is finalized separately through the authorized connector.

## Subsequent natural-traffic evidence — 21:11 UTC

A read-only production check at 2026-10-02 21:11:46.685552 UTC confirmed both activation flags remain true, all otherwise-eligible agency numbers remain in scope, and no other organization is enabled. One normal outbound call has now completed and produced one provider-verified `answered` evidence row classified `contact`. That saved-contact context is correctly ineligible for the new unsaved-caller tier. There are still zero recent-outbound routing attempts. One normal inbound call also completed.

The bounded logs queried from 20:53:25 through 21:11:47 UTC returned four HTTP requests for the relevant functions, all 200 (one inbound-handler v46 and three status-handler v44). The same sample contained one dial-evidence log and no matched 403, 5xx or error events. These are results of the particular log query and window, not a universal error-free claim. The stored evidence confirms the deployed capture path can verify and persist a real outbound call; it does not prove unanswered capture or actual unsaved-number callback routing. Individual-agent voicemail storage/access/playback remain awaiting appropriate natural traffic and recipient confirmation.

Performance advisors were also read after deployment. Existing index and RLS performance recommendations were not modified. No complete before/after advisor delta was established.
