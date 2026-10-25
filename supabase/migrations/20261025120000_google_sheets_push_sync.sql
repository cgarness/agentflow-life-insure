-- =====================================================================================================
-- Google Sheets real-time sync (Google Drive push notifications) — durable queue, watch lifecycle, push claims.
-- Plan: docs/plans/2026-10-25-google-sheets-realtime-sync/implementation_plan.md (§3–§6, §17).
--
-- New objects only, plus TWO guarded changes to the foundation (20261022062539):
--   * private.google_sheets_finish — CREATE OR REPLACE after verifying the exact live preimage MD5. The ONLY
--     differences: p_trigger also accepts 'push', and last_result also records 'backlog'.
--   * public.google_sheets_sync_runs — the trigger CHECK also accepts 'push'.
--
-- Security model (same as the foundation):
--   * Every new table is in `private`, carries organization_id/user_id copied from server rows (never from a
--     request), has RLS enabled with no policy and no grant to PUBLIC/anon/authenticated/service_role.
--   * Logic is private.* SECURITY DEFINER with a pinned search_path; Edge Functions reach it only through
--     public.google_sheets_* wrappers that only service_role may EXECUTE.
--   * Pilot scope (push_config.mode + push_pilot_sources) is enforced HERE, at every claim/kick/registration.
--   * Lock order: channels of a target (by id) → target → source → connection. Connection-only operations
--     (store_connection / mark_reconnect / disconnect) lock only the connection and never touch targets or
--     channels. push_accept reads the connection without a lock; every write still goes through the
--     unchanged private.google_sheets_lock_for_work.
--   * No-lost-work: a notification only ever INCREMENTS requested_seq; only push_complete with a SQL-verified
--     'done' advances processed_seq to the snapshot taken at claim time.
--   * Bounded receiver cost: a rejected request takes no lock and records at most one row per channel per
--     minute; a redelivery writes nothing; (channel, message number) is unique; retention keeps pace (§18).
--   * Renewal overlap: a superseded channel keeps being accepted for renew_overlap_s before it is stopped; a
--     channel Google confirmed is accepted for late deliveries only within late_grace_s after it ended (§18).
-- No existing policy, trigger, workflow, DNC, SMS, consent, telephony, lead or receipt object is altered.
-- =====================================================================================================

-- ---------------------------------------------------------------- preflight: dependency, replay, preimages
DO $pre$
BEGIN
  IF to_regclass('public.google_sheets_sources') IS NULL THEN
    RAISE EXCEPTION 'google sheets foundation is not applied';
  END IF;
  IF to_regclass('private.google_sheets_watch_targets') IS NOT NULL THEN
    RAISE EXCEPTION 'google sheets push sync already applied; review before replaying';
  END IF;
  IF md5(pg_get_functiondef('private.google_sheets_finish(uuid,uuid,integer,bigint,text,jsonb)'::regprocedure))
       <> 'f1cf66bea7de1d469e2ff03c57f1a414' THEN
    RAISE EXCEPTION 'google_sheets_finish preimage changed; refusing to replace it';
  END IF;
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
       WHERE c.conrelid = 'public.google_sheets_sync_runs'::regclass AND c.conname = 'google_sheets_sync_runs_trigger_check')
     IS DISTINCT FROM 'CHECK ((trigger = ANY (ARRAY[''schedule''::text, ''manual''::text, ''activation''::text])))' THEN
    RAISE EXCEPTION 'google_sheets_sync_runs trigger CHECK changed; refusing to replace it';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------- guarded foundation changes
ALTER TABLE public.google_sheets_sync_runs DROP CONSTRAINT google_sheets_sync_runs_trigger_check;
ALTER TABLE public.google_sheets_sync_runs ADD CONSTRAINT google_sheets_sync_runs_trigger_check
  CHECK (trigger IN ('schedule','manual','activation','push'));

-- Health/result write for a run — the foundation definition with exactly two changes: p_trigger also accepts
-- 'push', and last_result also records 'backlog' (read by push_complete; ignored by the UI). Outcomes and
-- every lock, lease, version, generation and eligibility check are unchanged (see the foundation).
CREATE OR REPLACE FUNCTION private.google_sheets_finish(p_source uuid, p_lease uuid, p_version integer, p_generation bigint,
  p_trigger text, p_result jsonb)
 RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  s public.google_sheets_sources; c public.google_sheets_connections;
  v_health text := COALESCE(p_result->>'health', 'ok');
  v_backoff boolean := COALESCE((p_result->>'backoff')::boolean, false);
  v_backlog boolean := COALESCE((p_result->>'backlog')::boolean, false);
  v_code text := left(p_result->>'error_code', 64);
  v_fail int; v_next timestamptz; v_now timestamptz;
BEGIN
  IF v_health NOT IN ('ok','needs_review','access_lost','error') OR p_trigger NOT IN ('schedule','manual','activation','push') THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.google_sheets_sources WHERE id = p_source FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF s.lease_owner IS DISTINCT FROM p_lease THEN RETURN 'not_owner'; END IF;
  SELECT * INTO c FROM public.google_sheets_connections WHERE id = s.connection_id FOR SHARE; -- finish:connection-lock
  v_now := clock_timestamp();
  IF s.lease_expires_at IS NULL OR s.lease_expires_at <= v_now
     OR s.config_version IS DISTINCT FROM p_version OR s.state <> 'enabled'
     OR c.id IS NULL OR c.status <> 'connected' OR c.auth_generation IS DISTINCT FROM p_generation
     OR c.user_id <> s.user_id OR c.organization_id <> s.organization_id
     OR NOT private.google_sheets_owner_eligible(s.user_id, s.organization_id) THEN
    UPDATE public.google_sheets_sources SET lease_owner = NULL, lease_expires_at = NULL WHERE id = s.id;
    RETURN 'released';
  END IF;

  v_fail := CASE WHEN v_backoff OR v_health = 'error' THEN s.consecutive_failures + 1 ELSE 0 END;
  v_next := CASE
    WHEN v_backoff OR v_health = 'error' THEN now() + (CASE LEAST(v_fail, 6)
         WHEN 1 THEN interval '1 minute' WHEN 2 THEN interval '2 minutes' WHEN 3 THEN interval '5 minutes'
         WHEN 4 THEN interval '15 minutes' WHEN 5 THEN interval '30 minutes' ELSE interval '60 minutes' END)
    WHEN v_backlog THEN now()
    ELSE now() + interval '5 minutes' + (random() * interval '60 seconds') - interval '30 seconds' END;

  UPDATE public.google_sheets_sources g
     SET lease_owner = NULL, lease_expires_at = NULL, last_checked_at = now(),
         health = v_health,
         review_reason = CASE WHEN v_health = 'needs_review' THEN left(p_result->>'review_reason', 64) ELSE NULL END,
         phase = CASE WHEN COALESCE((p_result->>'phase_complete')::boolean, false) THEN 'steady' ELSE g.phase END,
         consecutive_failures = v_fail, next_sync_at = v_next,
         last_success_at = CASE WHEN v_health = 'ok' AND NOT v_backoff THEN now() ELSE g.last_success_at END,
         last_error_code = v_code,
         last_error_message = left(p_result->>'error_message', 200),
         last_result = jsonb_build_object(
           'imported', COALESCE((p_result->>'imported')::int, 0), 'flagged', COALESCE((p_result->>'flagged')::int, 0),
           'skipped', COALESCE((p_result->>'skipped')::int, 0), 'errors', COALESCE((p_result->>'errors')::int, 0),
           'pending', COALESCE((p_result->>'pending')::int, 0), 'backlog', v_backlog, 'at', now()),
         updated_at = now()
   WHERE g.id = s.id;

  INSERT INTO public.google_sheets_sync_runs
    (organization_id, user_id, source_id, trigger, started_at, rows_read, imported, flagged, skipped, errors,
     error_code, errors_sample)
  VALUES (s.organization_id, s.user_id, s.id, p_trigger,
          COALESCE((p_result->>'started_at')::timestamptz, now()),
          COALESCE((p_result->>'rows_read')::int, 0), COALESCE((p_result->>'imported')::int, 0),
          COALESCE((p_result->>'flagged')::int, 0), COALESCE((p_result->>'skipped')::int, 0),
          COALESCE((p_result->>'errors')::int, 0), v_code,
          CASE WHEN jsonb_typeof(p_result->'errors_sample') = 'array'
               THEN (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM
                       (SELECT e FROM jsonb_array_elements(p_result->'errors_sample') e LIMIT 20) q)
               ELSE '[]'::jsonb END);
  DELETE FROM public.google_sheets_sync_runs
   WHERE source_id = s.id AND id NOT IN (SELECT id FROM public.google_sheets_sync_runs
                                         WHERE source_id = s.id ORDER BY finished_at DESC LIMIT 50);
  RETURN 'completed';
END $$;
REVOKE ALL ON FUNCTION private.google_sheets_finish(uuid, uuid, integer, bigint, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------- tables
-- Platform-level push configuration (one row; not tenant data). mode 'off' refuses every claim, kick and
-- registration (notifications are still durably queued); 'pilot' admits only push_pilot_sources; 'on' admits all.
CREATE TABLE private.google_sheets_push_config (
  singleton           boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mode                text NOT NULL DEFAULT 'off' CHECK (mode IN ('off','pilot','on')),
  max_concurrent_jobs integer NOT NULL DEFAULT 4 CHECK (max_concurrent_jobs BETWEEN 1 AND 50),
  renew_before_s      integer NOT NULL DEFAULT 10800 CHECK (renew_before_s BETWEEN 1800 AND 82800),
  -- A renewal keeps the superseded channel accepted this long before it is stopped (Google's pending notifications).
  renew_overlap_s     integer NOT NULL DEFAULT 900 CHECK (renew_overlap_s BETWEEN 60 AND 3600),
  -- A channel Google confirmed stays accepted this long after it expired or was stopped (in-flight deliveries and
  -- retries); never for failed, abandoned or never-activated channels.
  late_grace_s        integer NOT NULL DEFAULT 3600 CHECK (late_grace_s BETWEEN 0 AND 21600),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_sheets_push_config_overlap CHECK (renew_overlap_s < renew_before_s)
);
INSERT INTO private.google_sheets_push_config DEFAULT VALUES;

-- Server-side pilot allowlist (D7). Rows are written only by the reviewed ops file at the pilot gate.
CREATE TABLE private.google_sheets_push_pilot_sources (
  source_id       uuid PRIMARY KEY REFERENCES public.google_sheets_sources(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  added_at        timestamptz NOT NULL DEFAULT now()
);

-- One row per (connection, spreadsheet): the watch target AND its coalescing job.
CREATE TABLE private.google_sheets_watch_targets (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id                uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  connection_id          uuid NOT NULL REFERENCES public.google_sheets_connections(id) ON DELETE CASCADE,
  spreadsheet_id         text NOT NULL CHECK (spreadsheet_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  state                  text NOT NULL DEFAULT 'live' CHECK (state IN ('live','stopped')),
  requested_seq          bigint NOT NULL DEFAULT 0,
  processed_seq          bigint NOT NULL DEFAULT 0,
  next_attempt_at        timestamptz,
  attempts               integer NOT NULL DEFAULT 0,
  stale_streak           integer NOT NULL DEFAULT 0,
  lease_owner            uuid,
  lease_expires_at       timestamptz,
  lease_snapshot         bigint,
  lease_attempt          uuid,
  last_outcome           text,
  last_error_code        text,
  watch_failures         integer NOT NULL DEFAULT 0,
  next_watch_attempt_at  timestamptz,
  maint_lease_owner      uuid,
  maint_lease_expires_at timestamptz,
  last_notification_at   timestamptz,
  last_processed_at      timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_sheets_watch_targets_seq CHECK (processed_seq >= 0 AND processed_seq <= requested_seq),
  CONSTRAINT google_sheets_watch_targets_unique UNIQUE (connection_id, spreadsheet_id)
);
CREATE INDEX google_sheets_watch_targets_due_idx ON private.google_sheets_watch_targets (next_attempt_at)
  WHERE requested_seq > processed_seq;
CREATE INDEX google_sheets_watch_targets_lease_idx ON private.google_sheets_watch_targets (lease_expires_at)
  WHERE lease_owner IS NOT NULL;
CREATE INDEX google_sheets_watch_targets_owner_idx ON private.google_sheets_watch_targets (organization_id, user_id);

-- One row per Google notification channel. The channel token is never stored: only its SHA-256 digest.
CREATE TABLE private.google_sheets_watch_channels (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id            uuid NOT NULL REFERENCES private.google_sheets_watch_targets(id) ON DELETE CASCADE,
  organization_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL,
  connection_id        uuid NOT NULL,
  spreadsheet_id       text NOT NULL,
  auth_generation      bigint NOT NULL,
  channel_id           text NOT NULL UNIQUE CHECK (channel_id ~ '^gs1[A-Za-z0-9_-]{40}$'),
  token_digest         bytea NOT NULL CHECK (octet_length(token_digest) = 32),
  key_id               text NOT NULL CHECK (key_id ~ '^[0-9a-f]{8}$'),
  resource_id          text CHECK (resource_id IS NULL OR length(resource_id) BETWEEN 1 AND 256),
  observed_resource_id text CHECK (observed_resource_id IS NULL OR length(observed_resource_id) BETWEEN 1 AND 256),
  state                text NOT NULL DEFAULT 'registering'
                         CHECK (state IN ('registering','active','stopping','stopped','failed','abandoned')),
  reason               text NOT NULL CHECK (reason IN ('activate','resume','renew','reconnect','recover','rotate')),
  requested_expiration timestamptz,
  expires_at           timestamptz,
  sync_received_at     timestamptz,
  activated_at         timestamptz,
  stopped_at           timestamptz,
  stop_attempts        integer NOT NULL DEFAULT 0,
  next_stop_at         timestamptz,
  last_error_code      text,
  last_rejected_at     timestamptz,  -- rejection sampling: at most one recorded rejection per channel per minute
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
-- At most one registration in flight per target.
CREATE UNIQUE INDEX google_sheets_watch_channels_registering_idx ON private.google_sheets_watch_channels (target_id)
  WHERE state = 'registering';
CREATE INDEX google_sheets_watch_channels_target_idx ON private.google_sheets_watch_channels (target_id, state);
CREATE INDEX google_sheets_watch_channels_expiry_idx ON private.google_sheets_watch_channels (expires_at)
  WHERE state = 'active';
CREATE INDEX google_sheets_watch_channels_work_idx ON private.google_sheets_watch_channels (state, created_at)
  WHERE state IN ('registering','stopping');
CREATE INDEX google_sheets_watch_channels_terminal_idx ON private.google_sheets_watch_channels (updated_at)
  WHERE state IN ('stopped','failed','abandoned');

-- One row per first delivery of a notification on a known channel (plus catch-up kicks). A redelivery writes
-- nothing; rejections are sampled (one per channel per minute). No token, header value or personal data.
CREATE TABLE private.google_sheets_push_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,
  target_id       uuid NOT NULL REFERENCES private.google_sheets_watch_targets(id) ON DELETE CASCADE,
  channel_row_id  uuid REFERENCES private.google_sheets_watch_channels(id) ON DELETE CASCADE,
  message_number  bigint,
  resource_state  text,
  changed         text,
  reason          text,
  authenticated   boolean NOT NULL,
  outcome         text NOT NULL CHECK (outcome IN ('queued','sync','ignored_inactive','ignored_stale',
                                                   'rejected_token','rejected_resource','catch_up')),
  job_seq         bigint,
  received_at     timestamptz NOT NULL,
  queued_at       timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Message numbers are unique per channel: at most one authenticated row per (channel, number), enforced here.
CREATE UNIQUE INDEX google_sheets_push_events_dedupe_idx ON private.google_sheets_push_events (channel_row_id, message_number)
  WHERE authenticated AND message_number IS NOT NULL;
CREATE INDEX google_sheets_push_events_seq_idx ON private.google_sheets_push_events (target_id, job_seq)
  WHERE job_seq IS NOT NULL;
CREATE INDEX google_sheets_push_events_age_idx ON private.google_sheets_push_events (queued_at);

-- One row per processing attempt (telemetry). Counts only.
CREATE TABLE private.google_sheets_push_attempts (
  id                 uuid PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL,
  target_id          uuid NOT NULL REFERENCES private.google_sheets_watch_targets(id) ON DELETE CASCADE,
  worker             text NOT NULL CHECK (worker IN ('receiver','maintenance','api')),
  from_seq           bigint NOT NULL,
  snapshot_seq       bigint NOT NULL,
  oldest_received_at timestamptz,
  oldest_queued_at   timestamptz,
  started_at         timestamptz NOT NULL,
  first_commit_at    timestamptz,
  finished_at        timestamptz,
  sources_run        integer NOT NULL DEFAULT 0,
  imported           integer NOT NULL DEFAULT 0,
  flagged            integer NOT NULL DEFAULT 0,
  skipped_duplicate  integer NOT NULL DEFAULT 0,
  already_receipted  integer NOT NULL DEFAULT 0,
  errors             integer NOT NULL DEFAULT 0,
  google_requests    integer NOT NULL DEFAULT 0,
  edge_outcome       text,
  outcome            text,
  error_code         text
);
CREATE INDEX google_sheets_push_attempts_target_idx ON private.google_sheets_push_attempts (target_id, started_at DESC);
CREATE INDEX google_sheets_push_attempts_age_idx ON private.google_sheets_push_attempts (started_at);

REVOKE ALL ON private.google_sheets_push_config, private.google_sheets_push_pilot_sources,
              private.google_sheets_watch_targets, private.google_sheets_watch_channels,
              private.google_sheets_push_events, private.google_sheets_push_attempts
  FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE private.google_sheets_push_config        ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.google_sheets_push_pilot_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.google_sheets_watch_targets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.google_sheets_watch_channels     ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.google_sheets_push_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.google_sheets_push_attempts      ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------- private helpers
-- Constant-time equality for two digests: every byte is XOR-folded (no early exit); lengths are fixed (32).
CREATE FUNCTION private.google_sheets_ct_equal(a bytea, b bytea)
 RETURNS boolean
 LANGUAGE sql IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
  SELECT a IS NOT NULL AND b IS NOT NULL AND octet_length(a) = octet_length(b) AND octet_length(a) > 0
     AND (SELECT bit_or(get_byte(a, i) # get_byte(b, i)) FROM generate_series(0, octet_length(a) - 1) AS g(i)) = 0
$$;

-- Server-side push scope (D7): 'on' admits every source; 'pilot' only allowlisted ones; 'off' none.
CREATE FUNCTION private.google_sheets_push_source_allowed(p_source uuid)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
  SELECT CASE (SELECT c.mode FROM private.google_sheets_push_config c)
    WHEN 'on' THEN true
    WHEN 'pilot' THEN EXISTS (SELECT 1 FROM private.google_sheets_push_pilot_sources p
                                JOIN public.google_sheets_sources s ON s.id = p.source_id AND s.organization_id = p.organization_id
                               WHERE p.source_id = p_source)
    ELSE false END
$$;

-- ---------------------------------------------------------------- receiver: durable acceptance
-- One transaction per notification. Ownership is resolved ONLY from the channel row → its target → its
-- connection; the request supplies no organization, user or spreadsheet. Outcomes:
--   invalid / unknown_channel / rejected_token / rejected_resource  → the receiver answers 4xx (no work)
--   sync / duplicate / ignored_inactive / ignored_stale              → acknowledged, no job
--   queued                                                           → requested_seq += 1 (durable on commit)
-- Bounded cost (§18): authentication runs on an UNLOCKED read (the token digest never changes, and an effective
-- resource id never changes once known), so a rejected request never waits for or blocks genuine traffic; it
-- records at most one row per channel per minute (SKIP LOCKED: never waits). A redelivery of a recorded message
-- writes nothing and never locks the target. Only an authenticated first delivery locks: channel, then target.
-- A notification may trigger work only on a channel that is LIVE (registering ≤ 5 min; active or stopping and
-- not expired — a superseded channel stays 'stopping' for the renewal overlap) or that Google CONFIRMED
-- (activated_at) and that ended (expired or stopped) less than late_grace_s ago. Failed, abandoned and
-- never-activated channels never trigger work; nor does any channel whose target is not live or whose connection
-- is not the current, connected generation of the same owner.
CREATE FUNCTION private.google_sheets_push_accept(
  p_channel_id text, p_token_digest text, p_resource_id text, p_state text, p_message_number bigint,
  p_changed text, p_received_at timestamptz)
 RETURNS TABLE (outcome text, target_id uuid, process boolean)
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
#variable_conflict use_column
DECLARE
  ch private.google_sheets_watch_channels; t private.google_sheets_watch_targets; c public.google_sheets_connections;
  cfg private.google_sheets_push_config;
  v_now timestamptz := clock_timestamp();
  v_state text := lower(left(btrim(COALESCE(p_state, '')), 32));
  v_changed text := left(regexp_replace(lower(COALESCE(p_changed, '')), '[^a-z,]', '', 'g'), 100);
  v_received timestamptz; v_out text; v_seq bigint; v_process boolean := false; v_reason text;
BEGIN
  IF p_channel_id IS NULL OR p_channel_id !~ '^gs1[A-Za-z0-9_-]{40}$'
     OR p_token_digest IS NULL OR p_token_digest !~ '^[0-9a-f]{64}$'
     OR p_resource_id IS NULL OR length(p_resource_id) NOT BETWEEN 1 AND 256 OR p_resource_id ~ '[^!-~]'
     OR p_message_number IS NULL OR p_message_number < 0 OR v_state = '' THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, false; RETURN;
  END IF;
  v_received := LEAST(GREATEST(COALESCE(p_received_at, v_now), v_now - interval '1 hour'), v_now);

  -- 1. Authenticate on an unlocked read.
  SELECT * INTO ch FROM private.google_sheets_watch_channels w WHERE w.channel_id = p_channel_id; -- push_accept:unlocked-auth
  IF NOT FOUND THEN RETURN QUERY SELECT 'unknown_channel'::text, NULL::uuid, false; RETURN; END IF;
  IF NOT private.google_sheets_ct_equal(ch.token_digest, decode(p_token_digest, 'hex')) THEN
    v_out := 'rejected_token';
  ELSIF COALESCE(ch.resource_id, ch.observed_resource_id) IS NOT NULL
        AND COALESCE(ch.resource_id, ch.observed_resource_id) <> p_resource_id THEN
    v_out := 'rejected_resource';
  ELSIF EXISTS (SELECT 1 FROM private.google_sheets_push_events e
                 WHERE e.channel_row_id = ch.id AND e.message_number = p_message_number AND e.authenticated) THEN
    -- 2. Redelivery of a recorded message (numbers are unique per channel): nothing written, nothing locked.
    RETURN QUERY SELECT 'duplicate'::text, ch.target_id, false; RETURN;
  END IF;

  -- 3. Authenticated first delivery: lock the channel (lock order: channel → target) and re-check under the lock.
  IF v_out IS NULL THEN
    SELECT * INTO ch FROM private.google_sheets_watch_channels w WHERE w.id = ch.id FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'unknown_channel'::text, NULL::uuid, false; RETURN; END IF;
    IF COALESCE(ch.resource_id, ch.observed_resource_id) IS NOT NULL
       AND COALESCE(ch.resource_id, ch.observed_resource_id) <> p_resource_id THEN
      v_out := 'rejected_resource';
    ELSIF EXISTS (SELECT 1 FROM private.google_sheets_push_events e
                   WHERE e.channel_row_id = ch.id AND e.message_number = p_message_number AND e.authenticated) THEN
      RETURN QUERY SELECT 'duplicate'::text, ch.target_id, false; RETURN;  -- a concurrent first delivery committed
    END IF;
  END IF;

  IF v_out IS NOT NULL THEN
    -- Rejection sampling: one recorded row per channel per minute; a row locked by anyone else is skipped.
    -- Unauthenticated rows never take part in de-duplication, so they cannot suppress a genuine message.
    UPDATE private.google_sheets_watch_channels w SET last_rejected_at = v_now
     WHERE w.id = (SELECT x.id FROM private.google_sheets_watch_channels x
                    WHERE x.id = ch.id AND (x.last_rejected_at IS NULL OR x.last_rejected_at <= v_now - interval '1 minute')
                    FOR UPDATE SKIP LOCKED);
    IF FOUND THEN
      INSERT INTO private.google_sheets_push_events (organization_id, user_id, target_id, channel_row_id, message_number,
        resource_state, changed, authenticated, outcome, received_at)
      VALUES (ch.organization_id, ch.user_id, ch.target_id, ch.id, p_message_number, v_state, v_changed, false, v_out, v_received);
    END IF;
    RETURN QUERY SELECT v_out, ch.target_id, false; RETURN;
  END IF;

  -- A sync (or any message) can arrive before the watch response: remember Google's resource id.
  IF ch.resource_id IS NULL AND ch.observed_resource_id IS NULL THEN
    UPDATE private.google_sheets_watch_channels w SET observed_resource_id = p_resource_id, updated_at = v_now
     WHERE w.id = ch.id;
  END IF;

  SELECT * INTO cfg FROM private.google_sheets_push_config;
  SELECT * INTO t FROM private.google_sheets_watch_targets x WHERE x.id = ch.target_id FOR UPDATE;
  SELECT * INTO c FROM public.google_sheets_connections g WHERE g.id = ch.connection_id;
  IF ch.state = 'registering' AND ch.created_at > v_now - interval '5 minutes' THEN
    NULL;                                       -- live: Google may notify before the watch response
  ELSIF ch.activated_at IS NOT NULL AND ch.state IN ('active','stopping') AND ch.expires_at > v_now THEN
    NULL;                                       -- live (a superseded channel stays 'stopping' for the renewal overlap)
  ELSIF ch.activated_at IS NOT NULL AND ch.state IN ('active','stopping','stopped')
        AND v_now < LEAST(ch.expires_at, COALESCE(ch.stopped_at, ch.expires_at)) + make_interval(secs => cfg.late_grace_s) THEN
    v_reason := 'late_delivery';                -- confirmed by Google, ended less than late_grace_s ago
  ELSE
    v_out := 'ignored_inactive';                -- failed, abandoned, never confirmed, or past its grace
  END IF;
  IF v_out IS NULL THEN
    IF t.state <> 'live' THEN
      v_out := 'ignored_inactive';
    ELSIF c.id IS NULL OR c.status <> 'connected' OR c.auth_generation IS DISTINCT FROM ch.auth_generation
          OR c.user_id <> ch.user_id OR c.organization_id <> ch.organization_id OR t.connection_id <> ch.connection_id
          OR t.organization_id <> ch.organization_id OR t.user_id <> ch.user_id THEN
      v_out := 'ignored_stale';
    ELSIF v_state = 'sync' THEN
      v_out := 'sync';
    ELSE
      v_out := 'queued';
    END IF;
  END IF;

  IF v_out = 'sync' THEN
    UPDATE private.google_sheets_watch_channels w SET sync_received_at = COALESCE(w.sync_received_at, v_now), updated_at = v_now
     WHERE w.id = ch.id;
  ELSIF v_out = 'queued' THEN
    UPDATE private.google_sheets_watch_targets x
       SET requested_seq = x.requested_seq + 1, last_notification_at = v_now,
           next_attempt_at = CASE WHEN x.attempts > 0 AND x.next_attempt_at > v_now THEN x.next_attempt_at ELSE v_now END,
           updated_at = v_now
     WHERE x.id = t.id
    RETURNING x.requested_seq, (x.lease_expires_at IS NULL OR x.lease_expires_at <= v_now) AND x.next_attempt_at <= v_now
      INTO v_seq, v_process;
  END IF;
  INSERT INTO private.google_sheets_push_events (organization_id, user_id, target_id, channel_row_id, message_number,
    resource_state, changed, reason, authenticated, outcome, job_seq, received_at)
  VALUES (ch.organization_id, ch.user_id, t.id, ch.id, p_message_number, v_state, v_changed,
          CASE WHEN v_out = 'queued' THEN v_reason END, true, v_out, v_seq, v_received);
  RETURN QUERY SELECT v_out, t.id, COALESCE(v_process, false);
END $$;

-- ---------------------------------------------------------------- processing: claim / claim source / complete
-- Claims ONE due target (a specific one, or the next due when p_target is NULL) under a job lease and takes a
-- snapshot of requested_seq. Refuses (empty) when: push mode is off; the global concurrent-lease cap is reached;
-- the target is leased, not dirty or backing off; its connection is not connected; or another target of the
-- SAME connection is leased (per-Google-user serialisation). Returns the eligible, allowed sources.
CREATE FUNCTION private.google_sheets_push_claim(p_lease uuid, p_target uuid, p_lease_s integer, p_worker text)
 RETURNS TABLE (target_id uuid, organization_id uuid, user_id uuid, connection_id uuid, spreadsheet_id text,
                attempt_id uuid, from_seq bigint, snapshot_seq bigint, sources uuid[],
                oldest_received_at timestamptz, oldest_queued_at timestamptz)
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
#variable_conflict use_column
DECLARE
  cfg private.google_sheets_push_config; t private.google_sheets_watch_targets;
  v_attempt uuid := gen_random_uuid(); v_sources uuid[]; v_old_r timestamptz; v_old_q timestamptz; v_now timestamptz;
BEGIN
  IF p_lease IS NULL OR p_lease_s IS NULL OR p_lease_s NOT BETWEEN 1 AND 600
     OR p_worker IS NULL OR p_worker NOT IN ('receiver','maintenance','api') THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO cfg FROM private.google_sheets_push_config;
  IF cfg.mode = 'off' THEN RETURN; END IF;
  -- The count-then-lease step is serialised so the cap holds under concurrency.
  PERFORM pg_advisory_xact_lock(hashtextextended('google_sheets_push_claim', 0));
  v_now := clock_timestamp();
  IF (SELECT count(*) FROM private.google_sheets_watch_targets x
       WHERE x.lease_owner IS NOT NULL AND x.lease_expires_at > v_now) >= cfg.max_concurrent_jobs THEN
    RETURN;
  END IF;
  SELECT x.* INTO t
    FROM private.google_sheets_watch_targets x
    JOIN public.google_sheets_connections g ON g.id = x.connection_id
   WHERE (p_target IS NULL OR x.id = p_target)
     AND x.requested_seq > x.processed_seq
     AND (x.next_attempt_at IS NULL OR x.next_attempt_at <= v_now)
     AND (x.lease_expires_at IS NULL OR x.lease_expires_at <= v_now) -- push_claim:lease
     AND g.status = 'connected' AND g.has_refresh_token
     AND g.user_id = x.user_id AND g.organization_id = x.organization_id
     AND NOT EXISTS (SELECT 1 FROM private.google_sheets_watch_targets o
                      WHERE o.connection_id = x.connection_id AND o.id <> x.id
                        AND o.lease_owner IS NOT NULL AND o.lease_expires_at > v_now)
   ORDER BY x.next_attempt_at NULLS FIRST, x.last_notification_at NULLS FIRST, x.id
   LIMIT 1
   FOR UPDATE OF x SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(array_agg(s.id ORDER BY s.created_at, s.id), '{}') INTO v_sources
    FROM public.google_sheets_sources s
   WHERE s.connection_id = t.connection_id AND s.spreadsheet_id = t.spreadsheet_id
     AND s.organization_id = t.organization_id AND s.user_id = t.user_id
     AND s.state = 'enabled' AND s.health IN ('ok','error')
     AND private.google_sheets_push_source_allowed(s.id)
     AND private.google_sheets_owner_eligible(t.user_id, t.organization_id);
  SELECT min(e.received_at), min(e.queued_at) INTO v_old_r, v_old_q
    FROM private.google_sheets_push_events e
   WHERE e.target_id = t.id AND e.job_seq > t.processed_seq AND e.job_seq <= t.requested_seq;

  UPDATE private.google_sheets_watch_targets x
     SET lease_owner = p_lease, lease_expires_at = v_now + make_interval(secs => p_lease_s),
         lease_snapshot = x.requested_seq, lease_attempt = v_attempt, updated_at = v_now
   WHERE x.id = t.id;
  INSERT INTO private.google_sheets_push_attempts (id, organization_id, user_id, target_id, worker, from_seq, snapshot_seq,
    oldest_received_at, oldest_queued_at, started_at)
  VALUES (v_attempt, t.organization_id, t.user_id, t.id, p_worker, t.processed_seq, t.requested_seq, v_old_r, v_old_q, v_now);
  RETURN QUERY SELECT t.id, t.organization_id, t.user_id, t.connection_id, t.spreadsheet_id, v_attempt, t.processed_seq,
                      t.requested_seq, v_sources, v_old_r, v_old_q;
END $$;

-- The explicitly authorised push claim of ONE source (instead of repeated Sync now). Requires the caller's
-- CURRENT target lease (real clock), then applies exactly the scheduled claim's eligibility (enabled, health
-- ok/error, connection connected with a refresh token, lease free, owner eligible) plus the target's own
-- connection/spreadsheet/owner — without next_sync_at and without the manual 30-second cooldown.
CREATE FUNCTION private.google_sheets_push_claim_source(p_target uuid, p_target_lease uuid, p_source uuid, p_lease uuid)
 RETURNS TABLE (source_id uuid, organization_id uuid, user_id uuid, connection_id uuid, auth_generation bigint,
                spreadsheet_id text, sheet_id bigint, mapping jsonb, identity_mode text, id_header text,
                lead_source_default text, config_version integer, phase text, row_epoch integer)
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
#variable_conflict use_column
DECLARE t private.google_sheets_watch_targets;
BEGIN
  IF p_target IS NULL OR p_target_lease IS NULL OR p_source IS NULL OR p_lease IS NULL THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM private.google_sheets_watch_targets x WHERE x.id = p_target FOR SHARE;
  IF NOT FOUND OR t.lease_owner IS DISTINCT FROM p_target_lease OR t.lease_expires_at IS NULL
     OR t.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'stale: job lease lost' USING ERRCODE = 'P0001';
  END IF;
  IF NOT private.google_sheets_push_source_allowed(p_source) THEN RETURN; END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT s.id
      FROM public.google_sheets_sources s
      JOIN public.google_sheets_connections c ON c.id = s.connection_id
     WHERE s.id = p_source AND s.connection_id = t.connection_id AND s.spreadsheet_id = t.spreadsheet_id
       AND s.organization_id = t.organization_id AND s.user_id = t.user_id
       AND s.state = 'enabled' AND s.health IN ('ok','error')
       AND c.status = 'connected' AND c.has_refresh_token
       AND (s.lease_expires_at IS NULL OR s.lease_expires_at <= now()) -- push_claim_source:lease
       AND private.google_sheets_owner_eligible(s.user_id, s.organization_id)
     FOR UPDATE OF s SKIP LOCKED
  )
  UPDATE public.google_sheets_sources s
     SET lease_owner = p_lease, lease_expires_at = now() + interval '3 minutes'
    FROM picked, public.google_sheets_connections c
   WHERE s.id = picked.id AND c.id = s.connection_id
  RETURNING s.id, s.organization_id, s.user_id, s.connection_id, c.auth_generation, s.spreadsheet_id, s.sheet_id,
            s.mapping, s.identity_mode, s.id_header, s.lead_source_default, s.config_version, s.phase, s.row_epoch;
END $$;

-- Ends a job attempt. The outcome is RE-DERIVED here; the Edge outcome can only make it stricter
-- (done < backlog < retry < blocked < deferred). 'done' — the only outcome that advances processed_seq — requires
-- that EVERY still-eligible source finished healthy during this attempt (health ok AND last_success_at at or after
-- the attempt start) with no backlog. Anything else keeps the work queued: unfinished run, failed or released
-- finish, health error, backoff/quota/reconnect, backlog, a disconnected connection ('blocked'), or push mode off
-- ('deferred'). Returns {status, outcome, dirty}.
CREATE FUNCTION private.google_sheets_push_complete(p_target uuid, p_lease uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  t private.google_sheets_watch_targets; a private.google_sheets_push_attempts; cfg private.google_sheets_push_config;
  c public.google_sheets_connections;
  v_edge text := COALESCE(p_result->>'outcome', 'retry');
  v_reason text := left(COALESCE(p_result->>'reason', ''), 64);
  v_sql text := 'done'; v_out text; v_code text; v_delay interval; v_now timestamptz; v_dirty boolean;
  v_next timestamptz; v_commit timestamptz;
BEGIN
  IF p_target IS NULL OR p_lease IS NULL OR jsonb_typeof(p_result) IS DISTINCT FROM 'object'
     OR v_edge NOT IN ('done','backlog','retry','blocked') THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM private.google_sheets_watch_targets x WHERE x.id = p_target FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found', 'dirty', false); END IF;
  IF t.lease_owner IS DISTINCT FROM p_lease THEN RETURN jsonb_build_object('status', 'not_owner', 'dirty', false); END IF;
  v_now := clock_timestamp();
  SELECT * INTO cfg FROM private.google_sheets_push_config;
  SELECT * INTO a FROM private.google_sheets_push_attempts x WHERE x.id = t.lease_attempt;
  SELECT * INTO c FROM public.google_sheets_connections g WHERE g.id = t.connection_id;

  IF cfg.mode = 'off' THEN
    v_sql := 'deferred';
  ELSIF c.id IS NULL OR c.status <> 'connected' THEN
    v_sql := 'blocked';
  ELSIF EXISTS (SELECT 1 FROM public.google_sheets_sources s
                 WHERE s.connection_id = t.connection_id AND s.spreadsheet_id = t.spreadsheet_id
                   AND s.organization_id = t.organization_id AND s.user_id = t.user_id
                   AND s.state = 'enabled' AND s.health IN ('ok','error')
                   AND private.google_sheets_push_source_allowed(s.id)
                   AND private.google_sheets_owner_eligible(t.user_id, t.organization_id)
                   AND NOT (s.health = 'ok' AND s.last_success_at IS NOT NULL AND a.started_at IS NOT NULL
                            AND s.last_success_at >= a.started_at)) THEN
    v_sql := 'retry'; v_code := 'unfinished_source';
  ELSIF EXISTS (SELECT 1 FROM public.google_sheets_sources s
                 WHERE s.connection_id = t.connection_id AND s.spreadsheet_id = t.spreadsheet_id
                   AND s.organization_id = t.organization_id AND s.user_id = t.user_id
                   AND s.state = 'enabled' AND s.health IN ('ok','error')
                   AND private.google_sheets_push_source_allowed(s.id)
                   AND private.google_sheets_owner_eligible(t.user_id, t.organization_id)
                   AND COALESCE(s.last_result->>'backlog', 'false') = 'true') THEN
    v_sql := 'backlog';
  END IF;
  SELECT o INTO v_out FROM (VALUES ('done', 0), ('backlog', 1), ('retry', 2), ('blocked', 3), ('deferred', 4)) AS v(o, r)
   WHERE o IN (v_edge, v_sql) ORDER BY r DESC LIMIT 1;

  IF v_out = 'retry' THEN
    IF v_edge = 'retry' AND v_reason = 'busy' AND v_sql <> 'retry' THEN
      v_delay := interval '10 seconds';
    ELSIF v_edge = 'retry' AND v_reason = 'stale' AND t.stale_streak < 3 THEN
      v_delay := interval '5 seconds';
    ELSE
      v_delay := (ARRAY[30, 60, 120, 300, 900, 1800, 3600])[LEAST(t.attempts + 1, 7)] * interval '1 second';
    END IF;
    v_delay := v_delay * (0.8 + random() * 0.4);
  END IF;
  IF jsonb_typeof(p_result->'first_commit_at') = 'string' THEN
    v_commit := (p_result->>'first_commit_at')::timestamptz;
    IF a.started_at IS NULL OR v_commit < a.started_at - interval '5 seconds' OR v_commit > v_now + interval '5 seconds' THEN
      v_commit := NULL;
    END IF;
  END IF;

  UPDATE private.google_sheets_watch_targets x
     SET processed_seq = CASE WHEN v_out = 'done' THEN GREATEST(x.processed_seq, LEAST(x.lease_snapshot, x.requested_seq)) -- push_complete:snapshot
                              ELSE x.processed_seq END,
         attempts = CASE WHEN v_out IN ('done','backlog') THEN 0
                         WHEN v_out = 'retry' AND v_edge = 'retry' AND v_reason = 'busy' AND v_sql <> 'retry' THEN x.attempts
                         WHEN v_out = 'retry' AND v_edge = 'retry' AND v_reason = 'stale' AND x.stale_streak < 3 THEN x.attempts
                         WHEN v_out = 'retry' THEN x.attempts + 1
                         ELSE x.attempts END,
         stale_streak = CASE WHEN v_out = 'retry' AND v_edge = 'retry' AND v_reason = 'stale' THEN x.stale_streak + 1
                             WHEN v_out IN ('done','backlog') THEN 0 ELSE x.stale_streak END,
         -- 'done' with notifications that arrived during the run stays due NOW: exactly one follow-up run.
         next_attempt_at = CASE v_out
           WHEN 'retry' THEN v_now + v_delay
           WHEN 'done' THEN CASE WHEN x.requested_seq > GREATEST(x.processed_seq, LEAST(x.lease_snapshot, x.requested_seq))
                                 THEN v_now END
           ELSE v_now END,
         lease_owner = NULL, lease_expires_at = NULL, lease_snapshot = NULL, lease_attempt = NULL,
         last_outcome = v_out,
         last_error_code = CASE WHEN v_out = 'done' THEN NULL ELSE left(NULLIF(COALESCE(v_code, v_reason), ''), 64) END,
         last_processed_at = CASE WHEN v_out = 'done' THEN v_now ELSE x.last_processed_at END,
         updated_at = v_now
   WHERE x.id = t.id
  RETURNING v_out IN ('done','backlog') AND x.requested_seq > x.processed_seq, x.next_attempt_at INTO v_dirty, v_next;

  UPDATE private.google_sheets_push_attempts x
     SET finished_at = v_now, edge_outcome = v_edge, outcome = v_out,
         error_code = left(NULLIF(COALESCE(v_code, v_reason), ''), 64), first_commit_at = v_commit,
         sources_run       = CASE WHEN jsonb_typeof(p_result->'sources_run') = 'number'       THEN LEAST(GREATEST((p_result->>'sources_run')::int, 0), 1000000) ELSE 0 END,
         imported          = CASE WHEN jsonb_typeof(p_result->'imported') = 'number'          THEN LEAST(GREATEST((p_result->>'imported')::int, 0), 1000000) ELSE 0 END,
         flagged           = CASE WHEN jsonb_typeof(p_result->'flagged') = 'number'           THEN LEAST(GREATEST((p_result->>'flagged')::int, 0), 1000000) ELSE 0 END,
         skipped_duplicate = CASE WHEN jsonb_typeof(p_result->'skipped') = 'number'           THEN LEAST(GREATEST((p_result->>'skipped')::int, 0), 1000000) ELSE 0 END,
         already_receipted = CASE WHEN jsonb_typeof(p_result->'already') = 'number'           THEN LEAST(GREATEST((p_result->>'already')::int, 0), 1000000) ELSE 0 END,
         errors            = CASE WHEN jsonb_typeof(p_result->'errors') = 'number'            THEN LEAST(GREATEST((p_result->>'errors')::int, 0), 1000000) ELSE 0 END,
         google_requests   = CASE WHEN jsonb_typeof(p_result->'google_requests') = 'number'   THEN LEAST(GREATEST((p_result->>'google_requests')::int, 0), 1000000) ELSE 0 END
   WHERE x.id = t.lease_attempt;
  RETURN jsonb_build_object('status', 'completed', 'outcome', v_out, 'dirty', COALESCE(v_dirty, false),
                            'next_attempt_at', v_next);
END $$;

-- Event-driven catch-up (D2) after an owner action that must re-read the tab: activate, resume, a mapping save
-- on an enabled source, a structural review apply or an identity review apply. Owner-checked; only for an
-- enabled, allowed source on a connected connection. Returns the target id (NULL when push does not apply).
CREATE FUNCTION private.google_sheets_push_kick(p_user uuid, p_org uuid, p_source uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE s public.google_sheets_sources; c public.google_sheets_connections; v_t uuid; v_seq bigint; v_now timestamptz := clock_timestamp();
BEGIN
  PERFORM private.google_sheets_require_owner(p_user, p_org);
  IF p_reason IS NULL OR p_reason NOT IN ('activate','resume','save','review','identity_review') THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.google_sheets_sources x WHERE x.id = p_source AND x.organization_id = p_org AND x.user_id = p_user;
  IF NOT FOUND OR s.state <> 'enabled' OR NOT private.google_sheets_push_source_allowed(s.id) THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.google_sheets_connections g
   WHERE g.id = s.connection_id AND g.user_id = p_user AND g.organization_id = p_org;
  IF NOT FOUND OR c.status <> 'connected' THEN RETURN NULL; END IF;
  INSERT INTO private.google_sheets_watch_targets AS x (organization_id, user_id, connection_id, spreadsheet_id,
    requested_seq, next_attempt_at)
  VALUES (p_org, p_user, c.id, s.spreadsheet_id, 1, v_now)
  ON CONFLICT (connection_id, spreadsheet_id) DO UPDATE
     SET requested_seq = x.requested_seq + 1, state = 'live',
         next_attempt_at = CASE WHEN x.attempts > 0 AND x.next_attempt_at > v_now THEN x.next_attempt_at ELSE v_now END,
         updated_at = v_now
  RETURNING x.id, x.requested_seq INTO v_t, v_seq;
  INSERT INTO private.google_sheets_push_events (organization_id, user_id, target_id, reason, authenticated, outcome,
    job_seq, received_at)
  VALUES (p_org, p_user, v_t, p_reason, true, 'catch_up', v_seq, v_now);
  RETURN v_t;
END $$;

-- ---------------------------------------------------------------- watch lifecycle
-- Starts a registration: the caller has minted a channel id + token (only the digest is stored). Requires a
-- connected connection at the expected generation, an eligible owner and at least one enabled, allowed source
-- for the spreadsheet. Outcomes: register (row inserted) | exists | in_progress | disabled | not_connected |
-- changed | not_permitted | no_sources.
CREATE FUNCTION private.google_sheets_watch_begin(p_connection uuid, p_generation bigint, p_spreadsheet text,
  p_channel_id text, p_token_digest text, p_key_id text, p_reason text)
 RETURNS TABLE (outcome text, channel_row_id uuid, target_id uuid)
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
#variable_conflict use_column
DECLARE
  cfg private.google_sheets_push_config; c public.google_sheets_connections; t private.google_sheets_watch_targets;
  v_now timestamptz := clock_timestamp(); v_row uuid;
BEGIN
  IF p_connection IS NULL OR p_generation IS NULL OR p_spreadsheet IS NULL OR p_spreadsheet !~ '^[A-Za-z0-9_-]{10,200}$'
     OR p_channel_id IS NULL OR p_channel_id !~ '^gs1[A-Za-z0-9_-]{40}$'
     OR p_token_digest IS NULL OR p_token_digest !~ '^[0-9a-f]{64}$'
     OR p_key_id IS NULL OR p_key_id !~ '^[0-9a-f]{8}$'
     OR p_reason IS NULL OR p_reason NOT IN ('activate','resume','renew','reconnect','recover','rotate') THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO cfg FROM private.google_sheets_push_config;
  IF cfg.mode = 'off' THEN RETURN QUERY SELECT 'disabled'::text, NULL::uuid, NULL::uuid; RETURN; END IF;
  SELECT * INTO c FROM public.google_sheets_connections g WHERE g.id = p_connection;
  IF NOT FOUND OR c.status <> 'connected' OR NOT c.has_refresh_token THEN
    RETURN QUERY SELECT 'not_connected'::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;
  IF c.auth_generation IS DISTINCT FROM p_generation THEN RETURN QUERY SELECT 'changed'::text, NULL::uuid, NULL::uuid; RETURN; END IF;
  IF NOT private.google_sheets_owner_eligible(c.user_id, c.organization_id) THEN
    RETURN QUERY SELECT 'not_permitted'::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.google_sheets_sources s
                  WHERE s.connection_id = c.id AND s.spreadsheet_id = p_spreadsheet
                    AND s.organization_id = c.organization_id AND s.user_id = c.user_id
                    AND s.state = 'enabled' AND s.health IN ('ok','error')
                    AND private.google_sheets_push_source_allowed(s.id)) THEN
    RETURN QUERY SELECT 'no_sources'::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;
  INSERT INTO private.google_sheets_watch_targets AS x (organization_id, user_id, connection_id, spreadsheet_id)
  VALUES (c.organization_id, c.user_id, c.id, p_spreadsheet)
  ON CONFLICT (connection_id, spreadsheet_id) DO UPDATE SET state = 'live', updated_at = v_now
  RETURNING x.* INTO t;
  IF EXISTS (SELECT 1 FROM private.google_sheets_watch_channels w
              WHERE w.target_id = t.id AND w.state = 'active' AND w.auth_generation = c.auth_generation
                AND w.key_id = p_key_id AND w.expires_at > v_now + make_interval(secs => cfg.renew_before_s)) THEN
    RETURN QUERY SELECT 'exists'::text, NULL::uuid, t.id; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM private.google_sheets_watch_channels w WHERE w.target_id = t.id AND w.state = 'registering') THEN
    RETURN QUERY SELECT 'in_progress'::text, NULL::uuid, t.id; RETURN;
  END IF;
  INSERT INTO private.google_sheets_watch_channels (target_id, organization_id, user_id, connection_id, spreadsheet_id,
    auth_generation, channel_id, token_digest, key_id, reason, requested_expiration)
  VALUES (t.id, c.organization_id, c.user_id, c.id, p_spreadsheet, c.auth_generation, p_channel_id,
          decode(p_token_digest, 'hex'), p_key_id, p_reason, v_now + interval '24 hours')
  RETURNING id INTO v_row;
  RETURN QUERY SELECT 'register'::text, v_row, t.id;
END $$;

-- Records a Google result for a channel: activated (watch response) | failed | stopped | stop_failed | abandoned.
-- Locks every channel of the target in id order, then the target (lock order). An activation is a SEAMLESS
-- RENEWAL only when another channel at the same generation and key is ACTIVE and stays valid for the whole
-- renew_overlap_s; that channel becomes 'stopping' (code 'superseded', next_stop_at = now + overlap) and is NOT
-- returned for an immediate stop, so Google's pending notifications on it still arrive and are accepted (§18).
-- Every other activation is FRESH and queues one catch-up job; a 'stopping' channel never counts as coverage.
-- Channels of another generation or key are stopped at once. Returns {status, stop:[{row, channel_id,
-- resource_id}], kicked}.
CREATE FUNCTION private.google_sheets_watch_result(p_channel_row uuid, p_action text, p_resource_id text,
  p_expiration timestamptz, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  ch private.google_sheets_watch_channels; t private.google_sheets_watch_targets; c public.google_sheets_connections;
  cfg private.google_sheets_push_config;
  v_target uuid; v_now timestamptz; v_status text; v_stop jsonb := '[]'::jsonb; v_kicked boolean := false;
  v_had_live boolean; v_seq bigint; v_code text := left(NULLIF(btrim(COALESCE(p_code, '')), ''), 64);
BEGIN
  IF p_channel_row IS NULL OR p_action IS NULL
     OR p_action NOT IN ('activated','failed','stopped','stop_failed','abandoned') THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
  END IF;
  IF p_resource_id IS NOT NULL AND (length(p_resource_id) NOT BETWEEN 1 AND 256 OR p_resource_id ~ '[^!-~]') THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
  END IF;
  SELECT w.target_id INTO v_target FROM private.google_sheets_watch_channels w WHERE w.id = p_channel_row;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found', 'stop', '[]'::jsonb, 'kicked', false); END IF;
  PERFORM 1 FROM private.google_sheets_watch_channels w WHERE w.target_id = v_target ORDER BY w.id FOR UPDATE; -- watch_result:lock-order
  SELECT * INTO ch FROM private.google_sheets_watch_channels w WHERE w.id = p_channel_row;
  SELECT * INTO t FROM private.google_sheets_watch_targets x WHERE x.id = v_target FOR UPDATE;
  v_now := clock_timestamp();

  IF p_action = 'activated' THEN
    IF p_resource_id IS NULL OR p_expiration IS NULL THEN RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023'; END IF;
    SELECT * INTO c FROM public.google_sheets_connections g WHERE g.id = ch.connection_id;
    IF ch.state <> 'registering' THEN v_status := 'stale';
    ELSIF p_expiration <= v_now THEN v_status := 'expired';
    ELSIF ch.observed_resource_id IS NOT NULL AND ch.observed_resource_id <> p_resource_id THEN v_status := 'resource_mismatch';
    ELSIF c.id IS NULL OR c.status <> 'connected' OR c.auth_generation IS DISTINCT FROM ch.auth_generation THEN v_status := 'stale';
    ELSE v_status := 'activated';
    END IF;

    IF v_status = 'activated' THEN
      SELECT * INTO cfg FROM private.google_sheets_push_config;
      v_had_live := EXISTS (SELECT 1 FROM private.google_sheets_watch_channels w
                             WHERE w.target_id = t.id AND w.id <> ch.id AND w.state = 'active'
                               AND w.auth_generation = ch.auth_generation AND w.key_id = ch.key_id
                               AND w.expires_at > v_now + make_interval(secs => cfg.renew_overlap_s));
      UPDATE private.google_sheets_watch_channels w
         SET state = 'active', resource_id = p_resource_id, expires_at = p_expiration, activated_at = v_now,
             last_error_code = NULL, updated_at = v_now
       WHERE w.id = ch.id;
      -- Superseded peers stay accepted for the overlap; maintenance stops them when next_stop_at passes.
      UPDATE private.google_sheets_watch_channels w
         SET state = 'stopping', last_error_code = 'superseded', updated_at = v_now,
             next_stop_at = v_now + make_interval(secs => cfg.renew_overlap_s)
       WHERE w.target_id = t.id AND w.id <> ch.id AND w.state = 'active'
         AND w.auth_generation = ch.auth_generation AND w.key_id = ch.key_id;
      -- Channels of another generation or key: stopped now (their activation is fresh and queues a catch-up).
      WITH s AS (
        UPDATE private.google_sheets_watch_channels w SET state = 'stopping', next_stop_at = NULL, updated_at = v_now
         WHERE w.target_id = t.id AND w.id <> ch.id AND w.state = 'active'
        RETURNING w.id, w.channel_id, w.resource_id)
      SELECT COALESCE(jsonb_agg(jsonb_build_object('row', s.id, 'channel_id', s.channel_id, 'resource_id', s.resource_id)), '[]'::jsonb)
        INTO v_stop FROM s;
      UPDATE private.google_sheets_watch_targets x
         SET state = 'live', watch_failures = 0, next_watch_attempt_at = NULL, maint_lease_owner = NULL,
             maint_lease_expires_at = NULL, updated_at = v_now
       WHERE x.id = t.id;
      IF NOT v_had_live THEN
        UPDATE private.google_sheets_watch_targets x
           SET requested_seq = x.requested_seq + 1,
               next_attempt_at = CASE WHEN x.attempts > 0 AND x.next_attempt_at > v_now THEN x.next_attempt_at ELSE v_now END
         WHERE x.id = t.id RETURNING x.requested_seq INTO v_seq;
        INSERT INTO private.google_sheets_push_events (organization_id, user_id, target_id, channel_row_id, reason,
          authenticated, outcome, job_seq, received_at)
        VALUES (ch.organization_id, ch.user_id, t.id, ch.id, ch.reason, true, 'catch_up', v_seq, v_now);
        v_kicked := true;
      END IF;
    ELSE
      -- Google holds a channel we will not use: stop it (it also expires on its own within a day).
      UPDATE private.google_sheets_watch_channels w
         SET resource_id = COALESCE(w.resource_id, p_resource_id),
             state = CASE WHEN w.state = 'stopped' THEN 'stopped' ELSE 'stopping' END,
             next_stop_at = NULL, last_error_code = v_status, updated_at = v_now
       WHERE w.id = ch.id;
      IF ch.state <> 'stopped' THEN
        v_stop := jsonb_build_array(jsonb_build_object('row', ch.id, 'channel_id', ch.channel_id,
                                                       'resource_id', COALESCE(ch.resource_id, p_resource_id)));
      END IF;
    END IF;
    RETURN jsonb_build_object('status', v_status, 'stop', v_stop, 'kicked', v_kicked, 'target_id', t.id);
  END IF;

  IF p_action = 'failed' THEN
    IF ch.state = 'registering' THEN
      UPDATE private.google_sheets_watch_channels w SET state = 'failed', last_error_code = v_code, updated_at = v_now
       WHERE w.id = ch.id;
      UPDATE private.google_sheets_watch_targets x
         SET watch_failures = x.watch_failures + 1,
             next_watch_attempt_at = v_now + (ARRAY[60, 300, 900, 3600, 21600])[LEAST(x.watch_failures + 1, 5)] * interval '1 second',
             maint_lease_owner = NULL, maint_lease_expires_at = NULL, last_error_code = v_code, updated_at = v_now
       WHERE x.id = t.id;
    END IF;
  ELSIF p_action = 'stopped' THEN
    UPDATE private.google_sheets_watch_channels w
       SET state = 'stopped', stopped_at = v_now, resource_id = COALESCE(w.resource_id, p_resource_id), updated_at = v_now
     WHERE w.id = ch.id AND w.state <> 'stopped';
  ELSIF p_action = 'stop_failed' THEN
    UPDATE private.google_sheets_watch_channels w
       SET stop_attempts = w.stop_attempts + 1, last_error_code = v_code,
           state = CASE WHEN w.stop_attempts + 1 >= 5 THEN 'abandoned' ELSE w.state END,
           next_stop_at = v_now + (ARRAY[60, 300, 900, 3600, 3600])[LEAST(w.stop_attempts + 1, 5)] * interval '1 second',
           updated_at = v_now
     WHERE w.id = ch.id AND w.state = 'stopping';
  ELSE -- abandoned
    UPDATE private.google_sheets_watch_channels w SET state = 'abandoned', last_error_code = v_code, updated_at = v_now
     WHERE w.id = ch.id AND w.state NOT IN ('stopped','abandoned');
  END IF;
  RETURN jsonb_build_object('status', p_action, 'stop', '[]'::jsonb, 'kicked', false, 'target_id', t.id);
END $$;

-- Pause / Remove / Disconnect: stops monitoring for the owner's targets that no longer have an enabled source
-- (p_force: every target of the connection — used before Disconnect deletes the refresh token). Needs no import
-- permission (it only removes access). Marks channels 'stopping' (or 'abandoned' when Google's resource id is
-- unknown) and the target 'stopped'; returns the channels the caller should stop with Google.
CREATE FUNCTION private.google_sheets_watch_release(p_user uuid, p_org uuid, p_spreadsheet text, p_force boolean)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE c public.google_sheets_connections; r record; v_stop jsonb := '[]'::jsonb; v_part jsonb; v_now timestamptz := clock_timestamp();
BEGIN
  IF p_user IS NULL OR p_org IS NULL OR p_force IS NULL THEN RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023'; END IF;
  SELECT * INTO c FROM public.google_sheets_connections g WHERE g.organization_id = p_org AND g.user_id = p_user;
  IF NOT FOUND THEN RETURN jsonb_build_object('stop', '[]'::jsonb); END IF;
  FOR r IN SELECT x.id, x.spreadsheet_id FROM private.google_sheets_watch_targets x
            WHERE x.connection_id = c.id AND x.organization_id = p_org AND x.user_id = p_user
              AND (p_spreadsheet IS NULL OR x.spreadsheet_id = p_spreadsheet)
            ORDER BY x.id LOOP
    PERFORM 1 FROM private.google_sheets_watch_channels w WHERE w.target_id = r.id ORDER BY w.id FOR UPDATE;
    PERFORM 1 FROM private.google_sheets_watch_targets x WHERE x.id = r.id FOR UPDATE;
    IF p_force OR NOT EXISTS (SELECT 1 FROM public.google_sheets_sources s
                               WHERE s.connection_id = c.id AND s.spreadsheet_id = r.spreadsheet_id
                                 AND s.organization_id = p_org AND s.user_id = p_user AND s.state = 'enabled') THEN
      UPDATE private.google_sheets_watch_channels w
         SET resource_id = COALESCE(w.resource_id, w.observed_resource_id),
             state = CASE WHEN COALESCE(w.resource_id, w.observed_resource_id) IS NULL THEN 'abandoned' ELSE 'stopping' END,
             next_stop_at = NULL, updated_at = v_now
       WHERE w.target_id = r.id AND w.state IN ('registering','active');
      SELECT COALESCE(jsonb_agg(jsonb_build_object('row', w.id, 'channel_id', w.channel_id, 'resource_id', w.resource_id)
                                ORDER BY w.id), '[]'::jsonb)
        INTO v_part FROM private.google_sheets_watch_channels w WHERE w.target_id = r.id AND w.state = 'stopping';
      v_stop := v_stop || v_part;
      UPDATE private.google_sheets_watch_targets x SET state = 'stopped', maint_lease_owner = NULL,
             maint_lease_expires_at = NULL, updated_at = v_now
       WHERE x.id = r.id;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('stop', v_stop);
END $$;

-- Maintenance work list (D3: watch upkeep and recovery only — never a spreadsheet read). In order:
--   1. bounded retention (events 14 d, attempts 30 d, terminal channels 7 d, idle stopped targets 7 d);
--   2. channel hygiene: expired active → stopped; registering > 5 min → stopping/abandoned; channels whose
--      connection can no longer authenticate → abandoned; channels whose target has no enabled source → stopping;
--   3. 'stop' items (stopping channels whose retry time or renewal overlap has passed; next attempt pushed out
--      2 min as a lease);
--   4. 'register' items (mode not off): targets with an enabled, allowed source on a connected connection and no
--      live channel at the current generation and key outside the renew window — under a maintenance lease.
-- Channel rows are touched before any target row (lock order); targets are taken with SKIP LOCKED.
CREATE FUNCTION private.google_sheets_push_maintenance_claim(p_lease uuid, p_limit integer, p_key_id text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  cfg private.google_sheets_push_config; v_now timestamptz := clock_timestamp(); v_items jsonb := '[]'::jsonb;
  v_part jsonb; r record; v_reason text; v_n integer;
BEGIN
  IF p_lease IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_key_id IS NULL OR p_key_id !~ '^[0-9a-f]{8}$' THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO cfg FROM private.google_sheets_push_config;

  -- 1. retention (bounded per call)
  DELETE FROM private.google_sheets_push_events WHERE id IN (
    SELECT e.id FROM private.google_sheets_push_events e WHERE e.queued_at < v_now - interval '14 days' LIMIT 5000);
  DELETE FROM private.google_sheets_push_attempts WHERE id IN (
    SELECT a.id FROM private.google_sheets_push_attempts a WHERE a.started_at < v_now - interval '30 days' LIMIT 5000);
  DELETE FROM private.google_sheets_watch_channels WHERE id IN (
    SELECT w.id FROM private.google_sheets_watch_channels w
     WHERE w.state IN ('stopped','failed','abandoned') AND w.updated_at < v_now - interval '7 days'
     LIMIT 1000 FOR UPDATE SKIP LOCKED);

  -- 2. channel hygiene (channel rows only)
  UPDATE private.google_sheets_watch_channels w
     SET state = 'stopped', stopped_at = v_now, last_error_code = 'expired', updated_at = v_now
   WHERE w.id IN (SELECT x.id FROM private.google_sheets_watch_channels x
                   WHERE x.state IN ('active','stopping') AND x.expires_at <= v_now FOR UPDATE SKIP LOCKED);
  UPDATE private.google_sheets_watch_channels w
     SET resource_id = COALESCE(w.resource_id, w.observed_resource_id),
         state = CASE WHEN COALESCE(w.resource_id, w.observed_resource_id) IS NULL THEN 'abandoned' ELSE 'stopping' END,
         next_stop_at = NULL, last_error_code = 'registration_abandoned', updated_at = v_now
   WHERE w.id IN (SELECT x.id FROM private.google_sheets_watch_channels x
                   WHERE x.state = 'registering' AND x.created_at < v_now - interval '5 minutes' FOR UPDATE SKIP LOCKED);
  UPDATE private.google_sheets_watch_channels w
     SET state = 'abandoned', last_error_code = 'no_credentials', updated_at = v_now
   WHERE w.id IN (SELECT x.id FROM private.google_sheets_watch_channels x
                    JOIN public.google_sheets_connections g ON g.id = x.connection_id
                   WHERE x.state IN ('active','stopping') AND (g.status <> 'connected' OR NOT g.has_refresh_token)
                   FOR UPDATE OF x SKIP LOCKED);
  UPDATE private.google_sheets_watch_channels w
     SET state = 'stopping', next_stop_at = NULL, last_error_code = 'no_sources', updated_at = v_now
   WHERE w.id IN (SELECT x.id FROM private.google_sheets_watch_channels x
                   WHERE x.state = 'active'
                     AND NOT EXISTS (SELECT 1 FROM public.google_sheets_sources s
                                      WHERE s.connection_id = x.connection_id AND s.spreadsheet_id = x.spreadsheet_id
                                        AND s.organization_id = x.organization_id AND s.user_id = x.user_id
                                        AND s.state = 'enabled' AND s.health IN ('ok','error'))
                   FOR UPDATE SKIP LOCKED);

  -- 3. stop items
  WITH s AS (
    UPDATE private.google_sheets_watch_channels w SET next_stop_at = v_now + interval '2 minutes', updated_at = v_now
     WHERE w.id IN (SELECT x.id FROM private.google_sheets_watch_channels x
                     WHERE x.state = 'stopping' AND x.resource_id IS NOT NULL
                       AND (x.next_stop_at IS NULL OR x.next_stop_at <= v_now)
                     ORDER BY x.updated_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
    RETURNING w.id, w.channel_id, w.resource_id, w.connection_id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'stop', 'row', s.id, 'channel_id', s.channel_id,
                                               'resource_id', s.resource_id, 'connection_id', s.connection_id)), '[]'::jsonb)
    INTO v_part FROM s;
  v_items := v_items || v_part;

  -- 4. register / renew items
  IF cfg.mode <> 'off' THEN
    INSERT INTO private.google_sheets_watch_targets (organization_id, user_id, connection_id, spreadsheet_id)
    SELECT DISTINCT s.organization_id, s.user_id, s.connection_id, s.spreadsheet_id
      FROM public.google_sheets_sources s
      JOIN public.google_sheets_connections g ON g.id = s.connection_id
     WHERE s.state = 'enabled' AND s.health IN ('ok','error') AND g.status = 'connected'
       AND g.user_id = s.user_id AND g.organization_id = s.organization_id
       AND private.google_sheets_push_source_allowed(s.id)
    ON CONFLICT (connection_id, spreadsheet_id) DO NOTHING;
    v_n := 0;
    FOR r IN
      SELECT x.id, x.connection_id, x.spreadsheet_id, g.auth_generation
        FROM private.google_sheets_watch_targets x
        JOIN public.google_sheets_connections g ON g.id = x.connection_id
       WHERE g.status = 'connected' AND g.has_refresh_token
         AND g.user_id = x.user_id AND g.organization_id = x.organization_id
         AND private.google_sheets_owner_eligible(x.user_id, x.organization_id)
         AND (x.next_watch_attempt_at IS NULL OR x.next_watch_attempt_at <= v_now)
         AND (x.maint_lease_expires_at IS NULL OR x.maint_lease_expires_at <= v_now)
         AND EXISTS (SELECT 1 FROM public.google_sheets_sources s
                      WHERE s.connection_id = x.connection_id AND s.spreadsheet_id = x.spreadsheet_id
                        AND s.organization_id = x.organization_id AND s.user_id = x.user_id
                        AND s.state = 'enabled' AND s.health IN ('ok','error')
                        AND private.google_sheets_push_source_allowed(s.id))
         AND NOT EXISTS (SELECT 1 FROM private.google_sheets_watch_channels w
                          WHERE w.target_id = x.id AND w.state = 'registering')
         AND NOT EXISTS (SELECT 1 FROM private.google_sheets_watch_channels w
                          WHERE w.target_id = x.id AND w.state = 'active' AND w.auth_generation = g.auth_generation
                            AND w.key_id = p_key_id AND w.expires_at > v_now + make_interval(secs => cfg.renew_before_s))
       ORDER BY x.next_watch_attempt_at NULLS FIRST, x.id
       LIMIT p_limit
       FOR UPDATE OF x SKIP LOCKED
    LOOP
      v_reason := CASE
        WHEN EXISTS (SELECT 1 FROM private.google_sheets_watch_channels w WHERE w.target_id = r.id AND w.state = 'active'
                       AND w.auth_generation = r.auth_generation AND w.key_id = p_key_id) THEN 'renew'
        WHEN EXISTS (SELECT 1 FROM private.google_sheets_watch_channels w WHERE w.target_id = r.id AND w.state = 'active'
                       AND w.auth_generation <> r.auth_generation) THEN 'reconnect'
        WHEN EXISTS (SELECT 1 FROM private.google_sheets_watch_channels w WHERE w.target_id = r.id AND w.state = 'active') THEN 'rotate'
        WHEN EXISTS (SELECT 1 FROM private.google_sheets_watch_channels w WHERE w.target_id = r.id) THEN 'recover'
        ELSE 'activate' END;
      UPDATE private.google_sheets_watch_targets x
         SET state = 'live', maint_lease_owner = p_lease, maint_lease_expires_at = v_now + interval '3 minutes', updated_at = v_now
       WHERE x.id = r.id;
      v_items := v_items || jsonb_build_array(jsonb_build_object('kind', 'register', 'target_id', r.id,
        'connection_id', r.connection_id, 'generation', r.auth_generation, 'spreadsheet_id', r.spreadsheet_id, 'reason', v_reason));
      v_n := v_n + 1;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('mode', cfg.mode, 'items', v_items);
END $$;

-- Cron guard (runs as the job owner; no wrapper): true only when maintenance has real work — watch upkeep, a
-- queued job that is due (retry/recovery), or rows past their retention window (bounded deletes). Never true
-- merely because time passed, and never a spreadsheet read.
CREATE FUNCTION private.google_sheets_push_maintenance_due()
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
  WITH cfg AS (SELECT * FROM private.google_sheets_push_config)
  SELECT
    -- a queued job is due (retry, recovery of an expired lease, backlog, or a skipped claim)
    EXISTS (SELECT 1 FROM private.google_sheets_watch_targets x JOIN public.google_sheets_connections g ON g.id = x.connection_id
             WHERE (SELECT mode FROM cfg) <> 'off' AND x.requested_seq > x.processed_seq
               AND (x.next_attempt_at IS NULL OR x.next_attempt_at <= now())
               AND (x.lease_expires_at IS NULL OR x.lease_expires_at <= now())
               AND g.status = 'connected' AND g.has_refresh_token)
    -- channel upkeep
    OR EXISTS (SELECT 1 FROM private.google_sheets_watch_channels w
                WHERE (w.state = 'stopping' AND w.resource_id IS NOT NULL AND (w.next_stop_at IS NULL OR w.next_stop_at <= now()))
                   OR (w.state = 'registering' AND w.created_at < now() - interval '5 minutes')
                   OR (w.state IN ('active','stopping') AND w.expires_at <= now()))
    OR EXISTS (SELECT 1 FROM private.google_sheets_watch_channels w JOIN public.google_sheets_connections g ON g.id = w.connection_id
                WHERE w.state IN ('active','stopping') AND (g.status <> 'connected' OR NOT g.has_refresh_token))
    OR EXISTS (SELECT 1 FROM private.google_sheets_watch_channels w
                WHERE w.state = 'active'
                  AND NOT EXISTS (SELECT 1 FROM public.google_sheets_sources s
                                   WHERE s.connection_id = w.connection_id AND s.spreadsheet_id = w.spreadsheet_id
                                     AND s.organization_id = w.organization_id AND s.user_id = w.user_id
                                     AND s.state = 'enabled' AND s.health IN ('ok','error')))
    -- a spreadsheet needs a (new or renewed) channel
    OR EXISTS (SELECT 1 FROM public.google_sheets_sources s
                 JOIN public.google_sheets_connections g ON g.id = s.connection_id
                 LEFT JOIN private.google_sheets_watch_targets x ON x.connection_id = s.connection_id AND x.spreadsheet_id = s.spreadsheet_id
                WHERE (SELECT mode FROM cfg) <> 'off'
                  AND s.state = 'enabled' AND s.health IN ('ok','error') AND g.status = 'connected' AND g.has_refresh_token
                  AND private.google_sheets_push_source_allowed(s.id)
                  AND (x.id IS NULL OR (
                        (x.next_watch_attempt_at IS NULL OR x.next_watch_attempt_at <= now())
                    AND (x.maint_lease_expires_at IS NULL OR x.maint_lease_expires_at <= now())
                    AND NOT EXISTS (SELECT 1 FROM private.google_sheets_watch_channels w WHERE w.target_id = x.id AND w.state = 'registering')
                    AND NOT EXISTS (SELECT 1 FROM private.google_sheets_watch_channels w
                                     WHERE w.target_id = x.id AND w.state = 'active' AND w.auth_generation = g.auth_generation
                                       AND w.expires_at > now() + make_interval(secs => (SELECT renew_before_s FROM cfg)))))
                  AND private.google_sheets_owner_eligible(s.user_id, s.organization_id))
    -- retention is due (the maintenance pass deletes at most 5,000 rows of each per call)
    OR EXISTS (SELECT 1 FROM private.google_sheets_push_events e WHERE e.queued_at < now() - interval '14 days')
    OR EXISTS (SELECT 1 FROM private.google_sheets_push_attempts a WHERE a.started_at < now() - interval '30 days')
$$;

-- Monitoring summary for the owner's Settings page (via the service-role status action; D5). Per enabled,
-- allowed source: active | setting_up | interrupted — derived from the channels, so it cannot drift. Only an
-- ACTIVE channel counts: a 'stopping' channel is one we are ending, never reliable coverage.
CREATE FUNCTION private.google_sheets_push_status(p_user uuid, p_org uuid)
 RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'mode', (SELECT c.mode FROM private.google_sheets_push_config c),
    'sources', COALESCE((
      SELECT jsonb_object_agg(s.id::text, jsonb_build_object(
        'state', CASE
          WHEN g.status <> 'connected' THEN 'interrupted'
          WHEN x.id IS NULL THEN 'setting_up'
          WHEN EXISTS (SELECT 1 FROM private.google_sheets_watch_channels w
                        WHERE w.target_id = x.id AND w.state = 'active' AND w.expires_at > now()
                          AND w.auth_generation = g.auth_generation) THEN 'active'
          WHEN EXISTS (SELECT 1 FROM private.google_sheets_watch_channels w WHERE w.target_id = x.id AND w.state = 'registering')
               AND x.watch_failures = 0 THEN 'setting_up'
          WHEN x.watch_failures > 0 OR EXISTS (SELECT 1 FROM private.google_sheets_watch_channels w WHERE w.target_id = x.id)
            THEN 'interrupted'
          ELSE 'setting_up' END,
        'last_notification_at', x.last_notification_at,
        'last_processed_at', x.last_processed_at,
        'pending', COALESCE(x.requested_seq > x.processed_seq, false)))
        FROM public.google_sheets_sources s
        JOIN public.google_sheets_connections g ON g.id = s.connection_id
        LEFT JOIN private.google_sheets_watch_targets x ON x.connection_id = s.connection_id AND x.spreadsheet_id = s.spreadsheet_id
       WHERE s.organization_id = p_org AND s.user_id = p_user AND s.state = 'enabled'
         AND private.google_sheets_push_source_allowed(s.id)), '{}'::jsonb));
$$;

DO $acl$
DECLARE fn regprocedure;
BEGIN
  FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'private' AND p.proname LIKE 'google\_sheets\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', fn);
  END LOOP;
END
$acl$;

-- ---------------------------------------------------------------- public service-role-only wrappers
CREATE FUNCTION public.google_sheets_push_accept(p_channel_id text, p_token_digest text, p_resource_id text, p_state text,
  p_message_number bigint, p_changed text, p_received_at timestamptz)
 RETURNS TABLE (outcome text, target_id uuid, process boolean)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT * FROM private.google_sheets_push_accept(p_channel_id, p_token_digest, p_resource_id, p_state,
                                                       p_message_number, p_changed, p_received_at) $$;

CREATE FUNCTION public.google_sheets_push_claim(p_lease uuid, p_target uuid, p_lease_s integer, p_worker text)
 RETURNS TABLE (target_id uuid, organization_id uuid, user_id uuid, connection_id uuid, spreadsheet_id text,
                attempt_id uuid, from_seq bigint, snapshot_seq bigint, sources uuid[],
                oldest_received_at timestamptz, oldest_queued_at timestamptz)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT * FROM private.google_sheets_push_claim(p_lease, p_target, p_lease_s, p_worker) $$;

CREATE FUNCTION public.google_sheets_push_claim_source(p_target uuid, p_target_lease uuid, p_source uuid, p_lease uuid)
 RETURNS TABLE (source_id uuid, organization_id uuid, user_id uuid, connection_id uuid, auth_generation bigint,
                spreadsheet_id text, sheet_id bigint, mapping jsonb, identity_mode text, id_header text,
                lead_source_default text, config_version integer, phase text, row_epoch integer)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT * FROM private.google_sheets_push_claim_source(p_target, p_target_lease, p_source, p_lease) $$;

CREATE FUNCTION public.google_sheets_push_complete(p_target uuid, p_lease uuid, p_result jsonb)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT private.google_sheets_push_complete(p_target, p_lease, p_result) $$;

CREATE FUNCTION public.google_sheets_push_kick(p_user uuid, p_org uuid, p_source uuid, p_reason text)
 RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT private.google_sheets_push_kick(p_user, p_org, p_source, p_reason) $$;

CREATE FUNCTION public.google_sheets_watch_begin(p_connection uuid, p_generation bigint, p_spreadsheet text,
  p_channel_id text, p_token_digest text, p_key_id text, p_reason text)
 RETURNS TABLE (outcome text, channel_row_id uuid, target_id uuid)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT * FROM private.google_sheets_watch_begin(p_connection, p_generation, p_spreadsheet, p_channel_id,
                                                       p_token_digest, p_key_id, p_reason) $$;

CREATE FUNCTION public.google_sheets_watch_result(p_channel_row uuid, p_action text, p_resource_id text,
  p_expiration timestamptz, p_code text)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT private.google_sheets_watch_result(p_channel_row, p_action, p_resource_id, p_expiration, p_code) $$;

CREATE FUNCTION public.google_sheets_watch_release(p_user uuid, p_org uuid, p_spreadsheet text, p_force boolean)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT private.google_sheets_watch_release(p_user, p_org, p_spreadsheet, p_force) $$;

CREATE FUNCTION public.google_sheets_push_maintenance_claim(p_lease uuid, p_limit integer, p_key_id text)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT private.google_sheets_push_maintenance_claim(p_lease, p_limit, p_key_id) $$;

CREATE FUNCTION public.google_sheets_push_status(p_user uuid, p_org uuid)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT private.google_sheets_push_status(p_user, p_org) $$;

DO $acl$
DECLARE fn regprocedure;
BEGIN
  FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname LIKE 'google\_sheets\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END
$acl$;
