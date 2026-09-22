# AgentFlow Google integration — review and rollout

Owner decisions confirmed September 22, 2026: **Christopher Garness** operates AgentFlow personally (Chris Garness for everyday communications). Disconnecting Gmail stops future syncing and clears saved connection credentials; imported email history remains unless deleted separately. Chris also approved the following operating targets. These decisions supersede identity and retention/deletion approval items below; implementation, backup verification and other final policy terms remain release gates.

| Event | Approved decision |
| --- | --- |
| Verified deletion request | Delete the covered data within 30 calendar days, sooner where required, and confirm completion. Verify the requester and scope. |
| Agent leaves agency | Remove their access and stop their Google integrations; handle personal Google-data deletion separately from shared agency client records. |
| Agency closes workspace | Offer a 30-day export window, then delete its data unless a specific retention obligation applies. An explicit deletion request does not wait through that window. |
| Backup expiry | Target expiry within 30 days **after live-system deletion**; verify actual retention across all backup copies before making a published guarantee. |

These are approved business decisions, not proof of completed deletion/export/offboarding features. Keep `legalPublication.approved=false`. Before implementing broader deletion/account-closure behavior, inventory the affected tables, storage, activities, notifications and backups and produce an exact implementation plan under the existing workflow. Do not execute deletions, alter backup settings or expand production access based on this policy approval.

Status: implementation prepared on `codex/google-production-readiness`; **not deployed, not Google-verified, not ready to publish legal text**. Chris approved Builds 1–2 and a draft PR only. No production migration, secret change, credential conversion, merge/deploy, live email send, new test user, Google submission or paid assessment is authorized by that approval.

September 22 recovery: GitHub and Supabase connector reads succeeded again after the earlier HTTP 400 failures. [Draft PR #378](https://github.com/cgarness/agentflow-life-insure/pull/378) is published, open and unmerged. All 47 original uploaded file blobs and the remote Git tree were verified identical to the tested local build. All 61 backend and 6 UI checks, root TypeScript and diff checks passed. Shell Git authentication remains unavailable; publication uses the connected GitHub API. Draft publication is not approval to merge or deploy.

The next deletion proposal and remaining backup evidence are recorded in `docs/google-data-deletion-plan.md`. The local user-deletion path only soft-deletes the profile; it is not proof of stopped Google access or erased history.

**Hosted database backup check — September 22, 2026:** after Chris completed dashboard sign-in, the production project's [Scheduled backups page](https://supabase.com/dashboard/project/jncvvsvckxhqgqvkppmj/database/backups/scheduled) showed seven physical daily backups dated September 15–21 (UTC), latest September 21 at 10:21:20 UTC. The [Point in time page](https://supabase.com/dashboard/project/jncvvsvckxhqgqvkppmj/database/backups/pitr) displayed an offer to enable the add-on, confirming PITR is not enabled. The dashboard states Storage objects are excluded. This verifies the available hosted database backup window, not the expiry of every off-site/exported copy or a successful restore. No setting was changed, add-on purchased or restore started.

## What changed

- Public `/privacy` and `/terms` routes, real footer links, homepage Google explanation and disclosures beside the connection controls. Draft notices explicitly identify unfinished operator/retention terms.
- OAuth validates the signed-in AgentFlow user, exact return origin, atomically claimed state, expiry, current organization, required permissions and verified Google account identity. Competing callbacks cannot overwrite a newer connection. Existing refresh credentials are retained only for the same stable Google account ID.
- Google credentials use AES-256-GCM with random nonces, versioned keys and associated data binding the credential to integration, user and token type. Invalid encrypted envelopes never fall back to plaintext. This protects credential storage, not imported message bodies from authorized agency access.
- Server-only credential reads are explicitly owner/organization scoped. Database browser roles retain only approved metadata columns and existing RLS; they cannot read credentials or write connection/state/cursor tables. Privileges, not the UI select list, enforce this boundary.
- Generation-guarded refresh, state completion, message persistence and cursor writes prevent stale work from restoring a disconnected connection. An external request already dispatched can still finish; this is not a distributed cancellation guarantee.
- Message uniqueness includes organization, owner, provider and source mailbox. Account switching resets cursors and preserves the old source identity on history. Historical source backfill uses the connection identity available today; it cannot reconstruct unrecorded account switches from before this release.
- Single-integration disconnect clears local credentials and stops that integration. Explicit **Remove Google access** clears both Gmail and Calendar and requests revocation. If Google revocation fails or no saved token remains, the UI directs the user to Google Account connections. Imported history is not deleted by either action.
- Gmail permission failures/revoked grants request reconnect; quota/transient failures do not falsely revoke connections. Failed message retrieval/persistence does not advance the sync cursor. Calendar uses compatible encrypted-token readers and server access.

## Known environment and Google settings

| Item | Confirmed / planned value |
| --- | --- |
| Repository | `cgarness/agentflow-life-insure` |
| Baseline | `03bae62870c24a336801a7ff6faee46b8ce69269` |
| Supabase project | `jncvvsvckxhqgqvkppmj` |
| Frontend | `https://www.fflagent.com` |
| Google project | Number `87346168200`, display name **My First Project** |
| OAuth client | **AgentFlow Web** — preserve; do not delete the separate older client |
| Audience from owner screenshots | External, Testing; publishing disabled pending Branding |
| Support/developer contact | Existing `cgarness.ffl@gmail.com` |
| Application homepage | `https://www.fflagent.com/` |
| Proposed policy URLs | `https://www.fflagent.com/privacy`, `https://www.fflagent.com/terms`; publish approved versions before using in Google Branding |
| Owned domain to verify/add | `fflagent.com` |
| Existing callback domain | Preserve `jncvvsvckxhqgqvkppmj.supabase.co`; do not claim ownership of Supabase's domain |

Preserve both authorized redirect URIs exactly:

```text
https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/google-oauth-callback
https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/email-connect-callback
```

Confirm the running `GOOGLE_CLIENT_ID` belongs to **AgentFlow Web** without printing client secrets. Confirm Gmail API and Google Calendar API are enabled in that same project. Server-based authorization does not require adding JavaScript origins just to fix Branding. No authenticated Google Console session is established here; the owner screenshots are evidence, not proof of later changes.

### Requested permissions

| Scope | Purpose |
| --- | --- |
| `openid`, `email`, `profile` | Identify the connected Google account |
| `gmail.send` | User-initiated email from the connected Gmail account |
| `gmail.readonly` | Retrieve mailbox content for CRM history/contact matching, including unmatched messages |
| `calendar.events` | Optional appointment/event synchronization |
| `calendar.calendarlist.readonly` | List calendars for the user's selection |

API scopes above use the `https://www.googleapis.com/auth/` prefix. Existing broad Calendar grants remain readable, but new requests use the narrower pair. Changing the requested scope list does not retroactively remove an existing Google grant.

`gmail.send` is sensitive; `gmail.readonly` is restricted. Server storage of Gmail content puts this design on Google's restricted-scope verification/security-assessment path unless Google confirms an exception. Publishing the app is not the same as verification; warnings and caps can remain. No assessor or paid service is commissioned by this change.

Primary references: [Google Branding](https://support.google.com/cloud/answer/15549049), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), [revocation](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke), [Google data policy](https://developers.google.com/terms/api-services-user-data-policy).

## Release gates

1. Chris confirms the legal operator name, accurate provider disclosures, retention periods, deletion handling and backup obligations. Review the Limited Use/no advertising/no model-training commitments against actual application use. Finalize commercial/legal terms; do not simply hide the draft banner. Set `legalPublication.approved` only with approved final copy and an effective date.
2. Review this diff, the migration preconditions and exact deployment manifest. Obtain separate production authorization. Regenerate/validate database types from the approved schema when a staging environment is available; frontend code here uses existing metadata fields only.
3. Verify public routes and connection controls visually on desktop/mobile in an accessible preview. The local remote-browser attempt was blocked; component tests are not a visual substitute.
4. Stage and test the complete Edge package with native remote Deno imports in a non-production Supabase environment. Local checking used the installed Supabase JS package and a test-only `serve` adapter because remote module hosts were unavailable here.
5. Perform the staged rollout below, confirm advisors and catalog privileges, then an explicitly authorized real-account smoke test. Do not add users just to satisfy a test.
6. Publish approved pages, verify `fflagent.com` ownership in Search Console, complete Google Branding/Data Access, and submit the approved demonstration/scopes. Record Google's actual decisions. Production publishing, Google review and any assessment require their own owner actions/approval.

## Exact backend review manifest

Migrations (ordered, **not a single unattended `db push`**):

1. `supabase/migrations/20260921224443_google_oauth_production.sql` — schema expansion, service-only lifecycle/message/conversion RPCs, additional mailbox uniqueness key.
2. `supabase/migrations/20260921230744_google_oauth_credential_lockdown.sql` — after compatible functions are active: backfill remaining Calendar organization IDs, require non-null IDs, remove old cross-mailbox unique constraint, revoke browser grants and restore metadata-only SELECT.
3. `supabase/migrations/20260922055909_google_data_deletion_requests.sql` — while still in maintenance: service-only Gmail erasure ledger, write barriers/provenance, active-profile checks and guarded outbound-history/notification RPCs. This schema change itself erases no mailbox data. Do not resume new Gmail handlers before it is applied.

Every function in this list must be retrieved from live Supabase before deployment, compared with the review tree, and deployed as a **complete package**, preserving unrelated live changes. Importing a shared module does not update already-deployed function bundles.

```text
email-connect-start
email-connect-callback
email-disconnect
email-send-contact-message
email-sync-incremental
google-oauth-start
google-oauth-callback
google-calendar-status
google-calendar-configure
google-calendar-list
google-calendar-disconnect
google-calendar-sync-appointment
google-calendar-inbound-sync
```

Shared runtime files: `_shared/google-token.ts`, `_shared/google-oauth.ts`, `_shared/google-data-lifecycle.ts`. Email notification event keys are now constructed by the guarded SQL RPC. Include every actual transitive dependency in the fetched/deployed package, not test files. Keep `verify_jwt=false`; handlers verify user JWTs or the existing cron secret themselves. No cron schedule change is included.

### Preconditions and rollout order

No commands below have been executed against production.

1. Confirm project, current deployment versions, migration ledger, actual constraints/column types and safe backup/PITR coverage. Check for orphaned Calendar rows, uniqueness anomalies and explicit/inherited grants. Resolve unexpected schema/data differences before applying anything. Preserve known existing credentials and encryption keys in approved secrets infrastructure; never export them to chat or a review artifact.
2. Arrange a short Google-integration maintenance window. Avoid new connects/reconnects/sends during the coordinated transition and separately approve pausing/resuming the existing Gmail/Calendar jobs by their exact inspected identifiers. Existing callbacks spanning an old/new deployment may need to restart. Do not promise zero downtime or deploy one callback alone.
3. Set the temporary compatibility configuration securely: `GOOGLE_TOKEN_ALLOW_LEGACY_READ=true`, `GOOGLE_TOKEN_WRITE_FORMAT=legacy`. Generate a cryptographically random 32-byte key in the approved secret manager. Store JSON key ring `GOOGLE_TOKEN_KEYS` (key ID → standard-base64 key) and `GOOGLE_TOKEN_KEY_ID=primary`. No `VITE_` prefix. Keep the existing Google client ID/secret pair and callback secrets.
4. Apply **only expansion migration 20260921224443**. Old uniqueness and privileges remain temporarily. Do not leave this stage open longer than needed. If an automatic pipeline applies both migrations together, stop and adjust the deployment plan first.
5. Deploy/retrieve-and-verify **all 13** compatible functions while Google operations remain blocked. They read legacy and encrypted values but still write legacy during this brief window. Calendar reads now use service credentials and explicit owner/org filters. New Gmail handlers depend on migration 3 below; do not resume traffic or claim functional checks before all schema steps are complete. Rehearse the complete sequence in staging first.
6. Apply **lockdown migration 20260921230744**, then **Gmail deletion migration 20260922055909**, while still in maintenance. Execute `supabase/tests/google_oauth_access.sql` read-only catalog assertions and actual scoped synthetic-role checks in staging. Confirm owner/Agent/Admin/Team Leader/Super Admin/anonymous browser clients cannot read tokens, state or cursors or call service-only RPCs; intended metadata still works. Verify guarded Gmail persistence and two-session deletion races. Do not run the synthetic fixture in production. No mailbox deletion is performed by applying these schemas.
7. Set `GOOGLE_TOKEN_WRITE_FORMAT=encrypted` (or remove the override; encrypted is default), retaining legacy reads. Verify every deployed consumer now writes/reads authenticated envelopes before conversion. Keep the key ring available to all consumers.
8. Run the reviewed conversion script in **dry-run** with target pinning and securely supplied environment. Approve its aggregate counts before an `--apply` run. The script reads secrets only inside the trusted operator process and compares generation plus old token fields atomically in a service-only RPC body; it does not put tokens in URL filters or logs. Re-run after concurrent changes; zero failures/concurrent changes and no remaining legacy values are required. This is a legacy converter, not a key-rotation tool.
9. Disable legacy reads (`GOOGLE_TOKEN_ALLOW_LEGACY_READ=false`) only after counts and every runtime path are verified. Resume approved jobs, monitor safe status/error metadata, and run Supabase security/performance advisors. Reconnect Chris's existing `needs_reconnect` mailbox only with his authorized consent; encryption cannot revive a revoked grant.
10. Release the frontend only after legal approval, backend readiness and the separately approved merge/deploy. Retain old decryption keys until all values have been deliberately re-encrypted and checked; deleting a key early breaks connections.

Conversion command shape (operator must supply secrets privately; **not executed here**):

```bash
# Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_TOKEN_KEYS,
# GOOGLE_TOKEN_KEY_ID, GOOGLE_TOKEN_ALLOW_LEGACY_READ=true,
# GOOGLE_TOKEN_MIGRATION_APPROVED_HOST=jncvvsvckxhqgqvkppmj.supabase.co
# GOOGLE_TOKEN_WRITE_FORMAT must not be legacy in this operator process.
deno run --allow-env --allow-net scripts/migrate-google-tokens.ts
# Separate approval of dry-run results and the exact target is required:
deno run --allow-env --allow-net scripts/migrate-google-tokens.ts --apply
```

For local-only OAuth development, explicitly set `GOOGLE_OAUTH_APP_ORIGIN=http://localhost:5173` and `GOOGLE_OAUTH_ALLOW_LOCAL=true` in that non-production environment and register its callback appropriately. Do not enable local returns in production or add wildcard preview origins. The production return is exactly `https://www.fflagent.com/settings` with a server-selected section.

### Recovery and rollback

- Before encrypted writes, pause the transition and repair/redeploy the compatible functions. The expansion is additive except its supporting data backfill; keep it while resolving issues. Do not reverse backfills or remove new columns containing data casually.
- After lockdown, **do not restore browser credential grants** to make an old client work. Repair server-scoped consumers. After removing the old uniqueness constraint, do not reinstall it without checking for now-valid per-mailbox duplicates.
- After encrypted writes, **never redeploy Base64-only readers**. Retain encrypted readers and key ring, pause affected jobs if separately authorized, and restore the last reviewed compatible bundle or ship a forward fix. Keys and envelopes must be recovered together from approved backup handling.
- Conversion failures do not authorize discarding tokens or forcing a broad reconnect. Inspect aggregate failure causes securely; the script leaves unmatched/concurrently modified rows unchanged. If a specific grant cannot be recovered, ask its owner to reconnect.
- Keep unaffected CRM/telephony work outside this rollback. No production rollback command has been executed or approved.

## Data deletion procedure — implementation prepared, each real request needs approval

The Gmail-only operator tool and database barriers are implemented in this review branch. Use the exact procedure in `docs/google-data-deletion-plan.md`; this broader outline does not authorize Calendar or account/agency deletion, nor establish backup expiry:

1. Verify the requesting account and agency, authority over the data, and whether the request is integration disconnect, grant revocation, Google-derived data deletion or account closure. Do not accept a client-supplied organization ID as authorization.
2. Stop the affected integration and cancel pending states/cursors through the approved operation. Google grant revocation is a separate explicit action because it can also affect Calendar; handle an unavailable token through the user's Google Account controls. Local Gmail erasure makes no grant-revocation claim.
3. Prepare a read-only inventory by verified user + organization + source mailbox. Include imported `contact_emails`, related notifications/activities, Google-sourced appointments/mappings and relevant backups. Preserve other agents' messages and unrelated manually created records. Some shared agency records and historical source mappings need explicit review.
4. Present exact record counts, dependency effects, applicable retention holds and recoverability to the authorized owner. Obtain specific deletion approval and choose an approved retention/backup process before deleting anything. A disconnect is not deletion.
5. Execute only the reviewed scoped operation, record non-content audit evidence and verify remaining data/backup handling. Account closure must incorporate this integration cleanup; this PR does not redesign the account-deletion system.

## Verification evidence and remaining gaps

Local tests use **synthetic data only**. Database tests apply all three actual migration files to disposable PGlite PostgreSQL with a scoped fixture; they are not proof of the current production catalog or true multi-session locking behavior.

```bash
npm run test:google
npx vitest run src/pages/__tests__/googleLegalPages.test.tsx src/components/settings/__tests__/googleDisclosure.test.tsx
npx tsc --noEmit
npx tsc -p tsconfig.app.json --noEmit
npm run lint
npm run build
```

- **88 backend tests pass**, including the existing 61 plus scoped erasure, leadership notification copies, bounded retries, manifest changes, legacy provenance blockers, stale writes, new consent after erasure, deleted-profile checks, browser privilege denial, synthetic restore replay and operator project/hash/ledger safeguards. Invalid revocation tokens are not treated as proof that the entire grant was removed. PGlite interleaving tests do not replace two-session staging concurrency checks.
- **6 UI tests pass**, covering signed-out page components, policy links, draft labeling, disclosures, explicit all-access confirmation/cancellation and honest revocation warnings. Full router/viewport behavior still needs browser verification.
- Root TypeScript command passes but does not typecheck the application. Application TypeScript has **91 pre-existing errors**; compare the baseline and final diagnostics rather than claiming a clean application check. Lint baseline is **15 errors and 201 warnings**. No unrelated cleanup is included.
- Production build passes with existing-style large-chunk/dynamic-import warnings. Native Deno checking passes using local npm aliases/test-only serve adapter; deployment-native import resolution remains a staging gate.
- Browser visual check was blocked at the local URL (`ERR_BLOCKED_BY_CLIENT`); do not represent it as passed. Real Google consent, send/receive, refresh, revocation/reconnect and Calendar event write/read remain **unrun** pending an approved account/recipient and a deployed staging/production target.
- September 22 hosted security-advisor read is a production **baseline**, not validation of this undeployed migration. It reports existing non-Google findings including `app_config` and `webhook_debug_log` without RLS; actual reachability also depends on grants and needs separate review. No unrelated permissions were changed. See [Supabase RLS-disabled remediation](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public). Local candidate tests verify service-only function/ledger access; repeat hosted advisors after an approved rollout.

Real-account test must use synthetic message text, an explicitly approved recipient, a bounded test appointment/calendar and the actual released client. Confirm receipt/display (not merely a 200 response), refresh after access-token expiry, partial consent, revoked access, reconnect and independent disconnect. Keep inbox content, tokens and keys out of evidence/recordings. Record Google verification and any assessment as external outcomes, not code-test results.
