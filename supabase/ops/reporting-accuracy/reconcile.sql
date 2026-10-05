-- Read-only post-schema reconciliation. $1 organization UUID, $2 frozen as-of timestamptz.
WITH bounds AS (
 SELECT $1::uuid org,$2::timestamptz asof,z.time_zone,
 date_trunc('day',$2::timestamptz AT TIME ZONE z.time_zone) AT TIME ZONE z.time_zone day_start,
 date_trunc('week',$2::timestamptz AT TIME ZONE z.time_zone) AT TIME ZONE z.time_zone week_start,
 date_trunc('month',$2::timestamptz AT TIME ZONE z.time_zone) AT TIME ZONE z.time_zone month_start
 FROM private.report_agency_time_zone($1::uuid) z
), periods AS (
 SELECT b.*,v.period,v.start_at FROM bounds b CROSS JOIN LATERAL(VALUES('day',day_start),('week',week_start),('month',month_start))v(period,start_at)
), policies AS (
 SELECT c.organization_id org,c.id client_id,c.primary_policy_id policy_id,'primary' source FROM public.clients c,bounds b
 WHERE c.organization_id=b.org AND private.has_primary_policy(to_jsonb(c))
 UNION ALL SELECT c.organization_id,c.id,nullif(x->>'policyId','')::uuid,'additional'
 FROM public.clients c,bounds b CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.custom_fields->'additional_policies')='array' THEN c.custom_fields->'additional_policies' ELSE '[]'::jsonb END)x
 WHERE c.organization_id=b.org AND jsonb_typeof(x)='object'
), rows AS (
 SELECT p.period,p.start_at,p.asof,r.* FROM periods p CROSS JOIN LATERAL private.performance_rows(ARRAY[p.org],p.start_at,p.asof) r
), suspect_calls AS (
 SELECT c.id,c.agent_id,c.created_at,c.twilio_call_sid,c.duration,c.status,md5(to_jsonb(c)::text) row_hash,
 array_remove(ARRAY[
 CASE WHEN c.twilio_call_sid IS NULL THEN 'missing_provider_id' END,
 CASE WHEN c.ended_at<c.started_at THEN 'negative_elapsed' END,
 CASE WHEN c.status='ringing' AND c.created_at<(SELECT asof FROM bounds)-interval '1 day' THEN 'old_ringing' END,
 CASE WHEN c.twilio_call_sid IS NOT NULL AND count(*) OVER(PARTITION BY c.twilio_call_sid)>1 THEN 'duplicate_provider_id' END],NULL) reasons
 FROM public.calls c,bounds b WHERE c.organization_id=b.org AND c.created_at<b.asof AND lower(c.direction) IN ('outbound','outgoing')
), booking_copies AS (
 SELECT a.id,a.created_at,md5(to_jsonb(a)::text) row_hash,
 md5((to_jsonb(a)-ARRAY['id','created_at','updated_at'])::text) payload_hash,
 count(*) OVER(PARTITION BY to_jsonb(a)-ARRAY['id','created_at','updated_at']) copies
 FROM public.appointments a,bounds b WHERE a.organization_id=b.org AND a.created_at<b.asof
)
SELECT jsonb_build_object(
 'bounds',(SELECT to_jsonb(b) FROM bounds b),
 'canonical_per_agent',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY period,agent_id) FROM rows r),'[]'),
 'raw_period_totals',(SELECT jsonb_agg(jsonb_build_object('period',p.period,'calls',(SELECT count(*) FROM public.calls c WHERE c.organization_id=p.org AND lower(c.direction) IN('outbound','outgoing') AND c.created_at>=p.start_at AND c.created_at<p.asof),'bookings',(SELECT count(*) FROM public.appointments a WHERE a.organization_id=p.org AND a.created_at>=p.start_at AND a.created_at<p.asof))) FROM periods p),
 'policy_identity_gaps',coalesce((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('matching_events',(SELECT count(*) FROM public.wins w WHERE w.organization_id=p.org AND w.policy_id=p.policy_id))) FROM policies p WHERE p.policy_id IS NULL OR (SELECT count(*) FROM public.wins w WHERE w.organization_id=p.org AND w.policy_id=p.policy_id)<>1),'[]'),
 'unlinked_legacy_events',coalesce((SELECT jsonb_agg(w.id) FROM public.wins w,bounds b WHERE w.organization_id=b.org AND w.policy_id IS NULL),'[]'),
 'suspect_calls',coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM suspect_calls c WHERE cardinality(reasons)>0),'[]'),
 'exact_booking_candidates',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM booking_copies a WHERE copies>1),'[]'),
 'applied_duplicate_mappings',coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM private.performance_duplicate_rows d,bounds b WHERE d.organization_id=b.org),'[]'),
 'booking_receipts_missing_rows',coalesce((SELECT jsonb_agg(jsonb_build_object('request_id',r.request_id,'kind',r.kind,'appointment_id',r.appointment_id)) FROM private.booking_receipts r,bounds b WHERE r.organization_id=b.org AND NOT EXISTS(SELECT 1 FROM public.appointments a WHERE a.id=r.appointment_id AND a.organization_id=r.organization_id)),'[]'),
 'duration_quality',(SELECT jsonb_build_object('legacy_unknown',count(*) FILTER(WHERE c.duration_source='legacy_unknown'),'estimated',count(*) FILTER(WHERE c.duration_source='elapsed_estimate'),'conflicts',count(*) FILTER(WHERE c.duration_conflict)) FROM public.calls c,bounds b WHERE c.organization_id=b.org AND c.created_at<b.asof AND lower(c.direction) IN ('outbound','outgoing'))
) AS reconciliation;
