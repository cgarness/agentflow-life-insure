# Implementation Plan — Email Setup Pass 1

Implement a Gmail-only email flow for now, harden connected inbox scoping to prevent cross-user/cross-org tenant visibility, verify contact ownership prior to sending emails, add activity logging for email events, and document the deferred token encryption and Outlook send work.

## User Review Required

> [!IMPORTANT]
> - **Gmail-only UI:** The "Connect Outlook" option will be removed from the Settings UI. Any existing Outlook connections will be displayed with an "Unsupported" status and cannot be re-connected.
> - **Microsoft Connect Block:** Any API requests initiating Microsoft OAuth connections via the `email-connect-start` function will be rejected with: `"Outlook connect is not available yet."`
> - **Scoping:** Connected inboxes retrieved via `getMyConnections()` will be explicitly scoped to the authenticated user ID and their organization ID, ensuring users cannot view other users' connections in settings or conversations.
> - **Contact Ownership:** Sending emails via `email-send-contact-message` will now verify that the target contact (`lead` table) exists and belongs to the sender's organization.

## Open Questions

There are no outstanding open questions. We will proceed with the proposed implementation below.

## Proposed Changes

---

### Frontend Components

#### [MODIFY] [EmailSetup.tsx](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/components/settings/EmailSetup.tsx)
- Remove the "Connect Outlook" button from the JSX.
- Update the descriptive text:
  - From: `"Connect your own inbox so contact email send/receive can appear in conversation history."`
  - To: `"Connect your Gmail inbox so contact email send/receive can appear in conversation history (Gmail is currently supported)."`.
- Update `statusLabel` to return `"Unsupported"` if the provider is `"microsoft"`.
- Update the connected inbox `Badge` rendering: if the provider is `"microsoft"`, use the `"secondary"` variant and render the `"Unsupported"` label.
- Import `logActivity` from `@/lib/activityLogger` and `useAuth` from `@/contexts/AuthContext` and `useOrganization` from `@/hooks/useOrganization`.
- Inside `onDisconnect`, call `logActivity` on success with category `"settings"`, action `"Gmail disconnected"` or `"Outlook disconnected"`, and metadata `{ connection_id, provider }`.

---

### Frontend Libraries

#### [MODIFY] [supabase-email.ts](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/lib/supabase-email.ts)
- Update `getMyConnections()`:
  - Retrieve the current authenticated user via `supabase.auth.getUser()`.
  - Query the user's profile to retrieve their `organization_id`.
  - Filter the query explicitly using `.eq("user_id", user.id)` and `.eq("organization_id", profile.organization_id)` (if profile organization exists).
  - Remove `(supabase as any)` and query the table directly since `user_email_connections` is defined in generated types.
  - Return typed results using `as unknown as UserEmailConnection[]` to support literal types for status and provider.
- Remove `(supabase as any)` from `getContactEmails()` as well.

---

### Supabase Edge Functions

#### [MODIFY] [email-connect-start/index.ts](file:///Users/chrisgarness/Projects/agentflow-life-insure/supabase/functions/email-connect-start/index.ts)
- Add a check immediately after parsing the request body: if `provider === "microsoft"`, return a `400 Bad Request` response with error: `"Outlook connect is not available yet."`
- Keep all existing Gmail OAuth initialization, validation, and database state inserts intact.

#### [MODIFY] [email-connect-callback/index.ts](file:///Users/chrisgarness/Projects/agentflow-life-insure/supabase/functions/email-connect-callback/index.ts)
- Fetch the user's profile name (`first_name`, `last_name`) from `profiles` based on `stateRow.user_id` on success.
- Log activity after a successful connection upsert by inserting into the `activity_logs` table via the `admin` client:
  - Action: `"Gmail connected"` or `"Outlook connected"`
  - Category: `"settings"`
  - User ID: `stateRow.user_id`
  - User Name: User's parsed profile name or email.
  - Organization ID: `stateRow.organization_id`
  - Metadata: `{ provider, connection_id }`

#### [MODIFY] [email-send-contact-message/index.ts](file:///Users/chrisgarness/Projects/agentflow-life-insure/supabase/functions/email-send-contact-message/index.ts)
- Update `profiles` select query to include `first_name` and `last_name` columns.
- Before triggering provider email sending (line 119):
  - Fetch the contact (lead) from the `leads` table using the `admin` client.
  - Verify that the contact exists. If missing, return `400 Bad Request` with `"Contact not found."`
  - Verify `contact.organization_id === profile.organization_id`. If it belongs to a different organization, return `400 Bad Request` with friendly error: `"This contact does not belong to your organization."`
- Right after the `contact_emails` record is inserted:
  - Insert an activity log into `activity_logs` using the `admin` client:
    - Action: `deliveryStatus === "sent" ? "email sent" : "email send failed"`
    - Category: `"contacts"`
    - User ID: `user.id`
    - User Name: Sender's profile name.
    - Organization ID: `profile.organization_id`
    - Metadata: `{ provider, connection_id, contact_id, organization_id, user_id, delivery_status, error }` (excluding body or token info).

---

### Database Schema Types

#### [MODIFY] [types.ts](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/integrations/supabase/types.ts)
- Clean up any avoidable `as any` casts in `supabase-email.ts` since the table type definitions are available. No modifications to `types.ts` are required for this step since it already lists the email tables.

---

### Documentation

#### [MODIFY] [WORK_LOG.md](file:///Users/chrisgarness/Projects/agentflow-life-insure/WORK_LOG.md)
- Append a newest-first entry summarizing changes, verification, and explicit decisions.
- Document token encryption and Outlook send support as deferred work.

## Verification Plan

### Automated Tests
- Run `npm test -- --run` to ensure all existing tests (72/72) pass.
- Run `npx tsc --noEmit` to verify that there are no TypeScript compilation errors.

### Manual Verification
1. Open settings, verify that only the **Connect Gmail** button is visible, and the description specifies that Gmail is supported.
2. Attempt to trigger Microsoft connect via mock fetch or direct URL access and verify that the Edge Function rejects it with `"Outlook connect is not available yet."`
3. Verify that Gmail connect still starts OAuth and successfully redirects back.
4. Verify that the inbox list displays Gmail connections, and any existing Microsoft connections are safely labeled as `"Unsupported"` with a gray/secondary badge.
5. Verify that sending emails to a contact within the organization works, and sending to a contact outside the organization is blocked with a friendly message before provider sending.
6. Verify that `activity_logs` captures `"Gmail disconnected"`, `"Gmail connected"`, `"email sent"`, and `"email send failed"` with correct metadata.
