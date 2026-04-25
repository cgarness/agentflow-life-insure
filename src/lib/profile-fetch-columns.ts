/**
 * Explicit `profiles` columns when `select('*')` fails (e.g. PostgREST schema cache drift).
 * Keep aligned with `supabase-users.getById` + flags the app reads after onboarding / My Profile.
 * Avoid rarely-deployed columns so the fallback query still succeeds on older DBs.
 */
export const PROFILE_FETCH_FALLBACK_SELECT = [
  "id",
  "first_name",
  "last_name",
  "email",
  "role",
  "phone",
  "status",
  "avatar_url",
  "availability_status",
  "theme_preference",
  "is_super_admin",
  "created_at",
  "last_login_at",
  "updated_at",
  "licensed_states",
  "resident_state",
  "commission_level",
  "upline_id",
  "monthly_call_goal",
  "monthly_policies_goal",
  "weekly_appointment_goal",
  "monthly_talk_time_goal_hours",
  "npn",
  "timezone",
  "win_sound_enabled",
  "email_notifications_enabled",
  "sms_notifications_enabled",
  "push_notifications_enabled",
  "carriers",
  "organization_id",
  "team_id",
  "onboarding_complete",
].join(",");
