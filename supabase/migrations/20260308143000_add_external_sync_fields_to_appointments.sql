alter table public.appointments
  add column if not exists external_provider text,
  add column if not exists external_event_id text,
  add column if not exists external_last_synced_at timestamptz;
