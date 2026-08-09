-- Create DNC List table
create table if not exists public.dnc_list (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null unique,
  reason text,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

-- Enable RLS
alter table public.dnc_list enable row level security;

-- Policies for dnc_list
create policy "Allow authenticated users to view DNC list"
  on public.dnc_list for select
  to authenticated
  using (true);

create policy "Allow authenticated users to manage DNC list"
  on public.dnc_list for all
  to authenticated
  using (true);

-- Create index for faster lookups
create index if not exists idx_dnc_phone_number on public.dnc_list(phone_number);

-- Enable Realtime
alter publication supabase_realtime add table public.dnc_list;
