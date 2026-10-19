# Save-driven UV updates and existing-page access

Completed in production at 02:21 UTC on 2026-10-19: PR #462, migration hosted20261019021934, Vercel dpl_AznU7guUBZTPih9WnKw1qGMn8PkJ. Exact verification and remaining owner live-agent acceptance are recorded in release.md and production-evidence.json. Earlier pending gates below describe the preparation phase.

Chris approved replacing ongoing profile polling with updates after Profile Information saves, and reported the missing UV button on his Agent Profile. This authorizes preparation and local verification of this scoped replacement. Production application and repository publication are recorded separately after the exact candidate is ready; no earlier permission to change the protected A2P page is inferred.

## Behavior

- A committed change to shared profile fields queues only that enrolled profile. No typing, page view, availability/presence update, unchanged Save, or unenrolled profile causes a delivery.
- Database triggers observe the existing Profile Information Save write; the browser never handles worker credentials. The queue survives a closed browser or a failed asynchronous dispatch. Existing photo/license saves and publication/contact preference saves queue their relevant changes too.
- Keep withdrawal events for deletion, agency transfer, deactivation, source disablement, and a stored next license-expiration deadline. These are lifecycle events, not periodic comparison of every agent's profile.
- After acknowledgment, a row sleeps until another event (or its next known license deadline). Errors retain bounded backoff and leases. An indexed minute retry/backlog check starts the worker only when a due, unleased, nonexcluded queue row exists. No empty Edge worker invocation when idle.
- Replace only the UV cron command after the event path exists in the same transaction. Keep the existing worker, signed receiver, exclusion guards, payload version protocol, ACLs and RLS policies.
- Status requests stop while settled. A 30-second maximum status refresh window is allowed after opening a pending profile or saving; manual Refresh remains available for a long-running attempt.
- Chris gets an Underwriter Verified View link under his Agent Profile header and in My Profile, pointing to his exact existing CG Financial page. It is available only in his real own-account scope, contains no publish/edit action, and makes no UV sync RPC. His protected exclusion and page remain unchanged.

## Files

- New CLI-generated `supabase/migrations/*_uv_profile_save_driven.sql`: private event/dispatch helpers, triggers, dormant default for new private queue placeholders, replacement finish function and exact scheduler-command change. Existing applied migrations stay byte-identical.
- `src/components/underwriter-verified/UnderwriterVerifiedProfile.tsx`: protected existing-page link, explicit UV title, pending refresh action.
- `src/hooks/useUnderwriterVerifiedProfile.ts`: settled-state polling removal and bounded pending refresh after relevant saved profile changes.
- `src/test/uvProfile.test.tsx`: existing-page scope and bounded status refresh regression tests.
- `scripts/tests/uv-profile/save-driven.mjs`: synthetic SQL tests for save events, idle behavior, retries, rollback, permissions, exclusions, leases and lifecycle changes.
- `.github/workflows/uv-profile-sync.yml`: run the new SQL scenarios in the existing native PostgreSQL job.
- This scoped plan, verification/release records, `WORK_LOG.md`, and the new operational invariant in `AGENT_RULES.md`.

## Validation and release

Read-only live preflight on 2026-10-19: zero enrolled sync rows; Chris's protected exclusion present; cron job 14 `uv-profile-sync-every-minute` active. Remote AF main remains a18874e13e674020039264944d07b22d5b8eb855. Local activation records fd076ee remain unpublished after the previous approval-review rejection.

Run relevant frontend tests, TypeScript (including exact-base comparison where needed), scoped lint/build and synthetic PostgreSQL scenarios. Test actual replacement SQL with simulated Vault/net/cron surfaces, never with production credentials or calls. Confirm save dispatch does not wait on HTTP and dispatch failure preserves the queued work. Confirm stale leases cannot clear newer saves. Record verification limits honestly.

Before production application, compare the deployed finish function and named cron job to the expected preimage, preserve all unrelated schedules and permissions, then apply only the reviewed new migration. Confirm the job now uses a due-only dispatcher and no worker requests occur while idle. Release the tested frontend through normal GitHub/Vercel flow. Chris will perform live-agent acceptance after release, as requested. Do not alter UV receiver code/data, Twilio, A2P, consent, or exclusion rows.

Rollback: restore the prior named cron command and finish function from their reviewed preimages if necessary, preserving all queued versions and withdrawals; do not erase queue rows or remove protected exclusions. A frontend rollback alone must never be described as withdrawing pages.
