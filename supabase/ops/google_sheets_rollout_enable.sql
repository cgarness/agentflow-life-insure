-- Executed only by the protected runner in a bounded single transaction.
LOCK TABLE public.google_sheets_sources, public.google_sheets_connections,
 private.google_sheets_receipts, private.google_sheets_source_rows IN SHARE MODE;
DO $rollout$
BEGIN
 PERFORM 1 FROM public.leads WHERE id IN (SELECT lead_id FROM private.google_sheets_receipts) ORDER BY id FOR SHARE;
 PERFORM 1 FROM private.google_sheets_push_config FOR UPDATE;
 IF (SELECT concat_ws('|',mode,max_concurrent_jobs,renew_before_s,renew_overlap_s,late_grace_s)
 FROM private.google_sheets_push_config) IS DISTINCT FROM 'pilot|4|10800|900|3600'
 THEN RAISE EXCEPTION 'config drift'; END IF;
 IF NOT (select
(select count(*)=1 and bool_and(s.id='2a9ce6b6-0500-454d-8c46-48dfab8042b5' and s.state='enabled' and s.health='ok' and s.phase='steady' and s.config_version=2 and c.auth_generation=1 and c.status='connected' and c.has_refresh_token and s.user_id=c.user_id and s.organization_id=c.organization_id and private.google_sheets_owner_eligible(s.user_id,s.organization_id)) from public.google_sheets_sources s join public.google_sheets_connections c on c.id=s.connection_id)
and (select count(*)=1 from public.google_sheets_connections)
and (select md5(string_agg(l::text,'|' order by l.id))='e0915de31276f0159c86ca64d13e7e9e' from public.leads l where l.id in (select lead_id from private.google_sheets_receipts))
and (select md5(string_agg(r::text,'|' order by source_id,receipt_key))='234df3368457e80300be4ff221009819' from private.google_sheets_receipts r)
and (select md5(string_agg(r::text,'|' order by source_id,row_key))='d2102b3de9b5c52c101f627243263c6b' from private.google_sheets_source_rows r)) THEN RAISE EXCEPTION 'source or existing record drift'; END IF;
 UPDATE private.google_sheets_push_config SET mode='on',updated_at=now();
END
$rollout$;
