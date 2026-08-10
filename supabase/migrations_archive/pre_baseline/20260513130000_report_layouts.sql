CREATE TABLE public.report_layouts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    layout jsonb NOT NULL,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_report_layouts_user_org ON public.report_layouts(user_id, organization_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX idx_report_layouts_org_default ON public.report_layouts(organization_id) WHERE user_id IS NULL;

ALTER TABLE public.report_layouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own layout or org default" ON public.report_layouts FOR SELECT
    USING (organization_id = public.get_org_id() AND (user_id = auth.uid() OR user_id IS NULL));

CREATE POLICY "Users can manage their own layout" ON public.report_layouts FOR ALL
    USING (organization_id = public.get_org_id() AND user_id = auth.uid())
    WITH CHECK (organization_id = public.get_org_id() AND user_id = auth.uid());

CREATE POLICY "Admins can manage org default layouts" ON public.report_layouts FOR ALL
    USING (organization_id = public.get_org_id() AND user_id IS NULL AND (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('Admin', 'Team Leader'))
    ));
