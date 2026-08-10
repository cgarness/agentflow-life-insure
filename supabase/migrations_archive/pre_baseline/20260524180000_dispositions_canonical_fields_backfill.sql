-- Dispositions Build 1 — canonical-field standardization.
--
-- Canonical: campaign_action (text enum), dnc_auto_add (boolean).
-- Deprecated (kept for compat, NOT dropped): remove_from_queue, auto_add_to_dnc.
--
-- Safe one-time backfill of canonical fields from legacy fields only where
-- canonical is at its default. Intentionally set canonical values are preserved.
-- Live audit at draft time: 0 rows match the safe-backfill predicates; this
-- block is defensive for any future drift.
--
-- Also recreates three reporting RPCs to read dnc_auto_add (was auto_add_to_dnc).
-- No RLS changes. No NOT NULL changes. No column drops.

-- 1. Safety: refuse migration if any NULL organization_id slipped in.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.dispositions WHERE organization_id IS NULL) THEN
    RAISE EXCEPTION 'dispositions has NULL organization_id rows — refusing canonical backfill (Build 1 invariant; resolve before retry)';
  END IF;
END $$;

-- 2. Safe legacy → canonical backfill (never overwrites intentional canonical values).
UPDATE public.dispositions
   SET dnc_auto_add = true
 WHERE auto_add_to_dnc = true
   AND dnc_auto_add = false;

UPDATE public.dispositions
   SET campaign_action = 'remove_from_queue'
 WHERE remove_from_queue = true
   AND (campaign_action IS NULL OR campaign_action = 'none');

-- 3. Reaffirm campaign_action CHECK constraint (already present on prod; this is idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'dispositions_campaign_action_check'
  ) THEN
    ALTER TABLE public.dispositions
      ADD CONSTRAINT dispositions_campaign_action_check
      CHECK (campaign_action IN ('none', 'remove_from_queue', 'remove_from_campaign'));
  END IF;
END $$;

-- 4. Mark deprecated columns via COMMENT.
COMMENT ON COLUMN public.dispositions.remove_from_queue
  IS 'DEPRECATED — use campaign_action. Kept for backward compatibility; new code must not read or write.';
COMMENT ON COLUMN public.dispositions.auto_add_to_dnc
  IS 'DEPRECATED — use dnc_auto_add. Kept for backward compatibility; new code must not read or write.';

-- 5. Recreate the three reporting RPCs reading the canonical dnc_auto_add column.
--    Bodies preserved byte-for-byte from the live functions except for the column rename
--    inside the EXISTS(... auto_add_to_dnc = true) sub-queries.

CREATE OR REPLACE FUNCTION public.rpc_report_call_summary(
  p_org_id uuid,
  p_start_date timestamp with time zone,
  p_end_date timestamp with time zone,
  p_agent_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_result jsonb;
BEGIN
    WITH base_calls AS (
        SELECT c.*,
               (c.duration > 45 OR EXISTS (
                   SELECT 1 FROM dispositions d
                   WHERE d.id = c.disposition_id
                   AND d.dnc_auto_add = true
               )) as is_contacted,
               EXISTS (
                   SELECT 1 FROM dispositions d
                   JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id
                   WHERE d.id = c.disposition_id AND ps.convert_to_client = true
               ) as is_converted
        FROM calls c
        WHERE c.organization_id = p_org_id
          AND c.started_at >= p_start_date
          AND c.started_at <= p_end_date
          AND (p_agent_id IS NULL OR c.agent_id = p_agent_id)
    ),
    totals AS (
        SELECT
            COUNT(*) as total_calls,
            COUNT(*) FILTER (WHERE direction != 'inbound') as outbound_calls,
            COUNT(*) FILTER (WHERE direction = 'inbound') as inbound_calls,
            COUNT(*) FILTER (WHERE is_contacted) as contacted_calls,
            COUNT(*) FILTER (WHERE is_converted) as converted_calls,
            COALESCE(SUM(duration), 0) as total_duration_seconds
        FROM base_calls
    ),
    agent_stats AS (
        SELECT
            bc.agent_id,
            (p.first_name || ' ' || COALESCE(p.last_name, '')) as agent_name,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE bc.is_contacted) as contacted,
            COUNT(*) FILTER (WHERE bc.is_converted) as converted,
            COALESCE(SUM(bc.duration), 0) as total_duration,
            COALESCE(AVG(bc.duration), 0) as avg_duration
        FROM base_calls bc
        JOIN profiles p ON p.id = bc.agent_id
        WHERE bc.agent_id IS NOT NULL
        GROUP BY bc.agent_id, p.first_name, p.last_name
    )
    SELECT jsonb_build_object(
        'total_calls', t.total_calls,
        'outbound', t.outbound_calls,
        'inbound', t.inbound_calls,
        'contacted', t.contacted_calls,
        'converted', t.converted_calls,
        'total_duration_seconds', t.total_duration_seconds,
        'avg_duration_seconds', CASE WHEN t.total_calls > 0 THEN t.total_duration_seconds / t.total_calls ELSE 0 END,
        'answer_rate_pct', CASE WHEN t.total_calls > 0 THEN ROUND((t.contacted_calls::numeric / t.total_calls::numeric) * 100, 2) ELSE 0 END,
        'conversion_rate_pct', CASE WHEN t.contacted_calls > 0 THEN ROUND((t.converted_calls::numeric / t.contacted_calls::numeric) * 100, 2) ELSE 0 END,
        'calls_by_agent', COALESCE((SELECT jsonb_agg(row_to_json(a.*)) FROM agent_stats a), '[]'::jsonb),
        'calls_by_direction', jsonb_build_object('outbound', t.outbound_calls, 'inbound', t.inbound_calls)
    ) INTO v_result
    FROM totals t;

    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_report_call_volume_timeseries(
  p_org_id uuid,
  p_start_date timestamp with time zone,
  p_end_date timestamp with time zone,
  p_agent_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_result jsonb;
BEGIN
    WITH base_calls AS (
        SELECT c.*,
               (c.duration > 45 OR EXISTS (
                   SELECT 1 FROM dispositions d
                   WHERE d.id = c.disposition_id
                   AND d.dnc_auto_add = true
               )) as is_contacted,
               EXISTS (
                   SELECT 1 FROM dispositions d
                   JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id
                   WHERE d.id = c.disposition_id AND ps.convert_to_client = true
               ) as is_converted,
               EXTRACT(HOUR FROM c.started_at AT TIME ZONE 'UTC') as hour_of_day,
               EXTRACT(DOW FROM c.started_at AT TIME ZONE 'UTC') as dow,
               (c.started_at AT TIME ZONE 'UTC')::date as call_date
        FROM calls c
        WHERE c.organization_id = p_org_id
          AND c.started_at >= p_start_date
          AND c.started_at <= p_end_date
          AND (p_agent_id IS NULL OR c.agent_id = p_agent_id)
    ),
    by_hour AS (
        SELECT hour_of_day as hour,
               COUNT(*) as total,
               COUNT(*) FILTER (WHERE is_contacted) as contacted,
               COUNT(*) FILTER (WHERE is_converted) as converted
        FROM base_calls
        GROUP BY hour_of_day
    ),
    dow_names AS (
        SELECT 0 as dow, 'Sun' as dow_name UNION ALL
        SELECT 1, 'Mon' UNION ALL
        SELECT 2, 'Tue' UNION ALL
        SELECT 3, 'Wed' UNION ALL
        SELECT 4, 'Thu' UNION ALL
        SELECT 5, 'Fri' UNION ALL
        SELECT 6, 'Sat'
    ),
    by_dow AS (
        SELECT b.dow,
               n.dow_name,
               COUNT(*) as total,
               COUNT(*) FILTER (WHERE is_contacted) as contacted,
               COUNT(*) FILTER (WHERE is_converted) as converted
        FROM base_calls b
        JOIN dow_names n ON n.dow = b.dow
        GROUP BY b.dow, n.dow_name
    ),
    by_date AS (
        SELECT call_date::text as date,
               COUNT(*) as total,
               COUNT(*) FILTER (WHERE is_contacted) as contacted,
               COUNT(*) FILTER (WHERE is_converted) as converted
        FROM base_calls
        GROUP BY call_date
        ORDER BY call_date ASC
    ),
    heatmap AS (
        SELECT dow,
               hour_of_day as hour,
               COUNT(*) as total,
               COUNT(*) FILTER (WHERE is_contacted) as contacted
        FROM base_calls
        GROUP BY dow, hour_of_day
    )
    SELECT jsonb_build_object(
        'by_hour', COALESCE((SELECT jsonb_agg(row_to_json(h.*)) FROM by_hour h), '[]'::jsonb),
        'by_day_of_week', COALESCE((SELECT jsonb_agg(row_to_json(d.*)) FROM by_dow d), '[]'::jsonb),
        'by_date', COALESCE((SELECT jsonb_agg(row_to_json(dt.*)) FROM by_date dt), '[]'::jsonb),
        'heatmap', COALESCE((SELECT jsonb_agg(row_to_json(hm.*)) FROM heatmap hm), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_report_campaign_performance(
  p_org_id uuid,
  p_start_date timestamp with time zone,
  p_end_date timestamp with time zone,
  p_agent_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_result jsonb;
BEGIN
    WITH camp_stats AS (
        SELECT cmp.id as campaign_id,
               cmp.name as campaign_name,
               cmp.campaign_type as campaign_type,
               COUNT(DISTINCT cl.lead_id) as total_leads,
               COUNT(DISTINCT c.contact_id) FILTER (WHERE (c.duration > 45 OR EXISTS (SELECT 1 FROM dispositions d WHERE d.id = c.disposition_id AND d.dnc_auto_add = true))) as contacted,
               COUNT(DISTINCT c.contact_id) FILTER (WHERE EXISTS (SELECT 1 FROM dispositions d JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id WHERE d.id = c.disposition_id AND ps.convert_to_client = true)) as converted
        FROM campaigns cmp
        JOIN campaign_leads cl ON cl.campaign_id = cmp.id
        LEFT JOIN calls c ON c.campaign_id = cmp.id
            AND c.contact_id = cl.lead_id
            AND c.organization_id = p_org_id
            AND c.started_at >= p_start_date
            AND c.started_at <= p_end_date
            AND (p_agent_id IS NULL OR c.agent_id = p_agent_id)
        WHERE cmp.organization_id = p_org_id
        GROUP BY cmp.id, cmp.name, cmp.campaign_type
    ),
    ls_stats AS (
        SELECT l.lead_source,
               COUNT(DISTINCT l.id) as total,
               COUNT(DISTINCT c.contact_id) FILTER (WHERE (c.duration > 45 OR EXISTS (SELECT 1 FROM dispositions d WHERE d.id = c.disposition_id AND d.dnc_auto_add = true))) as contacted,
               COUNT(DISTINCT c.contact_id) FILTER (WHERE EXISTS (SELECT 1 FROM dispositions d JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id WHERE d.id = c.disposition_id AND ps.convert_to_client = true)) as converted
        FROM leads l
        LEFT JOIN calls c ON c.contact_id = l.id
            AND c.organization_id = p_org_id
            AND c.started_at >= p_start_date
            AND c.started_at <= p_end_date
            AND (p_agent_id IS NULL OR c.agent_id = p_agent_id)
        WHERE l.organization_id = p_org_id
          AND l.lead_source IS NOT NULL AND l.lead_source != ''
        GROUP BY l.lead_source
    )
    SELECT jsonb_build_object(
        'campaigns', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'campaign_id', c.campaign_id,
            'campaign_name', c.campaign_name,
            'campaign_type', c.campaign_type,
            'total_leads', c.total_leads,
            'contacted', c.contacted,
            'converted', c.converted,
            'conversion_rate_pct', CASE WHEN c.contacted > 0 THEN ROUND((c.converted::numeric / c.contacted::numeric) * 100, 2) ELSE 0 END
        )) FROM camp_stats c), '[]'::jsonb),
        'by_lead_source', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'lead_source', ls.lead_source,
            'total', ls.total,
            'contacted', ls.contacted,
            'converted', ls.converted,
            'conversion_rate_pct', CASE WHEN ls.contacted > 0 THEN ROUND((ls.converted::numeric / ls.contacted::numeric) * 100, 2) ELSE 0 END
        )) FROM ls_stats ls), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

-- 6. Reload PostgREST cache (column comments + RPC bodies changed).
NOTIFY pgrst, 'reload schema';
