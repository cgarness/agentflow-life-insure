-- =====================================================================================================
-- ROLLBACK for 20260922200000_custom_field_norm_execute_grant.sql.
-- ⚠ ROLLBACK NOT EXECUTED REMOTELY. The forward migration is NOT YET APPLIED ANYWHERE.
-- =====================================================================================================
-- ⚠⚠ RUNNING THIS RE-BREAKS EVERY CUSTOM-FIELD CREATE. ⚠⚠
--
-- While custom_fields_org_norm_active_idx exists, revoking EXECUTE on private.custom_field_norm(text)
-- from the writing roles returns public.custom_fields to the 2026-09-19 → 2026-09-22 outage: every
-- `authenticated` (and `service_role`) INSERT of an active organization field — and every rename or
-- re-activation of one — fails in index maintenance with 42501
-- `permission denied for function custom_field_norm`.
--
-- Use it ONLY together with one of:
--   * the full rollback of 20260919052941 (drops the guard, the support index and the function), or
--   * a separately approved `DROP INDEX public.custom_fields_org_norm_active_idx`.
--
-- Reads nothing and rewrites nothing: one ACL entry, exactly the inverse of the forward migration.
-- No RLS policy, table grant, index, trigger, function body or row is touched.

REVOKE EXECUTE ON FUNCTION private.custom_field_norm(text) FROM authenticated, service_role;
