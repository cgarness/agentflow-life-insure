-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- EXACT ROLLBACK for 20260823203257_rls_phase1_calls_command_split.sql
-- (authored as 20260823120000_…; renamed to the production apply-time version 20260823203257.
--  THIS file keeps its original 20260823120000 name — the applied migration's header points at
--  this exact path, so it must not move.)
--
-- Restores the pre-Phase-1 topology: drops the four command-specific policies and recreates the
-- original "Calls Hierarchical Access" PERMISSIVE ALL policy with its verbatim USING / WITH CHECK.
-- "Calls Agency Group Peer Read", table grants, and the RLS enabled/forced state are not touched by
-- either direction.
--
-- ⚠ NOT EXECUTED REMOTELY. Provided for review and for a local/emergency restore only; running it
-- re-opens the direct-claim bypass Phase 1 closes, so it must not be applied to production without
-- Chris's explicit approval. Run inside a single transaction.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS "Calls Hierarchical Select" ON public.calls;
DROP POLICY IF EXISTS "Calls Hierarchical Insert" ON public.calls;
DROP POLICY IF EXISTS "Calls Hierarchical Update" ON public.calls;
DROP POLICY IF EXISTS "Calls Hierarchical Delete" ON public.calls;

CREATE POLICY "Calls Hierarchical Access" ON public.calls
  TO authenticated
  USING (
    ((agent_id = auth.uid())
     OR super_admin_own_org(organization_id)
     OR ((get_user_role() = 'Admin'::text) AND (organization_id = get_org_id()))
     OR ((get_user_role() = ANY (ARRAY['Team Leader'::text, 'Team Lead'::text]))
         AND (organization_id = get_org_id())
         AND (agent_id IS NOT NULL)
         AND is_ancestor_of(auth.uid(), agent_id))
     OR ((get_org_id() IS NOT NULL)
         AND (organization_id = get_org_id())
         AND (direction = 'inbound'::text)
         AND (agent_id IS NULL)))
  )
  WITH CHECK (
    ((agent_id = auth.uid())
     OR super_admin_own_org(organization_id)
     OR ((get_user_role() = 'Admin'::text) AND (organization_id = get_org_id()))
     OR ((get_user_role() = ANY (ARRAY['Team Leader'::text, 'Team Lead'::text]))
         AND (organization_id = get_org_id())
         AND (agent_id IS NOT NULL)
         AND is_ancestor_of(auth.uid(), agent_id)))
  );

COMMIT;
