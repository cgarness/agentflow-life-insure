# Google data deletion and backup verification — implementation proposal

Prepared September 22, 2026 for Christopher Garness. **Design only; no deletion, migration, deployment or backup change has been executed.** The approved work covers preparing this plan. Implementation requires review of its exact scope and the outstanding production inventory below.

## Verified evidence and limits

- Local baseline is `03bae62870c24a336801a7ff6faee46b8ce69269`; public Git read on September 22 confirmed main still at that commit and no `codex/google-production-readiness` branch. The prepared OAuth code is local only.
- `src/lib/supabase-users.ts` currently soft-deletes a profile by setting `status='Deleted'` and `availability_status='Offline'`, optionally after contact reassignment. This function does not revoke Auth sessions, clear Google credentials or erase email history. Do not represent this path as verified offboarding or data deletion.
- The Google build protects credential/cursor persistence with connection generations. That alone does not establish a deletion barrier for every derived write: inbound notifications and outbound history/activity inserts are separate operations, and Calendar writes require separate review.
- GitHub and Supabase MCP calls recovered after the September 22 HTTP 400 failures. The organization subscription is verified as **Pro**. A read-only live column/FK inventory confirmed the existing email/state/cursor fields and notification `event_key`; the proposed source-mailbox/generation/Calendar-org columns are not yet deployed. Actual backup retention remains **unverified**; subscription defaults do not establish the project's configured recovery window or off-site copies.
- Live FK inspection confirms that removing an email connection would set `contact_emails.connection_id` to NULL and cascade its sync cursors. Removing a profile would cascade its email connections, messages and OAuth states. Notifications and activities do not have a message FK, so deleting a message cannot be assumed to erase those copies. There were no FKs targeting appointments in the inspected catalog; polymorphic references and trigger-driven dependencies still need their own review.

## Proposed scope and data inventory

First implement a verified, operator-run **Gmail data deletion request** with a mandatory dry-run and an independently approved execution. It must not become a generic agency wipe or delete anything in the user's Google mailbox. Calendar data deletion, departing-agent access removal and workspace closure/export need the additional inventories below before implementation.

| Data | Local source evidence | Required treatment |
| --- | --- | --- |
| `user_email_connections` | OAuth and email consumers | Match organization, user and Google provider. Stop sync, rotate generation, clear credentials and pending work before deletion. Preserve enough non-secret identity to prevent stale restoration. |
| `email_oauth_states`, `email_sync_cursors` | Expansion migration and shared OAuth lifecycle | Cancel the selected user's relevant pending state/cursor records. Do not affect another user's authorization. |
| `contact_emails` | Email send/sync handlers | Scope by organization + `owner_user_id` + provider + verified source mailbox, including history detached from `connection_id` after an account switch. Legacy source ambiguity is a manual-review blocker, never permission for a broad delete. |
| `notifications` | `insertInboundEmailNotifications`, `inboundEmailEventKey` | Match the selected message IDs through `event_key='inbound_email:<id>'` and organization. These notifications may belong to leadership recipients. Erase their subject/body snippets as part of the covered data; legacy rows without provenance require review. |
| `activity_logs` | Email-send activity insert | Select only attributable Google email activities using organization, user and metadata. Current metadata lacks a per-message ID; add future provenance and review legacy records without deleting unrelated agency audit history. |
| `calendar_integrations`, `appointments` | Calendar consumers | Inventory separately. Google imports can overwrite fields of linked appointments; `sync_source='external'` alone does not prove a record was originally created by Google. Preserve unrelated CRM appointments and do not delete Google events as a side effect of local erasure. |
| Storage, logs, exports and backups | Not established by inspected email handlers | Inspect bucket metadata, all active writers/processors, application logs, manual dumps, replicas, provider copies and export destinations. No absence claim without checking them. |

Before implementing SQL, perform read-only catalog inspection for these tables' columns, constraints, foreign keys, triggers, grants and RLS, plus dependencies referencing them. Query counts/provenance completeness only; do not retrieve private message bodies or credential values. Record the exact resolved dependencies in this plan before adding any additional table to a deletion operation.

## Proposed files for Gmail deletion only

| File | Change proposed for separate implementation approval |
| --- | --- |
| CLI-generated migration named `google_data_deletion_requests` (timestamp generated when implementation starts) | Add request/audit metadata, a persistent mailbox deletion barrier and service-only bounded inventory/erase operations. Extend the existing guarded message/cursor lifecycle where necessary. Do not edit previously applied migrations. |
| `scripts/delete-google-mailbox-data.ts` (new) | Dry-run by default; require verified request ID, exact project, org, user, mailbox, reviewed manifest and explicit execution flag. Return counts/status only. |
| `supabase/functions/_shared/google-data-lifecycle.ts` (new) | Shared active-user and deletion-barrier checks for server consumers; no browser credentials. |
| `supabase/functions/_shared/google-oauth.ts` | Reject new connection completion while a covered deletion is in progress; deliberate reconnect after completion is a new consent event. |
| `supabase/functions/email-connect-start/index.ts`, `email-connect-callback/index.ts`, `email-disconnect/index.ts` | Wire any required lifecycle context through the existing wrappers; preserve ordinary disconnect/history-retention behavior. |
| `supabase/functions/email-sync-incremental/index.ts` | Make notification creation respect the same barrier as message persistence, including delayed workers and retries. |
| `supabase/functions/email-send-contact-message/index.ts` | Guard send initiation and subsequent history/activity persistence; attach exact message provenance. An already dispatched Google send cannot be recalled. |
| `supabase/tests/google_data_deletion.test.ts` (new), `supabase/tests/google_oauth_fixture.sql` | Synthetic multi-tenant SQL tests, idempotency, provenance and stale-work races. |
| `supabase/functions/_shared/google-consumers.test.ts`, `google-endpoints.test.ts` | Exercise delayed send/sync/notification operations across the deletion barrier and rejected reconnect. |
| `docs/google-data-deletion-plan.md`, `docs/google-oauth-production.md`, `implementation_plan.md`, `WORK_LOG.md` | Record reviewed scope, operator procedure, verification evidence and limitations. |

Request/audit and barrier table names, exact columns and FK behavior must be finalized after catalog inspection. No runnable deletion SQL is supplied by this planning document. The existing broad `wipe_organization_operational_data` function is not an acceptable substitute.

## Request and completion contract

1. Verify the requester's identity and authority, exact agency/user/mailbox, covered data and any specific retention obligation. Agency ownership does not automatically authorize disclosure of another agent's private mailbox data.
2. Record the received/verified dates, deadline and owner. Use the approved target of 30 calendar days after verification, sooner where required. Record any hold with its reason, exact coverage and next review; do not silently extend a deadline.
3. Stop the affected integration and establish a durable barrier checked at every persistence point. Invalidate pending OAuth state and stale connection generations. Shared Google-grant revocation affects Calendar too and must be disclosed and reconciled.
4. Generate a bounded manifest with counts, row identities, provenance gaps and dependency effects. Obtain approval of this concrete operation. Store the manifest securely outside chat and avoid subjects, bodies, tokens or unnecessary addresses in audit output.
5. Execute in idempotent bounded transactions, verify zero covered live rows and no delayed reinsertion, and record failures honestly. Preserve unrelated clients, calls, policies, agency records and other users' copies.
6. Confirm live deletion separately from backup expiry. Keep a minimal restricted deletion ledger that survives restoration; before reopening access or restarting sync after a restore, replay completed erasure requests against restored data. Do not claim completion of all copies while backup evidence is missing.

## Backup evidence required

Read-only verification for Supabase project `jncvvsvckxhqgqvkppmj` must capture the actual daily-backup/PITR mode, configured retention and available recovery window. Separately inventory manual/off-site dumps, replicas, Storage objects and exports. Record who controls each copy and its expiry mechanism. The approved target is expiry within 30 days **after live deletion**; a 30-day live-deletion deadline and backup retention are separate clocks.

[Supabase's backup documentation](https://supabase.com/docs/guides/platform/backups) describes plan-dependent daily retention and PITR, but it does not prove this project's settings. It also states that database backups contain Storage metadata, not the stored objects themselves. The currently exposed connector has no backup-list operation; authenticated Dashboard or an already authorized Management API session is needed for that evidence. Do not request passwords or paste access tokens into chat.

## Separate follow-ups before policy publication

- **Departing agent:** inspect every authenticated access path, session invalidation, profile status checks and both Google integrations. A profile status change or removal of refresh sessions alone must not be claimed to invalidate all existing JWTs. Produce the exact endpoint/RLS/UI change list before implementation; existing user-management files are inspection targets, not authorization to redesign all account access.
- **Calendar deletion:** resolve source provenance and appointment dependencies, then propose exact fields/records to erase and barrier changes in both Calendar workers. Test preservation of manually created shared agency appointments.
- **Agency closure/export:** inventory all tenant tables, linked objects and processors; design the 30-day export window, recipient authorization, export expiry and explicit-request override. No full-workspace export/deletion scope is approved by the Gmail proposal.
- **Acceptance:** use two synthetic agencies and multiple mailboxes; prove cross-tenant isolation, account-switch history coverage, notifications to other recipients, retry safety, stale-worker rejection, reconnect behavior, partial revocation failure and restoration-ledger replay. A local fixture test is not a production backup restore test.

Keep draft legal publication disabled until the actual operation and backup handling support the final promises. Approval of this proposal would authorize implementation only in an isolated review branch; production execution, real deletion and paid services remain separate actions.
