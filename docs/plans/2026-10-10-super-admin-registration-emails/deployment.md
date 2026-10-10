# Super Admin registration emails — production deployment sequence

**Status:** NOT DEPLOYED. Every step below needs Chris's separate approval. Production is `jncvvsvckxhqgqvkppmj`.
Changes go through the Supabase MCP path (invariant #30: the GitHub "Deploy to production" integration stays disabled).
`create-user` is **not** redeployed at any step. Live v56 keeps the production self-service signup restriction.

Branch: `claude/super-admin-registration-emails-20261010`. File hashes are recorded in §7, at the bottom of this file.

## Order and why

1. **Secrets first.** The worker and the cron job both require the token.
2. **Function second.** It is inert until the queue exists: the claim RPC is missing and the cron job is absent.
3. **Migration last.** Triggers start enqueueing and the cron job starts delivering in the same commit.

---

## 0. Read-only preflight (Claude, before any write)

- `list_migrations`: the newest version is `20261010043517` (or a later, unrelated, recorded version). `20261010200000` must not be recorded.
- `get_edge_function platform-admin-notify` → not found.
- `get_edge_function create-user` → still v56, `verify_jwt=true`, ezbr `2dc286da…`. It must contain `Self-service signup is temporarily disabled`. **Stop if it changed.**
- SQL (read-only):
  ```sql
  SELECT to_regclass('public.platform_admin_notifications') AS queue,
         (SELECT count(*) FROM cron.job WHERE jobname = 'platform-admin-notify-every-minute') AS job,
         (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_zz_platform_admin_notify_%') AS triggers;
  -- expect: NULL, 0, 0
  ```

## 1. Secrets (Chris, in the Supabase dashboard; values never in git, chat or logs)

1. Generate one value locally, for example `openssl rand -hex 32` (64 characters; at least 32 are required).
2. **Edge Functions → Secrets**:
   - `PLATFORM_ADMIN_NOTIFY_TOKEN` = that value.
   - *(Optional)* `PLATFORM_ADMIN_NOTIFY_RECIPIENT`. **Leave unset** for the default, `chris@fflagent.com`. If set, it must be exactly one valid address. Blank, malformed or multiple addresses **fail closed**: the worker returns 503, logs `PLATFORM_ADMIN_NOTIFY_RECIPIENT is set but invalid (length N)` without the value, and claims nothing. Queued notifications keep their retry eligibility and send once the secret is fixed.
   - `RESEND_API_KEY` already exists (it is used by the system-email functions). Do not change it.
3. **Vault** (SQL editor, run by Chris):
   ```sql
   SELECT vault.create_secret('<the same value>', 'platform_admin_notify_token', 'platform-admin-notify worker token');
   ```
4. Claude verifies by name only, without decrypting:
   ```sql
   SELECT count(*) FROM vault.secrets WHERE name = 'platform_admin_notify_token';  -- expect 1
   ```
   Claude also confirms that the Edge secret names exist (names only).

## 2. Deploy the Edge Function (Claude, after approval)

- `deploy_edge_function`:
  - name `platform-admin-notify`;
  - entrypoint `index.ts`;
  - `verify_jwt: false`;
  - files exactly as on the branch:
    - `index.ts` (= `supabase/functions/platform-admin-notify/index.ts`)
    - `../_shared/platformAdminNotifications.ts`
    - `../_shared/systemEmailTemplates.ts`
    - `../_shared/systemEmail.ts`
- Read back with `get_edge_function`: every file byte-identical to the branch (sha256 in §7), `verify_jwt=false`, ACTIVE.
- Bundling the updated `_shared` files into this one function changes **no other function**. `create-user`, `invite-user`, `send-invite-email`, `send-welcome-email`, `invite-to-agency-group` and `send-email-previews` keep their currently deployed copies, and none of them is redeployed.
- Smoke check (no data, no secret needed): a POST with no `Authorization` header → **403**. A GET → **405**.

## 3. Apply the migration (Claude, after approval)

- `apply_migration`, name `platform_admin_registration_notifications`, with the **exact bytes** of `supabase/migrations/20261010200000_platform_admin_registration_notifications.sql` (sha256 in §7).
- The stamped production version will differ from `20261010200000`. Afterwards, rename the repository file to the recorded version (bytes unchanged), the same convention as the earlier releases.
- Read-back (read-only):
  ```sql
  SELECT relrowsecurity, relacl FROM pg_class WHERE oid = 'public.platform_admin_notifications'::regclass;
  -- expect RLS on; ACL holds postgres + service_role only
  SELECT count(*) FROM public.platform_admin_notifications;                          -- expect 0 (no backfill)
  SELECT column_name FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'platform_admin_notifications' AND column_name = 'first_attempted_at';
  -- expect 1 row (the 23 h delivery window starts at the first attempt)
  SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname LIKE 'trg_zz_platform_admin_notify_%';
  -- expect 2: profiles, organizations
  SELECT p.oid::regprocedure, p.proacl FROM pg_proc p
   WHERE p.proname IN ('claim_platform_admin_notifications','complete_platform_admin_notification',
                       'enqueue_platform_admin_user_registered','enqueue_platform_admin_agency_created');
  -- expect no anon/authenticated/PUBLIC EXECUTE
  SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'platform-admin-notify-every-minute';
  -- expect 1 row, '* * * * *'
  ```
- `get_advisors` (security): no new finding attributable to these objects.

## 4. Observation (read-only)

The next real registration or agency creation produces a queue row. About 60–120 s later it should read `sent` with a `provider_message_id`, and Chris receives the email.
```sql
SELECT event_type, status, attempts, created_at, sent_at, last_error
  FROM public.platform_admin_notifications ORDER BY created_at DESC LIMIT 20;
```
Edge logs: `platform-admin-notify: row=… outcome=… status=…`. The logs never contain the email body or any secret.
A `503 Recipient configuration invalid` or `503 Email provider not configured` in the Edge logs means a secret needs fixing. Rows stay `pending` with `attempts = 0` and never expire until they have been attempted.

## 5. Live end-to-end test — needs a SEPARATE approval (D5)

This requires one real invite signup to an address Chris controls, in an organization Chris chooses. It creates one real user, so it is a production write. Without that approval, the live test stays **BLOCKED / NOT PASSED**.

## 6. Rollback (each is a NEW migration or action, approval-gated)

- **Stop delivery only:** a new migration with `SELECT cron.unschedule('platform-admin-notify-every-minute');`. Rows keep queueing harmlessly.
- **Full rollback:** a new migration with the exact bytes of `supabase/migrations/rollback/20261010200000_platform_admin_registration_notifications.rollback.sql`. It removes the job, the triggers, the functions and the table. Signup and organization creation are then identical to before the feature. To keep the delivery history, export the queue first (invariant #29).
- **Function:** delete `platform-admin-notify`, or leave it in place: without the queue and the cron job it does nothing.
- **Secrets:** remove `PLATFORM_ADMIN_NOTIFY_TOKEN` (and the optional recipient) plus Vault `platform_admin_notify_token`.

## 7. Artifact hashes (sha256, at branch head)

Recompute with `sha256sum` before every step. Any mismatch stops the release; if a later commit legitimately changes a file, update this table in the same commit.

| File | sha256 |
|---|---|
| `supabase/migrations/20261010200000_platform_admin_registration_notifications.sql` | `f33f84cf6baa53d5b2e5a08fae36056ce8d840369f5e43613dc11c5b38acce9e` |
| `supabase/migrations/rollback/20261010200000_platform_admin_registration_notifications.rollback.sql` | `1c21c4aa3b0d4f3ce567d9dfa79d003490f474f7d65ee877a1105cde09a65ad8` |
| `supabase/functions/platform-admin-notify/index.ts` | `4c0ab59ad62ec5a7b925cf2926b5d45c9886866028c7f5b8328038ca5b6feb6f` |
| `supabase/functions/_shared/platformAdminNotifications.ts` | `33e098aa79684727dc3d1fa5589413250514fc73afbfe26d8a625b056c00cdcd` |
| `supabase/functions/_shared/systemEmailTemplates.ts` | `68fb076996b10eddef74a354ae51290d06aa09fb68bc77796cfcf241aa0d4aac` |
| `supabase/functions/_shared/systemEmail.ts` | `095cbd75237081f8611ec8cfd8c0105d6c1376bb505174b70e01af55f45743c7` |
