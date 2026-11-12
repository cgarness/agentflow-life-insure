# Carriers directory — expandable cards

## Authority and status

Chris selected the simplified expandable-card design, then said **“Proceed with the build.”** This authorizes implementation, isolated verification, a feature branch, and a reviewable pull request. Production migration execution, production data changes, merge, and deployment remain separate actions requiring Chris's approval of the finished result. This plan was written before implementation edits.

Baseline: `e07d28bdef1d8a9a21f0eee408b181b625389527`; branch `feat/carrier-directory-20261111`. Read `AGENT_RULES.md`, `VISION.md`, and latest `WORK_LOG.md`. The latest Fidelity carrier identity and commission changes must be preserved. PR #527 (Team Commissions), #486 (age/backfill), and #398 (underwriting draft) are separate work; recheck main before publishing.

Implementation is complete on the feature branch. Local focused verification passes 281 tests across 17 files; root TypeScript, production build, scoped lint and native PostgreSQL 17.11 pass. The strict application TypeScript comparison reports base=79, candidate=78, new=0 after removing an inherited impossible Sidebar comparison. Hosted PostgreSQL 17.6 and isolated browser gates have passed; final follow-up results are recorded in the pull request. Local Chromium is blocked before launch. See [verification](verification.md) for evidence, limitations and the exact pending production sequence.

## Product behavior

- Add **Carriers** beside Training/Resources in the existing sidebar and authenticated app shell.
- Name-only search, alphabetical full-width cards, all initially closed, one card open at a time. Use the existing accessible Radix Accordion.
- Expanded content: **Quick links**, **Guides & training**, **Contacts**. Existing portal appears once. Hide empty groups; show a short empty message if the carrier has no resources.
- External resources open in a new tab with safe HTTP(S) URLs and `noopener noreferrer`. Phone/email actions use `tel:`/`mailto:` and an explicit phone-copy action. No Twilio or call telemetry work.
- Admins maintain labeled, ordered resource links in Settings → Carriers. Agents read only. Preserve existing names, identities, appointments, contacts, logos, and portal values unless those fields are deliberately edited.
- No personal appointment badges, separate carrier detail pages, favorites, embedded media, new underwriting engine, credentials, or production sample data.

## Data and access contract

Add only `public.carriers.resource_links jsonb NOT NULL DEFAULT '[]'`. It is an ordered array of at most 50 exact objects `{id,label,url,group}`: UUID id (unique per array), nonblank label up to 120 characters, HTTP(S) URL up to 2048 characters, and group `quick_links` or `guides_training`. Validate in Zod and a private SECURITY INVOKER write trigger with fixed search path and no direct client execution grants. Do not modify existing RLS, table grants, indexes, or the updated-at trigger.

Generate using installed Supabase CLI 2.84.5, then keep the authored migration at `supabase/migrations/pending/carrier_resource_links.sql`, outside the active migration glob. Record generated version and final checksum in verification. Production release is backend first, frontend second. No migration/backfill/seeding runs against hosted databases during this build.

Generated version: `20261111182547`. Pending SQL SHA-256: `6809e2be65dd77835251edd069b85e043ac6793d9dfce6266f6954401e3ce97d`.

Read-only production inspection confirmed PostgreSQL 17.6, own-organization Agent/Team Leader reads, own-organization Admin writes, and an existing Super Admin cross-organization exception. Preserve that exception, do not claim universal cross-organization denial. Existing broad table ACLs (including TRUNCATE) are unchanged and outside this feature; no claim that RLS covers TRUNCATE.

Use explicit organization filtering plus RLS, with query scope including authenticated identity and organization. Hide/reset stale data on identity, organization, access, or View As changes. Settings writes must confirm one affected row and preserve drafts on failure; resource-only edits must not rewrite carrier identity or legacy fields. Invalidate directory reads after acknowledged saves.

Add a shared append-only Carriers permission default for legacy saved arrays. Explicit saved true/false values win; malformed explicit flags deny. Preserve unrelated permissions and order. Use the same normalizer in enforcement and Settings. Preserve Admin/Super Admin semantics and the existing View As allowlist. The historical Reports byte pins for `permissionDefaults.ts` and `usePermissions.ts` will be refreshed only for this narrow new-feature change, with semantic preservation/parity tests; the AGENT_RULES warning against changing the hook merely for Commissions does not prohibit this independently authorized feature.

## Intended files (before edits)

Application:
- `src/pages/CarriersPage.tsx`
- `src/components/carriers/CarrierDirectory.tsx`
- `src/components/carriers/CarrierAccordionCard.tsx`
- `src/components/carriers/CarrierResources.tsx`
- `src/components/settings/carriers/CarrierResourceLinksEditor.tsx`
- `src/components/settings/carriers/carrierSchema.ts`
- `src/components/settings/Carriers.tsx`
- `src/lib/carrierResources.ts`
- `src/hooks/useCarrierDirectory.ts`
- `src/integrations/supabase/types.ts`
- `src/config/permissionDefaults.ts`
- `src/hooks/usePermissions.ts`
- `src/components/settings/Permissions.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/App.tsx`

Verification and database:
- `src/lib/__tests__/carrierResources.test.ts`
- `src/hooks/__tests__/useCarrierDirectory.test.tsx`
- `src/components/carriers/__tests__/CarrierDirectory.test.tsx`
- `src/components/settings/carriers/__tests__/CarrierResourceLinksEditor.test.tsx`
- `src/components/settings/__tests__/CarriersResources.test.tsx`
- `src/lib/__tests__/carrierPermissions.test.tsx`
- `src/lib/__tests__/reportsContracts.test.ts` (two reviewed blob pins only)
- `src/components/layout/__tests__/viewAsSidebarNav.test.tsx`
- `src/components/layout/__tests__/viewAsRouteAllowlist.test.tsx`
- `src/lib/__tests__/viewAsSurfaces.test.ts`
- `supabase/migrations/pending/carrier_resource_links.sql`
- `supabase/tests/carrier_resource_links_fixture.sql`
- `supabase/tests/carrier_resource_links.sql`
- `scripts/run_carrier_resource_links_tests.sh`
- `.github/workflows/carrier-directory.yml`
- `scripts/tests/carriers/browser/{vite.config.mjs,main.tsx,client.ts,auth.ts,index.html,verify.mjs}` (added to this manifest before authoring: isolated browser rendering of the real directory/Settings components, synthetic auth/data adapters, external requests blocked; separate from native database proofs)

Documentation:
- This plan and adjacent `verification.md`
- Root `implementation_plan.md` (new current-task pointer, historical content preserved)
- `WORK_LOG.md` (newest-first entry)

Any necessary additional file will be recorded here before editing. New components remain below 200 lines; the existing Settings component is a known legacy exception. Tailwind only. No dependency upgrades, lockfile changes, public RPCs, credentials, production fixture data, or changes to policy/commission/dialer logic.

## Verification and release gates

1. Capture baseline root and application TypeScript diagnostics before implementation.
2. Unit/integration tests: schema and URL safety, keyboard accordion/search/empty/error states, actual clipboard feedback, editor ordering and failed-save draft retention, acknowledged organization-scoped writes, no stale identity data, permission backward compatibility and View As exclusion.
3. Disposable native PostgreSQL verification: migration/defaults/old-field preservation; valid writes and malformed rejection; Agent/Admin isolation and preserved Super Admin exception; unchanged policies, ACLs, indexes, old trigger; trigger function security metadata.
4. Run required `npx tsc --noEmit`, application diagnostics comparison, scoped lint, focused regression suites, and production build. Report baseline failures honestly. Browser verification must use an isolated synthetic environment, never a production-connected preview for writes.
5. Review full diff, ensure no private data/secrets, recheck main, commit feature branch, open PR, and inspect actual CI outcomes. A deployment or native CI result is not called verified until observed.
6. Present PR, evidence, remaining limits, and exact pending backend/release action for Chris's approval. Do not merge, deploy, or execute hosted mutations in this build.
