-- Calendar Pass 3 (B2): restore oauth_state + oauth_state_expires_at on calendar_integrations.
-- These were declared in 20260307090000_create_calendar_integrations.sql but lost in
-- subsequent ensure_ migrations that recreated the table shape without them. The deployed
-- google-oauth-start / google-oauth-callback functions both require them; without these
-- columns, Google Calendar Connect fails at the upsert step.
--
-- Live state (verified 2026-05-25): 0 calendar_integrations rows.

alter table public.calendar_integrations
  add column if not exists oauth_state text,
  add column if not exists oauth_state_expires_at timestamptz;

-- Partial index for the callback lookup (`.eq("oauth_state", state)`).
create index if not exists calendar_integrations_oauth_state_idx
  on public.calendar_integrations (oauth_state)
  where oauth_state is not null;
