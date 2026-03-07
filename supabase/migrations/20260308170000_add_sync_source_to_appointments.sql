alter table public.appointments
  add column if not exists sync_source text not null default 'internal';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointments_sync_source_check'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_sync_source_check
      check (sync_source in ('internal', 'external'));
  end if;
end
$$;

create index if not exists idx_appointments_google_external_event
  on public.appointments (user_id, external_provider, external_event_id)
  where external_provider = 'google' and external_event_id is not null;
