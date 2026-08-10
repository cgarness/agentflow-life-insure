-- Ensure per-user calendar integration storage exists with secure token columns.
create table if not exists public.calendar_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  calendar_id text not null,
  sync_mode text not null default 'two_way',
  sync_enabled boolean not null default true,
  -- bytea allows storing encrypted token payloads (for example pgcrypto output)
  access_token bytea,
  refresh_token bytea,
  token_expires_at timestamptz,
  last_sync_at timestamptz,
  last_sync_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Align existing tables with required columns/types/defaults.
alter table public.calendar_integrations
  alter column user_id set not null,
  alter column provider set not null,
  alter column calendar_id set not null,
  alter column sync_mode set not null,
  alter column sync_mode set default 'two_way',
  alter column sync_enabled set not null,
  alter column sync_enabled set default true,
  alter column created_at set not null,
  alter column created_at set default now(),
  alter column updated_at set not null,
  alter column updated_at set default now(),
  alter column access_token type bytea using access_token::bytea,
  alter column refresh_token type bytea using refresh_token::bytea;

-- Ensure per-user/provider uniqueness and user lookup performance.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'calendar_integrations_user_provider_unique'
      and conrelid = 'public.calendar_integrations'::regclass
  ) then
    alter table public.calendar_integrations
      add constraint calendar_integrations_user_provider_unique unique (user_id, provider);
  end if;
end
$$;

create index if not exists idx_calendar_integrations_user_id
  on public.calendar_integrations (user_id);

-- Keep updated_at current on updates.
do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'calendar_integrations_updated_at'
      and tgrelid = 'public.calendar_integrations'::regclass
  ) then
    create trigger calendar_integrations_updated_at
      before update on public.calendar_integrations
      for each row
      execute function public.update_updated_at();
  end if;
end
$$;

alter table public.calendar_integrations enable row level security;

-- Recreate policies so they are guaranteed to match owner-only access rules.
drop policy if exists "Users can read own calendar integrations" on public.calendar_integrations;
drop policy if exists "Users can insert own calendar integrations" on public.calendar_integrations;
drop policy if exists "Users can update own calendar integrations" on public.calendar_integrations;
drop policy if exists "Users can delete own calendar integrations" on public.calendar_integrations;

create policy "Users can read own calendar integrations"
  on public.calendar_integrations
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own calendar integrations"
  on public.calendar_integrations
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own calendar integrations"
  on public.calendar_integrations
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own calendar integrations"
  on public.calendar_integrations
  for delete
  using (auth.uid() = user_id);
