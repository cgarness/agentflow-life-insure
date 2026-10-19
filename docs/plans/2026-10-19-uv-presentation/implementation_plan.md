# UV profile presentation follow-up

Chris requested these changes on October 18, 2026 at 19:36 PDT, following the approved live integration release. This explicit instruction authorizes the scoped UI work and release.

## Changes
- AgentFlow: gold View page and Copy link actions on Agent Profile; publishing/contact controls remain exclusively in Settings > My Profile. Private/unready pages have disabled actions, never fabricated URLs. Protected owner receives both navigation actions without a sync RPC.
- UV: replace the separate minimal card with the shared existing full-page layout (header, hero, credentials, services, contact and footer). Render only the resolved agent data. Preserve missing-field behavior, opted-in contact visibility and neutral managed-profile claims.
- Keep contact_card_only as a capability boundary: managed pages remain direct-contact pages without intake, booking, consent or messaging-program enrollment. Existing CG Financial forms, disclosures and page behavior remain unchanged.

## Files
AF: UnderwriterVerifiedProfile and extracted action component; MyProfile settings placement; focused tests and browser fixture; scoped documentation and WORK_LOG.
UV: shared AgentProfileLayout; ManagedContactCard wrapper; Index; Header, HeroSection, CredentialsSection, TrustBar, ContactSection and Footer; focused tests; scoped documentation and WORK_LOG.

## Verification and release
Run focused rendering/privacy/action tests, TypeScript and lint/build. Review desktop/mobile rendering of actual components. Publish scoped PRs, wait for required checks, merge and verify canonical deployments. No migration, Edge deployment, secrets, enrollment, public profile data, RLS, A2P, SMS or dialer changes. Rollback is frontend-only to the preceding deployment.
