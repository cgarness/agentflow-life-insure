-- Sold Date windows read one organization's date range (D6: kept only because the native plan proof uses it).
-- Bounded index build; failure aborts this additive migration without altering data.
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='25s';
CREATE INDEX performance_wins_org_sold_date ON public.wins(organization_id,sold_date);
