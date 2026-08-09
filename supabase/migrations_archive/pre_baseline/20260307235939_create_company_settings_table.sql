-- Create company_settings table
create table if not exists public.company_settings (
    id uuid primary key default gen_random_uuid(),
    company_name text not null,
    logo_url text,
    logo_name text,
    favicon_url text,
    favicon_name text,
    timezone text default 'America/Chicago',
    date_format text default 'MM/DD/YYYY',
    time_format text default '12',
    primary_color text default '#3B82F6',
    company_phone text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Set up RLS
alter table public.company_settings enable row level security;

-- Create policy to allow authenticated users to read settings
create policy "Allow authenticated users to read company settings"
    on public.company_settings
    for select
    to authenticated
    using (true);

-- Create policy to allow authenticated users to update settings
create policy "Allow authenticated users to update company settings"
    on public.company_settings
    for update
    to authenticated
    using (true)
    with check (true);

-- Create policy to allow authenticated users to insert settings (if none exist)
create policy "Allow authenticated users to insert company settings"
    on public.company_settings
    for insert
    to authenticated
    with check (true);

-- Add updated_at trigger
create extension if not exists moddatetime schema extensions;

create trigger handle_updated_at before update on public.company_settings
  for each row execute procedure moddatetime (updated_at);
