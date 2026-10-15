# Team Leader invitation hotfix — 2026-10-15

## Authority and scope
Chris requested an immediate fix, then explicitly directed ChatGPT to implement the scoped proposal here. Approved scope: Team Leaders invite new Agent accounts into their own organization, with themselves as upline; send/copy/resend support; the two named Edge deployments and corresponding frontend release. No production test accounts/emails, schema/RLS changes, new direct-create workflow, or unrelated permissions.

Baseline main: `03ef0cbaecb1074655d568eb5a5a6a3d94d08866`. Initial live functions: invite-user v225; send-invite-email v229; both verify_jwt=false. Re-fetch immediately before deploying. Read AGENT_RULES (workflow, tenancy, signup and system-email invariants), VISION, and newest/relevant WORK_LOG entries. Open concurrent work must not be merged as part of this hotfix.

## Files to change
- supabase/functions/invite-user/index.ts
- supabase/functions/send-invite-email/index.ts
- src/components/settings/user-management/InviteUserModal.tsx
- src/components/settings/UserManagement.tsx (pending-invite refresh only)
- src/lib/__tests__/teamLeaderInvitations.test.ts
- src/components/settings/user-management/__tests__/InviteUserModal.test.tsx
- This implementation_plan.md, WORK_LOG.md and the relevant AGENT_RULES.md invitation invariant.

## Implementation
1. Regression tests execute the actual Edge handler source with fake Auth, database and mail boundaries; no production connection. Reproduce the admin-only refusal before edits.
2. Allow Team Leaders through invitation-specific authorization only. Permit Agent role only; derive organization and upline from stored caller identity; reject foreign upline/org/team assignments. Keep ordinary Agent denial and existing Admin/Super Admin privileges.
3. Resend: resolve recipient/token from stored invitation; a Team Leader can resend only their own Agent invitation in the same organization and direct downline. Keep shared isOrgAdmin/canManageOrganization unchanged. Reject expired/non-pending invites without extending expiry.
4. Align form options with real authenticated profile. Zod validation for send and copy; one shared in-flight guard; preserve truthful email/copy results. Refresh pending invitations explicitly after success. No general user-management redesign.
5. Run focused Edge/form/signup tests, root npx tsc --noEmit, app TypeScript baseline comparison, scoped lint, Deno bundle check and Vite build. Distinguish pre-existing failures from regressions.
6. Publish only the tested diff on a dedicated branch and merge via a head-guarded PR; no direct main push. Re-fetch and deploy complete function bundles, preserving verify_jwt=false and all shared email code. Verify Vercel commit/Ready/aliases and read back live function guards. Run advisors without fixing unrelated findings.

## Rollback and limits
Restore the captured prior two function bundles if the new backend fails; revert only this PR's frontend changes through a new reviewed commit if needed. Never redeploy create-user: live self-service restriction differs from repository and must remain unchanged. No claim of live recipient delivery/account acceptance without a real approved test. Track evidence below before release.

## Verification and backend release
87 focused tests and 85 shared-email/auth tests passed. Both Deno entrypoints check. Root tsc passed; app tsc is byte-identical to the baseline log (84 diagnostics). Vite build passed; no lint errors. Initial permission regressions fail before and pass after. Production invite-user v232 and send-invite-email v236 deployed with their existing shared dependencies and verify_jwt=false. No schema, RLS, create-user, production account or recipient change. Frontend and final read-back evidence belongs in the PR release comment. A temporary branch-only publishing workflow may apply the exact tested patch and remove itself; no publishing-helper files may survive into the merge tree.
