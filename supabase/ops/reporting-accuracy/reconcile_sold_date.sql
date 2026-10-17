-- Read-only Sold Date reconciliation. $1 organization UUID, $2 frozen as-of timestamptz.
-- Uses only objects that exist both before and after the Sold Date release, so the same query gives the
-- "before" evidence and the expected corrected totals. It never writes. Agency calendar: company_settings.
WITH b AS (
 SELECT $1::uuid org,$2::timestamptz asof,z.time_zone,($2::timestamptz AT TIME ZONE z.time_zone)::date today
 FROM private.report_agency_time_zone($1::uuid) z
), periods AS (
 SELECT b.*,v.period,v.unit,date_trunc(v.unit,b.today::timestamp)::date sold_from,b.today+1 sold_until,
  (date_trunc(v.unit,b.asof AT TIME ZONE b.time_zone) AT TIME ZONE b.time_zone) entry_from,b.asof entry_until
 FROM b CROSS JOIN (VALUES('day','day'),('week','week'),('month','month'),('year','year')) v(period,unit)
), windows AS (
 SELECT period,sold_from,sold_until,entry_from,entry_until FROM periods
 UNION ALL
 SELECT 'previous_'||period,(sold_from-('1 '||unit)::interval)::date,sold_from,
  ((sold_from-('1 '||unit)::interval)::timestamp AT TIME ZONE time_zone),entry_from FROM periods
), facts AS (
 SELECT w.id,w.agent_id,w.sold_date,w.created_at,w.policy_id,w.event_time_source,
  (coalesce(w.recorded_at,w.created_at) AT TIME ZONE b.time_zone)::date entered_date,
  12*private.performance_sale_monthly(w,c.premium) annual
 FROM b JOIN public.wins w ON w.organization_id=b.org AND w.created_at<b.asof
 LEFT JOIN public.clients c ON c.id=w.contact_id AND c.organization_id=w.organization_id
), per_window AS (
 SELECT x.period,f.agent_id,
  count(*) FILTER(WHERE f.created_at>=x.entry_from AND f.created_at<x.entry_until) entry_time_policies,
  coalesce(sum(f.annual) FILTER(WHERE f.created_at>=x.entry_from AND f.created_at<x.entry_until),0) entry_time_annual,
  count(*) FILTER(WHERE f.sold_date>=x.sold_from AND f.sold_date<x.sold_until) sold_date_policies,
  coalesce(sum(f.annual) FILTER(WHERE f.sold_date>=x.sold_from AND f.sold_date<x.sold_until),0) sold_date_annual
 FROM windows x CROSS JOIN facts f GROUP BY x.period,f.agent_id
)
SELECT jsonb_build_object(
 'bounds',(SELECT jsonb_build_object('org',org,'asof',asof,'time_zone',time_zone,'agency_today',today) FROM b),
 'windows',(SELECT jsonb_agg(jsonb_build_object('period',period,'sold_date_from',sold_from,'sold_date_through',sold_until-1,
   'entry_from',entry_from,'entry_until',entry_until) ORDER BY period) FROM windows),
 'per_window_agent',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.period,p.agent_id) FROM per_window p
   WHERE p.entry_time_policies+p.sold_date_policies>0),'[]'),
 'wins',(SELECT count(*) FROM facts),
 'undated',(SELECT count(*) FROM facts WHERE sold_date IS NULL),
 'future_dated',(SELECT count(*) FROM facts,b WHERE facts.sold_date>b.today),
 'entered_after_sold_date',(SELECT count(*) FROM facts WHERE entered_date>sold_date),
 'entry_lag_days',coalesce((SELECT jsonb_object_agg(lag,n ORDER BY lag) FROM (SELECT entered_date-sold_date lag,count(*) n FROM facts
   WHERE sold_date IS NOT NULL GROUP BY 1) l),'{}'),
 'missing_policy_identity',(SELECT count(*) FROM facts WHERE policy_id IS NULL),
 'duplicate_policy_events',(SELECT count(*) FROM (SELECT policy_id FROM facts WHERE policy_id IS NOT NULL GROUP BY policy_id HAVING count(*)>1) d),
 'event_time_sources',coalesce((SELECT jsonb_object_agg(event_time_source,n) FROM (SELECT event_time_source,count(*) n FROM facts GROUP BY 1) s),'{}')
) AS reconciliation;
