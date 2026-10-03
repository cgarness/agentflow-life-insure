# AgentFlow + UnderwriterVerified A2P wizard

Status: proposal for Chris's review, October 3, 2026. This phase changes planning documentation only. The previous approval shipped PR #406; it does not authorize this new document-processing, website, consent, or multi-business expansion. No new production mutation or registration is performed by this plan.

## Product outcome

One guided setup with two main parts: **Business and website** and **Verify and register**. Agents should enter information once, review what was read from their EIN letter, resolve specific issues, and complete the provider's required review/verification. Reuse the shipped approval/rejection and number-readiness tracking.

The goal is fewer preventable rejections and less repeated entry. Do not claim a guaranteed approval rate, IRS verification, or entirely unattended registration. An OCR match is not proof that a document is authentic or that a carrier approved the business.

## Business ownership decision

Chris asked whether one agency Twilio account limits registration to the agency. It does not: Twilio supports multiple customer Brands/Campaigns/Messaging Services in one account under an ISV architecture. The current AgentFlow database, however, has one A2P registration per organization. That application limit must be extended to support independent agent businesses.

Recommended design:

- **Agency business is the default.** An agent representing the same legal business can have a personal public profile without creating a new EIN/Brand registration. Agency administrators manage that business's registration.
- **Separate agent business is an explicit option.** If the sender is a different legal business, prepare a separate business identity, consent wording, registration and sender mapping. Do not use the agency EIN merely because the agent belongs to the agency.
- Add a stable `business_id` below `organization_id`; an agent profile, public page, Twilio account, Brand and Messaging Service are separate objects. Do not equate email addresses, slugs, people, CRM agencies and legal businesses.
- One account may host multiple registrations, but independent customer subaccounts are Twilio's recommended isolation model. Preserve verified current account ownership and the working Voice/TwiML setup. This wizard must not move existing numbers, recreate accounts, or migrate voice automatically.
- Roll out agency-owned business setup first. Enable independent agent registration only after the multi-business authorization, event routing and send-time isolation tests pass. Both use the same wizard rather than separate implementations.

## Current evidence

- AgentFlow: main `84829dfe`, merged PR #406; schema `20261003174429`; hosted submission/status infrastructure is deployed but no agency A2P account is enabled. Registration and most related records are currently keyed by organization, and the UI/API are administrator-only.
- UnderwriterVerified: repository `cgarness/ffl-agent`, production main `f220400a`, Vercel project `underwriterverified`. It uses its own Supabase project `rtgmdbqzkwlmplurypyh`, separate from AgentFlow `jncvvsvckxhqgqvkppmj`.
- Website PR #11 (`cursor/a2p-consent-intake-c93e`, `ad9f2a6`) remains open/draft. It implements persistent intake, separate informational/marketing choices and an ownership repair; do not duplicate or overwrite it.
- Current live-source quote/SMS/call handlers show success by setting component state without saving an intake request. The existing legal-brand resolver supplies CG Financial's address for scoped profiles, and the global SMS-opt-in path is specific to Christopher Garness / CG Financial. These must be generalized before the wizard claims readiness for other businesses.
- PR #11's release preflight records an unowned canonical profile and inherited anonymous profile-write policies. Those are reported historical observations, not newly verified catalog facts. The current Supabase connector explicitly denies access to the website project, so production ownership, grants and migration history remain unverified here.
- No application files in either repository were modified during this investigation. No private IRS document was uploaded, no consent record submitted, and no provider account changed.

## Part 1 — Business and website

1. Identify who will send the messages: existing agency business or an independent business. Resolve permissions server-side. An agent may prepare their own profile; agency registration, shared-number assignments and agency publication require the appropriate administrator/business representative authority.
2. Import existing profile fields as suggestions: public name, business/DBA display name, contact methods, NPN/licences, headshot and agency affiliation. Keep legal business name, DBA and individual agent name distinct. Do not create licences, testimonials, business facts or consent methods from inference.
3. Link or provision the correct UnderwriterVerified profile through an authenticated server-to-server integration. Existing users prove ownership; do not claim a profile from a matching email, name, slug or public page. AgentFlow and website auth UUIDs are not interchangeable. New linked profiles need an explicit ownership model and idempotent stable external IDs.
4. Create an unpublished draft using the existing website design. Produce stable business/agent URLs plus matching privacy, terms and scoped opt-in pages. Keep Christopher's existing public URLs working. Never publish EINs, IRS letters or private mailing details automatically.
5. Complete actual messaging setup: customer-care and/or marketing purpose, recipients, frequency, volume, sample messages, real opt-in sources and support contact. Reuse approved templates with confirmed facts; do not claim keyword/Facebook/verbal consent paths that are not implemented and evidenced.
6. After identity review, publish a confirmed version. Verify public rendered content, the correct business identity, working links, optional independent consent choices, disclosure versions and actual server persistence. A 200 response containing only the SPA shell is insufficient evidence.

The website remains the public profile/consent surface. AgentFlow is the operational wizard. Show the linked site preview and completion state in AgentFlow; do not force users to re-enter the same details in unrelated dashboards.

## Part 2 — Verify and register

1. Accept a clear image or PDF of an IRS CP 575 or 147C letter. Offer camera upload, crop/rotate/retake guidance, and a manual-entry/review path for unreadable documents. Do not require an EIN letter for a genuine no-EIN sole proprietor; route that case through the existing provider verification flow. Never request an SSN as an EIN substitute.
2. Extract candidate legal name, EIN and document address with per-field confidence and evidence. Preserve multi-line names and suffixes; require confirmation of critical fields. Business structure, current address, messaging volume and representative authority need their own confirmation and cannot be invented from the letter.
3. Compare confirmed identity against the website draft and registration draft. Show specific differences with correction actions. A historical document address differing from the current business address requires review rather than silently replacing either. No silent mutation of a public website or provider registration.
4. Validate links and consent separately from the document. Check public accessibility, canonical business/page ownership, matching support contact/DBA, privacy and terms, opt-in disclosures and the actual evidence-writing path. The EIN letter does not establish that a website or campaign is compliant.
5. Prepare the supported Twilio Brand and Campaign fields from one confirmed, versioned snapshot. Validate the account's actual prefill entitlement with official supported requests. The documentation contains inconsistent field labels and account-gated campaign prefill; do not fabricate special headers or assume every field is accepted.
6. Present one review summary, current fees and explicit submission authorization. Complete any required provider OTP, representative verification and final attestation. Use the existing hosted flow where supported. An opaque hosted iframe cannot be treated as readable proof that the user left all prefilled fields unchanged: label local checks as preparation checks and retain the provider review step.
7. Reuse durable operations, uncertain-result locks, signed events and reconciliation. On rejection, show the provider reason, identify the affected preparation field/page, recheck the corrected version, and support eligible resubmission. Never auto-retry an uncertain or paid create.
8. Keep website checks, document confirmation, Brand approval, Campaign approval and individual number registration as separate statuses. SMS remains blocked until the configured sender passes the existing checks for its own business/account/campaign.

## Storage and permission changes

This expands the previous decision to keep EIN/document handling entirely inside Twilio. It therefore requires an explicit, narrow private-document design rather than adding fields to the public profile table.

- Proposed raw-document retention: delete after the user confirms extraction, with a maximum 24-hour lifetime for abandoned uploads. Record deletion failures for retry; do not mark deletion complete before storage confirms it. Re-upload if an appeal later needs the original.
- Keep only required confirmed registration data encrypted and scoped to the registered business. Mask EIN in normal UI responses. Retain it only while needed for registration/correction; record retention and purge behavior before release. No raw OCR text, full EIN, document URL or image in ordinary audit history, notifications, analytics or browser persistence.
- Private storage only, short-lived authorized upload/read access, bounded MIME/size/page/pixel checks and malware/active-content controls. Preview data must use isolated storage. Document content is untrusted input and must never control tool calls or backend actions.
- An authorized business representative can confirm legal identity. Agency membership or View As alone cannot authorize independent-business document access, ownership changes or provider submission.
- No IRS image or tax ID crosses into UnderwriterVerified's public database or HTML. The website integration receives an allowlisted public DTO and signed/versioned linking metadata only.
- URL checks are limited to verified public website origins and paths, reject private-network/redirect targets and use bounded time/size limits. Readiness evidence records rule/template/content versions and checked time; material edits invalidate readiness.

## Cross-system consent and sender integrity

Persistent consent is a prerequisite, not decorative text. Finish and verify PR #11's intake/ownership foundation before enabling publication or submission for new users. Generalize its single-brand assumptions without rewriting historical consent events.

Use signed, replay-safe delivery of website requests and consent events to the matching AgentFlow business/profile. Preserve informational and marketing purposes, exact displayed disclosures, source URL, timestamps and immutable source IDs. Durable retries must not duplicate leads or grants. Transport IPs or a phone OTP are not fabricated customer-consent evidence.

Define one authoritative send-time eligibility check and a fail-closed policy for unavailable verification. Registration approval alone never grants permission to text. Preserve organization DNC and provider STOP handling; an unchecked later form cannot erase a suppression. Enable this new website-consent sending path only for explicitly onboarded businesses and supported purposes, without replaying old queued messages.

For multi-business support, every number maps to exactly one registered business and current Messaging Service. Manual sends derive business from the selected authorized number; workflows require a permitted business/default and may only select that business's eligible shared numbers. Events and notifications route by verified provider IDs and business, not by the account alone. Do not introduce cross-agent fallback senders.

## Implementation sequence

1. Review the plan and confirm the business model. Establish authorized access to the website database; inspect current ownership, policies, grants and migration history. Resolve the existing profile owner through proof, not a guess. Reuse/test the PR #11 candidate and release its prerequisite fixes separately before dependent code.
2. Add stable business/profile links, explicit membership/authority and the multi-business registration data model with compatibility for the currently deployed organization-level API. Use forward migrations and preserve old schema/API during the transition; never edit the applied A2P migration.
3. Build the profile/website step and generalize scoped policies/consent for each business. Add signed integration delivery, isolation and publication/readiness evidence. No production form tests against customer data.
4. Build private upload, bounded extraction, user confirmation, retention and deterministic mismatch checks. Choose/configure the extraction provider after confirming regional/retention requirements and existing approved credentials; no document goes to an unconfigured external processor.
5. Add supported provider prefill, fees/review, version invalidation, correction/resubmission and per-business sender enforcement. Preserve working voice, DNC, Twilio account ownership and existing uncertain-operation behavior.
6. Verify the complete flow in isolated environments, then request a concrete production release for the exact migrations, endpoints, integrations and selected business. Twilio paid registration and live customer messaging are separate actions.

## Planned file scope

Before implementation, inspect nested instructions and recheck concurrent branches. The following is the intended file list; reconcile additions before editing if the approved provider or ownership approach requires another file. New migration timestamps must be generated by the Supabase CLI at authoring time.

**AgentFlow existing:** `src/components/settings/phone/a2p/{A2pRegistration,A2pPreparation,A2pStatus,A2pSession}.tsx`, `useA2pRegistration.ts`, `types.ts`, `schema.ts`, `A2pRegistration.test.tsx`; `src/components/settings/PhoneSystem.tsx`; `src/pages/AgentProfile.tsx`; `src/components/workflows/panels/ActionConfigPanel.tsx`; `src/lib/workflow-types.ts`; `supabase/functions/a2p-registration/index.ts`, `a2p-events/index.ts`, `a2p-reconcile/index.ts`, `twilio-sms/index.ts`, `workflow-executor/index.ts`; `_shared/a2p/{auth,types,store,registration,sync,events,notifications,sending,workflow_test}.ts`; `supabase/config.toml`; `supabase/tests/a2p_registration.sql`; `scripts/test-a2p-db.mjs`; `.github/workflows/a2p-registration.yml`; `AGENT_RULES.md`, `WORK_LOG.md`, `implementation_plan.md` and the A2P plan/release docs. Dependency manifests/locks only if the chosen upload/parser/provider integration needs them.

**AgentFlow new:** `src/components/settings/phone/a2p/wizard/{A2pWizard,BusinessStep,WebsiteStep,EinDocumentStep,IdentityReview,ReadinessReview}.tsx`, `useA2pWizard.ts`, `schema.ts`, `types.ts`, `A2pWizard.test.tsx`; `src/components/agent-profile/BusinessSetupCard.tsx`; `supabase/functions/a2p-document/index.ts`, `a2p-document-worker/index.ts`, `a2p-website/index.ts`, `underwriterverified-events/index.ts`; `_shared/a2p/{businesses,documents,documentExtraction,documentRetention,websiteBridge,readiness,consent}.ts` and focused tests; CLI-generated forward migrations for businesses/registration scope, private documents and website/consent integration; corresponding SQL suites and release documentation.

**UnderwriterVerified prerequisite:** preserve and review the complete existing 47-file PR #11 scope as its own dependency, including the two unapplied forward migrations and integration tests. No silent wholesale merge.

**UnderwriterVerified wizard extension, existing:** `src/App.tsx`, `src/pages/{Admin,Index,SmsOptIn,BookCall,PrivacyPolicy,TermsAndConditions}.tsx`; `src/hooks/{useAgentProfile,useLegalBrand,useLegalPaths}.ts`; `src/contexts/AgentDataContext.tsx`; `src/lib/{a2pBrand,smsDisclosure,submitPublicIntake,smsEligibility}.ts`; `src/components/{BrandContactBlock,SmsConsentFields,PublicIntakeForm,SmsOptInForm,BookCallForm,LeadCaptureSection,LegalSection,Footer}.tsx`; `src/integrations/supabase/types.ts`; the relevant `src/test` compliance/intake/eligibility suites; `supabase/config.toml`; PR #11's readiness/release docs. Split large edited components to keep additions focused.

**UnderwriterVerified new:** `src/lib/businessProfile.ts`, `src/hooks/useBusinessProfile.ts`, `src/components/business/{BusinessProfileFields,PublicationReview}.tsx`; `supabase/functions/agentflow-profile-bridge/index.ts`, `agentflow-intake-delivery/index.ts`; `_shared/agentflowBridge.ts`; CLI-generated forward migration for business/legal fields, stable external linking, scoped publication and delivery outbox; SQL and integration tests for ownership/replay/purpose isolation. Do not edit PR #11's migrations if they have been applied by the time this starts.

## Acceptance criteria

- Two businesses in one agency cannot read one another's private documents, claim one another's website profile, overwrite legal data, receive misrouted decisions, or text from the other's numbers. Current supported agency behavior still works.
- Every new public profile/policy/form uses that business's confirmed information; missing data never falls back to Christopher/CG Financial. Agent personal pages can truthfully identify an agency as the sender when representing it.
- Upload extraction handles legibility failures, multi-line names, wrong documents, SSN input, malicious content, confirmation edits, expiry and deletion retries. Low-confidence results never auto-submit.
- Versioned preflight catches missing pages, redirected/wrong-brand links, stale publication, absent consent persistence and unsupported messaging claims. Edits invalidate checks and fee/submission authorization where appropriate.
- The hosted/API contract proves each prefill field accepted for the enrolled account. OTP and required attestation remain real provider steps. No local checkbox fakes approval.
- Brand, Campaign, number, consent and provider-outage scenarios are independently exercised. Retry/idempotency tests cover cross-system delivery, document jobs, concurrent submissions and uncertain provider outcomes.
- Browser-to-API-to-isolated-database checks cover both repositories at desktop/mobile widths, owner/admin/agent permissions, signed integration callbacks, rejection correction, and upload retention. No preview test accidentally writes production.

## Release dependencies and decision record

Awaiting approval of this new implementation plan. Website database access is currently denied by the connected Supabase account; do not bypass that access boundary. Its production fixes cannot be claimed complete until authorized access and catalog checks succeed. Verify Twilio ISV/Embeddable access, real account/resource mappings, current fees and reconciliation setup before any submission. The absence of those permissions does not prevent isolated implementation after plan approval.

References checked October 3, 2026:
- https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv
- https://www.twilio.com/en-us/blog/developers/best-practices/direct-customer-to-isv-rearchitecture-guide
- https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/collect-business-info
- https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/compliance-embeddable-onboarding
- https://github.com/cgarness/ffl-agent/pull/11
- https://github.com/cgarness/agentflow-life-insure/pull/406
