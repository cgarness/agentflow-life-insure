## Latest release position — 2026-10-18 04:45 UTC (supersedes the position below)
Production unchanged; no gate is approved. Isolated candidate unchanged at bf536191cab043bca2089d02dee8a6955ededc28 (UV 397dbb91e42aebc83043d9f5605824ff2ba87211). Evidence: verification.md, newest section.

**Blocking access (not an approval).** Authorize the Supabase connector for the Underwriter Verified organization `bmuykmwtwicpltmpenqm` (project `jzdzeevjpootbeuniygx`). Then Gate A live preflight runs read-only: migration history, agents policies/grants/triggers/columns, `agentflow_consent_links`, private schema, receiver preimage and verify_jwt, advisors baseline. Optional for hosted acceptance from this container: allow `www.underwriterverified.com` and `jzdzeevjpootbeuniygx.supabase.co` in the environment's network settings.

**Gate B package (AF backend) — preflighted, awaiting explicit approval.** Inert and independent of the UV backend; may be approved before Gate A only if Chris chooses to deviate from the documented order.
1. Re-take AF advisors and migration list immediately before applying (PR #457 may land first).
2. apply_migration name `uv_profile_sync`, exact bytes of `supabase/migrations/20261018002956_uv_profile_sync.sql` (SHA-256 `b4807643e6ec4106d102f0c30db3a4b8fdad4479a7d80d5da42fc77c3ea4d2aa`). Creates private.uv_profile_sources and private.uv_profile_sync (RLS on, no grants), five empty-search_path SECURITY DEFINER functions; authenticated EXECUTE only on get_my_uv_profile/set_my_uv_profile; service_role only on claim/prepare/finish. No seed rows, triggers, cron or remote calls. Read back catalog: tables, RLS flags, function ACLs, no PUBLIC/anon EXECUTE.
3. Deploy Edge function `uv-profile-sync-worker` with exactly index.ts, handler.ts, ../_shared/uv-profile/protocol.ts and payload.ts at the hashes in the PR record, verify_jwt=false (dedicated Bearer secret). Function is currently absent (no preimage). Read back all four files and verify_jwt.
4. Post-change: advisors equal baseline plus exactly +2 RLS-no-policy INFO and +2 authenticated SECURITY DEFINER WARN; unauthenticated POST returns 401; GET returns 405; no source rows; no schedule.
Rollback before activation: none required (inert). Do not drop tables later without approval; preference/version rows are retained.

**Credential package — separate approval.** Set via the Supabase dashboard prompt (values never in chat/git/logs): AF `UV_PROFILE_SYNC_SECRET` (≥32 chars, identical on UV), AF-only `UV_PROFILE_WORKER_SECRET` (different value), AF `UV_PROFILE_SYNC_ENABLED=false`; UV `UV_PROFILE_SYNC_SECRET`. Never reuse SMS bridge credentials; no VITE copies; RECEIVER_URL stays a code constant.

**Gate D preconditions found in preflight (pilot not ready).**
- Complete Chris's AF licensing data first: every state that should appear needs a license number and a current expiration date (today only NV qualifies; the live page shows five states). Do not relax the filter to publish licenses without expiry evidence.
- Pilot must set both public phone and public email on, and the AF values must equal the currently published UV values or Chris must explicitly approve the A2P legal-page contact change; AF email currently differs from UV's canonical default.
- Register the public brand exactly `CG Financial` / `cg-financial` on both sides; accept that the consent-pinned name stays "Christopher Garness" with an identity_review_required warning, or approve a separate reviewed name decision.
- Exact mapping candidate: AF org `a0000000-0000-0000-0000-000000000001`, AF profile `ecf2bb91-0350-4542-85ec-14d914311e99`, UV agent `e7c2f35a-e215-4e9e-9492-176a344384eb` (owner and consent link to be re-verified live under Gate A access).
- Withdrawal must be tested on a synthetic profile, never on this A2P page.

**Provisioning remedy proposal — not built; requires approval before any new-page rollout.**
R1 (UV migration, #APPROVE_RLS_CHANGE): `submit_public_intake` refuses agents that are unpublished or have no owner (`user_id` NULL) before any request/consent write.
R2 (UV frontend): for ownerless managed profiles, hide quote/book-call/SMS opt-in forms and the agent-specific legal links; show only the contact actions the agent published.
R3 (UV frontend/metadata): for managed profiles without an owner, omit the "Verified" badge, "✅ Agent Verified" metadata and "Licensed in N States" claim, or show neutral wording such as "Licensed states on file". Changing the live canonical page's wording is a separate decision for Chris.
R4 (receiver): provisioning requires at least one published contact channel.
UV-owner SSO and consumer-request import into AF stay out of scope.

## Latest release position — 2026-10-18
Isolated implementation and synthetic desktop/mobile acceptance are verified; final exact-head CI records are on the paired PRs. See verification.md for immutable code/run/artifact evidence. Production release has not started. UV project management permission is still denied; live preflight must precede Gate A approval. Keep allow_provisioning=false: owner/inbox/routing/legal acceptance is incomplete and inherited unconditional verification/licensing claims require explicit review before new pages. No credentials, flags, schedule, mapping or deployment was changed. Existing consent/A2P page remains untouched.

# Separately gated release — NOT authorized by build approval

No migration, function, credential, scheduler, frontend or profile mapping was applied to production by this task.

1. Verify UV live schema and existing Edge code. Its management access was previously denied; do not infer live schema from fixtures. Review and approve exact UV migration 20261017222810_agentflow_profile_sync.sql and full agentflow-profile-sync function with its dedicated authentication. Keep new sources disabled and provisioning false. Run advisors and verify private/public grants after approved DDL.
2. Identity-check and separately approve the existing Christopher Garness / CG Financial UUID link. Preserve UV UUID, owner, canonical agency/agent slugs and consent link. Never link by email or name alone. New-profile lead/intake routing, legal contact information and UV-only editing access need acceptance before any new-profile rollout.
3. Review and separately approve AgentFlow migration 20261018002956_uv_profile_sync.sql and full uv-profile-sync-worker code. It creates no enrollment, secrets or cron. Inspect hosted function preimages first. Configure UV_PROFILE_SYNC_SECRET on both backends, a DIFFERENT UV_PROFILE_WORKER_SECRET on AgentFlow, and UV_PROFILE_SYNC_ENABLED=false. Never put these in VITE variables, source or logs. Verify advisors/grants; register exact matching public agency identity separately on each backend.
4. Separately approve frontend merges/releases after backend availability. AgentFlow VITE_UV_PROFILE_ENABLED remains false until the UI gate. UV frontend publication-column queries require its backend migration first. Never merge an unrelated PR or change dialing.
5. Separately approve pilot enrollment/contact visibility, source enabled flags, worker activation and a bounded schedule (suggested once a minute). Prove a synthetic profile's publish/edit/withdraw lifecycle, canonical existing identity preservation and no duplicate profiles. The UI reports Syncing until acknowledgement; cross-system withdrawal is not instantaneous during an outage. Keep provisioning false until new-profile intake/privacy/ownership acceptance is complete.
6. Wider activation is a separate approval after pilot evidence. Rollback: stop new enrollment/publication, leave withdrawal worker functioning until existing requested withdrawals are acknowledged, then disable scheduling/worker. A Vercel rollback alone does NOT unpublish UV database records. Do not drop mapping/tombstone tables or reset version counters.

Context: no consumer leads or SMS sent; no production dialer, RLS, account ownership or consent evidence changed. Actual licensing/identity verification remains out of scope.

## October 18 candidate correction
AF migration remains unapplied. SHA-256: b4807643e6ec4106d102f0c30db3a4b8fdad4479a7d80d5da42fc77c3ea4d2aa. This supersedes cf41abf999e6e579f5249183ceeb0266c85b2763e9a531cb5a83c6e88e9b5d09 because license projection now reuses the existing canonical public.normalize_us_state(text); full-name licenses must not disappear. No existing normalizer definition, grants or live state changed. Paired UV candidate: 397dbb91e42aebc83043d9f5605824ff2ba87211; its migration hash remains 027ac014a3ce5d982990925bfb864e76e2d34b7025fddcdea41616ccc547f8cd.
