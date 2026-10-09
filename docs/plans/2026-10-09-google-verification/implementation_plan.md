# Google verification preparation — October 9, 2026

Chris asked to prioritize Google verification and authorized starting the work needed for submission at 12:33 PDT. Prepare the smallest reviewable website/submission change. Broader integration usability is deferred. This authorizes implementation and a draft review PR; it does not certify Google compliance, approve the final legal copy, commission an assessor, submit to Google, or authorize production backend changes.

## Source and evidence

- Current main and Vercel production: `8d53531d0edc509cc97fdc49a06c4873438ca67d`; production `agentflow`, deployment `dpl_28cKkn6bUSTKXTCoRgZ39iSCKTkP`, READY.
- Read AGENT_RULES.md, VISION.md, latest WORK_LOG.md and relevant prior OAuth records. No root AGENTS.md exists. Preserve current production behavior and organization boundaries.
- Existing draft PR #378 is open, unmerged and conflicting. Reuse the approved owner identity and business targets, not its undeployed implementation claims.
- Prior owner decisions: personal operation by Christopher Garness; Gmail history remains after disconnect; verified deletion target 30 calendar days; closed-workspace export target 30 days; backup expiry target 30 days after live deletion, subject to verification. These are not evidence of completed operational capabilities.
- Owner screenshots show External/Testing, AgentFlow branding, contact `cgarness.ffl@gmail.com`, entered homepage/privacy/terms links and both application/callback domains. Saved state, domain proof and Verification Center results remain unconfirmed.
- Read-only live function retrieval: email-connect-start v30, email-sync-incremental v31, email-disconnect v28, google-oauth-start v491. Gmail requests openid/email/profile/gmail.send/gmail.readonly. Calendar requests calendar + calendar.events. Sync imports unmatched messages. Disconnect clears local connection credentials without calling Google revocation or deleting history. Bundled token helper is Base64, not application-level encryption.

## Intended files (listed before implementation)

1. src/App.tsx — public privacy and terms routes, no auth/routing restructure.
2. src/pages/PrivacyPolicyPage.tsx — thin public page.
3. src/pages/TermsOfServicePage.tsx — thin public page.
4. src/components/legal/LegalPageLayout.tsx — accessible legal-page layout, review status, support/policy links.
5. src/content/legal.ts — complete proposed policy/terms for owner review, publication flag false until final approval.
6. src/components/marketing/MarketingFooter.tsx — real privacy/terms links.
7. src/components/marketing/GoogleIntegrationSummary.tsx — brief public explanation of optional Gmail/Calendar use.
8. src/pages/LandingPage.tsx — mount the summary before the footer.
9. docs/plans/2026-10-09-google-verification/ — this plan, submission packet, readable policy review and verification record.
10. implementation_plan.md — append a scoped pointer without overwriting other plans.
11. WORK_LOG.md — newest-first preparation/verification entry.

Existing `public/agentflow-icon.png` is a 512×512 PNG, 12,409 bytes; reuse unchanged for Google branding. No image generation, dependency, schema, function, permission, credential, calling or message changes.

## Implementation

Prepare complete readable copy with the actual operator, Google data accessed and purpose, background sync, unmatched-mail/agency visibility, providers, Limited Use commitments, revocation instructions, retained history, deletion request channel and honest retention targets. Do not claim the old PR's server-only credentials, AES encryption, Remove Google access control, working erasure automation, backup expiry or certification are deployed. Keep review labeling until owner approval; do not submit a draft to Google.

Prepare exact Google fields, live-scope inventory with least-privilege discrepancy, Gmail justifications, real-demo storyboard and a short owner checklist. Separate brand verification from scope approval/CASA. No fake demo, client ID, Search Console token, security answer or video URL.

## Verification

Run required npx tsc --noEmit, compare meaningful app diagnostics to the unchanged base, build production assets, inspect changed lint and links, and verify the public pages on an accessible preview. No new low-impact implementation-mirroring tests. No real emails, appointments, accounts or production writes. Record limitations honestly. Publish a draft PR for concrete review; final legal approval and release are the next owner gate.
