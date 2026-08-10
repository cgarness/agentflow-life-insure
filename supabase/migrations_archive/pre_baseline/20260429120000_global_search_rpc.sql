-- Global Search RPC v1
-- Enables full-text ILIKE search across leads, clients, recruits, campaigns, calls
-- scoped by organization via public.get_org_id().
-- pg_trgm GIN indexes make ILIKE '%q%' fast and set up v2 fuzzy matching.

create extension if not exists pg_trgm schema public;

-- Trigram indexes: leads
create index if not exists idx_leads_trgm_name
  on public.leads using gin ((first_name || ' ' || last_name) public.gin_trgm_ops);
create index if not exists idx_leads_trgm_phone
  on public.leads using gin (phone public.gin_trgm_ops);
create index if not exists idx_leads_trgm_email
  on public.leads using gin (email public.gin_trgm_ops);

-- Trigram indexes: clients
create index if not exists idx_clients_trgm_name
  on public.clients using gin ((first_name || ' ' || last_name) public.gin_trgm_ops);
create index if not exists idx_clients_trgm_phone
  on public.clients using gin (phone public.gin_trgm_ops);
create index if not exists idx_clients_trgm_email
  on public.clients using gin (email public.gin_trgm_ops);

-- Trigram indexes: recruits
create index if not exists idx_recruits_trgm_name
  on public.recruits using gin ((first_name || ' ' || last_name) public.gin_trgm_ops);
create index if not exists idx_recruits_trgm_phone
  on public.recruits using gin (phone public.gin_trgm_ops);
create index if not exists idx_recruits_trgm_email
  on public.recruits using gin (email public.gin_trgm_ops);

-- Trigram indexes: campaigns
create index if not exists idx_campaigns_trgm_name
  on public.campaigns using gin (name public.gin_trgm_ops);
create index if not exists idx_campaigns_trgm_desc
  on public.campaigns using gin (description public.gin_trgm_ops);

-- Trigram indexes: calls
create index if not exists idx_calls_trgm_contact_name
  on public.calls using gin (contact_name public.gin_trgm_ops);
create index if not exists idx_calls_trgm_contact_phone
  on public.calls using gin (contact_phone public.gin_trgm_ops);
create index if not exists idx_calls_trgm_disposition
  on public.calls using gin (disposition_name public.gin_trgm_ops);

-- RPC: global_search
-- Returns up to 5 results per type (25 max), ordered by relevance desc, title asc.
-- Returns empty set when search_query is null, empty, or shorter than 2 chars.
create or replace function public.global_search(search_query text)
returns table (
  result_type text,
  id          uuid,
  title       text,
  subtitle    text,
  match_field text,
  relevance   int
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select
      case
        when search_query is null or length(trim(search_query)) < 2
          then null
        else '%' || trim(search_query) || '%'
      end as pattern,
      public.get_org_id() as org_id
  ),
  lead_hits as (
    select
      'lead'::text,
      l.id,
      (l.first_name || ' ' || l.last_name)::text,
      coalesce(nullif(l.phone, ''), nullif(l.email, ''), 'Lead')::text,
      case
        when (l.first_name || ' ' || l.last_name) ilike (select pattern from q) then 'name'
        when l.phone ilike (select pattern from q) then 'phone'
        else 'email'
      end::text,
      100::int
    from public.leads l, q
    where q.pattern is not null
      and l.organization_id = q.org_id
      and (
        (l.first_name || ' ' || l.last_name) ilike q.pattern
        or l.phone ilike q.pattern
        or l.email ilike q.pattern
      )
    limit 5
  ),
  client_hits as (
    select
      'client'::text,
      c.id,
      (c.first_name || ' ' || c.last_name)::text,
      coalesce(nullif(c.phone, ''), nullif(c.email, ''), 'Client')::text,
      case
        when (c.first_name || ' ' || c.last_name) ilike (select pattern from q) then 'name'
        when c.phone ilike (select pattern from q) then 'phone'
        else 'email'
      end::text,
      90::int
    from public.clients c, q
    where q.pattern is not null
      and c.organization_id = q.org_id
      and (
        (c.first_name || ' ' || c.last_name) ilike q.pattern
        or c.phone ilike q.pattern
        or c.email ilike q.pattern
      )
    limit 5
  ),
  recruit_hits as (
    select
      'recruit'::text,
      r.id,
      (r.first_name || ' ' || r.last_name)::text,
      coalesce(nullif(r.phone, ''), nullif(r.email, ''), 'Recruit')::text,
      case
        when (r.first_name || ' ' || r.last_name) ilike (select pattern from q) then 'name'
        when r.phone ilike (select pattern from q) then 'phone'
        else 'email'
      end::text,
      80::int
    from public.recruits r, q
    where q.pattern is not null
      and r.organization_id = q.org_id
      and (
        (r.first_name || ' ' || r.last_name) ilike q.pattern
        or r.phone ilike q.pattern
        or r.email ilike q.pattern
      )
    limit 5
  ),
  campaign_hits as (
    select
      'campaign'::text,
      ca.id,
      ca.name::text,
      coalesce(ca.status, 'campaign')::text,
      case
        when ca.name ilike (select pattern from q) then 'name'
        else 'description'
      end::text,
      70::int
    from public.campaigns ca, q
    where q.pattern is not null
      and ca.organization_id = q.org_id
      and (
        ca.name ilike q.pattern
        or ca.description ilike q.pattern
      )
    limit 5
  ),
  conv_hits as (
    select
      'conversation'::text,
      cv.id,
      coalesce(cv.contact_name, cv.contact_phone, 'Call')::text,
      coalesce(cv.disposition_name, cv.status, '')::text,
      case
        when cv.contact_name ilike (select pattern from q) then 'contact'
        when cv.contact_phone ilike (select pattern from q) then 'phone'
        else 'disposition'
      end::text,
      60::int
    from public.calls cv, q
    where q.pattern is not null
      and cv.organization_id = q.org_id
      and (
        cv.contact_name ilike q.pattern
        or cv.contact_phone ilike q.pattern
        or cv.disposition_name ilike q.pattern
      )
    order by cv.created_at desc
    limit 5
  )
  select * from lead_hits
  union all select * from client_hits
  union all select * from recruit_hits
  union all select * from campaign_hits
  union all select * from conv_hits
  order by relevance desc, title asc;
$$;

revoke all on function public.global_search(text) from public;
grant execute on function public.global_search(text) to authenticated;
