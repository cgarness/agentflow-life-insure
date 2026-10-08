# Incoming call forwarding verification

October 8, 2026. Isolated implementation approved by Chris at 12:26 PDT. After reviewing the completed fix and separate release requirement, Chris confirmed Alexa found the save button and instructed continuation at 13:39 PDT; publication and deployment of this reviewed inbound bundle are authorized. The runtime fix is deployed as inbound v48; source closeout is recorded in PR #431. Base main is `d70fc6d14624ac001b4c68fad20eb979a9d9e06d`; branch is `codex/inbound-forwarding-20261008`.

## Alexa save investigation

Production read-only inspection identifies Alexa Segura as an Active Agent in the expected organization, with no `agent_inbound_settings` row. The settings table has authenticated SELECT/INSERT/UPDATE grants and the expected self-and-organization RLS policies. The guard rejects agency-owned forwarding destinations to prevent loops. None of these reads independently proves an authenticated write will succeed.

The inspected log window is October 7 at 12:30 PDT through October 8 at 12:30 PDT. Alexa's own production browser GET at October 8, 12:25:08 PDT succeeded with HTTP 200 and an empty result. No forwarding write request or forwarding-related database rejection appears in that window. No session, phone number, configuration or data was changed to test her account.

The UI uses a separate **Save call forwarding** button. **Save Preferences** writes profile preferences and does not save the forwarding section. Standard formatted US numbers are supported. Invalid input produces inline validation before any request; missing organization context also returns before a request. Neither condition is established for Alexa. At 13:39 PDT, Chris confirmed Alexa found the forwarding save control. The reported save issue is resolved by that clarification; no UI or account-setting patch is needed. An authenticated save was not independently exercised in this session.

## Implemented change

When a verified owner-browser wave cannot persist routed targets or resolves no usable identity, the handler now calls the existing `advance_to_owner_mobile` transition. Both this failure and an unanswered browser Dial share one result handler. SQL continues to decide current forwarding eligibility, Break/DND/busy exclusions, parent-call liveness, reservation, destination snapshot and missed-call classification.

Known results log `wave_suppressed` for browser-preparation failure, keeping real `dial_action` provider evidence separate. Unknown-commit failure retains its previous mark/converge/voicemail order without an added telemetry RPC. Group routing, outbound dialing, mobile recording policy, signatures and frontend code are unchanged. Replays may re-emit a persisted destination, without making another reservation; tests do not claim that replayed TwiML never contains a Number noun.

## Production bundle reconciliation

Read back `twilio-voice-inbound` v47, ACTIVE, `verify_jwt=false`, bundle fingerprint `996586e697d143b2285319c722a5c6d8a817896224bf547609dee17092d6dac9`. The deployed planner/stage voicemail callback repair was absent from main and is retained verbatim in this candidate. Of ten bundled source files, nine candidate files match production exactly; only `stages.ts` changes relative to live. See `bundle-manifest.json` for source-byte hashes. Temporary extraction files contained one extra newline; hashes remove exactly that extraction-only byte.

The live SQL planner's recent-outbound ownership tier and all routing SQL remain unchanged. No migration is required. A release must retrieve and compare the current full bundle again; any newer drift requires reconciliation before deployment. Never replace the callback repair with older main code.

## Verification

- All 17 inbound Vitest suites pass: **267 tests**, including 22 new forwarding fallback cases.
- Existing forwarding form/profile suites pass: **21 tests**. These mock persistence and do not prove Alexa can save in her browser.
- Independent review found no remaining defects and independently passed **71 tests** across four focused suites.
- Deno 2.1.4 type-checks both modified Edge modules and their local imports. `--no-lock` was necessary because the repository lockfile is version 5, unsupported by that deployed runtime version; these checked modules have no remote dependencies. No lockfile was changed.
- `npx tsc --noEmit` passes. The meaningful application TypeScript comparison remains **85 baseline / 85 candidate / zero new diagnostics**; the final comparison is recorded before commit.
- Scoped ESLint and `git diff --check` pass.

Coverage includes browser preparation failures, ordinary online and offline paths, canonical refusal shapes, parent ended/claimed/stage conflicts, persisted-snapshot replay, group behavior, callback identity and encoding, no mobile recording, request deadline and late-result suppression, browser lifecycle/ownership writes and existing inbound telemetry contracts.

No hosted save, live call, audio, production deployment or production write was used as a substitute for local verification. No fresh native database suite was required because no SQL, policy or schema changed; handler tests use inspected live RPC result contracts rather than reimplementing SQL eligibility.

## Completed runtime release

- [PR #431](https://github.com/cgarness/agentflow-life-insure/pull/431) publishes implementation head `7bafcd708f9a1a2d0133dcab4a54aae22df586d3`, with tree `e6b3b71c3032f3c26cbd832f5226c026df41e439` identical to the reviewed local source.
- All five workflows passed on that head: Dialer DNC `37841728906`, Reporting integrity `37841728595`, SMS consent `37841728558`, A2P `37841728775`, Reports frontend `37841728586`. Both Vercel previews passed. Full frontend comparison: 4,323 candidate tests passed versus 4,301 baseline, unchanged existing failed tests/files and 85 app diagnostics, zero unhandled errors; root TypeScript, scoped lint, Reports tests and production build passed.
- Immediately before deployment, main remained `d70fc6d14624ac001b4c68fad20eb979a9d9e06d`; every live v47 source and its configuration still matched the reviewed baseline. No overlapping incoming-call PR was found.
- Deployed complete ten-file package at **2026-10-08T20:56:08.733Z**: **v48**, **ACTIVE**, `verify_jwt=false`, fingerprint `a0a459768b340096c36f119baeff08de7028fa3e7f5e218daddd5a19c79b6b62`. Immediate retrieval matched **all ten candidate files byte-for-byte**. Signature validation remains unchanged. Only stages differs from the pre-release live bundle.
- The recovery package was parsed using the same JSON file structure accepted by the deployment tool; its exact set of ten names and SHA-256 source hashes equals the pre-release live baseline. Recovery JSON SHA-256: `0aa2c26c67678684cc2ccc8a184036bccb09a2dd10af065fa4e60c9fd11ce185`.
- This closeout changes documentation only after the successful implementation-head gates. Final source-merge metadata is recorded on PR #431.

## Verification limits

A controlled real-call check remains outstanding: an owner-authorized caller should verify browser miss → mobile → AgentFlow voicemail and Break/DND/another-call exclusions. This release did not place a live call or fabricate audio proof. No SQL, agent setting, historical record or provider callback configuration was changed.
