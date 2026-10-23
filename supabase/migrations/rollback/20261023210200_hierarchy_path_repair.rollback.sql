-- Rollback stub for migrations/pending/20261023210200_hierarchy_path_repair.sql (hierarchy stabilization M3).
-- Plan: docs/plans/2026-10-23-hierarchy-stabilization/implementation_plan.md §10. This file ALWAYS REFUSES and
-- changes nothing: M3 has no automatic data inverse.
--
-- Why: M3 only makes stored hierarchy_path values equal to the canonical upline chain. Writing the old (wrong)
-- values back would need a byte-exact recovery artifact (invariant #29: full ids outside the repo, sha256,
-- re-parsed and compared full-row) AND M2 rolled back first (M2's triggers re-derive any hierarchy_path write), and
-- it would still not withdraw anything a Team Leader already did with the authority. Rolling back functions never
-- removes granted authority either.
--
-- Recovery path = OPERATIONAL REVOCATION (each step is an ordinary, audited application action):
--   1. An Admin reassigns the affected agents' upline in User Management (to the Admin or another leader). With M2
--      live, the new path is derived immediately and the previous Team Leader loses ancestry at once.
--   2. Or an Admin changes the Team Leader's role to Agent, or deactivates the Team Leader: with M1 live,
--      is_ancestor_of grants nothing to a non-Team-Leader or non-Active profile, whatever the token says.
--   3. Optionally revoke the member's sessions (Supabase Auth) so JWT-role branches end before token expiry.
-- The Gate 2c snapshot (id8, depth, updated_at) is forensic only and cannot drive a restore.
DO $refuse$
BEGIN
  RAISE EXCEPTION 'hierarchy M3 has no automatic rollback; use operational revocation (plan §10): reassign the affected uplines or change the Team Leader''s role/status'
    USING ERRCODE = 'feature_not_supported';
END $refuse$;
