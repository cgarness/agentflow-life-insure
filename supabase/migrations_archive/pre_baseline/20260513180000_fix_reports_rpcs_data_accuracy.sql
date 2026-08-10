-- Migration: Fix Reports RPC Data Accuracy
-- Fixes 3 bugs across all 4 reporting RPCs:
-- 1. is_contacted: use d.auto_add_to_dnc = true instead of name ILIKE matching
-- 2. disposition breakdown: LEFT JOIN dispositions instead of INNER JOIN (include undispositioned calls)
-- 3. calls_by_agent: JOIN profiles to include agent_name in results

-- 1. rpc_report_call_summary (fix is_contacted + agent_name)
DROP FUNCTION IF EXISTS rpc_report_call_summary(uuid, timestamptz, timestamptz, uuid);
CREATE OR REPLACE FUNCTION rpc_report_call_summary(
    p_org_id uuid,
    p_start_date timestamptz,
    p_end_date timestamptz,
    p_agent_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result jsonb;
BEGIN
    WITH base_calls AS (
        SELECT c.*,
               (c.duration > 45 OR EXISTS (
                   SELECT 1 FROM dispositions d 
                   WHERE d.id = c.disposition_id 
                   AND d.auto_add_to_dnc = true
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
$$;
REVOKE ALL ON FUNCTION rpc_report_call_summary FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_report_call_summary TO authenticated;


-- 2. rpc_report_call_volume_timeseries (fix is_contacted)
DROP FUNCTION IF EXISTS rpc_report_call_volume_timeseries(uuid, timestamptz, timestamptz, uuid);
CREATE OR REPLACE FUNCTION rpc_report_call_volume_timeseries(
    p_org_id uuid,
    p_start_date timestamptz,
    p_end_date timestamptz,
    p_agent_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result jsonb;
BEGIN
    WITH base_calls AS (
        SELECT c.*,
               (c.duration > 45 OR EXISTS (
                   SELECT 1 FROM dispositions d 
                   WHERE d.id = c.disposition_id 
                   AND d.auto_add_to_dnc = true
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
$$;
REVOKE ALL ON FUNCTION rpc_report_call_volume_timeseries FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_report_call_volume_timeseries TO authenticated;


-- 3. rpc_report_disposition_breakdown (fix is_contacted + LEFT JOIN dispositions)
DROP FUNCTION IF EXISTS rpc_report_disposition_breakdown(uuid, timestamptz, timestamptz, uuid);
CREATE OR REPLACE FUNCTION rpc_report_disposition_breakdown(
    p_org_id uuid,
    p_start_date timestamptz,
    p_end_date timestamptz,
    p_agent_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result jsonb;
BEGIN
    WITH base_calls AS (
        SELECT c.id, c.agent_id, c.campaign_id, c.duration,
               COALESCE(d.name, '[No Disposition]') as disposition_name,
               COALESCE(d.color, '#6B7280') as color,
               COALESCE(ps.convert_to_client, false) as is_converted,
               CASE 
                   WHEN c.duration < 30 THEN '0-30s'
                   WHEN c.duration < 60 THEN '30s-1m'
                   WHEN c.duration < 120 THEN '1m-2m'
                   WHEN c.duration < 300 THEN '2m-5m'
                   ELSE '5m+'
               END as duration_range
        FROM calls c
        LEFT JOIN dispositions d ON d.id = c.disposition_id
        LEFT JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id
        WHERE c.organization_id = p_org_id
          AND c.started_at >= p_start_date
          AND c.started_at <= p_end_date
          AND (p_agent_id IS NULL OR c.agent_id = p_agent_id)
    ),
    by_disp AS (
        SELECT disposition_name,
               MAX(color) as color,
               COUNT(*) as count,
               COALESCE(AVG(duration), 0) as avg_duration,
               bool_or(is_converted) as is_converted
        FROM base_calls
        GROUP BY disposition_name
    ),
    by_agent AS (
        SELECT agent_id,
               jsonb_object_agg(disposition_name, count) as dispositions
        FROM (
            SELECT agent_id, disposition_name, COUNT(*) as count
            FROM base_calls
            WHERE agent_id IS NOT NULL
            GROUP BY agent_id, disposition_name
        ) a
        GROUP BY agent_id
    ),
    by_camp AS (
        SELECT bc.campaign_id,
               MAX(cmp.name) as campaign_name,
               jsonb_object_agg(bc.disposition_name, bc.count) as dispositions
        FROM (
            SELECT campaign_id, disposition_name, COUNT(*) as count
            FROM base_calls
            WHERE campaign_id IS NOT NULL
            GROUP BY campaign_id, disposition_name
        ) bc
        JOIN campaigns cmp ON cmp.id = bc.campaign_id
        GROUP BY bc.campaign_id
    ),
    dur_hist AS (
        SELECT duration_range as range,
               COUNT(*) as count
        FROM base_calls
        GROUP BY duration_range
    )
    SELECT jsonb_build_object(
        'by_disposition', COALESCE((SELECT jsonb_agg(row_to_json(d.*)) FROM by_disp d), '[]'::jsonb),
        'by_agent', COALESCE((SELECT jsonb_agg(row_to_json(a.*)) FROM by_agent a), '[]'::jsonb),
        'by_campaign', COALESCE((SELECT jsonb_agg(row_to_json(c.*)) FROM by_camp c), '[]'::jsonb),
        'duration_histogram', COALESCE((SELECT jsonb_agg(row_to_json(h.*)) FROM dur_hist h), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION rpc_report_disposition_breakdown FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_report_disposition_breakdown TO authenticated;


-- 4. rpc_report_campaign_performance (fix is_contacted)
DROP FUNCTION IF EXISTS rpc_report_campaign_performance(uuid, timestamptz, timestamptz, uuid);
CREATE OR REPLACE FUNCTION rpc_report_campaign_performance(
    p_org_id uuid,
    p_start_date timestamptz,
    p_end_date timestamptz,
    p_agent_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result jsonb;
BEGIN
    WITH camp_stats AS (
        SELECT cmp.id as campaign_id,
               cmp.name as campaign_name,
               cmp.campaign_type as campaign_type,
               COUNT(DISTINCT cl.lead_id) as total_leads,
               COUNT(DISTINCT c.contact_id) FILTER (WHERE (c.duration > 45 OR EXISTS (SELECT 1 FROM dispositions d WHERE d.id = c.disposition_id AND d.auto_add_to_dnc = true))) as contacted,
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
               COUNT(DISTINCT c.contact_id) FILTER (WHERE (c.duration > 45 OR EXISTS (SELECT 1 FROM dispositions d WHERE d.id = c.disposition_id AND d.auto_add_to_dnc = true))) as contacted,
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
$$;
REVOKE ALL ON FUNCTION rpc_report_campaign_performance FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_report_campaign_performance TO authenticated;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
