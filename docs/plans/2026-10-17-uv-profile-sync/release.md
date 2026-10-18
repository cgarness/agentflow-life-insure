## 2026-10-18 06:15 UTC — Gate A applied and verified; Gate B awaits approval

Chris's `APPROVE_RLS_CHANGE` at 06:07:44 UTC approved **UV backend foundation only**. This current section supersedes earlier pending/unchanged-production statements below. Gate A is complete; the AgentFlow → UV user workflow is not yet live.

- UV project `jzdzeevjpootbeuniygx`: exact source migration `20261017222810_agentflow_profile_sync.sql` (SHA-256 `027ac014a3ce5d982990925bfb864e76e2d34b7025fddcdea41616ccc547f8cd`) was recorded by Supabase as **`20261018060903_agentflow_profile_sync`**. Hosted statements equal the source bytes exactly. Preserve this source-to-hosted mapping; do not rename, replay, or edit the applied migration.
- New receiver `agentflow-profile-sync`, ID `569992e7-4011-4523-b5db-3ec5540a32a4`, **version 1 ACTIVE**, `verify_jwt=false`, dedicated HMAC handler. Bundle SHA-256 `ca816d866cc84db89eb07be8db900a0d63f6495700926b05e5cacb7ea7f92840`. All four retrieved files exactly match the approved hashes below. The other three functions are unchanged.
- Live columns, policies, RLS, trigger and RPC ACLs match the migration. Private sources/links/nonces contain zero rows; enabled/provisioning defaults are false. Anonymous reads preserve both existing published/unmanaged profiles. All original agent fields and aggregate consent/intake/STOP fingerprints match the pre-change snapshot.
- Unsigned canonical POST returned **503 `{"error":"not_configured"}`**, no-store, from the deployed Deno runtime; no database delivery occurred. Canonical profile returned HTTP 200 with unchanged title/photo metadata and production bundle.
- Advisors: only expected additions — three private-table RLS/no-policy INFO, one unused nonce-age index INFO, and one authenticated multiple-permissive SELECT performance WARN. No new security WARN/ERROR, public definer grants, missing RLS or mutable search paths. See verification.md for counts and remediation references.

**Current rollback position:** disabled backend foundation retained. No new source, mapping, credentials, flags, scheduler, profile publication, AF backend, frontend merge or production frontend deployment was performed. No destructive rollback is needed. Retain durable mappings/versions/withdrawal/consent state; do not restore SELECT=true or drop tables. Later withdrawals must be acknowledged before worker shutdown. External preview caches cannot be recalled.

### Exact next approval: Gate B, AgentFlow backend foundation only

Project `jncvvsvckxhqgqvkppmj`; reviewed AF runtime at `8d752a440912cfc541dd9af67dba27b8d2f44fb1`, with documentation-only follow-up. Fresh 06:13 UTC reads: feature tables/RPCs/schedule absent; exact worker lookup says Function not found. Concurrent **`20261018060615_seal_list_unrestricted_users`** is now applied externally, superseding the 05:44 preflight. This task did not apply it. Recheck history/advisors immediately before Gate B.

1. Apply only `supabase/migrations/20261018002956_uv_profile_sync.sql`, SHA-256 **`b4807643e6ec4106d102f0c30db3a4b8fdad4479a7d80d5da42fc77c3ea4d2aa`**. Two private tables with RLS and no direct client/service-role grants; five SECURITY DEFINER RPCs with empty search_path; authenticated self-profile get/set only, service_role claim/prepare/finish only. No core profile/license triggers, seed rows or schedule.
2. Deploy complete `uv-profile-sync-worker` with `verify_jwt=false` and its dedicated Bearer authentication; files under supabase/functions:

| File | SHA-256 |
|---|---|
| uv-profile-sync-worker/index.ts | d5537a4aadfb0190b27e484ea823be22905d78b7f597da5fa4624ebf45b6684d |
| uv-profile-sync-worker/handler.ts | 76564f229e5b1e970e8b6ce1f6abf1cda6273e96c93b0696117b717e758fad12 |
| _shared/uv-profile/payload.ts | 7815b44e5b4656c2c307c96ec52192e430ca5535984cac2e64046fb5e061d228 |
| _shared/uv-profile/protocol.ts | ccdd801d09744976ea63dac39990f2b72d236c6c0675fc33eef1a2317fc846c4 |

3. Read back complete files/settings, SQL bytes/catalog/grants and empty tables; prove unauthenticated POST 401 and GET 405 (or 503 only if the runtime's own project URL/key is unavailable); compare advisors and ensure no schedule/source activation. Expected security additions: two intentionally inaccessible private-table INFO and two authenticated self-profile SECURITY DEFINER WARN. Do not remediate unrelated findings.
4. Withhold activation on rollback; preserve preference/version/lease state. Corrective SQL needs separate review.

**Gate B approval excludes credentials.** Credential configuration remains separate: distinct `UV_PROFILE_WORKER_SECRET` (AF only) and dedicated `UV_PROFILE_SYNC_SECRET` (both backends), `UV_PROFILE_SYNC_ENABLED=false`. Values must never enter chat/git/logs; no SMS credential reuse. `VITE_UV_PROFILE_ENABLED` is the frontend flag; `RECEIVER_URL` remains a code constant. Frontend releases, existing UUID linking, exact public/contact/legal choices, pilot activation/scheduler and wider publication retain their separate approvals.

**Pilot blockers remain:** mismatched NPN/NV license number, AF one eligible state versus UV five, different email and consent-pinned name, plus explicit legal contact choices. No profile data was corrected or linked. New-page owner/inbox/intake/legal remedies R1–R4 remain proposals; `allow_provisioning=false`. No actual license/identity verification is claimed.

## 2026-10-18 05:44 UTC — concurrent main reconciliation

AF main is now `f3d9b0ccf08d692cef6bd39a11cb32fb4e20443f` (PR #457 merged at 05:28:38 UTC). Earlier main/deployment statements below describe the earlier read-only snapshot, not the new current base. Reconcile the feature branch with this main; preserve both WORK_LOG prefixes, all other upstream files unchanged, and the unrelated root plan. Feature runtime, migration hashes and UV peer pin remain unchanged. Fresh AF migrations remain through `20261017043757`; security advisor counts remain 27 RLS/no-policy, 22 mutable-search-path, 2 public-RLS-disabled, 3 extension-in-public, 58 anon/121 authenticated definer, 1 leaked-password. The merged security migration is not recorded applied and is outside this release. Re-run exact-base profile and full Reports comparisons; final head/results go on the PR. UV documentation head `4d65109581315d107bd33222753c55d5ae1252df` passed workflow `39100875987`. No production action by this task; Gate A still awaits its explicit approval.

## 2026-10-18 05:30 UTC — Gate A preflight complete; explicit approval required

Chris transferred implementation ownership back to this workspace. Both named Supabase connections work. UV live schema, policies, grants, constraints/indexes, triggers, existing owner and consent identity, migration history, receiver absence and advisor baseline are verified in verification.md. This supersedes earlier access-blocked status; no production gate has been approved or executed.

**Exact next approval scope: UV backend foundation only.** Project `jzdzeevjpootbeuniygx`; apply only `supabase/migrations/20261017222810_agentflow_profile_sync.sql`, SHA-256 `027ac014a3ce5d982990925bfb864e76e2d34b7025fddcdea41616ccc547f8cd`, then deploy only `agentflow-profile-sync` with these complete files and `verify_jwt=false`:

| File under supabase/functions | SHA-256 |
|---|---|
| agentflow-profile-sync/index.ts | 3ff98559f71bc15cbcec8ed47d5a4c37e1196d164bba07041da866b54281f1fe |
| agentflow-profile-sync/handler.ts | 8053cd4b61022191279fed849db39d8d1b04ad0fdd8f8093993a53bc692e7067 |
| _shared/uv-profile/payload.ts | 7815b44e5b4656c2c307c96ec52192e430ca5535984cac2e64046fb5e061d228 |
| _shared/uv-profile/protocol.ts | ccdd801d09744976ea63dac39990f2b72d236c6c0675fc33eef1a2317fc846c4 |

The SQL adds publication/managed flags (existing rows remain published/unmanaged); replaces public SELECT=true with published-only reads plus owner private reads; adds private sources/links/nonces with RLS and no direct PUBLIC/anon/authenticated/service_role grants; locks AF-managed fields against client modification; grants only service_role execution of nonce/apply RPCs with empty search_path. No source/mapping rows, credentials, scheduler or activation are installed. Existing owner write policies, ownership/slugs, biography/booking/testimonials and consent evidence remain intact. The receiver performs dedicated HMAC authentication before privileged apply; gateway JWT checking is intentionally false only for this new function.

**Execution after approval.** Recheck live migration/policies/function absence and file hashes immediately before writing. Apply exact SQL using apply_migration and record the actual hosted version (the tool may assign a different timestamp; never replay the migration directory). Deploy all four files, then read back their complete content and verify_jwt setting. Verify columns/policies/grants/trigger/RPC ACLs, all three new tables empty, no enrollment, unchanged canonical content and consent identity, public page 200, and advisor deltas against the baseline. Probe only unauthenticated canonical receiver requests: with a missing signing credential POST must fail closed with 503; if a valid dedicated credential already exists, an unsigned POST must return 401. Do not create credentials or signed production test data within this gate. Replay/hosted reconciliation acceptance belongs to the separately approved credential/pilot gate.

**Rollback position.** No production action needs rollback yet. After this disabled foundation, withhold source enrollment and activation; retain schema and empty durable state. If later writes occur, retain mapping IDs, versions, withdrawal and consent records, and acknowledge required withdrawals before stopping a worker. Do not restore public SELECT=true or drop durable tables. Any corrective SQL needs its own review/approval. Frontend rollback cannot unpublish data or recall external caches.

**Other gates remain separate.** AF backend (Gate B), credentials, exact-head frontend releases (Gate C), UUID mapping/public fields/activation/scheduler (Gate D), and wider/new-profile publication (Gate E). New-page remedies R1–R4 are proposals requiring their own build scope; allow_provisioning=false. UV's schema must precede its frontend. No actual identity/license verification is added by this feature.

**Canonical pilot is blocked on data review.** Direct live comparison now proves NPN and NV license-number mismatches, not merely missing expiry. AF would publish only one license versus five on UV. Photo bytes match; phone digits match; emails differ; opt-in defaults would remove legal contact details. Do not change either data set, publish the differing NPN/license, or link the consent-pinned page until Chris approves the exact public/contact/legal diff. Source-of-truth direction does not establish that an entered license value is accurate. See verification.md; no actual credential verification is claimed.

Proposed repository invariant (not applied): before first linking or resuming a consent-linked profile, compare exact NPN/license values, approved contact/legal surfaces and pinned identity against current source data; synchronization success is never evidence of credential accuracy.

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
