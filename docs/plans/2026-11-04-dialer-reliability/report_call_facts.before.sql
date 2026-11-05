CREATE OR REPLACE FUNCTION private.report_call_facts(p_org uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_agent_ids uuid[])
 RETURNS TABLE(call_id uuid, agent_id uuid, direction_class text, created_at timestamp with time zone, duration_seconds bigint, campaign_id uuid, campaign_lead_id uuid, converted_key text, lead_id uuid, lead_source text, disposition_key text, disposition_name text, disposition_color text, disp_counts_contacted boolean, disp_converts boolean, disp_dnc boolean, disp_callback boolean, disp_appointment boolean, is_contacted boolean, is_converting boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  WITH base AS (
    SELECT
      c.id,
      c.agent_id,
      CASE
        WHEN lower(coalesce(c.direction, '')) = ANY (ARRAY['outbound', 'outgoing']) THEN 'outbound'
        WHEN lower(coalesce(c.direction, '')) = ANY (ARRAY['inbound', 'incoming'])  THEN 'inbound'
        ELSE 'other'
      END                                                     AS direction_class,
      c.created_at,
      greatest(coalesce(c.duration, 0), 0)::bigint           AS duration_seconds,
      cmp.id                                                  AS campaign_id,
      CASE WHEN cl.campaign_id = cmp.id THEN cl.id END        AS campaign_lead_id,
      c.contact_id,
      coalesce(l1.id, l2.id)                                  AS lead_id,
      coalesce(l1.lead_source, l2.lead_source)                AS raw_lead_source,
      c.disposition_id,
      c.disposition_name                                      AS raw_disposition_name,
      coalesce(di.id, dn.id)                                  AS resolved_disposition_id,
      coalesce(di.name, dn.name)                              AS resolved_disposition_name,
      coalesce(di.color, dn.color)                            AS resolved_color,
      coalesce(di.counts_as_contacted, dn.counts_as_contacted, false) AS counts_contacted,
      coalesce(ps.convert_to_client, false)                   AS converts,
      coalesce(di.dnc_auto_add, dn.dnc_auto_add, false)       AS dnc,
      coalesce(di.callback_scheduler, dn.callback_scheduler, false) AS callback,
      coalesce(di.appointment_scheduler, dn.appointment_scheduler, false) AS appointment
    FROM public.calls c
    LEFT JOIN public.dispositions di
           ON di.id = c.disposition_id
          AND di.organization_id = p_org
    LEFT JOIN public.dispositions dn
           ON c.disposition_id IS NULL
          AND c.disposition_name IS NOT NULL
          AND lower(dn.name) = lower(c.disposition_name)
          AND dn.organization_id = p_org
    LEFT JOIN public.pipeline_stages ps
           ON ps.id = coalesce(di.pipeline_stage_id, dn.pipeline_stage_id)
          AND ps.organization_id = p_org
    LEFT JOIN public.campaign_leads cl
           ON cl.id = c.campaign_lead_id
    LEFT JOIN public.campaigns cmp
           ON cmp.id = coalesce(c.campaign_id, cl.campaign_id)
          AND cmp.organization_id = p_org
    LEFT JOIN public.leads l1
           ON l1.id = c.lead_id
          AND l1.organization_id = p_org
    LEFT JOIN public.leads l2
           ON c.lead_id IS NULL
          AND l2.id = c.contact_id
          AND (c.contact_type = 'lead' OR c.contact_type IS NULL)
          AND l2.organization_id = p_org
    WHERE c.organization_id = p_org
      AND NOT EXISTS (SELECT 1 FROM private.performance_duplicate_rows d WHERE d.organization_id=p_org AND d.kind='call' AND d.duplicate_id=c.id)
      AND c.created_at >= p_start
      AND c.created_at <  p_end
      AND (p_agent_ids IS NULL OR c.agent_id = ANY (p_agent_ids))
  )
  SELECT
    b.id,
    b.agent_id,
    b.direction_class,
    b.created_at,
    b.duration_seconds,
    b.campaign_id,
    b.campaign_lead_id,
    -- Converted identity: contact first, so one person reached through two campaign_lead memberships
    -- counts once. Prefixed so ids from different tables can never collide.
    coalesce('contact:' || b.contact_id::text, 'campaign_lead:' || b.campaign_lead_id::text, 'call:' || b.id::text),
    b.lead_id,
    coalesce(nullif(btrim(b.raw_lead_source), ''), '(No source)'),
    CASE
      WHEN b.resolved_disposition_id IS NOT NULL THEN b.resolved_disposition_id::text
      WHEN nullif(btrim(b.raw_disposition_name), '') IS NOT NULL
        THEN 'name:' || lower(btrim(b.raw_disposition_name))
      ELSE 'none'
    END,
    coalesce(b.resolved_disposition_name, nullif(btrim(b.raw_disposition_name), ''), '(No disposition)'),
    coalesce(b.resolved_color, '#6B7280'),
    b.counts_contacted,
    b.converts,
    b.dnc,
    b.callback,
    b.appointment,
    -- Canonical Contacted (outbound only). No Answer is tested first, on the resolved name.
    CASE
      WHEN b.direction_class <> 'outbound' THEN false
      WHEN lower(coalesce(b.resolved_disposition_name, b.raw_disposition_name, '')) = 'no answer' THEN false
      WHEN b.duration_seconds > 45 THEN true
      WHEN b.counts_contacted THEN true
      ELSE false
    END,
    (b.direction_class = 'outbound' AND b.converts)
  FROM base b;
$function$
