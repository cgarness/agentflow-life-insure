-- Create notifications table
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'system'
    check (type in ('win', 'missed_call', 'lead_claimed', 'appointment_reminder', 'anniversary', 'system')),
  title text not null,
  body text not null,
  read boolean not null default false,
  action_url text,
  action_label text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Index for fast per-user queries sorted by recency
create index idx_notifications_user_created on public.notifications (user_id, created_at desc);

-- Index for unread count
create index idx_notifications_user_unread on public.notifications (user_id) where read = false;

-- Enable Row Level Security
alter table public.notifications enable row level security;

-- Users can only read their own notifications
create policy "Users can read own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

-- Users can update (mark read) their own notifications
create policy "Users can update own notifications"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Users can delete their own notifications
create policy "Users can delete own notifications"
  on public.notifications for delete
  using (auth.uid() = user_id);

-- Service role / authenticated users can insert notifications for any user
-- (notifications are typically created by server-side triggers or the app on behalf of users)
create policy "Authenticated users can insert notifications"
  on public.notifications for insert
  with check (auth.role() = 'authenticated');

-- Enable Realtime on the notifications table
alter publication supabase_realtime add table public.notifications;
