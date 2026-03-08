

## Google Calendar Integration — Full Implementation Plan

### Current State
- **CalendarSettings.tsx** already has a Google Calendar integration card (Card 5) with connect/disconnect, calendar picker, and sync mode toggle
- **Edge functions** exist for OAuth flow, calendar list, status, configure, disconnect, outbound sync, and inbound sync
- **Missing**: The `calendar_integrations` table doesn't exist in the database yet, and the `appointments` table is missing columns (`external_event_id`, `external_provider`, `external_last_synced_at`, `sync_source`, `user_id`) that the edge functions reference
- **Build error**: All 12 edge functions import `jsr:@supabase/functions-js/edge-runtime.d.ts` which has a transitive dependency resolution issue with `openai`. This needs fixing.

### Plan

#### 1. Fix Build Error — Remove problematic JSR import from all edge functions
Remove `import "jsr:@supabase/functions-js/edge-runtime.d.ts"` from all 12 edge function files. This import is only for type hints and is not needed at runtime. Removing it resolves the openai dependency resolution error.

**Files** (12 edge functions): Remove line 1 from each:
- `supabase/functions/google-oauth-start/index.ts`
- `supabase/functions/google-oauth-callback/index.ts`
- `supabase/functions/google-calendar-list/index.ts`
- `supabase/functions/google-calendar-status/index.ts`
- `supabase/functions/google-calendar-configure/index.ts`
- `supabase/functions/google-calendar-disconnect/index.ts`
- `supabase/functions/google-calendar-sync-appointment/index.ts`
- `supabase/functions/google-calendar-inbound-sync/index.ts`
- `supabase/functions/telnyx-token/index.ts`
- `supabase/functions/telnyx-buy-number/index.ts`
- `supabase/functions/telnyx-search-numbers/index.ts`
- `supabase/functions/telnyx-check-connection/index.ts`

#### 2. Database Migration — Create `calendar_integrations` table and add columns to `appointments`

**New table: `calendar_integrations`**
- `id` uuid PK
- `user_id` uuid (references auth.users, not null)
- `provider` text (default 'google')
- `calendar_id` text
- `access_token` text
- `refresh_token` text
- `token_expires_at` timestamptz
- `sync_mode` text (default 'outbound_only')
- `sync_enabled` boolean (default true)
- `last_sync_token` text
- `last_sync_at` timestamptz
- `created_at` / `updated_at` timestamps
- RLS: users can manage their own rows

**Alter `appointments` table** — add:
- `user_id` uuid (nullable, for associating with user)
- `external_event_id` text (nullable)
- `external_provider` text (nullable)
- `external_last_synced_at` timestamptz (nullable)
- `sync_source` text (default 'internal')

#### 3. CalendarPage — Show Google Calendar events with visual indicator
- Google events already flow into the `appointments` table via inbound sync
- Add a small Google icon badge on appointment cards where `sync_source = 'external'` or `external_provider = 'google'`
- Add a "Sync Now" button in the calendar header that triggers the inbound sync function
- Track `sync_source` in the fetched appointment data to distinguish Google vs internal events
- Google-sourced events show as read-only (no edit/delete) since they're managed in Google

#### 4. CalendarPage — Fetch sync status on load
- On mount, check `google-calendar-status` to see if Google is connected
- If connected and two-way sync is enabled, show a small "Google Calendar" indicator in the header
- Add a manual "Sync" button that invokes `google-calendar-inbound-sync` (will need to adjust the function to also accept authenticated user calls, not just cron)

#### 5. Update inbound sync to support on-demand calls
- Modify `google-calendar-inbound-sync/index.ts` to accept either cron secret OR authenticated user JWT
- When called by a user, only sync that user's integration (not all users)

### Files to change
1. **12 edge function files** — remove JSR import (line 1)
2. **`supabase/functions/google-calendar-inbound-sync/index.ts`** — add user-authenticated mode
3. **Database migration** — create `calendar_integrations`, alter `appointments`
4. **`src/pages/CalendarPage.tsx`** — add sync status, Google badge on events, Sync Now button, read-only for external events

