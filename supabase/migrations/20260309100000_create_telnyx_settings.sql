create table if not exists telnyx_settings (
  id uuid primary key default gen_random_uuid(),
  api_key text,
  connection_id text,
  sip_username text,
  sip_password text,
  updated_at timestamptz default now()
);

insert into telnyx_settings (id)
values ('00000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

alter table telnyx_settings enable row level security;

create policy "Authenticated users can manage telnyx settings"
  on telnyx_settings for all
  using (auth.role() = 'authenticated');
