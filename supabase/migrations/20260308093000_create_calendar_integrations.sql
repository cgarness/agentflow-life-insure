-- Create calendar integrations table for per-user calendar provider connections
create table if not exists public.calendar_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  calendar_id text not null,
  sync_mode text not null default 'two_way',
  sync_enabled boolean not null default true,
  -- Store encrypted token payloads (pgcrypto bytea output)
  access_token bytea,
  refresh_token bytea,
  token_expires_at timestamptz,
  last_sync_at timestamptz,
  last_sync_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_integrations_user_provider_unique unique (user_id, provider)
);

-- Index for fast per-user lookups
create index if not exists idx_calendar_integrations_user_id
  on public.calendar_integrations (user_id);

-- Keep updated_at current on writes
create trigger calendar_integrations_updated_at
  before update on public.calendar_integrations
  for each row
  execute function public.update_updated_at();

-- Enable row level security
alter table public.calendar_integrations enable row level security;

-- Users can only view their own integration records
create policy "Users can read own calendar integrations"
  on public.calendar_integrations
  for select
  using (auth.uid() = user_id);

-- Users can only insert their own integration records
create policy "Users can insert own calendar integrations"
  on public.calendar_integrations
  for insert
  with check (auth.uid() = user_id);

-- Users can only update their own integration records
create policy "Users can update own calendar integrations"
  on public.calendar_integrations
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Users can only delete their own integration records
create policy "Users can delete own calendar integrations"
  on public.calendar_integrations
  for delete
  using (auth.uid() = user_id);
