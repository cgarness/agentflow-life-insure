# AgentFlow to Underwriter Verified profile synchronization

## October 18 continuation: approved isolated corrections
The handoff explicitly requests the validator and configuration corrections under the existing build approval. Before editing: paired shared payload.ts; UV src/test/uvProfileProtocol.test.ts; both existing uv-profile-sync.yml workflows (full changed-TypeScript lint, pinned peer); scoped plan/release/verification documents and newest-first WORK_LOG.md entries. Synthetic checks only. Production gates stay separate; root plan and unrelated releases remain untouched.

Date: 2026-10-17
Status: Chris approved the isolated build in ChatGPT ("I give you permission to take care of this build"). Production changes, RLS application, credentials, scheduler activation, merges and deployments are NOT approved by this build authorization.
Base: e2ddef261e0288a058f8bf1eaa6f9c1ace8d7881
Paired repository: cgarness/underwriter-verified, base 2501713d368aa1ad0cea6acc1792fb51f3cb1c8c
Branch in both repositories: codex/uv-profile-sync-20261017

## Source review and concurrent work
AGENT_RULES.md, VISION.md and newest WORK_LOG entries reviewed. Root implementation_plan.md belongs to commission preview PR #455; preserve it. Existing dialer, reporting, commissions and Google Sheets releases are outside scope. UV has no AGENT_RULES.md/VISION.md/AGENTS.md; its Work Log, consent bridge, transfer, profile preview documents and source were reviewed. AgentFlow profile schema was inspected read-only. UV live management access is permission-blocked; verify its live schema and function preimages before any production release.

## Product and boundaries
AgentFlow is the source for opt-in public name/photo/contact/NPN/licensing. UV stays the public website. Add compact View/Copy/profile publication controls to the existing Agent Profile and My Profile surfaces, with explicit public-phone/public-email choices. No new UV signup for newly provisioned profiles. Preserve existing UV-only biography, booking and authentic testimonial content. Do not generate testimonials or interpret profile readiness as credential verification.

Use stable UUID mapping, never email/name-only account claiming. Existing profiles require an operator-reviewed link before enabling synchronization; no canonical Christopher profile duplication. Preserve UV agent UUID, owner, existing agency/agent slugs and SMS consent evidence. Consent-pinned name and agency changes require separate review, not automatic bridge rewrites. CRM internal agency name is not necessarily the approved public business brand.

## Architecture
One-way server-to-server synchronization with dedicated credentials unrelated to SMS. An enrolled-profile reconciliation worker reads fresh canonical profile and agent_state_licenses records, creates durable versioned delivery state and retries safely. No remote work or fallible sync trigger in ordinary profile/license save transactions. Worker leases prevent concurrent ownership; receiver rejects stale versions and duplicate-body conflicts. Profile removal, deactivation or organization change schedules unpublishing, not reassignment. Private delivery/link data must not be publicly readable. Backend activation defaults off; no seed rows or cron/secrets applied by schema installation.

Per-organization activation and approved public agency branding are server-controlled. User configuration RPCs derive current user and organization from authenticated context. Only that user may change publication/contact choices; no new admin/downline/View As powers. Public data is explicit allowlisted data only; no lead/client/call/commission/credential exposure. Actual license verification remains a separate feature.

## Intended file inventory before application edits
AgentFlow:
- this scoped implementation_plan.md, verification.md, release.md and newest-first WORK_LOG.md entry
- src/lib/uv-profile/*, src/hooks/useUnderwriterVerifiedProfile.ts
- src/components/underwriter-verified/*; small composition insertions in src/components/agent-profile/AgentProfileTab.tsx and src/components/settings/MyProfile.tsx
- focused unit/component tests for those modules
- new generated supabase/migrations/*_uv_profile_sync.sql (not applied)
- supabase/functions/uv-profile-sync-worker/* and a dedicated shared profile protocol helper; only corresponding config.toml entry
- isolated SQL/Edge tests and .github/workflows/uv-profile-sync.yml (test-only; no deployment or production secrets)
UV:
- scoped plan/release/verification and WORK_LOG.md entry
- new generated supabase/migrations/*_agentflow_profile_sync.sql (not applied)
- dedicated agentflow-profile-sync Edge endpoint/helpers; only corresponding config entry
- public agent hook/search/metadata publication filters, scoped public AgentData provider and Index composition
- existing Admin linked-field locking/save payload restriction and tests
- dedicated test-only CI workflow.
Any additional necessary file must be recorded here before editing. No broad rewrites.

## Gates and verification
Use Zod, Tailwind, organization_id, explicit grants and RLS, .maybeSingle() for possible zero rows and surgical components. Read live Edge code before any later deployment; preserve auth settings except for approved new handlers. Generate migration filenames with Supabase CLI, not invented timestamps. Test with synthetic data only in isolated databases: authorization, publication visibility, identity collisions, stable slugs, canonical consent preservation, duplicate/stale deliveries, retries/outage, photo bounds, licensing removal/expiry, profile removal, View As and opt-out races. Run npx tsc --noEmit plus project app typecheck, changed-file lint, focused/full regression suites and builds; distinguish known baseline failures. No production form submission, SMS, lead import, migration or deployment. Run hosted advisors after separately approved backend changes.

Release gates: exact reviewed UV backend/RLS and existing-profile mapping; exact AgentFlow backend/RLS/credentials; tested frontend release; explicit pilot activation with contact-publication consent; wider agency activation only after pilot. Every consequential production action is separately approved. Final report must state actual commits, tests, blockers, migrations/deployments and next step honestly.

## License normalization correction inventory
Repo Schema Gotchas requires public.normalize_us_state for canonical mixed-format licenses. Read-only live inspection confirms the function and 10 full-name rows. Add the still-unapplied 20261018002956_uv_profile_sync.sql and scripts/tests/uv-profile/paired.mjs to this correction inventory before editing. Reuse the existing normalizer; no production change or alteration of that function. The test fixture loads its exact baseline definition, covers full names/duplicate spelling/invalid names, and keeps expiry, organization and license validation.

## Isolated browser acceptance inventory
Add scripts/tests/uv-profile/browser/{index.html,entry.tsx,auth.tsx,vite.config.mts,verify.mjs} and a browser job to the existing scoped verification workflow. Run Chromium in GitHub Actions with synthetic RPC/public-read transport and a test-only auth provider; real AF controls/API/hook and UV page/search components. No real credentials, forms, hosted writes, deployment or network-policy changes. Capture desktop/mobile screenshots and verify View/Copy, separate contact choices, status, source updates, public search, withdrawal, and sign-out/View As isolation. This is synthetic browser evidence, not hosted runtime/pilot proof. Metadata/photo handlers remain covered by existing server tests; live hosted acceptance remains gated.

Browser fixture refinement before editing: add af-subject.tsx and uv-subject.tsx as real test entry modules; Vite dependency scanning cannot read a synthetic filesystem module. No production paths change.
