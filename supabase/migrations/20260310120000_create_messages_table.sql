create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null,
  from_number text not null,
  to_number text not null,
  status text not null default 'sent',
  telnyx_message_id text,
  created_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz default now(),
  created_at timestamptz default now()
);

alter table public.messages enable row level security;

create policy "Authenticated users can read messages"
  on public.messages for select
  to authenticated using (true);

create policy "Authenticated users can insert messages"
  on public.messages for insert
  to authenticated with check (true);
