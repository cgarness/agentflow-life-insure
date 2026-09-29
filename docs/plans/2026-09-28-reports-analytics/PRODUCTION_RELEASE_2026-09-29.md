# Reports & Analytics Production Release — 2026-09-29

Status: **Released and verified**

- PR #393 merged to main at `9aa011c40cc2baab1e9e875beb68b7f3ca69f65e`.
- Vercel production deployment `dpl_GoE52MKMXS4zBfYtQ9DZ6Jo98sj1` reached READY on the merged commit.
- Supabase applied migration version: `20260929152553`.
- Canonical repo migration path: `supabase/migrations/20260929152553_reports_secure_scoped_rpcs.sql`.
- Legacy Reports RPCs are sealed from PUBLIC, anon, and authenticated.
- New Reports RPCs are authenticated/service-role only and use server-enforced tenant/report scope.
- Chris's agency reports in `America/Los_Angeles`.
- Production smoke results for 2026-09-01 through 2026-09-29:
  - Calls Made: 2,222
  - Talk Time: 55,664 seconds
  - Policies Sold: 2
  - These matched independent SQL for the same agency-zone window.
- No production data rows were mutated by the migration; it creates/revokes function-level database objects only.
- Post-migration advisors were run; unrelated pre-existing security/performance findings remain outside this release.
