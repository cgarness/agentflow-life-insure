-- A2P is independent of voice Trust Hub. No existing rows/configuration changed.
begin;
create table public.a2p_accounts (
 organization_id uuid primary key references public.organizations(id),
 account_sid text not null check (account_sid ~ '^AC[0-9a-fA-F]{32}$'),
 account_scope text not null check(account_scope in ('master','subaccount')),
 primary_profile_sid text not null check(primary_profile_sid ~ '^BU[0-9a-fA-F]{32}$'),
 enabled boolean not null default false,
 sms_enforced boolean not null default false,
 enrollment_verified_at timestamptz,
 resources_reconciled_at timestamptz,
 fee_version text not null,
 fees jsonb not null check(jsonb_typeof(fees)='array' and jsonb_array_length(fees)>0),
 fees_valid_until timestamptz not null,
 theme_id text,
 created_at timestamptz not null default now()
);
create table public.a2p_registrations (
 organization_id uuid primary key references public.organizations(id),
 created_by uuid not null references public.profiles(id),
 draft jsonb not null default '{}'::jsonb,
 version integer not null default 1,
 account_sid text,
 brand_inquiry_id text,
 brand_bundle_sid text unique,
 brand_sid text unique,
 brand_status text not null default 'not_started',
 identity_status text,
 brand_errors jsonb not null default '[]',
 messaging_service_sid text unique,
 campaign_inquiry_id text,
 campaign_sid text unique,
 campaign_status text not null default 'not_started',
 campaign_errors jsonb not null default '[]',
 is_test boolean not null default false,
 operation_id uuid,
 operation_kind text,
 operation_started_at timestamptz,
 sync_token uuid,
 sync_started_at timestamptz,
 last_synced_at timestamptz,
 sync_attempted_at timestamptz,
 sync_error text,
 snapshot_version integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,account_sid)
);
create table public.a2p_numbers (
 organization_id uuid not null references public.a2p_registrations(organization_id),
 phone_number_id uuid not null references public.phone_numbers(id) on delete cascade,
 phone_sid text not null unique check(phone_sid ~ '^PN[0-9a-fA-F]{32}$'),
 messaging_service_sid text not null,
 status text not null default 'pending_registration',
 pool_member boolean not null default false,
 checked_at timestamptz,
 event_at timestamptz,
 failure_reason text,
 primary key(organization_id,phone_number_id)
);
create table public.a2p_history (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.a2p_registrations(organization_id),
 actor_id uuid references public.profiles(id),
 kind text not null,
 detail jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create index on public.a2p_history(organization_id,created_at desc,id);
create table public.a2p_event_inbox (
 account_sid text not null,
 event_id text not null,
 organization_id uuid not null references public.a2p_registrations(organization_id),
 event_type text not null,
 event_at timestamptz not null,
 payload jsonb not null,
 processed_at timestamptz,
 attempts integer not null default 0,
 retry_at timestamptz not null default now(),
 last_error text,
 received_at timestamptz not null default now(),
 primary key(account_sid,event_id)
);
create index on public.a2p_event_inbox(received_at) where processed_at is null;
create table public.a2p_email_outbox (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.a2p_registrations(organization_id),
 user_id uuid not null references public.profiles(id),
 event_key text not null,
 title text not null,
 created_at timestamptz not null default now(),
 sent_at timestamptz,
 attempts integer not null default 0,
 last_error text,
 unique(user_id,event_key)
);
-- Never expose account mappings, registration writes, events, or email work to clients.
do $$ declare t text; begin
 foreach t in array array['a2p_accounts','a2p_registrations','a2p_numbers','a2p_history','a2p_event_inbox','a2p_email_outbox'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
 foreach t in array array['a2p_registrations','a2p_numbers','a2p_history'] loop
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy a2p_admin_read on public.%I for select to authenticated using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.organization_id=%I.organization_id and p.status=''Active'' and p.role in (''Admin'',''Super Admin'')))',t,t);
 end loop;
end $$;

-- Service-only atomic status commit, immutable history, and notification fan-out.
-- Callers acquire sync_token before reading the provider; stale workers cannot commit.
create function public.commit_a2p_snapshot(p_org uuid,p_token uuid,p_snapshot jsonb)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r public.a2p_registrations; changed boolean; k text; title text;
begin
 select * into r from public.a2p_registrations where organization_id=p_org for update;
 if not found or r.sync_token is distinct from p_token or p_token is null then return false; end if;
 changed := r.is_test is distinct from coalesce((p_snapshot->>'is_test')::boolean,r.is_test)
  or r.brand_status is distinct from p_snapshot->>'brand_status'
  or r.identity_status is distinct from p_snapshot->>'identity_status'
  or r.campaign_status is distinct from p_snapshot->>'campaign_status'
  or r.brand_errors is distinct from coalesce(p_snapshot->'brand_errors','[]'::jsonb)
  or r.campaign_errors is distinct from coalesce(p_snapshot->'campaign_errors','[]'::jsonb);
 update public.a2p_registrations set
  brand_sid=coalesce(p_snapshot->>'brand_sid',brand_sid),
  brand_status=p_snapshot->>'brand_status',identity_status=p_snapshot->>'identity_status',
  brand_errors=coalesce(p_snapshot->'brand_errors','[]'),
  campaign_sid=coalesce(p_snapshot->>'campaign_sid',campaign_sid),
  campaign_status=p_snapshot->>'campaign_status',campaign_errors=coalesce(p_snapshot->'campaign_errors','[]'),
  is_test=coalesce((p_snapshot->>'is_test')::boolean,is_test),
  snapshot_version=snapshot_version+case when changed then 1 else 0 end,
  last_synced_at=now(),sync_error=null,sync_token=null,sync_started_at=null,updated_at=now()
 where organization_id=p_org;
 -- Membership is committed under the same generation lock as provider status.
 update public.a2p_numbers n set pool_member=(m->>'pool_member')::boolean,checked_at=now()
 from jsonb_array_elements(coalesce(p_snapshot->'pool','[]'::jsonb)) m
 where n.organization_id=p_org and n.phone_number_id=(m->>'phone_number_id')::uuid;
 if changed then
  insert into public.a2p_history(organization_id,kind,detail) values(p_org,'provider_status',p_snapshot);
  k := 'a2p:'||p_org||':'||(r.snapshot_version+1)::text;
  title := 'A2P registration status updated';
  if p_snapshot->>'campaign_status' in ('FAILED','REJECTED','SUSPENDED') or p_snapshot->>'brand_status' in ('FAILED','REJECTED','SUSPENDED') then title:='A2P registration needs attention';
  elsif p_snapshot->>'campaign_status'='VERIFIED' then title:='A2P campaign approved — check phone numbers'; end if;
  insert into public.notifications(user_id,organization_id,type,title,body,action_url,action_label,event_key)
  select p.id,p_org,'system',title,'Open A2P Registration to review the status and next steps.','/settings?section=a2p-registration','View registration',k
  from public.profiles p where p.organization_id=p_org and p.status='Active' and p.role in ('Admin','Super Admin')
  on conflict(user_id,event_key) where event_key is not null do nothing;
  insert into public.a2p_email_outbox(organization_id,user_id,event_key,title)
  select p_org,p.id,k,title from public.profiles p where p.organization_id=p_org and p.status='Active' and p.role in ('Admin','Super Admin') and p.email_notifications_enabled=true
  on conflict(user_id,event_key) do nothing;
 end if;
 return true;
end $$;
revoke all on function public.commit_a2p_snapshot(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.commit_a2p_snapshot(uuid,uuid,jsonb) to service_role;

-- Validated inbox events update only a previously attached, agency-owned sender.
create function public.process_a2p_number_event(p_account text,p_event text)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
declare e public.a2p_event_inbox; n public.a2p_numbers; s text; k text; title text;
begin
 select * into e from public.a2p_event_inbox where account_sid=p_account and event_id=p_event for update;
 if not found or e.processed_at is not null then return; end if;
 if e.event_type not like 'com.twilio.messaging.compliance.number-%' then raise exception 'not a number event'; end if;
 select x.* into n from public.a2p_numbers x join public.phone_numbers p on p.id=x.phone_number_id and p.organization_id=x.organization_id
 join public.a2p_registrations r on r.organization_id=x.organization_id and r.account_sid=e.account_sid
 where x.organization_id=e.organization_id and x.phone_sid=e.payload->>'phonenumbersid'
 and x.messaging_service_sid=e.payload->>'messagingservicesid' for update of x;
 if not found then raise exception 'number mapping not established'; end if;
 if n.event_at is not null and e.event_at<=n.event_at then
  update public.a2p_event_inbox set processed_at=now() where account_sid=p_account and event_id=p_event; return;
 end if;
 s := case e.event_type
 when 'com.twilio.messaging.compliance.number-registration.successful' then 'registered'
 when 'com.twilio.messaging.compliance.number-registration.pending' then 'pending_registration'
 when 'com.twilio.messaging.compliance.number-registration.failed' then 'failed'
 when 'com.twilio.messaging.compliance.number-deregistration.successful' then 'unregistered'
 when 'com.twilio.messaging.compliance.number-deregistration.pending' then 'pending_deregistration'
 when 'com.twilio.messaging.compliance.number-deregistration.failed' then 'failed'
 else 'unknown' end;
 update public.a2p_numbers set status=s,event_at=e.event_at,failure_reason=left(coalesce(e.payload->>'failureReason',e.payload->>'failurereason'),1200)
 where organization_id=n.organization_id and phone_number_id=n.phone_number_id;
 insert into public.a2p_history(organization_id,kind,detail) values(e.organization_id,'number_status',jsonb_build_object('phone_sid',n.phone_sid,'status',s,'event_at',e.event_at));
 if s is distinct from n.status then
  k:='a2p-number:'||p_event; title:=case when s='registered' then 'A2P phone number registered' else 'A2P phone number status changed' end;
  insert into public.notifications(user_id,organization_id,type,title,body,action_url,action_label,event_key)
  select p.id,e.organization_id,'system',title,'Open A2P Registration to check texting readiness.','/settings?section=a2p-registration','View registration',k
  from public.profiles p where p.organization_id=e.organization_id and p.status='Active' and p.role in ('Admin','Super Admin')
  on conflict(user_id,event_key) where event_key is not null do nothing;
  insert into public.a2p_email_outbox(organization_id,user_id,event_key,title)
  select e.organization_id,p.id,k,title from public.profiles p where p.organization_id=e.organization_id and p.status='Active' and p.role in ('Admin','Super Admin') and p.email_notifications_enabled=true on conflict(user_id,event_key) do nothing;
 end if;
 update public.a2p_event_inbox set processed_at=now() where account_sid=p_account and event_id=p_event;
end $$;
revoke all on function public.process_a2p_number_event(text,text) from public,anon,authenticated;
grant execute on function public.process_a2p_number_event(text,text) to service_role;
commit;
