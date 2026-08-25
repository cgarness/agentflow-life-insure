-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- RLS PHASE 1 — command-split of "Calls Hierarchical Access" (plan §9, rulings R11/R15/R20).
-- Authored under Chris's explicit #APPROVE_RLS_CHANGE (2026-08-23), which authorizes AUTHORING and
-- LOCAL TESTING only. This migration has NOT been applied remotely.
--
-- WHY: the live policy is a single ALL-commands policy whose USING contains
--   (get_org_id() IS NOT NULL AND organization_id = get_org_id() AND direction='inbound' AND agent_id IS NULL)
-- and whose WITH CHECK accepts (agent_id = auth.uid()). Together those let ANY authenticated member
-- of the organization directly UPDATE-claim any unassigned inbound call over PostgREST — bypassing
-- the Twilio-authoritative claim flow and able to BLOCK the real winner (a squatter's agent_id write
-- makes the legitimate first-write CAS fail its `agent_id IS NULL` predicate). The same USING also
-- permits DELETE of those rows.
--
-- WHAT (exactly, and nothing more):
--   * SELECT   — the ORIGINAL USING expression, verbatim. Visibility does not narrow in Phase 1;
--                every dashboard, notification deep link and recent-call list keeps working.
--   * INSERT   — the ORIGINAL WITH CHECK expression, verbatim. INSERT eligibility is unchanged.
--   * UPDATE   — the ORIGINAL USING **AND** a top-level NULL-safe exclusion of already-unassigned
--                inbound source rows; the ORIGINAL WITH CHECK verbatim.
--   * DELETE   — the ORIGINAL USING **AND** the same exclusion.
--
-- The exclusion is written as  (direction IS DISTINCT FROM 'inbound' OR agent_id IS NOT NULL)
-- deliberately, NOT as NOT (direction = 'inbound' AND agent_id IS NULL): with a NULL `direction`
-- the latter evaluates to NULL and would silently drop rows that are permitted today (three-valued
-- logic). It sits at the TOP level so it applies to EVERY branch — Agent, Team Leader, the legacy
-- 'Team Lead' alias, Admin and Super Admin alike (R20) — not merely to the org-member branch.
--
-- NOT in this migration (each separately gated): Phase 2 SELECT privacy narrowing; any change to
-- "Calls Agency Group Peer Read"; table grants; RLS enabled/forced state; authorization helper
-- functions; predicate "optimization"; application/Edge/frontend/Twilio changes. Policy DDL only —
-- ZERO table DML, zero backfill.
--
-- Atomicity: Supabase applies each migration in a single transaction, and the fail-closed
-- preconditions below abort (rolling the whole thing back) unless the catalog is exactly the
-- expected pre-Phase-1 topology. A partially applied replacement is therefore impossible.
-- Rollback SQL: supabase/migrations/rollback/20260823120000_rls_phase1_calls_command_split.rollback.sql
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ── Fail-closed preconditions ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_using text;
  v_check text;
  v_expected_using CONSTANT text :=
    '((agent_id = auth.uid()) OR super_admin_own_org(organization_id) OR ((get_user_role() = ''Admin''::text) AND (organization_id = get_org_id())) OR ((get_user_role() = ANY (ARRAY[''Team Leader''::text, ''Team Lead''::text])) AND (organization_id = get_org_id()) AND (agent_id IS NOT NULL) AND is_ancestor_of(auth.uid(), agent_id)) OR ((get_org_id() IS NOT NULL) AND (organization_id = get_org_id()) AND (direction = ''inbound''::text) AND (agent_id IS NULL)))';
  v_expected_check CONSTANT text :=
    '((agent_id = auth.uid()) OR super_admin_own_org(organization_id) OR ((get_user_role() = ''Admin''::text) AND (organization_id = get_org_id())) OR ((get_user_role() = ANY (ARRAY[''Team Leader''::text, ''Team Lead''::text])) AND (organization_id = get_org_id()) AND (agent_id IS NOT NULL) AND is_ancestor_of(auth.uid(), agent_id)))';
  n integer;
BEGIN
  -- (1) RLS must already be enabled (this migration never changes that state).
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.calls'::regclass) THEN
    RAISE EXCEPTION 'RLS Phase 1 precondition failed: row level security is not enabled on public.calls';
  END IF;

  -- (2) The exact policy being replaced must exist, as an ALL policy for `authenticated`.
  SELECT qual, with_check INTO v_using, v_check
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'calls'
     AND policyname = 'Calls Hierarchical Access';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RLS Phase 1 precondition failed: policy "Calls Hierarchical Access" not found on public.calls';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='calls'
                    AND policyname='Calls Hierarchical Access'
                    AND cmd='ALL' AND permissive='PERMISSIVE' AND roles::text='{authenticated}') THEN
    RAISE EXCEPTION 'RLS Phase 1 precondition failed: "Calls Hierarchical Access" is not the expected PERMISSIVE ALL policy TO authenticated';
  END IF;

  -- (3) Its expressions must be byte-identical to the reviewed baseline — no drift, no surprise edit.
  IF v_using IS DISTINCT FROM v_expected_using THEN
    RAISE EXCEPTION 'RLS Phase 1 precondition failed: USING expression drifted from the reviewed baseline. Found: %', v_using;
  END IF;
  IF v_check IS DISTINCT FROM v_expected_check THEN
    RAISE EXCEPTION 'RLS Phase 1 precondition failed: WITH CHECK expression drifted from the reviewed baseline. Found: %', v_check;
  END IF;

  -- (4) No OTHER permissive ALL/UPDATE/DELETE policy may exist — one would OR around the new
  --     exclusion and re-open the bypass (permissive policies combine with OR).
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='calls'
     AND permissive='PERMISSIVE' AND cmd IN ('ALL','UPDATE','DELETE')
     AND policyname <> 'Calls Hierarchical Access';
  IF n <> 0 THEN
    RAISE EXCEPTION 'RLS Phase 1 precondition failed: % other permissive ALL/UPDATE/DELETE polic(ies) on public.calls would bypass the exclusion', n;
  END IF;

  -- (5) The independent peer-read SELECT policy must be present and untouched by this migration.
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='calls'
                    AND policyname='Calls Agency Group Peer Read'
                    AND cmd='SELECT'
                    AND qual='is_agency_group_peer_organization(organization_id)') THEN
    RAISE EXCEPTION 'RLS Phase 1 precondition failed: "Calls Agency Group Peer Read" is missing or altered';
  END IF;

  -- (6) The target policy names must be free.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='public' AND tablename='calls'
                AND policyname IN ('Calls Hierarchical Select','Calls Hierarchical Insert',
                                   'Calls Hierarchical Update','Calls Hierarchical Delete')) THEN
    RAISE EXCEPTION 'RLS Phase 1 precondition failed: a command-specific calls policy already exists';
  END IF;
END $$;

-- ── Replace the ALL policy with command-specific policies ────────────────────────────────────────
DROP POLICY "Calls Hierarchical Access" ON public.calls;

-- SELECT: the ORIGINAL USING expression, verbatim. Unassigned-inbound visibility is preserved
-- exactly (Phase 2 is where narrowing is considered, with its own consumer inventory and approval).
CREATE POLICY "Calls Hierarchical Select" ON public.calls
  FOR SELECT TO authenticated
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
  );

-- INSERT: the ORIGINAL WITH CHECK expression, verbatim. Phase 1 does not change INSERT permissions.
CREATE POLICY "Calls Hierarchical Insert" ON public.calls
  FOR INSERT TO authenticated
  WITH CHECK (
    ((agent_id = auth.uid())
     OR super_admin_own_org(organization_id)
     OR ((get_user_role() = 'Admin'::text) AND (organization_id = get_org_id()))
     OR ((get_user_role() = ANY (ARRAY['Team Leader'::text, 'Team Lead'::text]))
         AND (organization_id = get_org_id())
         AND (agent_id IS NOT NULL)
         AND is_ancestor_of(auth.uid(), agent_id)))
  );

-- UPDATE: original hierarchical eligibility AND the top-level NULL-safe exclusion of
-- already-unassigned inbound SOURCE rows. WITH CHECK is the original expression, verbatim — Phase 1
-- removes those source rows from direct UPDATE eligibility and does not redesign which assigned-row
-- transitions are allowed.
CREATE POLICY "Calls Hierarchical Update" ON public.calls
  FOR UPDATE TO authenticated
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
    AND (direction IS DISTINCT FROM 'inbound'::text OR agent_id IS NOT NULL)
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

-- DELETE: original hierarchical eligibility AND the same NULL-safe exclusion.
CREATE POLICY "Calls Hierarchical Delete" ON public.calls
  FOR DELETE TO authenticated
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
    AND (direction IS DISTINCT FROM 'inbound'::text OR agent_id IS NOT NULL)
  );

COMMENT ON POLICY "Calls Hierarchical Select" ON public.calls IS
  'RLS Phase 1 (plan §9, R15/R20): the SELECT half of the former "Calls Hierarchical Access" ALL '
  'policy, USING expression preserved verbatim. Phase 2 (separately approved) is where '
  'unassigned-inbound visibility narrowing is considered.';
COMMENT ON POLICY "Calls Hierarchical Insert" ON public.calls IS
  'RLS Phase 1: the INSERT half of the former ALL policy, WITH CHECK preserved verbatim.';
COMMENT ON POLICY "Calls Hierarchical Update" ON public.calls IS
  'RLS Phase 1 (R20): original hierarchical eligibility AND a top-level NULL-safe exclusion of '
  'unassigned inbound source rows (direction IS DISTINCT FROM ''inbound'' OR agent_id IS NOT NULL), '
  'so no authenticated role — Agent, Team Leader/Team Lead, Admin or Super Admin — can direct-claim '
  'or mutate a call the Twilio-authoritative claim flow has not assigned. Claiming happens only via '
  'the service-role claim_inbound_call RPC. WITH CHECK is the original expression, unchanged.';
COMMENT ON POLICY "Calls Hierarchical Delete" ON public.calls IS
  'RLS Phase 1 (R20): original hierarchical eligibility AND the same NULL-safe unassigned-inbound '
  'exclusion as the UPDATE policy.';

-- ── Post-conditions: fail closed if the resulting topology is not exactly what was reviewed ──────
DO $$
DECLARE n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='calls'
              AND policyname='Calls Hierarchical Access') THEN
    RAISE EXCEPTION 'RLS Phase 1 postcondition failed: the ALL policy still exists';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='calls' AND roles::text='{authenticated}'
     AND policyname IN ('Calls Hierarchical Select','Calls Hierarchical Insert',
                        'Calls Hierarchical Update','Calls Hierarchical Delete');
  IF n <> 4 THEN
    RAISE EXCEPTION 'RLS Phase 1 postcondition failed: expected 4 command-specific policies, found %', n;
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='calls' AND permissive='PERMISSIVE'
     AND cmd IN ('ALL','UPDATE','DELETE')
     AND policyname NOT IN ('Calls Hierarchical Update','Calls Hierarchical Delete');
  IF n <> 0 THEN
    RAISE EXCEPTION 'RLS Phase 1 postcondition failed: % permissive write polic(ies) could bypass the exclusion', n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='calls'
                    AND policyname='Calls Agency Group Peer Read'
                    AND cmd='SELECT'
                    AND qual='is_agency_group_peer_organization(organization_id)') THEN
    RAISE EXCEPTION 'RLS Phase 1 postcondition failed: the peer-read policy was altered';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.calls'::regclass)
     OR (SELECT relforcerowsecurity FROM pg_class WHERE oid='public.calls'::regclass) THEN
    RAISE EXCEPTION 'RLS Phase 1 postcondition failed: the RLS enabled/forced state changed';
  END IF;
END $$;
