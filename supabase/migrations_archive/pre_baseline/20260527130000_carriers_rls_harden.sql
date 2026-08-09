-- Migration: Carriers RLS & Schema Hardening
-- Location: supabase/migrations/20260527130000_carriers_rls_harden.sql

-- 1. Re-check null organization_id count before SET NOT NULL
DO $$
DECLARE
    null_count INTEGER;
BEGIN
    SELECT count(*) INTO null_count FROM public.carriers WHERE organization_id IS NULL;
    IF null_count > 0 THEN
        RAISE EXCEPTION 'Cannot harden carriers RLS: % rows have NULL organization_id.', null_count;
    END IF;
END $$;

-- 2. ALTER COLUMN organization_id SET NOT NULL only if safe
ALTER TABLE public.carriers ALTER COLUMN organization_id SET NOT NULL;

-- 3. Add/verify updated_at trigger using the repo canonical public.update_updated_at() pattern if missing
CREATE OR REPLACE TRIGGER carriers_updated_at
    BEFORE UPDATE ON public.carriers
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at();

-- 4. Add/verify index on organization_id if missing
CREATE INDEX IF NOT EXISTS carriers_organization_id_idx ON public.carriers (organization_id);

-- 5. Add/verify unique case-insensitive carrier name per organization
DO $$
DECLARE
    dup_count INTEGER;
BEGIN
    SELECT count(*) INTO dup_count FROM (
        SELECT lower(name), organization_id 
        FROM public.carriers 
        GROUP BY lower(name), organization_id 
        HAVING count(*) > 1
    ) t;
    IF dup_count > 0 THEN
        RAISE EXCEPTION 'Cannot add unique index carriers_org_lower_name_unique: % duplicate lowercase names per organization exist.', dup_count;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS carriers_org_lower_name_unique ON public.carriers (organization_id, lower(name));

-- 6. Use DROP POLICY IF EXISTS guards for old and new policy names
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.carriers;
DROP POLICY IF EXISTS "Enable insert access for authenticated users" ON public.carriers;
DROP POLICY IF EXISTS "Enable update access for authenticated users" ON public.carriers;
DROP POLICY IF EXISTS "Enable delete access for authenticated users" ON public.carriers;
DROP POLICY IF EXISTS "carriers_select" ON public.carriers;
DROP POLICY IF EXISTS "carriers_insert" ON public.carriers;
DROP POLICY IF EXISTS "carriers_update" ON public.carriers;
DROP POLICY IF EXISTS "carriers_delete" ON public.carriers;

-- 7. Replace RLS policies using public.get_org_id(), public.get_user_role(), and public.is_super_admin()

-- SELECT: own organization or super admin
CREATE POLICY "carriers_select" ON public.carriers
    FOR SELECT TO authenticated
    USING (
        organization_id = public.get_org_id()
        OR public.is_super_admin()
    );

-- INSERT: with check organization_id IS NOT NULL and (super admin or (own org admin))
CREATE POLICY "carriers_insert" ON public.carriers
    FOR INSERT TO authenticated
    WITH CHECK (
        organization_id IS NOT NULL
        AND (
            public.is_super_admin()
            OR (
                organization_id = public.get_org_id()
                AND public.get_user_role() = 'Admin'
            )
        )
    );

-- UPDATE: using super admin or own org admin
CREATE POLICY "carriers_update" ON public.carriers
    FOR UPDATE TO authenticated
    USING (
        public.is_super_admin()
        OR (
            organization_id = public.get_org_id()
            AND public.get_user_role() = 'Admin'
        )
    )
    WITH CHECK (
        organization_id IS NOT NULL
        AND (
            public.is_super_admin()
            OR (
                organization_id = public.get_org_id()
                AND public.get_user_role() = 'Admin'
            )
        )
    );

-- DELETE: using super admin or own org admin
CREATE POLICY "carriers_delete" ON public.carriers
    FOR DELETE TO authenticated
    USING (
        public.is_super_admin()
        OR (
            organization_id = public.get_org_id()
            AND public.get_user_role() = 'Admin'
        )
    );

-- 8. Reload schema for postgrest
NOTIFY pgrst, 'reload schema';
