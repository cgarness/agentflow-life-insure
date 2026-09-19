-- =====================================================================================================
-- ROLLBACK for 20260919010000_custom_field_logical_name_guard.sql.
-- ⚠ NOT EXECUTED REMOTELY. The forward migration has NOT been applied to any hosted project.
-- =====================================================================================================
-- Drops the organization-wide logical-name guard, its normalization helper and its support index,
-- restoring the pre-migration behaviour exactly: the only uniqueness on public.custom_fields becomes
-- the two pre-existing partial indexes again, whose personal variant keys on `created_by` — so N users
-- in one organization can once more each create their own "Gender". That is the defect the forward
-- migration corrects; roll back only deliberately.
--
-- This rollback READS NOTHING AND REWRITES NOTHING. The forward migration performed no INSERT, UPDATE,
-- DELETE or backfill, so there is no data change to undo. Every custom-field row — the 25 pre-existing
-- duplicates included — is left exactly as it is, and any row created while the guard was in force is
-- an ordinary row that remains valid afterwards. No RLS policy was created or altered by the forward
-- migration, so none is restored here.

DROP TRIGGER IF EXISTS trg_custom_fields_logical_name_guard ON public.custom_fields;
DROP FUNCTION IF EXISTS private.custom_fields_logical_name_guard();
DROP INDEX IF EXISTS public.custom_fields_org_norm_active_idx;
-- Dropped last: the index above depends on it.
DROP FUNCTION IF EXISTS private.custom_field_norm(text);

COMMENT ON TABLE public.custom_fields IS NULL;

-- The `private` schema is NOT dropped: it is created by the baseline (20260806000000:90) and holds
-- many unrelated helpers.


-- =====================================================================================================
-- SEPARATELY REVERSIBLE COMPONENT — undo of the D-1 table privilege hardening.
-- =====================================================================================================
-- Restores the pre-migration grant set, which is this project's ALTER DEFAULT PRIVILEGES default:
-- the full `arwdDxt` set to anon AND authenticated. RUNNING THIS RESTORES A REAL DEFECT — it hands
-- `anon` and `authenticated` TRUNCATE on public.custom_fields, which row-level security does not
-- filter and which would let any caller empty every organization's field definitions. Restore it only
-- if something is proven to depend on those privileges, and prefer granting that dependency exactly
-- what it needs instead.
--
-- Comment the block out to roll back the guard while KEEPING the privilege correction.
GRANT ALL ON TABLE public.custom_fields TO anon;
GRANT ALL ON TABLE public.custom_fields TO authenticated;
