# Release package — save-driven UV sync and existing-page link

Chris explicitly approved publishing these fixes, applying the exact AgentFlow migration, and releasing after required checks pass on 2026-10-18 at 19:02 PDT. This supersedes the publication/production authorization hold below. Prepared, not yet released. Branch `codex/uv-save-driven-20261019` includes prior unpublished AF activation records fd076ee and this candidate. Existing remote main a18874e13e674020039264944d07b22d5b8eb855 was confirmed read-only.

## Exact backend candidate

- Project: AgentFlow `jncvvsvckxhqgqvkppmj` only.
- Migration: `supabase/migrations/20261019015242_uv_profile_save_driven.sql`.
- SHA-256: `4b2dd7a14a1d8a18586d61e7cd7dbbbd692f79d90efb5d055bdd37ff8ae1accd`.
- Adds private revoked-access trigger/dispatch helpers and source-event triggers; sets new private queue placeholders dormant; replaces only the existing finish function while retaining its ACL; replaces only job 14's command with `SELECT private.dispatch_uv_profile_sync();` using the existing job name, owner and schedule.
- No RLS-policy edits, no new public RPC, no Edge deployment, no credential rotation, no UV-side migration or profile mutation. Protected exclusions and existing CG Financial page are retained.

## Frontend candidate

Own protected profile receives an Underwriter Verified View link to `https://www.underwriterverified.com/cg-financial/christopher-garness` beneath the Agent Profile hero and in My Profile. This is navigation only, not enrollment or a publishing control. Other agents retain explicit publication/contact choice. Settled status polling ends; a pending operation may refresh for at most 30 seconds, then requires Refresh or reopening the page.

## Release steps

1. Obtain explicit publication/production authorization. Earlier automatic approval review rejected pushing the prior release records because external repository mutation/data disclosure lacked explicit authorization and remote trust was unverified. No attempt was made to route around that rejection in this task.
2. Publish this scoped AgentFlow branch and open its PR; verify the native SQL job and normal required CI on the exact head, including no unrelated source edits. The existing Underwriter Verified activation-record branch can be published under the same explicit authorization if Chris approves both repositories; no UV runtime change is needed.
3. Recheck deployed function/cron preimages, protected exclusions and unrelated schedules. Apply only the exact AF migration. Read back its stored SQL, function ACLs/RLS posture and job command; confirm an idle interval creates no UV worker invocation. Preserve queued versions, retries and withdrawals.
4. Merge/release the verified frontend through the established GitHub/Vercel flow and confirm the production deployment. Chris performs live-agent acceptance. Do not declare the replacement live based on local files or CI alone.

Rollback is a separately reviewed forward migration restoring the prior finish body and named UV cron command from their known preimages, keeping all queue rows and protected exclusions. Never disable all delivery while public withdrawals are still pending.
