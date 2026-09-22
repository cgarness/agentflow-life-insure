# AgentFlow Google production implementation plan

Prepared for Chris Garness · September 21, 2026

**September 22 follow-up:** Chris authorized the review/backup preparation to continue. All 67 targeted checks and root TypeScript passed again. The source-grounded deletion proposal is `docs/google-data-deletion-plan.md`; complete production dependency/backup verification and broader offboarding/export implementation remain pending. Both connectors recovered after HTTP 400 failures, permitting draft-PR preparation through GitHub and read-only production column/FK inspection. The Supabase organization is Pro; actual backup settings are still unverified. Shell Git authentication remains unavailable. No production change occurred.

**Owner decisions, September 22, 2026:** Christopher Garness is the personal legal operator; Chris Garness is his everyday name. Retain imported Gmail history on disconnect. Chris approved a 30-calendar-day target for verified deletion requests (sooner where required, with completion confirmation), removal of departing agents' access and Google integrations while handling personal Google-data deletion separately from shared agency records, a 30-day agency workspace export window followed by deletion unless a specific retention obligation applies, and backup expiry targeted within 30 days after live deletion subject to configuration verification. Explicit deletion requests need not wait through the export window. These targets require implementation and verification; remaining final policy terms still need completion. No publication, production deployment, backup change or actual deletion is authorized by these copy decisions. Broader deletion/offboarding implementation requires its own exact reviewed file/table plan.

**Status: implementation approved by Chris on September 21, 2026; production rollout remains unapproved.** This document is not a deployed change or a claim that Google has verified AgentFlow. No users have been added, credentials retrieved, messages sent, or production settings changed during this investigation.

## Outcome

Make AgentFlow's Google email integration ready for external production use: users connect their own Google account, send and receive email, remain connected through normal token refresh, understand how their data is used, and can disconnect or request deletion. Preserve working Calendar integration, which shares Google credentials and token utilities.

Completion means both functioning software and the required Google approvals. Publishing an OAuth app alone does not establish either. This project covers Google integration readiness, not certification of every AgentFlow feature.

## Confirmed configuration

| Setting | Confirmed value |
| --- | --- |
| Repository inspected | `cgarness/agentflow-life-insure` |
| Main snapshot inspected | `03bae62870c24a336801a7ff6faee46b8ce69269` |
| Public application | `https://www.fflagent.com` |
| Supabase project | `jncvvsvckxhqgqvkppmj` |
| Google project number | `87346168200` |
| Google project display name | My First Project |
| Google organization shown | cgarness-ffl-org |
| OAuth client confirmed by Chris | AgentFlow Web |
| Current audience | External |
| Current publishing status | Testing |
| Current Google support/developer contact | cgarness.ffl@gmail.com |
| Publish blocker shown by Google | Complete Branding configuration |

The full deployed client ID and Google API enablement have not been independently read. Preserve the existing client and secret; changing them is not necessary for the work below. The other client named AgentFlow must not be deleted merely because it is older.

The existing authorized redirects are:

```text
https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/google-oauth-callback
https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/email-connect-callback
```

## Findings that determine the work

| Finding | Evidence and implication |
| --- | --- |
| Public legal pages are missing from the inspected app | `src/App.tsx` has no privacy or terms route. `MarketingFooter.tsx` renders the legal labels as spans, not links. Branding's home, privacy and terms fields are empty in Chris's screenshots. |
| Google credentials are not protected by application encryption | Deployed `email-connect-callback` v29 includes `_shared/google-token.ts`, which uses Base64 and a legacy raw-token fallback. Database disk encryption, if provided by the host, is a separate protection. |
| Browser roles can read credential columns | Read-only production catalog inspection confirms table/column SELECT privileges on token fields. RLS is enabled, but email connection SELECT permits the owner and some same-organization leadership roles. Calendar credentials are readable by their owner. The UI's narrow SELECT is not an authorization boundary. No token values were retrieved and no misuse was established. |
| Credential protection also affects Calendar | Several Calendar Edge Functions use the user's database client to read token fields. Those server reads must be adapted before credential-column privileges are removed, otherwise the fix would break Calendar. |
| Gmail disconnect is incomplete | Deployed `email-disconnect` v27 clears stored tokens and marks the row disconnected. It does not revoke Google's grant, delete imported messages, or distinguish a nonexistent/unauthorized connection from a successful update. |
| Current import is broader than matched CRM contacts | The inspected sync code bootstraps up to 200 recent messages from a seven-day query and stores message bodies even when contact matching returns no contact. Disclosure must reflect this behavior. A seven-day initial query is not a seven-day retention policy. |
| OAuth needs lifecycle hardening | The inspected email flow accepts a caller-supplied return URL, checks state before marking it used later, and writes the token response without ensuring the required Gmail permissions were granted. Reconnect must handle missing refresh tokens and changed mailbox identity safely. |
| Background jobs exist | Production catalog shows active email and Calendar synchronization jobs every five minutes. Job presence is not proof of successful delivery or refresh. |
| The existing mailbox needs reconnect | Earlier read-only checks found Chris's only Gmail connection marked `needs_reconnect` with an expired/revoked token error. Testing status is consistent with short-lived grants, but does not prove the cause of that individual error. |

## Build 1 — public pages and clear consent

1. Add public `/privacy` and `/terms` pages using AgentFlow's existing visual design. They must work when signed out and when opened directly, without being redirected to login.
2. Make the footer's Privacy Policy and Terms of Service labels real links. Add a concise, accurate explanation of Google email and optional Calendar integration to the homepage.
3. Show a short Google data disclosure beside Connect Gmail and in Calendar setup, with the same privacy-policy URL used by Google Branding.
4. Publish actual data practices: account identification, mailbox and Calendar information accessed, storage, agency visibility, service providers, retention, deletion, and user controls. Do not claim only matched-contact messages are imported while unmatched messages are stored.
5. Finalize operator identity and retention/deletion commitments with Chris before publishing legal text. Do not invent an LLC, mailing address, legal jurisdiction, refund policy, deletion deadline, security certification, or existing support mailbox.

Proposed files:

```text
src/App.tsx
src/pages/LandingPage.tsx
src/pages/PrivacyPolicyPage.tsx                     (new)
src/pages/TermsOfServicePage.tsx                    (new)
src/components/legal/LegalPageLayout.tsx           (new)
src/content/legal.ts                              (new)
src/components/marketing/MarketingFooter.tsx
src/components/settings/EmailSetup.tsx
src/components/settings/CalendarSettings.tsx
src/components/settings/GoogleDataDisclosure.tsx   (new)
```

Keep changes to the existing large components surgical. New React components remain below the repository's 200-line guideline; use Tailwind and Zod where forms are introduced. Do not rewrite unrelated marketing, calling, billing, or CRM features.

### Google data disclosure draft

The following is working copy for the Google section, not a complete or approved privacy policy:

> Connecting Gmail lets AgentFlow identify your connected Google account, send emails you initiate, and import email messages into your agency workspace. Imported information can include senders, recipients, subjects, message text, timestamps, and conversation identifiers. Importing may include messages that have not been linked to a CRM contact. Authorized agency users may access imported communications according to their role and your agency's permissions.
>
> If you separately connect Google Calendar, AgentFlow uses calendar information to support the synchronization options you select. Google connection credentials are used by AgentFlow's servers to keep these features working while you are signed out.
>
> Disconnecting stops future access by the selected integration. Previously imported CRM records are handled under the retention and deletion terms below. You can also remove AgentFlow's Google access through your Google Account settings.

Before publication, add verified retention periods, the deletion request procedure, the operator's identity, and accurate provider disclosures. Include an approved Limited Use commitment linked to Google's policy. A proposed commitment is: "AgentFlow follows the Google API Services User Data Policy, including its Limited Use requirements." Confirm and enforce restrictions on advertising, sale of Google data, human access, and general-purpose model training; do not publish unsupported promises. [Google's data policy](https://developers.google.com/terms/api-services-user-data-policy) and [Workspace policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy).

## Build 2 — credential protection and reliable authorization

### Protect Google credentials

- Keep OAuth credentials and OAuth state inaccessible to browser roles. Prepare a migration removing broad privileges from `anon` and `authenticated` on credential/state tables, restoring only the metadata access the app actually needs. Remove table-level grants as well as any explicit sensitive-column grants; a column revoke alone does not cancel a table-level SELECT.
- Preserve tenant isolation and the intended visibility of CRM email records. This work does not broaden RLS or give leadership access to mailbox credentials.
- After validating the signed-in user, perform necessary token reads/writes through server credentials with explicit ownership filters. Continue using user-scoped reads for CRM operations where those reads enforce authorization.
- Replace Base64 token storage with authenticated encryption using a server-only, versioned encryption key and fresh random nonces. The proposed implementation is AES-256-GCM through Web Crypto; key material stays out of source control, browsers, logs, screenshots, and this document.
- Update every Gmail and Calendar token consumer together. Support existing token formats only during a documented transition. An encrypted value with an invalid tag/key must fail closed, never be treated as a legacy plaintext token.
- Prepare a controlled migration of existing stored tokens and a rollback procedure. Once encrypted writes begin, rolling back to the old Base64-only functions is unsafe.

### Make connection behavior dependable

- Allow only the canonical production return origin and an explicit settings path; use separate explicit development configuration. Validate return destinations again in the callback.
- Claim OAuth state atomically while checking expiry, provider, and ownership. Recheck current organization membership before attaching an email connection. Reject reused or expired state and handle consent denial cleanly.
- Validate granted scopes and usable offline credentials before declaring a connection ready. Preserve an existing refresh token only for the same verified Google account; never attach one mailbox's refresh token to another.
- Reset per-mailbox synchronization state when the connected account changes. Confirm old imported records remain associated with their actual source.
- Handle revoked grants, transient Google failures, rate limits, partial consent, and insufficient permissions with useful connection states. Do not show a successful send, sync, or disconnect when the operation did not succeed.
- Verify refresh and sync cannot restore credentials after disconnect through an in-flight update. Use a connection generation or equivalent conditional-write guard where needed.
- Retain the current mailbox-import behavior in this change and disclose it accurately. Changing to contact-only ingestion requires an explicit product decision.

### Disconnect, revocation and deletion

Use distinct controls: disconnecting one integration stops its local work; removing Google access revokes the Google grant; deletion removes the specified imported data. A disconnect is not a claim that stored CRM history was deleted.

Revocation can invalidate the same user's Gmail and Calendar authorization across the project. Do not implement an invisible Gmail-only revoke that leaves Calendar falsely marked connected. Make the impact clear and reconcile affected connection states. Account removal must also revoke access where possible and follow the approved deletion process. [Google's revocation behavior](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke).

First prepare an owner-verified, auditable deletion procedure scoped to the requesting user, organization, and Google-derived data. Identify related activities, notifications, and backups before making retention promises. Do not delete Chris's production records as a test.

Proposed backend files:

```text
supabase/functions/_shared/google-token.ts
supabase/functions/_shared/google-oauth.ts           (new)
supabase/functions/email-connect-start/index.ts
supabase/functions/email-connect-callback/index.ts
supabase/functions/email-disconnect/index.ts
supabase/functions/email-send-contact-message/index.ts
supabase/functions/email-sync-incremental/index.ts
supabase/functions/google-oauth-start/index.ts
supabase/functions/google-oauth-callback/index.ts
supabase/functions/google-calendar-status/index.ts
supabase/functions/google-calendar-configure/index.ts
supabase/functions/google-calendar-list/index.ts
supabase/functions/google-calendar-disconnect/index.ts
supabase/functions/google-calendar-sync-appointment/index.ts
supabase/functions/google-calendar-inbound-sync/index.ts
src/lib/supabase-email.ts
supabase/migrations/<timestamp>_google_oauth_production.sql
supabase/tests/google_oauth_access.sql               (new)
supabase/functions/_shared/google-token.test.ts      (new)
supabase/functions/_shared/google-oauth.test.ts      (new)
scripts/migrate-google-tokens.ts                     (new; controlled operational script)
docs/google-oauth-production.md                     (new)
implementation_plan.md
WORK_LOG.md
AGENT_RULES.md                                      (credential-access invariant)
```

The migration's final filename and any extra test files must be recorded before implementation. If deletion implementation needs additional tables or endpoints, add the exact design and files to the reviewed plan first. Do not silently expand the work into a general account-deletion redesign.

## Google configuration and submission

These are the intended settings after the pages and software are ready. The proposed legal URLs are not live pages today.

| Google field | Value or action |
| --- | --- |
| App name | AgentFlow |
| Support/developer email | Keep the existing monitored `cgarness.ffl@gmail.com` until an approved replacement is available |
| Homepage | `https://www.fflagent.com/` |
| Privacy policy | `https://www.fflagent.com/privacy` — publish and verify first |
| Terms of service | `https://www.fflagent.com/terms` — publish and verify first |
| Authorized domain to add | `fflagent.com` |
| Existing callback domain | Preserve `jncvvsvckxhqgqvkppmj.supabase.co`; resolve any verification issue Google reports for this provider domain without claiming ownership of Supabase |
| Domain verification | Verify the owned application domain in Search Console using a project Owner/Editor account; record Google's actual verification result |
| Audience | External |
| Production status | Change after the required configuration is complete; record the actual result separately from verification |
| APIs | Confirm Gmail API and Google Calendar API are enabled in this project |
| Redirect URIs | Keep both exact existing callbacks above |
| JavaScript origins | This server authorization flow does not require adding browser origins merely to fix Branding |
| Client secrets | Keep existing client pairing; verify privately through an authenticated configuration check, without printing secret values |

Google requires public, accurate application information and matching privacy links. Complete its Branding review, publish the approved branding, then complete the required Data Access review. [Branding requirements](https://support.google.com/cloud/answer/15549049?hl=en).

### Scope declaration and draft explanations

| Scope | Why AgentFlow needs it |
| --- | --- |
| `openid`, `email`, `profile` | Identify the Google account connected to the signed-in AgentFlow user and display the connected account. |
| `https://www.googleapis.com/auth/gmail.send` | Send emails that the user composes and initiates from AgentFlow using that user's Gmail account. |
| `https://www.googleapis.com/auth/gmail.readonly` | Retrieve message content and conversation identifiers for the email history and contact-matching features. Metadata-only access cannot display message bodies. The current implementation can import unmatched messages as well. |
| `https://www.googleapis.com/auth/calendar.events` | Read and synchronize appointment events when the user enables Calendar integration. |
| `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | List calendars so the user can choose where appointments synchronize. |

The first five email scopes reflect the inspected runtime. Calendar currently asks for broad `calendar` plus `calendar.events`; the proposed narrower Calendar pair above must be verified against every API method, implemented, and tested before the declaration is changed. Preserve access to user-selected shared calendars where currently supported. [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth).

`gmail.send` is sensitive and `gmail.readonly` is restricted. AgentFlow's server-side storage of Gmail content puts this design on the restricted-scope verification and security-assessment path unless Google confirms an applicable exception. Plan for the independent assessment and any associated commercial decision; no assessor has been hired and no fee is authorized. [Gmail scope classifications](https://developers.google.com/workspace/gmail/api/auth/scopes) and [restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

Prepare a demonstration using an account Chris explicitly authorizes, without adding users now. Show the real consent flow and client ID, connection in AgentFlow, a user-initiated send to an explicitly approved recipient, receipt and display, optional Calendar operations, and disconnect controls. Use synthetic message content and keep private inbox data, secrets and tokens out of the recording. Submit only the scopes the released build actually uses. Google, not AgentFlow or Codex, decides approval.

## Verification and rollout

Required local verification:

1. Signed-out visitors can directly open the homepage, privacy and terms pages, including on mobile; footer links and Google disclosure links resolve.
2. Synthetic users representing the owner, another agent, leadership, another organization and anonymous access cannot read or alter credential/state fields. Safe metadata remains available as intended.
3. Token tests cover round trips, nonce uniqueness, wrong keys, tampering, legacy migration and failure without a configured key.
4. OAuth tests cover expired/reused/concurrent state, organization changes, return-URL rejection, denied/partial consent, no refresh token, account switching and disconnect races.
5. Google-mocked integration tests cover send, refresh, duplicate inbound messages, transient failures, revoked access and Calendar compatibility. Inspect sync cursor advancement under per-message failure so failed messages are not silently lost.
6. Run the repository-required `npx tsc --noEmit`, meaningful application typechecking with `npx tsc -p tsconfig.app.json --noEmit`, affected tests, lint and a production build. Record existing failures separately; the root TypeScript command alone is not sufficient evidence.

Production rollout requires an exact reviewed deployment manifest. Retrieve each live Edge Function before deployment and preserve `verify_jwt=false` with authorization enforced in code. Stage compatibility readers and server-scoped credential access before changing grants or encrypted writes. Apply the reviewed migration, verify privileges, migrate credentials securely, enable encrypted writes, and verify all consumers. Never expose token values in a migration report. Check Supabase advisors after backend/security changes.

After approval and deployment, verify the real connection, Google consent, send/receive, refresh, revocation/reconnect and Calendar behavior with an explicitly authorized account. Google review, domain proof and any assessment remain external gates. No new user is added merely to pass the release checks.

## Decisions and approval

Chris's saved workflow and `AGENT_RULES.md` section 8 require approval of `implementation_plan.md` before code changes. Chris approved the scope below, and Builds 1–2 are now implemented on the isolated review branch. See `docs/google-oauth-production.md` and `WORK_LOG.md` for verification and pending release gates.

**Approved implementation scope:** implement Builds 1–2 within the listed scope on an isolated feature branch, run the listed verification, and prepare the reviewed diff and draft PR. This does not authorize a production migration, token conversion, secret change, merge/deployment, live message send, Google submission, paid assessment, or adding users. Those actions must be presented with their concrete final scope under the existing AgentFlow approval rules.

Required owner information before legal-page publication: the legal operator name, the approved retention/deletion commitments and how requests will be handled. The existing Google contact address can remain while those details are finalized. These are business commitments that cannot be inferred from the code.

Current Google console limitation: the remote browser previously returned a connection error, so Chris's screenshots are the evidence for console state. No signed-in Google console access has been established here. Once code and materials are ready, use a functioning secure browser handoff or guided owner actions for the remaining Google settings; do not request passwords or client secrets in chat.

## Implementation file record

Migration generated with the Supabase CLI: `supabase/migrations/20260921224443_google_oauth_production.sql`. Additional local verification files: `vitest.google.config.ts`, `supabase/tests/google_oauth_fixture.sql`, `supabase/tests/google_oauth_access.test.ts`, `supabase/functions/_shared/google-endpoints.test.ts`, `src/pages/__tests__/googleLegalPages.test.tsx`, and `src/components/settings/__tests__/googleDisclosure.test.tsx`. Tests use synthetic data and mocked Google requests; no production data or secrets.

Test tooling: `package.json` and `package-lock.json` add pinned development-only `@electric-sql/pglite@0.3.14` and a Google-specific test command so the migration and grants can be verified in disposable local PostgreSQL without touching Supabase.

Test adapter: `supabase/tests/google-serve-stub.ts` bridges the Deno server registration into the Node test runtime only.

Additional integration test file: `supabase/functions/_shared/google-consumers.test.ts` exercises actual send, sync and Calendar-list handlers with synthetic HTTP fixtures.

Rollout refinement: CLI-generated `supabase/migrations/20260921230744_google_oauth_credential_lockdown.sql` separates privilege removal and the old mailbox uniqueness constraint removal from schema expansion. Deploy all compatible consumers between these migrations. This preserves the approved staging requirement.
