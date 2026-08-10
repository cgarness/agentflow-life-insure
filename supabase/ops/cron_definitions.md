# Operational cron definitions (environment-parameterized; DISABLED by default)

**Contract:** cron jobs are **operational configuration, not schema**. The baseline migration and the
reference bootstrap create **no** cron jobs, so a fresh local/CI environment can never call
production. Jobs are created per environment, by hand, with that environment's own URL and secrets.
Never commit a concrete project URL or secret here. Local stacks should generally leave all of these
uncreated.

Production project (for operator reference only): AGENTFLOW CRM / `jncvvsvckxhqgqvkppmj`.
`{{PROJECT_URL}}` = the target environment's own Supabase URL. Auth headers come from the
environment's secret store (the `private.*_cron_secret` singletons / Vault) — never from this file.

## Jobs sourced from (now archived) migrations

| Job | Schedule | Command target | Source (archived) |
|---|---|---|---|
| `recording-retention-purge-daily` | `15 8 * * *` | `{{PROJECT_URL}}/functions/v1/recording-retention-purge` (secret from `private.recording_retention_cron_secret`) | `20260423140000` |
| `email-sync-incremental-every-5m` | `*/5 * * * *` | `{{PROJECT_URL}}/functions/v1/email-sync-incremental` (secret from `private.email_sync_cron_secret`) | `20260430120100` |
| `google-calendar-inbound-sync-every-5m` | `*/5 * * * *` | `{{PROJECT_URL}}/functions/v1/google-calendar-inbound-sync` (secret from `private.google_sync_cron_secret`) | `20260430120100` |
| `cleanup-old-notifications` | `0 3 * * *` | SQL-only (`DELETE` old notifications; no HTTP) | `20260512120000` |

## Jobs that exist in production with NO migration source (dashboard-created; captured 2026-08-08)

| Job | Schedule | Command target |
|---|---|---|
| `spam-check-daily` | `0 3 * * *` | `{{PROJECT_URL}}/functions/v1/spam-check-cron` |
| `daily-call-limit-reset` | `0 0 * * *` | `{{PROJECT_URL}}/functions/v1/daily-call-limit-reset` |
| `reset-daily-call-counts` | `0 0 * * *` | SQL-only (no HTTP) |

These three predate this capture and were created via the dashboard/SQL editor. Recreating them in a
new environment is a deliberate operator action using this table.

## Verification for any non-production environment

```sql
select jobname, schedule, active from cron.job;         -- expected: zero rows locally
select count(*) from net.http_request_queue;            -- expected: 0
```
