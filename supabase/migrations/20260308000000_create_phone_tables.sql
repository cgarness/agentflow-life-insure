-- Create phone_settings table as a singleton
create table if not exists public.phone_settings (
  id uuid primary key default '00000000-0000-0000-0000-000000000000'::uuid,
  provider text not null default 'twilio',
  account_sid text,
  auth_token text,
  api_key text,
  api_secret text,
  application_sid text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint singleton_check check (id = '00000000-0000-0000-0000-000000000000'::uuid)
);

-- Enable RLS
alter table public.phone_settings enable row level security;

-- Policies for phone_settings
create policy "Allow authenticated users to read phone settings"
  on public.phone_settings for select
  to authenticated
  using (true);

create policy "Allow authenticated users to update phone settings"
  on public.phone_settings for update
  to authenticated
  using (true);

create policy "Allow authenticated users to insert phone settings"
  on public.phone_settings for insert
  to authenticated
  with check (true);

-- Create phone_numbers table
create table if not exists public.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null unique,
  friendly_name text,
  status text default 'active' check (status in ('active', 'released', 'spam')),
  assigned_to uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS
alter table public.phone_numbers enable row level security;

-- Policies for phone_numbers
create policy "Allow authenticated users to view phone numbers"
  on public.phone_numbers for select
  to authenticated
  using (true);

create policy "Allow authenticated users to manage phone numbers"
  on public.phone_numbers for all
  to authenticated
  using (true);

-- Enable Realtime
alter publication supabase_realtime add table public.phone_settings;
alter publication supabase_realtime add table public.phone_numbers;
