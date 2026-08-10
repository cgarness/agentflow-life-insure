-- Inbound calls are inserted by telnyx-webhook with agent_id NULL until inbound-call-claim (on answer).
-- Hierarchical RLS previously only allowed agent_id = auth.uid(), so agents could not SELECT these rows
-- and Recent / timelines stayed empty. Extend USING (read) only — WITH CHECK unchanged so clients
-- cannot INSERT synthetic unassigned inbound rows.

DROP POLICY IF EXISTS "Calls Hierarchical Access" ON public.calls;

CREATE POLICY "Calls Hierarchical Access" ON public.calls
FOR ALL
TO authenticated
USING (
  agent_id = auth.uid()
  OR
  public.is_super_admin()
  OR
  (public.get_user_role() = 'Admin' AND organization_id = public.get_org_id())
  OR
  (
    public.get_user_role() IN ('Team Leader', 'Team Lead')
    AND organization_id = public.get_org_id()
    AND agent_id IS NOT NULL
    AND public.is_ancestor_of(auth.uid(), agent_id)
  )
  OR
  (
    public.get_org_id() IS NOT NULL
    AND organization_id = public.get_org_id()
    AND direction = 'inbound'
    AND agent_id IS NULL
  )
)
WITH CHECK (
  agent_id = auth.uid()
  OR
  public.is_super_admin()
  OR
  (public.get_user_role() = 'Admin' AND organization_id = public.get_org_id())
  OR
  (
    public.get_user_role() IN ('Team Leader', 'Team Lead')
    AND organization_id = public.get_org_id()
    AND agent_id IS NOT NULL
    AND public.is_ancestor_of(auth.uid(), agent_id)
  )
);

NOTIFY pgrst, 'reload schema';
