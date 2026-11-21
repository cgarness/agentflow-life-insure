# Automatic setup for purchased agency numbers

After an admin confirms a purchase, AgentFlow should link the number to the agency and finish eligible texting setup in the background. The admin can close Settings immediately.

| Step | Behavior | Acceptance check |
|---|---|---|
| 1. Purchase | The completed purchase records two setup tasks in the same transaction. | Replaying the receipt creates one agency phone number and one task per setup step. The worker has no purchase operation. |
| 2. Link the number | Trust Hub assignment uses a provider-confirmed agency profile on the account that owns the number. | An approved profile links automatically. A suspended agency waits. Conflicting ownership receives a review status. |
| 3. Register SMS | An eligible US local number joins its agency's approved campaign and Messaging Service. | Approval that arrives later resumes the task. A pending or interrupted attachment cannot authorize sending. |
| 4. Enable texting | Signed number registration and a matching provider membership make the number eligible for the agency's active sending policy. | Manual and workflow sends enforce the same receipt and registration checks. Existing senders keep working, including while a new number is waiting. |
| 5. Show the result | Phone Numbers shows voice, Trust Hub and SMS status separately. | A successful purchase stays on the Phone Numbers tab. Staff see an actionable exception, and eligible setup retries never purchase a number. |

## Product decisions

- Start with new purchases after activation. Existing active senders keep their current configuration.
- Track voice and SMS independently. Toll-free SMS keeps its separate verification requirement. An Inbounds-only number stays excluded from outbound texting.
- Preserve the original Twilio owner, pricing confirmation, per-agency scope, approved routing and single-leg voice calling. Setup should not move a number between accounts or messaging services.
- Signed registration can arrive before or after the provider membership snapshot. Honor both orders and append a newly eligible agency sender once to the enabled consent policy. Preserve an admin's subsequent removal and the existing consent and opt-out checks.
- Use the verified brand, Twilio account and Messaging Service to identify the tenant's US texting campaign. Twilio uses the same US compliance resource identifier within each Messaging Service. [Twilio resource reference](https://www.twilio.com/docs/messaging/api/usapptoperson-resource)

## Verification

The review branch is based on sticky-number PR #531 at `99ca1eb0588b89870c65c8c2d348e239e876f59e`. It includes that branch's phone and SMS behavior in the tested source.

| Check | Result |
|---|---|
| PostgreSQL 17.6 | 131 existing purchase assertions and 63 new setup assertions passed. Separate workers claimed independent tasks. Two SMS tasks in the same agency serialized. The 12 existing contention scenarios passed. |
| Sticky-number compatibility | All 66 existing database regressions passed with the new schema and activation installed on a synthetic database. |
| Phone UI | A real Chromium browser at 1440 and 390 pixels verified purchase confirmation, lost-response recovery, status polling through SMS ready and clearing stale status after an agency switch. The fixture recorded zero external requests. |
| Sender behavior | Simulated provider and database responses exercised four live dispatch implementations across 32 cases, including pending registration, suspension and absent or disabled sending policy. |
| Existing dispatch and routing | Five integration suites passed on real localhost PostgREST 12.2.3 and PostgreSQL 17.6 with synthetic provider traffic. Exact sender ownership, consent, replay and confirmation dispatch were exercised on the combined schema. |

Historical shared-account Trust Hub profiles can be linked manually only if their agency ownership can be verified from a server-recorded profile or the agency's Twilio brand. An ambiguous historical profile requires support review. Existing numbers already linked are outside the new-purchase queue.

## Release checklist

Run the existing number-purchase, voice-routing and consent regression checks alongside the new SQL, worker and UI tests. The database fixture uses disposable PostgreSQL and synthetic tenants. Provider tests simulate configuration, signed events and transient failures. Exact run results belong in the implementation record.

1. Before any release, compare production migration history, function versions, complete module contents, JWT settings, current frontend and any updates to sticky-number PR #531. The current production frontend includes sticky changes on a branch ahead of main. Preserve those changes in the actual release candidate.
2. Install the compatibility migrations with new-purchase capture disabled. The separate activation file lives under `supabase/migrations/pending/`. Keep the existing purchase and send services operational while adopting these new reads.
3. Release the complete approved Edge bundles for manual texting, workflows, consent dispatch, the ClearPath alert, registration, Trust Hub and the reconciler with their current JWT settings. Preserve the sticky-specific files in the deployed bundles. Verify they can read the new database contracts and that the minute scheduler is processing.
4. Release the reviewed frontend against those contracts. Enable capture only once the exact backend and frontend are verified and Chris approves production activation.
5. Validate using the next authorized purchase, or a separately approved controlled test. Verify agency ownership, a single receipt, signed registration, pool membership, policy selection and the visible status. Real purchases and customer texts require explicit authorization.

To pause rollout, stop enrollment of additional purchases first. Retain existing receipts and keep the send guards in place for numbers already enrolled. Re-read provider state before resuming an uncertain operation. Once multiple valid agencies store the shared compliance identifier, restoring the former global uniqueness constraint would conflict with valid registrations. Preserve their agency-scoped registrations during recovery.
