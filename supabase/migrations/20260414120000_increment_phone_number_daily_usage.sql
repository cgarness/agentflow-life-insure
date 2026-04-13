-- Atomic per-DID daily usage with UTC day boundary (uses existing limit_reset_at + daily_call_count).
-- Called from the client after each successful outbound dial attempt.

CREATE OR REPLACE FUNCTION public.increment_phone_number_daily_usage(p_phone_e164 text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_today date;
BEGIN
  IF p_phone_e164 IS NULL OR btrim(p_phone_e164) = '' THEN
    RETURN;
  END IF;

  v_org := public.get_org_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'increment_phone_number_daily_usage: no organization context';
  END IF;

  v_today := (timezone('utc', now()))::date;

  UPDATE public.phone_numbers pn
  SET
    daily_call_count = CASE
      WHEN pn.limit_reset_at IS NULL
        OR (pn.limit_reset_at AT TIME ZONE 'UTC')::date < v_today
      THEN 1
      ELSE COALESCE(pn.daily_call_count, 0) + 1
    END,
    limit_reset_at = CASE
      WHEN pn.limit_reset_at IS NULL
        OR (pn.limit_reset_at AT TIME ZONE 'UTC')::date < v_today
      THEN (v_today::timestamp AT TIME ZONE 'UTC')
      ELSE pn.limit_reset_at
    END,
    updated_at = now()
  WHERE pn.phone_number = p_phone_e164
    AND pn.organization_id = v_org;

  IF NOT FOUND THEN
    -- Number not in org — silent no-op (stale UI / manual entry mismatch)
    RETURN;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_phone_number_daily_usage(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_phone_number_daily_usage(text) TO authenticated;

COMMENT ON FUNCTION public.increment_phone_number_daily_usage(text) IS
  'Increments daily_call_count for an org-owned DID; resets count when UTC calendar day changes (limit_reset_at).';
