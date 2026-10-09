# AgentFlow Google OAuth submission packet

Prepared October 9, 2026. **Preparation only: not submitted, not verified, and not yet ready to certify.** This packet uses production source readback and Chris's Google Console screenshots. It does not treat draft PR #378 as deployed software.

## 1. Brand fields

Open [Google Auth Platform](https://console.cloud.google.com/auth/overview?project=87346168200), select **My First Project** (`project-b7e9b5b4-d066-48c9-b36`), and use the **AgentFlow Web** OAuth client. Preserve the older AgentFlow client.

| Field | Value |
| --- | --- |
| App name | AgentFlow |
| User support email | cgarness.ffl@gmail.com |
| Developer contact | cgarness.ffl@gmail.com |
| Homepage | https://www.fflagent.com/ |
| Privacy policy | https://www.fflagent.com/privacy |
| Terms of service | https://www.fflagent.com/terms |
| Logo | `public/agentflow-icon.png` — existing 512 × 512 PNG, 12,409 bytes |
| Application domain | fflagent.com |
| Callback domain shown in current console | jncvvsvckxhqgqvkppmj.supabase.co |

Preserve these redirect URIs exactly:

```text
https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/google-oauth-callback
https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/email-connect-callback
```

The last screenshot showed the right application and callback domains entered, but did not prove Save completed. Save Branding and open **Verification Center**. An External app in **Testing** saying verification is not required is not an approval for public production use. Publishing status and successful verification are separate states.

## 2. Public website release

This branch adds public `/privacy` and `/terms` routes, real footer links, and a homepage explanation of Gmail and Calendar. The exact proposed copy is `src/content/legal.ts`. Review pages explicitly show **Pending publication approval** until Chris approves the copy.

The copy reuses previously approved operator and retention decisions. It accurately discloses background Gmail import, unmatched messages, agency visibility, retained history after disconnect, and a support deletion channel. It does not claim deployed AES token encryption, automated erasure, a security assessment, or Google approval.

Before publishing: approve this exact text, confirm the stated deletion/support targets can be operated, set `legalPublication.approved` to `true`, and set the actual effective date in the same release. After release, open both production URLs without signing in, follow the homepage links, and check the Google consent-screen links. Do not submit a review copy to Google.

Verify ownership of `fflagent.com` in [Google Search Console](https://search.google.com/search-console) using an account that is also an owner/editor of this Google Cloud project. Complete the DNS or other verification Google actually supplies. No verification token or ownership result has been captured. If Google flags the Supabase callback domain, capture the exact issue; do not claim ownership of `supabase.co`. An owned custom callback domain would be a separately reviewed configuration change.

## 3. Actual scope inventory

Read-only deployed source on October 9:

| Flow | Scope | Reason / submission status |
| --- | --- | --- |
| Gmail (`email-connect-start` v30) | `openid` | Associate the connection with its Google account. |
| Gmail | `email` | Identify the connected email address. |
| Gmail | `profile` | Basic account profile; confirm this is actually needed before finalizing Data Access. |
| Gmail | `https://www.googleapis.com/auth/gmail.send` | Send user-composed email; sensitive scope. |
| Gmail | `https://www.googleapis.com/auth/gmail.readonly` | Read message bodies and conversation history; restricted scope. |
| Calendar (`google-oauth-start` v491) | `https://www.googleapis.com/auth/calendar` | Broad calendar permission currently requested; least-privilege blocker. |
| Calendar | `https://www.googleapis.com/auth/calendar.events` | Event access currently requested; overlap with the broader permission must be resolved. |

Google may display identity permissions using normalized `userinfo.email` / `userinfo.profile` names. Match the observed consent request and Data Access configuration; do not add duplicate permissions to compensate for label differences.

**Do not copy the old PR's narrower Calendar list into the console and assume the running app changed.** It proposes `calendar.events` plus `calendar.calendarlist.readonly`, but production currently requests `calendar` plus `calendar.events`. Audit the actual Calendar endpoints and narrow the deployed request before scope submission, or establish a real feature need for each permission. Do not invent a broad-scope justification. Changing only the console does not change runtime requests.

### Gmail justification drafts

**gmail.send**

> AgentFlow is a CRM for life insurance agencies. A user connects their own Gmail account so they can compose and send messages to their contacts from AgentFlow using that account. This scope is used for user-initiated email sending. Identity-only and read-only scopes cannot send a message. AgentFlow does not use this permission to administer the mailbox or modify mailbox settings.

**gmail.readonly**

> AgentFlow retrieves Gmail messages and conversation history so connected users can review communications alongside CRM contacts. It reads sender and recipient addresses, subjects, message bodies, timestamps, and message/thread identifiers, and synchronizes recent messages in the background. Imported messages can include messages that do not match an existing contact and may be visible to authorized agency users as disclosed in the privacy policy. Metadata-only access is insufficient to display the message body; send-only access cannot retrieve incoming conversations. This integration does not require permission to delete or modify messages in Gmail.

These describe the observed feature, not proof of compliance. Final justifications must match the released behavior and the recorded demo. Keep the initial recent-message import window distinct from a retention/deletion promise.

## 4. Real demonstration recording

Record a concise, continuous demonstration in English (or with English captions). Use the exact client being submitted, an authorized test account, and a controlled mailbox with no private customer information. Do not show passwords, tokens or client secrets. The required evidence must actually run; a storyboard is not a completed demo.

1. Show the public AgentFlow homepage, app identity, privacy policy and terms links.
2. Sign in with the authorized test account. Explain which Google feature is being connected and the agency visibility of imported mail.
3. Start Gmail connection from AgentFlow. Show the complete Google OAuth consent flow, app name and requested permissions. Identify the submitted OAuth client ID safely; a client ID is not the client secret.
4. Return to AgentFlow and show the connected account. Send one user-composed test message to an address controlled by the demonstrator; verify the result. Show an incoming test conversation and its body in CRM history, explaining background import and unmatched-message handling.
5. If Calendar is included, show its separate consent flow and each feature needed for the final scopes: calendar selection and the supported event read/create/update operations. This must follow the scope correction, not an undeployed design.
6. Show the real disconnect control, explain that imported history remains, show Google's third-party connection management and the support deletion instructions. Do not demonstrate an erasure button or revocation behavior the released app does not have.
7. Upload the recording as an accessible unlisted video and paste the real URL in the verification form. Check that a reviewer can open it without requesting access.

No demonstration, recipient, recording, video URL, or new account was created in this preparation task.

## 5. Submission gates, in order

| Gate | Current evidence | Required completion |
| --- | --- | --- |
| Public brand material | Complete proposed pages and existing logo prepared on this branch | Owner approves exact copy; publish; check production links. |
| Google project/brand | Screenshots show External/Testing and correct entered links/domains | Save; inspect Verification Center; confirm contact inbox and active client. |
| Domain ownership | No Search Console proof captured | Verify application domain with an appropriate project owner/editor; resolve any actual domain error. |
| Minimum scopes | Live Gmail scopes known; Calendar is broader than previous plan | Confirm profile need and correct Calendar scope/runtime mismatch before Data Access submission. |
| Safe Google data handling | Deployed sync helper Base64-encodes credentials; encoding is not encryption. It does not establish secure storage or adequate credential access controls. | Verify and remediate token storage/access boundaries, revocation and data deletion against actual deployment. Do not answer security questions using PR #378's undeployed controls. |
| Deletion operations | Approved business targets exist; old historical attribution and backup expiry remain unproven | Verify an actionable request process, authority checks, live/derived/backup handling and confirmation evidence. |
| Restricted-scope assessment | Gmail readonly is restricted; imported Gmail data is handled server-side | Follow Google's assessment requirement unless Google confirms an applicable exception; obtain the required assessor evidence. No assessment has been commissioned or passed. |
| Demonstration | Recording script ready | Record the functioning release and provide accessible video URL. |
| Submission | No Verification Center report or final saved state captured | Resolve its listed requirements, then submit accurate brand/scope evidence; monitor the contact inbox for reviewer requests. |

Brand verification can be prepared ahead of scope review. Completing branding does not approve Gmail access. Do not remove `gmail.readonly` merely to avoid its review while the app still imports email.

PR #378 remains a separate, conflicting draft containing substantial backend and deletion work. It is not part of this website change and must be reconciled and verified before any of its controls are represented as live. No production backend deployment, paid assessment, merge, or Google submission is included here.

## Official references checked October 9, 2026

- [Restricted-scope verification and security assessment](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Gmail scope classifications](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Google API Services User Data Policy and Limited Use](https://developers.google.com/terms/api-services-user-data-policy)

Google's actual Verification Center and reviewer instructions determine the required evidence for this project. Do not promise an approval date or claim review is complete based on publishing status.
