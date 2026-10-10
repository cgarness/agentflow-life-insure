-- =====================================================================================================
-- Platform admin registration notifications (Super Admin "New User Registered" / "New Agency Created").
-- Plan: implementation_plan.md, 2026-10-10 section (D1 Option A). Apply ONLY with Chris's approval.
--
-- The database ENQUEUES; the Edge Function `platform-admin-notify` SENDS (AGENT_RULES invariant #21).
--   * One AFTER INSERT row trigger on public.profiles   -> event 'user_registered'
--   * One AFTER INSERT row trigger on public.organizations -> event 'agency_created'
--   Every registration path (create-user invite/self-serve, legacy accept-invite, SQL) ends in exactly
--   one profiles INSERT; every agency path ends in one organizations INSERT. Logins, profile edits and
--   onboarding saves are UPDATEs and never enqueue.
--   The trigger performs NO network I/O and swallows its own errors, so a notification failure can
--   never abort a signup or an organization creation (invariant #10 pattern).
-- * UNIQUE (event_type, subject_id) + ON CONFLICT DO NOTHING: at most one notification per subject.
-- * The queue is platform-global and server-only: RLS on with no policies, every privilege revoked from
--   PUBLIC/anon/authenticated, service_role only. It stores ids, never a PII snapshot.
-- * Claim/complete RPCs are service_role-only. Claims use FOR UPDATE SKIP LOCKED plus a 5-minute lease.
-- * pg_cron calls the worker each minute ONLY when a row is due, authenticated with the dedicated Vault
--   secret 'platform_admin_notify_token' (never the service-role key). Without that secret the job is a
--   no-op, so the migration is inert until secrets are provisioned.
-- * No backfill: existing users and agencies never notify.
-- Rollback: supabase/migrations/rollback/20261010200000_platform_admin_registration_notifications.rollback.sql
-- =====================================================================================================
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF to_regclass('public.platform_admin_notifications') IS NOT NULL THEN
    RAISE EXCEPTION 'platform_admin_notifications already exists; refusing replay';
  END IF;
  IF to_regclass('public.profiles') IS NULL OR to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION 'public.profiles and public.organizations are required';
  END IF;
  IF to_regnamespace('private') IS NULL THEN
    RAISE EXCEPTION 'schema private is required';
  END IF;
END $guard$;

-- ── Queue ───────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.platform_admin_notifications (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type          text        NOT NULL CHECK (event_type IN ('user_registered', 'agency_created')),
  subject_id          uuid        NOT NULL,
  organization_id     uuid,
  status              text        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'sending', 'sent', 'skipped', 'failed')),
  attempts            integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- 60 s settle delay: a self-serve signup whose org provisioning fails deletes its auth user (profiles
  -- cascade) within milliseconds; the worker re-checks the subject before sending.
  available_at        timestamptz NOT NULL DEFAULT (now() + interval '60 seconds'),
  locked_until        timestamptz,
  last_attempt_at     timestamptz,
  -- Set once, by the first claim (coalesce), and never overwritten. The 23-hour delivery window is
  -- measured from here because Resend's Idempotency-Key lasts 24 h from the first send; a row that was
  -- never attempted carries no duplicate risk and must not expire while delivery is blocked.
  first_attempted_at  timestamptz,
  sent_at             timestamptz,
  provider_message_id text        CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 200),
  last_error          text        CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_admin_notifications_event_subject_key UNIQUE (event_type, subject_id),
  CONSTRAINT platform_admin_notifications_first_attempt_check CHECK ((attempts = 0) = (first_attempted_at IS NULL))
);

COMMENT ON TABLE public.platform_admin_notifications IS
  'Platform-global, server-only queue of Super Admin registration notifications (user_registered, agency_created). '
  'Enqueued by AFTER INSERT triggers; delivered by the platform-admin-notify Edge Function. service_role only.';

CREATE INDEX platform_admin_notifications_due_idx
  ON public.platform_admin_notifications (available_at, id)
  WHERE status IN ('pending', 'sending');

ALTER TABLE public.platform_admin_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_admin_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_admin_notifications TO service_role;

-- ── Enqueue triggers (never block the parent write) ────────────────────────────────────────────
CREATE FUNCTION private.enqueue_platform_admin_user_registered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  BEGIN
    INSERT INTO public.platform_admin_notifications (event_type, subject_id, organization_id)
    VALUES ('user_registered', NEW.id, NEW.organization_id)
    ON CONFLICT (event_type, subject_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'platform admin notification enqueue failed (user_registered %): %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

CREATE FUNCTION private.enqueue_platform_admin_agency_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  BEGIN
    INSERT INTO public.platform_admin_notifications (event_type, subject_id, organization_id)
    VALUES ('agency_created', NEW.id, NEW.id)
    ON CONFLICT (event_type, subject_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'platform admin notification enqueue failed (agency_created %): %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_platform_admin_user_registered() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.enqueue_platform_admin_agency_created() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_zz_platform_admin_notify_user_registered
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_platform_admin_user_registered();

CREATE TRIGGER trg_zz_platform_admin_notify_agency_created
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_platform_admin_agency_created();

-- ── Worker RPCs (service_role only) ────────────────────────────────────────────────────────────
-- Claims due rows atomically. A row stuck in 'sending' past its lease is reclaimed (the worker's Resend
-- Idempotency-Key makes the re-send safe); one that already used its final attempt, or an ATTEMPTED row
-- whose first attempt is more than 23 hours old (the Resend idempotency window), is closed as 'failed'
-- for review instead. A never-attempted row never expires: it waits until delivery is possible.
CREATE FUNCTION public.claim_platform_admin_notifications(p_limit integer DEFAULT 10)
RETURNS SETOF public.platform_admin_notifications
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 50';
  END IF;

  UPDATE public.platform_admin_notifications
     SET status = 'failed',
         locked_until = NULL,
         updated_at = now(),
         last_error = left(coalesce(last_error || ' | ', '') ||
                      CASE WHEN first_attempted_at < now() - interval '23 hours'
                           THEN 'Delivery window expired; review required.'
                           ELSE 'Delivery lease expired after final attempt; review required.' END, 500)
   WHERE (status = 'sending' AND locked_until < now() AND attempts >= 6)
      OR (status IN ('pending', 'sending') AND first_attempted_at < now() - interval '23 hours'
          AND (status = 'pending' OR locked_until < now()));

  RETURN QUERY
  UPDATE public.platform_admin_notifications n
     SET status = 'sending',
         attempts = n.attempts + 1,
         locked_until = now() + interval '5 minutes',
         last_attempt_at = now(),
         first_attempted_at = coalesce(n.first_attempted_at, now()),
         updated_at = now()
   WHERE n.id IN (
           SELECT c.id
             FROM public.platform_admin_notifications c
            WHERE c.available_at <= now()
              AND (c.status = 'pending' OR (c.status = 'sending' AND c.locked_until < now()))
            ORDER BY c.available_at, c.id
            LIMIT p_limit
            FOR UPDATE SKIP LOCKED)
  RETURNING n.*;
END;
$$;

-- Records one attempt's outcome. Only a row still 'sending' can be completed (a stale worker whose lease
-- was reclaimed cannot overwrite a newer outcome). Returns the resulting status, or NULL if not applied.
--   p_outcome 'sent'    -> sent (provider message id kept)
--   p_outcome 'skipped' -> skipped (subject gone / nothing to send)
--   p_outcome 'retry'   -> pending with backoff 1/2/5/15/30 min, or failed after 6 attempts or 23 h
--                          after the FIRST attempt
--   p_outcome 'failed'  -> failed now (a non-retryable error, e.g. a Resend idempotency conflict)
CREATE FUNCTION public.complete_platform_admin_notification(
  p_id uuid,
  p_outcome text,
  p_provider_message_id text DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row   public.platform_admin_notifications%ROWTYPE;
  v_error text := nullif(left(btrim(regexp_replace(coalesce(p_error, ''), '[[:cntrl:]]+', ' ', 'g')), 500), '');
  v_next  text;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('sent', 'skipped', 'retry', 'failed') THEN
    RAISE EXCEPTION 'p_outcome must be sent, skipped, retry or failed';
  END IF;

  SELECT * INTO v_row FROM public.platform_admin_notifications WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'sending' THEN
    RETURN NULL;
  END IF;

  IF p_outcome = 'sent' THEN
    v_next := 'sent';
    UPDATE public.platform_admin_notifications
       SET status = 'sent', sent_at = now(), locked_until = NULL, last_error = NULL,
           provider_message_id = left(nullif(btrim(coalesce(p_provider_message_id, '')), ''), 200),
           updated_at = now()
     WHERE id = p_id;
  ELSIF p_outcome = 'skipped' THEN
    v_next := 'skipped';
    UPDATE public.platform_admin_notifications
       SET status = 'skipped', locked_until = NULL, last_error = v_error, updated_at = now()
     WHERE id = p_id;
  ELSIF p_outcome = 'failed' OR v_row.attempts >= 6 OR v_row.first_attempted_at < now() - interval '23 hours' THEN
    v_next := 'failed';
    UPDATE public.platform_admin_notifications
       SET status = 'failed', locked_until = NULL,
           last_error = coalesce(v_error, 'Delivery failed; review required.'), updated_at = now()
     WHERE id = p_id;
  ELSE
    v_next := 'pending';
    UPDATE public.platform_admin_notifications
       SET status = 'pending', locked_until = NULL, last_error = v_error, updated_at = now(),
           available_at = now() + CASE v_row.attempts
                                    WHEN 1 THEN interval '1 minute'
                                    WHEN 2 THEN interval '2 minutes'
                                    WHEN 3 THEN interval '5 minutes'
                                    WHEN 4 THEN interval '15 minutes'
                                    ELSE interval '30 minutes' END
     WHERE id = p_id;
  END IF;

  RETURN v_next;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_platform_admin_notifications(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_platform_admin_notification(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_admin_notifications(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_platform_admin_notification(uuid, text, text, text) TO service_role;

-- ── Schedule (production has pg_cron + pg_net + Vault; local test stacks may not) ──────────────
DO $schedule$
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regnamespace('net') IS NULL OR to_regnamespace('vault') IS NULL THEN
    RAISE NOTICE 'pg_cron/pg_net/vault not installed; platform-admin-notify schedule not created';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'platform-admin-notify-every-minute') THEN
    RAISE EXCEPTION 'platform-admin-notify schedule already exists; review before replacing';
  END IF;
  PERFORM cron.schedule('platform-admin-notify-every-minute', '* * * * *', $job$
    SELECT net.http_post(
      url := 'https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/platform-admin-notify',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||decrypted_secret),
      body := '{}'::jsonb, timeout_milliseconds := 60000
    ) FROM vault.decrypted_secrets
     WHERE name = 'platform_admin_notify_token' AND length(decrypted_secret) >= 32
       AND EXISTS (SELECT 1 FROM public.platform_admin_notifications
                    WHERE status IN ('pending', 'sending') AND available_at <= now());
  $job$);
END $schedule$;
