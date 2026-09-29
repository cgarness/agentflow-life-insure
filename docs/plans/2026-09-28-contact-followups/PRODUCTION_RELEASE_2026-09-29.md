# Contact Follow-ups + Group Leaderboard Repair Production Release — 2026-09-29

Status: **Released and verified** (production `jncvvsvckxhqgqvkppmj`)

- **Application:** PR #395, tested branch head `d719845e45ea4e798a6dae74d13d28ff8492a0a3`, squash-merged to `main` at
  `196ea9a1d6435a271d67b6916844a09a04f8c0d4` (21:03:50 UTC). The merged tree is identical to the tested head.
- **CI on the tested head:** `Group leaderboard backend verification` (postgres:17.6, run 36616908278) and
  `Leaderboard backend verification` (run 36616908176) passed.
- **Frontend:** Vercel production deployment `dpl_4Lu4ibn82JTKvzFbTPQwuDwqsEq2`, built by the Git integration, reached
  READY at 21:04:59 UTC and is aliased to `www.fflagent.com` / `fflagent.com`.
- **Supabase migration:** `apply_migration` recorded version `20260929215047`, name
  `group_leaderboard_repair_membership_setter_credit` (21:50:47 UTC).
  - The stored SQL (`md5(array_to_string(statements, E'\n'))` = `fe1c3033e7ce8b947b2b987eaea42dd7`, 5,434 bytes) is
    byte-identical to the repository file.
  - That file was authored as `20260929170000_…` and renamed afterwards to
    `supabase/migrations/20260929215047_group_leaderboard_repair_membership_setter_credit.sql` (sha256
    `ee4a6d4973ab12c55b6775f741fc0fa3c541a7d67a64bf36514aff462636773d`, contents unchanged).
- **Rollback:** renamed to
  `supabase/migrations/rollback/20260929215047_group_leaderboard_repair_membership_setter_credit.rollback.sql` (sha256
  `d192f97115d7d9efca090867dfd749b778804fa1363a58b4854009c3cffcd5e9`, contents unchanged).
  - Its first-line comment still names the authored file `20260929170000_…`; that name now means `20260929215047_…`.
  - Never applied. Rolling back needs Chris's separate approval.
- **`get_agency_group_leaderboard(uuid,text)`:** definition md5 `e1283b5b05d295c1d25888485cc08346` →
  `8bd49ee01e0b92abd3e66548569f36bb`.
  - 42702 repaired: the membership check's `organization_id` is now `agency_group_members.organization_id`.
  - Appointments Set credits the setter: `COALESCE(ap.created_by, ap.user_id)`.
  - Owner, SECURITY DEFINER, `search_path`, signature, return shape and the membership authorization are unchanged.
- **Final ACL:** `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`.
  - PUBLIC, anon and authenticator cannot EXECUTE (live probe: 42501).
  - authenticated and service_role can: a live non-member call reaches the membership denial, P0001, not 42702.
- **Index:** `CREATE INDEX appointments_setter_created_at_idx ON public.appointments USING btree (COALESCE(created_by, user_id), created_at)`.
  It is valid, and EXPLAIN shows the setter lookup uses it.
- **Unchanged:**
  - `get_org_leaderboard_stats` (definition md5 `c8b1f9d0c7cf5f8dfb7e437577029278`);
  - Reports `get_report_call_summary` (prosrc md5 `f221e1d470fc70ec92937be66be56e69`);
  - every other function, index, policy, column, grant and trigger (before/after fingerprints identical);
  - no production data changed.
- **Advisors:**
  - Security findings 194 → 193: the only change is the removed `anon_security_definer_function_executable` finding
    for this RPC. The `authenticated` finding remains by design.
  - Performance findings: an identical set of 410.
  - No other finding was changed.
- **Production smoke:**
  - `www.fflagent.com` routes returned 200 and served the new bundle.
  - The exact production bundle rendered Dashboard, Contacts, an opened contact with the Follow-ups card, Calendar
    and Reports with 0 page errors, against a synthetic backend.
  - A signed-in live check was not possible from the release environment.
- **Data today:** 0 agency groups and 70 appointments; 30 have no `created_by`, so they are credited to `user_id`. No
  appointment has a setter different from its assignee, so no current number changes.
- **Known remaining follow-ups (separate approvals):**
  - Dialer appointment timestamp / `created_by` writer fix;
  - `UserPerformanceTab` reads a non-existent `appsWeekly`;
  - the Group board's clients-based `policies_sold` and no-direction call counts;
  - Team Leader RLS undercount of a downline's setter count in the browser (Reports is exact);
  - a signed-in browser smoke test by Admin/Agent/Team Leader.
