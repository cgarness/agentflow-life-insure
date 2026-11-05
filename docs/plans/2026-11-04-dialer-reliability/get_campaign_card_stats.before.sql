CREATE OR REPLACE FUNCTION public.get_campaign_card_stats(p_campaign_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(campaign_id uuid, total_leads integer, called_leads integer, contacted_leads integer, converted_leads integer, policies_sold integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Resolve caller identity / org / view-all ONCE (single evaluation).
  WITH me AS (
    SELECT
      public.get_org_id() AS org_id,
      auth.uid()          AS uid,
      (
        public.get_user_role() = ANY (ARRAY['Admin', 'Team Leader', 'Team Lead'])
        OR public.is_super_admin()
      )                   AS view_all
  ),
  -- Campaigns the caller may see: org-scoped AND access-scoped to the frontend
  -- `canUserAccessCampaign` rules. `p_campaign_ids` can only narrow this set.
  camp AS (
    SELECT c.id, c.organization_id
    FROM public.campaigns c
    CROSS JOIN me
    WHERE me.org_id IS NOT NULL
      AND c.organization_id = me.org_id
      AND (p_campaign_ids IS NULL OR c.id = ANY (p_campaign_ids))
      AND (
            upper(btrim(c.type)) = ANY (ARRAY['OPEN POOL', 'OPEN'])
         OR (upper(btrim(c.type)) = 'PERSONAL' AND c.user_id = me.uid)
         OR (upper(btrim(c.type)) = 'TEAM'
             AND me.uid::text = ANY (
               ARRAY(SELECT jsonb_array_elements_text(coalesce(c.assigned_agent_ids, '[]'::jsonb)))
             ))
         OR (me.view_all AND upper(btrim(c.type)) = 'TEAM')
      )
  ),
  -- One row per (campaign_lead, OUTBOUND call) with resolved disposition flags.
  call_facts AS (
    SELECT
      cl.campaign_id            AS campaign_id,
      cl.id                     AS campaign_lead_id,
      CASE
        WHEN lower(coalesce(di.name, dn.name, ca.disposition_name, '')) = 'no answer'
          THEN false
        WHEN coalesce(ca.duration, 0) > 45
          THEN true
        WHEN coalesce(di.counts_as_contacted, false)
          THEN true
        WHEN ca.disposition_id IS NULL AND coalesce(dn.counts_as_contacted, false)
          THEN true
        ELSE false
      END AS is_contacted,
      CASE
        WHEN coalesce(psi.convert_to_client, false)
          THEN true
        WHEN ca.disposition_id IS NULL AND coalesce(psn.convert_to_client, false)
          THEN true
        ELSE false
      END AS is_converting
    FROM camp
    JOIN public.campaign_leads cl ON cl.campaign_id = camp.id
    JOIN public.calls ca
      ON ca.campaign_lead_id = cl.id
     AND lower(coalesce(ca.direction, '')) = ANY (ARRAY['outbound', 'outgoing'])
    LEFT JOIN public.dispositions di     ON di.id = ca.disposition_id
    LEFT JOIN public.pipeline_stages psi ON psi.id = di.pipeline_stage_id
    LEFT JOIN public.dispositions dn
      ON ca.disposition_id IS NULL
     AND lower(dn.name) = lower(ca.disposition_name)
     AND dn.organization_id = camp.organization_id
    LEFT JOIN public.pipeline_stages psn ON psn.id = dn.pipeline_stage_id
  )
  SELECT
    camp.id AS campaign_id,
    (SELECT count(*)::int
       FROM public.campaign_leads cl
      WHERE cl.campaign_id = camp.id)                                    AS total_leads,
    (SELECT count(*)::int
       FROM public.campaign_leads cl
      WHERE cl.campaign_id = camp.id
        AND coalesce(cl.call_attempts, 0) > 0)                          AS called_leads,
    (SELECT count(DISTINCT cf.campaign_lead_id)::int
       FROM call_facts cf
      WHERE cf.campaign_id = camp.id
        AND cf.is_contacted)                                            AS contacted_leads,
    (SELECT count(DISTINCT cf.campaign_lead_id)::int
       FROM call_facts cf
      WHERE cf.campaign_id = camp.id
        AND cf.is_converting)                                           AS converted_leads,
    (SELECT count(*)::int
       FROM public.wins w
      WHERE w.campaign_id = camp.id
        AND w.organization_id = camp.organization_id)                  AS policies_sold
  FROM camp;
$function$
