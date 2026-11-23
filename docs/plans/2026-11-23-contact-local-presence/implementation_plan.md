# Full Contact View · AI Local Presence
November 23, 2026 · Owner Chris Garness · Feature branch `feat/contact-local-presence-20261123`

## Agent experience
A lead, client or recruit with verified unassigned calling and texting numbers opens with **AI Local Presence** selected in **From**. Picking a city/number, or returning to automatic selection, takes one click. Opening the view or switching the dropdown never sends, dials, changes an assignment or changes the agent’s global preference. A manual selection lasts for this contact visit. The saved number field continues to show the actual assignment.

| Contact state | Initial selection and action |
| --- | --- |
| Both channels verified unassigned, ordinary first-use routing available | AI Local Presence. Switch to an available number immediately. |
| Established number on either channel | Show the saved number. Preserve per-channel eligibility and the existing alternate-number confirmation. |
| Different saved numbers | Keep the existing explicit channel distinction and choice. |
| Pending first text, reserved number, history under review, or stale/missing preview | Preserve the existing safeguards. A pending retry must use its original number. |
| Organization with an off/shadow channel | The same automatic UI is available for verified unassigned contacts. Apply existing channel authorization and legacy SMS restrictions. Pin only in modes authorized to do so. Leave ambiguous legacy records and guard-only recovery paths under their existing rules. |

## Delivery checklist

- [x] Locate production and check overlapping work. Vercel release for www.fflagent.com is 666387b06236281a1e61b1d0fc765284bc63cd99. The branch base d85434f635bbf2d4118781e6d254798eef699363 adds release documentation only. It contains the number-label fix. The separate Automations V2 branch is excluded.
- [x] Trace current behavior. Before this change, the header preferred a provisional SMS number and confirmed alternates even before an assignment existed. An explicit one-call or one-text override prevents ordinary first-use assignment. Calls already support an ordinary explicit candidate. A selected first SMS sender that differs from the agency default needs an additional server-supported intent.
- [x] **Contact view.** Distinguish a positively verified unassigned contact from loading, review, reserved, split, and established states. Show the automatic option and keep friendly city/state labels. Selecting a number has no network side effects beyond reads. Reset the visit choice when identity, contact, or assignment changes.
- [x] **Calling.** Use the existing caller ID matcher and organization setting. Prefer eligible agency numbers in the same area code, then the same state, then the normal eligible fallback. Exclude personal, inbound-only, capped and otherwise ineligible numbers from automatic rotation. Honor an explicit eligible manual choice. Recheck the actual caller at call admission. Keep Twilio Voice.js device.connect(), re-entrancy protection, the single call row, statuses and dispositions. A missed call leaves the contact unassigned. A qualifying conversation can establish the number used.
- [x] **Automatic texting.** Route through the existing eligible SMS sender and dispatch checks. Calls and texts can resolve to different eligible numbers before assignment. The UI enables each action independently.
- [x] **Remember a manually selected first SMS sender.** For the first text from a different eligible agency number, the implementation binds the selected number to the request so provider acceptance can establish it. Keep personal senders and deliberate exceptions as single-use choices. Scope the first-use change to this screen. Preserve request ownership, duplicate prevention, reservations, uncertain receipts, existing clients, and concurrency. Refuse a stale first-use choice rather than overwriting a newer assignment. Chris approved the branch implementation on November 23.
- [x] **Frontend verification.** Ran hook and mounted full-contact tests for leads/clients/recruits, separate channel readiness, no writes on open/switch, manual choice, return to auto, city labels, navigation/refresh, View As and concurrent assignment. Checked local geographic and fallback choices, original sender for retries, assigned-contact confirmation, call-row creation, statuses, dispositions, and duplicate prevention. Voice qualification and missed-call rules use the existing database path.
- [x] **First-text backend verification.** Tested the real Edge handler and isolated database with contending sends, personal senders, consent, final rejection, acceptance, uncertain receipts, legacy replay and rollback. All recipients and provider responses were synthetic.
- [x] **Build and review.** Checked root and app TypeScript, scoped lint, tests, browser interactions, Vite and diff. Published the isolated candidate in [draft PR #537](https://github.com/cgarness/agentflow-life-insure/pull/537).
- [ ] **Production rollout.** Requires approval for the exact migration, Edge deployment and primary frontend release listed below. Recheck the live versions before executing.

## Files and sequence
First write this plan. Provide a narrow caller-routing context in `src/contexts/ContactCallerRoutingContext.ts` so opening a contact does not subscribe to call timer updates. Add this isolated branch to the existing deployment exclusion in `vercel.json` before publishing the branch. Initial implementation files: `src/lib/contact-from-number.ts`, `src/hooks/useContactFromNumber.ts`, `src/components/contacts/ContactFromNumberControl.tsx`, `src/components/contacts/FullScreenContactView.tsx`, `src/contexts/TwilioContext.tsx`; existing hook, mounted contact-view, and caller-ID/provider tests under `src/hooks/__tests__`, `src/components/contacts/__tests__`, `src/contexts/__tests__`. Update this checklist and `WORK_LOG.md`. Extend exact files before touching them if inspection requires an additional helper or fixture.

Approved first-SMS branch scope: `src/lib/sms-send/pendingSmsStore.ts`, `src/lib/sms-send/sendManualSms.ts`, `supabase/functions/twilio-sms/index.ts`, `supabase/functions/_shared/sms/readiness.ts` (inspected only), `supabase/functions/_shared/sms/dispatch.ts`, a new migration and rollback, and the sticky-number SQL/Edge/intent suites. Verify live function source and auth settings before preparing any deployment. Preserve organization_id, authorization and RLS. No historical-number backfill or agency-mode change.

## Candidate verification
The final candidate passed 402 focused frontend tests in 21 suites, including 43 mounted Full Contact View cases. Coverage includes leads, clients, recruits, personal and agency choices, voice admission, statuses and dispositions, and immutable first-text retry intent. Six isolated Chromium scenarios passed at 1440 px/light and 390 px/dark with zero page errors or external requests.

Native PostgreSQL passed 15 new first-text scenario groups and 66 existing sticky-number groups. Tests exercised accepted and rejected provider results, owned reservations, cross-key races, late contradictory receipts, grants and rollback/reapply. Deno type checking and 29 Edge unit tests passed. Six integration suites exercised the actual Edge handler with local PostgREST, PostgreSQL and stub Twilio transport. An independent check ran the new request against the captured production handler and verified that the previous version safely rejects it. No live call or text was placed.

Root TypeScript and the Vite build passed. The app-specific type check produced the same 78 baseline diagnostics after normalizing source positions. Scoped ESLint reported zero errors and seven existing warnings. The full repository test suite was not run.

## Review decisions
Chris requested the plan and the start of the isolated build. The first-SMS contract was discovered during inspection. Chris approved branch scope for that work. Actual database and Edge changes and the production frontend require exact release approval. Deploy compatible backend support ahead of the frontend. Roll back the frontend first and respect in-flight SMS requests before reverting backend support.

## Approved first-text implementation
The first manually selected, eligible agency sender on a verified unassigned contact uses a dedicated manual dispatch intent. Capture the selected sender ID, its phone number and the assignment generation with the pending request. Send a first_use object containing sender_id, generation and body. Omitting the top-level body causes old Edge versions to reject this new intent. Ordinary, automatic, personal and already-assigned exceptions retain their existing wire forms. No backfill is needed.

A dedicated service-only prepare and start RPC validate the actor, organization, authorized contact, current assignment, sender and mode under the existing lock. New requests require enforced SMS first-use routing. Voice can share the accepted number only where its existing rules allow. Bind the exact selection to the immutable request; consent and readiness remain checked before a provider handoff. Provider acceptance may establish the reservation. Definitive failure releases an owned reservation when safe; uncertain submissions must retain their original identity and avoid a second handoff.

Exact implementation and verification files for this increment:
- AGENT_RULES.md to document the scoped change to the existing FROM-selection contract
- src/components/contacts/ContactFromNumberControl.tsx for the personal-number confirmation
- src/hooks/useContactFromNumber.ts and src/hooks/__tests__/useContactFromNumber.test.tsx
- src/lib/sms-send/smsSendResult.ts and src/lib/sms-send/__tests__/smsSendResult.test.ts to recognize a server-confirmed, definite first-text rejection
- src/lib/sms-send/pendingSmsStore.ts, src/lib/sms-send/sendManualSms.ts, src/lib/sms-send/__tests__/stickyIntent.test.ts
- src/components/contacts/FullScreenContactView.tsx and src/components/contacts/__tests__/fullScreenContactViewFromNumber.test.tsx
- supabase/functions/twilio-sms/index.ts, supabase/functions/_shared/sms/dispatch.ts, supabase/functions/_shared/sms/affinity.test.ts
- supabase/migrations/20261123170000_contact_first_sms_sender.sql and supabase/ops/contact_first_sms_sender_rollback.sql
- scripts/sticky-numbers/first-sms-tests.mjs, this plan and WORK_LOG.md

Run focused Vitest and the mounted contact view, isolated Deno dispatch tests, native PostgreSQL transaction/replay and rollback tests, root and app TypeScript, scoped lint and Vite build. Check both old/new request formats. Compare the live twilio-sms package, function metadata and database dependencies read-only. Draft code and local tests are authorized. An exact release request will name the migration, full Edge package and frontend.


## Production release and recovery

Candidate code commit [2128bb6](https://github.com/cgarness/agentflow-life-insure/commit/2128bb641afecae1bf45e6a3ce9b3e8b2e04b15b). Approval is pending. No production migration, Edge deployment or frontend rollout took place.

1. Compare the current primary Vercel aliases, Edge version and SQL dependencies with the reviewed baseline. All 17 installed dependency signatures and definitions matched at verification. The captured 15-file production Edge package matched commit `553f89d3a647770a6c722e4ae4ba89b15b2a3b09`.
2. Apply only `supabase/migrations/20261123170000_contact_first_sms_sender.sql` to `jncvvsvckxhqgqvkppmj`. SHA-256 `ec6d9dbdad74e6ac5cbfaa4f135a2fd8f24b6bd744f8c606a94f2694cfd4472a`. Verify service-only grants and run Supabase advisors against the baseline.
3. Deploy the full 15-file candidate package for `twilio-sms`, retaining the v63 setting `verify_jwt=false` and its existing internal authorization. Two package files differ from v63, the endpoint and shared SMS dispatcher. Preserve the existing dispatcher automation option. The SHA-256 of the canonical sorted filename-to-file-digest manifest is `0c38d8460e5eae5a99b2702d9c28c5a862f735afd2154add58d6da746ed5097b` for the candidate and `d142b628bdeed83258933d7ea41f02f6c92029ffd3eab46e16e87ad204f1d0d8` for v63. Verify the deployed files and metadata.
4. Release the candidate frontend to the primary Vercel project `agentflow` after backend verification. Smoke-test an authorized contact read-only. Confirm AI Local Presence for verified unassigned contacts, the saved number for assigned contacts, and the agency and personal choices. Record deployment IDs and alias readbacks.
5. For recovery, restore the previous frontend first. Keep compatible Edge and SQL available for in-flight requests, stale clients and uncertain receipts. After draining/reconciling them, restore the captured v63 package if necessary. Only then consider `supabase/ops/contact_first_sms_sender_rollback.sql` (SHA-256 `9dd302a25c0ec2103303a4f74bd56b2e999a176a96331ef8fc2229783dda7490`), which checks for unfinished work and preserves existing history. Record the exact recovery actions and verification.
