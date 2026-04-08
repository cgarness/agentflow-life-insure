-- Create RPC to get exact call stats for a list of contacts

CREATE OR REPLACE FUNCTION public.get_contact_call_stats(
  p_contact_ids uuid[]
)
RETURNS TABLE (
  contact_id uuid,
  calls_today integer,
  total_calls integer,
  last_disposition text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH contact_calls AS (
    SELECT 
      c.contact_id,
      COUNT(*) as total_count,
      COUNT(*) FILTER (WHERE c.created_at >= CURRENT_DATE) as today_count
    FROM public.calls c
    WHERE c.contact_id = ANY(p_contact_ids)
    GROUP BY c.contact_id
  ),
  last_calls AS (
    SELECT DISTINCT ON (c.contact_id)
      c.contact_id,
      c.disposition_name
    FROM public.calls c
    WHERE c.contact_id = ANY(p_contact_ids)
    ORDER BY c.contact_id, c.created_at DESC
  )
  SELECT 
    cc.contact_id,
    cc.today_count::integer,
    cc.total_count::integer,
    lc.disposition_name
  FROM contact_calls cc
  LEFT JOIN last_calls lc ON cc.contact_id = lc.contact_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_contact_call_stats(uuid[]) TO authenticated;
NOTIFY pgrst, 'reload schema';
