-- Campaign Settings close-out — real "Last dialed" on Dialer campaign cards.
--
-- Returns the most recent call timestamp per campaign for the caller's org, so
-- the Dialer campaign-selection cards can show a real "Last dialed" date
-- instead of the hardcoded "Never" stub (there is NO campaigns.last_dialed_at
-- column, and we are intentionally not adding a denormalized counter).
--
--   last_dialed_at = MAX(calls.created_at) GROUP BY campaign_id
--
-- Security model: SECURITY DEFINER so EVERY agent sees the SAME org-wide
-- last-dialed per campaign, regardless of their per-row visibility under
-- public.calls RLS (Admin / Team Leader / Agent all get identical numbers) —
-- matching the get_campaign_card_stats / get_trusted_today_dialer_stats pattern.
-- Because DEFINER bypasses RLS on public.calls, the explicit
-- `organization_id = public.get_org_id()` filter in the body is the SOLE tenant
-- guard: no cross-org leakage (and Super Admin does NOT bypass org scoping
-- here). `SET search_path = public, pg_temp` pins the schema resolution so a
-- SECURITY DEFINER function cannot be hijacked via a caller-controlled
-- search_path (standard Supabase security-advisor requirement).
--
-- Aggregate timestamps only; no PII. Campaigns with no calls in the org simply
-- return no row → the frontend renders "Never".

CREATE OR REPLACE FUNCTION public.get_campaign_last_dialed()
RETURNS TABLE (
  campaign_id    uuid,
  last_dialed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    c.campaign_id,
    MAX(c.created_at) AS last_dialed_at
  FROM public.calls c
  WHERE c.organization_id = public.get_org_id()
    AND c.campaign_id IS NOT NULL
  GROUP BY c.campaign_id;
$$;

REVOKE ALL ON FUNCTION public.get_campaign_last_dialed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_campaign_last_dialed() TO authenticated;

NOTIFY pgrst, 'reload schema';
