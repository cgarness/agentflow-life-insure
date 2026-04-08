-- Create call_scripts table
create table if not exists public.call_scripts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  product_type text not null,
  active boolean default true,
  content text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS
alter table public.call_scripts enable row level security;

-- Policies for call_scripts
create policy "Allow authenticated users to view call scripts"
  on public.call_scripts for select
  to authenticated
  using (true);

create policy "Allow authenticated users to manage call scripts"
  on public.call_scripts for all
  to authenticated
  using (true);

-- Enable Realtime
alter publication supabase_realtime add table public.call_scripts;
