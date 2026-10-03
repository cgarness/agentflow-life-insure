-- Synthetic localhost fixtures, never production.
CREATE FUNCTION public.test_uuid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid;
$$;
CREATE FUNCTION public.test_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT FAILED: %',label; END IF; END $$;
CREATE FUNCTION public.test_actor(n integer,org integer DEFAULT 1,actor_role text DEFAULT 'Agent') RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('sub',public.test_uuid(n),'app_metadata',jsonb_build_object('organization_id',public.test_uuid(org),'role',actor_role))::text,false)::void;
$$;
INSERT INTO public.organizations(id,name) VALUES(test_uuid(1),'Synthetic A'),(test_uuid(2),'Synthetic B');
INSERT INTO public.profiles(id,organization_id,role,status,twilio_client_identity) VALUES
(test_uuid(11),test_uuid(1),'Agent','Active','synthetic_agent_11'),
(test_uuid(12),test_uuid(1),'Agent','Active','synthetic_agent_12'),
(test_uuid(19),test_uuid(1),'Admin','Active','synthetic_admin_19'),
(test_uuid(21),test_uuid(2),'Agent','Active','synthetic_agent_21');
INSERT INTO public.campaigns(id,organization_id,name,type,status,user_id,assigned_agent_ids,retry_interval_minutes,max_attempts) VALUES
(test_uuid(101),test_uuid(1),'P1','Personal','Active',test_uuid(11),'[]',60,5),
(test_uuid(102),test_uuid(1),'P2','Personal','Active',test_uuid(11),'[]',60,5),
(test_uuid(103),test_uuid(1),'T','Team','Active',test_uuid(19),jsonb_build_array(test_uuid(11),test_uuid(12)),60,5),
(test_uuid(104),test_uuid(1),'O','Open Pool','Active',test_uuid(19),'[]',60,5),
(test_uuid(105),test_uuid(2),'B','Personal','Active',test_uuid(21),'[]',60,5);
INSERT INTO public.leads(id,organization_id,phone) VALUES
(test_uuid(201),test_uuid(1),'(555) 123-4567'),
(test_uuid(202),test_uuid(1),'+1 555 123 4567'),
(test_uuid(203),test_uuid(1),'5551234568'),
(test_uuid(204),test_uuid(2),'5551234567');
INSERT INTO public.campaign_leads(id,organization_id,campaign_id,lead_id,phone,user_id) VALUES
(test_uuid(301),test_uuid(1),test_uuid(101),test_uuid(201),'5551234567',test_uuid(11)),
(test_uuid(302),test_uuid(1),test_uuid(102),test_uuid(202),'+1 555 123 4567',test_uuid(11)),
(test_uuid(303),test_uuid(1),test_uuid(103),test_uuid(202),'(555) 123-4567',test_uuid(11)),
(test_uuid(304),test_uuid(1),test_uuid(104),test_uuid(201),'+15551234567',test_uuid(11)),
(test_uuid(305),test_uuid(2),test_uuid(105),test_uuid(204),'5551234567',test_uuid(21));
INSERT INTO public.calls(id,organization_id,agent_id,campaign_id,campaign_lead_id,contact_id,contact_type,contact_phone,caller_id_used,status,started_at,ended_at,duration) VALUES
(test_uuid(401),test_uuid(1),test_uuid(11),test_uuid(101),test_uuid(301),test_uuid(201),'lead','5551234567','+15559990000','completed',now()-interval '2 hours',now()-interval '119 minutes',47),
(test_uuid(402),test_uuid(1),test_uuid(12),test_uuid(104),test_uuid(304),test_uuid(201),'lead','5551234567','+15559990000','ringing',now(),NULL,0);
INSERT INTO public.dispositions(id,organization_id,name,dnc_auto_add,campaign_action,callback_scheduler,appointment_scheduler,require_notes,min_note_chars) VALUES
(test_uuid(501),test_uuid(1),'DNC',true,'remove_from_campaign',false,false,false,0),
(test_uuid(502),test_uuid(1),'Not Interested',true,'remove_from_campaign',false,false,false,0),
(test_uuid(503),test_uuid(1),'Different NI',false,'none',false,false,false,0),
(test_uuid(504),test_uuid(1),'No Answer',false,'none',false,false,false,0),
(test_uuid(505),test_uuid(1),'Callback',false,'none',true,false,true,5),
(test_uuid(506),test_uuid(1),'Appointment',false,'none',false,true,true,5),
(test_uuid(507),test_uuid(1),'Sold',false,'remove_from_queue',false,false,true,1);
INSERT INTO public.pipeline_stages(id,organization_id,name,convert_to_client) VALUES(test_uuid(601),test_uuid(1),'Sold',true);
UPDATE public.dispositions SET pipeline_stage_id=test_uuid(601) WHERE id=test_uuid(507);
INSERT INTO public.phone_numbers(organization_id,phone_number) VALUES(test_uuid(1),'+15559990000');
-- Stale Open UI already has a legitimate issued lock before Agent 11 suppresses.
INSERT INTO public.dialer_lead_locks(campaign_lead_id,campaign_id,organization_id,locked_by,expires_at,queue_issued_at)
 VALUES(test_uuid(304),test_uuid(104),test_uuid(1),test_uuid(12),now()+interval '5 minutes',now());
