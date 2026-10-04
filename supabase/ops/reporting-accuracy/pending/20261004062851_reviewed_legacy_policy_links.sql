-- QUARANTINED: review separately. Link six single-policy conversion events; no new sale or fact rewrite.
-- These identities remain durable on application rollback.
BEGIN;
SET LOCAL lock_timeout='1s'; SET LOCAL statement_timeout='15s'; SET LOCAL TIME ZONE 'UTC';
DO $$ DECLARE target record;c public.clients;w public.wins;hash text;
BEGIN
 FOR target IN SELECT * FROM (VALUES
('3c934626-e2ed-4618-99b0-5cd4736cfe15'::uuid,'1d3cf2dcff375190096d47ef5014dd52','acb839f9-f5ab-47b9-923c-c543c7d9be3b'::uuid,'conversion:e1dbfd8e-ae07-4f13-87d8-e4890d669578','7c692e64-fbbc-4c7a-bcbf-149a6476c520'::uuid,0,false,'2026-08-14T00:21:43.233682+00:00'::timestamptz),
('30b31e9d-d675-4a26-abff-fbdea0c9e8ba'::uuid,'c3314409e320fabf8c53788421dc0b69','c765c097-f6ac-450b-942b-fafc04e2f3fb'::uuid,'conversion:216b11c4-94c1-4a28-8d5a-e3ae0dec3d49','7c692e64-fbbc-4c7a-bcbf-149a6476c520'::uuid,193.14,false,'2026-08-27T16:21:09.953204+00:00'::timestamptz),
('4e53c094-7979-40a6-8df2-7fe5dbc41db7'::uuid,'782ade0be0cc1bf245a2a02862942c08','e5513781-559d-4df3-bf12-6d2a79967f7f'::uuid,'conversion:b0142dc1-a2d3-49db-93dc-617214b93b45','7c692e64-fbbc-4c7a-bcbf-149a6476c520'::uuid,137,false,'2026-08-26T21:51:30.073449+00:00'::timestamptz),
('e6bdbaf8-8544-4687-8523-a01f18b25739'::uuid,'8659adb7d9a4929ac35c0dbbe1484acf','3446233c-8b0c-4206-8291-124bef6f3fec'::uuid,'conversion:da7bb40a-b22a-498d-85e8-f8698ceb0655','7c692e64-fbbc-4c7a-bcbf-149a6476c520'::uuid,108.91,false,'2026-08-26T21:48:36.871885+00:00'::timestamptz),
('a3b4031e-59d1-4fa0-9372-5cb064dd1833'::uuid,'fd14e515efc23566baab452f51e3c242','ea1c5823-8709-43f6-8502-e37b005694ff'::uuid,'conversion:39cdd2cf-6d09-40a7-a62a-51d301b32433','7c692e64-fbbc-4c7a-bcbf-149a6476c520'::uuid,112.42,false,'2026-09-17T20:27:01.527712+00:00'::timestamptz),
('02d0d979-7f61-45a7-ba3a-7d0bbd5318a4'::uuid,'d3215444265a05a59d75e796c0305827','c7db161a-3e5d-44cb-a1ce-b846af550246'::uuid,'conversion:ea32efcd-fb7d-4897-a481-e4bad5cb51d6','7c692e64-fbbc-4c7a-bcbf-149a6476c520'::uuid,54.6,false,'2026-09-02T21:14:28.449704+00:00'::timestamptz)
 ) v(client_id,source_hash,win_id,event_key,seller,premium,snapshot,event_time) ORDER BY client_id LOOP
 SELECT * INTO c FROM public.clients WHERE id=target.client_id AND organization_id='a0000000-0000-0000-0000-000000000001' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Legacy client missing'; END IF;
 hash:=md5(jsonb_build_object('owner',c.assigned_agent_id,'policy_type',c.policy_type,'carrier',c.carrier,'premium',c.premium,'sold_date',c.sold_date,'created_at',c.created_at,'additional_policies',c.custom_fields->'additional_policies')::text);
 IF hash<>target.source_hash OR coalesce(c.custom_fields->'additional_policies','[]')<>'[]'::jsonb OR c.lead_id IS NULL OR target.event_key<>'conversion:'||c.lead_id THEN
 RAISE EXCEPTION 'Ambiguous or changed legacy policy: %',c.id; END IF;
 SELECT * INTO w FROM public.wins WHERE id=target.win_id AND organization_id=c.organization_id AND contact_id=c.id FOR UPDATE;
 IF NOT FOUND OR (SELECT count(*) FROM public.wins WHERE organization_id=c.organization_id AND contact_id=c.id)<>1
 OR (w.idempotency_key,w.agent_id,coalesce(w.premium_amount,0),w.premium_snapshot,w.created_at) IS DISTINCT FROM (target.event_key,target.seller,target.premium,target.snapshot,target.event_time) THEN
 RAISE EXCEPTION 'Legacy event evidence changed: %',c.id; END IF;
 IF c.primary_policy_id IS NULL THEN
  UPDATE public.clients SET primary_policy_id=gen_random_uuid() WHERE id=c.id RETURNING * INTO c;
 END IF;
 IF w.policy_id IS NOT NULL AND w.policy_id<>c.primary_policy_id THEN RAISE EXCEPTION 'Legacy policy already linked differently'; END IF;
 UPDATE public.wins SET policy_id=c.primary_policy_id WHERE id=w.id AND policy_id IS NULL;
 END LOOP;
END $$;
COMMIT;
