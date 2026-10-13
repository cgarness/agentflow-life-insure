-- =====================================================================================================
-- Google Sheets lead import V1 — foundation (Settings → Google Sheets; "new row → create lead").
-- Plan: docs/plans/2026-10-13-google-sheets-import/implementation_plan.md §0.
--
-- New objects only, plus ONE narrowly scoped change to public._contacts_permission_default (a new
-- 'contacts.leads.import_google_sheets' row, ON for Agent and Team Leader). The live preimage MD5 is
-- verified before replacement and the function's signature, volatility, owner and ACL are preserved.
--
-- Security model:
--   * Tenant tables carry organization_id; RLS SELECT is own-only; authenticated has no write grant.
--   * Credentials live in Supabase Vault; OAuth states, receipts and the row ledger live in `private`.
--   * Logic lives in private.* (no EXECUTE for anyone but the owner). Edge Functions reach it only
--     through public.google_sheets_* SECURITY DEFINER wrappers whose EXECUTE is granted to service_role
--     alone (revoked from PUBLIC/anon/authenticated). Wrappers take the server-validated actor.
--   * Every write re-checks owner eligibility, source state/version, connection generation and lease.
-- No existing table, trigger, workflow, DNC, SMS, consent or telephony object is altered.
-- =====================================================================================================

-- ---------------------------------------------------------------- preflight: replay + preimage guard
DO $pre$
BEGIN
  IF to_regclass('public.google_sheets_sources') IS NOT NULL THEN
    RAISE EXCEPTION 'google_sheets foundation already applied; review before replaying';
  END IF;
  IF md5(pg_get_functiondef('public._contacts_permission_default(text,text)'::regprocedure))
       <> 'a199d5ddfb9a56070aeb7706d3e9a4b8' THEN
    RAISE EXCEPTION '_contacts_permission_default preimage changed; refusing to replace it';
  END IF;
END
$pre$;

CREATE SCHEMA IF NOT EXISTS private;

-- ---------------------------------------------------------------- permission default (new key only)
-- Exact live preimage plus one row. Admin / Super Admin bypass happens in the callers, as before.
CREATE OR REPLACE FUNCTION public._contacts_permission_default(p_role text, p_key text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT CASE p_role WHEN 'Agent' THEN d.agent WHEN 'Team Leader' THEN d.team_leader ELSE false END
     FROM (VALUES
       ('contacts.leads.view_assigned',   true,  true),
       ('contacts.leads.view_unassigned', false, true),
       ('contacts.leads.view_all',        false, false),
       ('contacts.leads.create',          true,  true),
       ('contacts.leads.edit',            true,  true),
       ('contacts.leads.delete',          false, false),
       ('contacts.leads.import',          false, true),
       ('contacts.leads.import_google_sheets', true, true),
       ('contacts.leads.undo_own_import', false, true),
       ('contacts.leads.undo_team_import',false, true),
       ('contacts.leads.assign',          false, true),
       ('contacts.leads.bulk_assign',     false, true),
       ('contacts.leads.bulk_status',     true,  true),
       ('contacts.leads.update_status',   true,  true),
       ('contacts.leads.add_to_campaign', false, true),
       ('contacts.clients.view',          true,  true),
       ('contacts.clients.edit',          true,  true),
       ('contacts.clients.delete',        false, false),
       ('contacts.recruits.view',         true,  true),
       ('contacts.recruits.create',       true,  true),
       ('contacts.recruits.edit',         true,  true),
       ('contacts.recruits.delete',       false, false),
       ('contacts.notes.manage',          true,  true),
       ('contacts.tasks.manage',          true,  true),
       ('contacts.appointments.manage',   true,  true),
       ('contacts.messages.manage',       true,  true)
     ) AS d(key, agent, team_leader)
     WHERE d.key = p_key),
    false
  );
$function$;
REVOKE ALL ON FUNCTION public._contacts_permission_default(text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------- tables
CREATE TABLE public.google_sheets_connections (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  google_sub        text,
  google_email      text,
  granted_scopes    text[] NOT NULL DEFAULT '{}',
  status            text NOT NULL DEFAULT 'disconnected'
                      CHECK (status IN ('connected','reconnect_required','disconnected')),
  auth_generation   bigint NOT NULL DEFAULT 0,
  has_refresh_token boolean NOT NULL DEFAULT false,
  last_error_code   text,
  connected_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE public.google_sheets_sources (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  connection_id        uuid NOT NULL REFERENCES public.google_sheets_connections(id) ON DELETE CASCADE,
  spreadsheet_id       text NOT NULL CHECK (spreadsheet_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  sheet_id             bigint NOT NULL CHECK (sheet_id >= 0),
  spreadsheet_name     text NOT NULL DEFAULT '',
  sheet_title          text NOT NULL DEFAULT '',
  display_name         text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  mapping              jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(mapping) = 'object'),
  identity_mode        text NOT NULL DEFAULT 'row_position' CHECK (identity_mode IN ('source_id','row_position')),
  id_header            text,
  lead_source_default  text NOT NULL DEFAULT 'Google Sheets' CHECK (length(lead_source_default) <= 120),
  include_existing     boolean NOT NULL DEFAULT false,
  config_version       integer NOT NULL DEFAULT 1,
  state                text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','enabled','paused')),
  health               text NOT NULL DEFAULT 'ok' CHECK (health IN ('ok','needs_review','access_lost','error')),
  review_reason        text,
  phase                text NOT NULL DEFAULT 'steady' CHECK (phase IN ('initial','steady')),
  row_epoch            integer NOT NULL DEFAULT 1,
  activated_at         timestamptz,
  baseline_row_count   integer,
  next_sync_at         timestamptz,
  lease_owner          uuid,
  lease_expires_at     timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_checked_at      timestamptz,
  last_success_at      timestamptz,
  last_result          jsonb,
  last_error_code      text,
  last_error_message   text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_sheets_sources_identity_header
    CHECK (identity_mode <> 'source_id' OR (id_header IS NOT NULL AND length(btrim(id_header)) > 0)),
  CONSTRAINT google_sheets_sources_unique_tab UNIQUE (organization_id, user_id, spreadsheet_id, sheet_id)
);
CREATE INDEX google_sheets_sources_due_idx ON public.google_sheets_sources (next_sync_at)
  WHERE state = 'enabled' AND health IN ('ok','error');
CREATE INDEX google_sheets_sources_owner_idx ON public.google_sheets_sources (organization_id, user_id);

CREATE TABLE public.google_sheets_sync_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_id       uuid NOT NULL REFERENCES public.google_sheets_sources(id) ON DELETE CASCADE,
  trigger         text NOT NULL CHECK (trigger IN ('schedule','manual','activation')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz NOT NULL DEFAULT now(),
  rows_read       integer NOT NULL DEFAULT 0,
  imported        integer NOT NULL DEFAULT 0,  -- includes flagged
  flagged         integer NOT NULL DEFAULT 0,  -- subset of imported
  skipped         integer NOT NULL DEFAULT 0,
  errors          integer NOT NULL DEFAULT 0,
  error_code      text,
  errors_sample   jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX google_sheets_sync_runs_source_idx ON public.google_sheets_sync_runs (source_id, finished_at DESC);

CREATE TABLE private.google_sheets_oauth_states (
  state_hash        text PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  user_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  auth_generation   bigint NOT NULL,
  return_origin     text NOT NULL,
  verifier_enc      text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  consumed_at       timestamptz
);

-- Operational per-source ledger (cascades with the source). Permanent protection lives in receipts.
CREATE TABLE private.google_sheets_source_rows (
  source_id      uuid NOT NULL REFERENCES public.google_sheets_sources(id) ON DELETE CASCADE,
  row_key        text NOT NULL,
  row_number     integer NOT NULL,
  fingerprint    text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('baseline','pending','done')),
  pending_reason text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, row_key)
);

-- Permanent processing receipts. No FK to the source or the lead: they survive source removal,
-- lead deletion/conversion and reconnects. Never updated or deleted by this feature.
CREATE TABLE private.google_sheets_receipts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,
  spreadsheet_id  text NOT NULL,
  sheet_id        bigint NOT NULL,
  receipt_key     text NOT NULL,
  outcome         text NOT NULL CHECK (outcome IN ('imported','imported_flagged','skipped_duplicate')),
  lead_id         uuid,
  source_id       uuid,
  fingerprint     text NOT NULL,
  row_number      integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, spreadsheet_id, sheet_id, receipt_key)
);
CREATE INDEX google_sheets_receipts_fp_idx
  ON private.google_sheets_receipts (organization_id, user_id, spreadsheet_id, sheet_id, fingerprint);

-- ---------------------------------------------------------------- grants + RLS
REVOKE ALL ON public.google_sheets_connections, public.google_sheets_sources, public.google_sheets_sync_runs
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.google_sheets_connections, public.google_sheets_sources, public.google_sheets_sync_runs
  TO authenticated;
GRANT ALL ON public.google_sheets_connections, public.google_sheets_sources, public.google_sheets_sync_runs
  TO service_role;
REVOKE ALL ON private.google_sheets_oauth_states, private.google_sheets_source_rows, private.google_sheets_receipts
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.google_sheets_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_sheets_sources     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_sheets_sync_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.google_sheets_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.google_sheets_source_rows  ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.google_sheets_receipts     ENABLE ROW LEVEL SECURITY;

CREATE POLICY google_sheets_connections_select_own ON public.google_sheets_connections
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND organization_id = public.get_org_id());
CREATE POLICY google_sheets_sources_select_own ON public.google_sheets_sources
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND organization_id = public.get_org_id());
CREATE POLICY google_sheets_sync_runs_select_own ON public.google_sheets_sync_runs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND organization_id = public.get_org_id());

-- ---------------------------------------------------------------- private helpers
-- Mirrors public.has_contacts_permission for an EXPLICIT (user, org): Admin / super admin → true;
-- stored boolean wins; otherwise the SQL default. Adds: Active profile, same org, org not suspended.
CREATE FUNCTION private.google_sheets_owner_eligible(p_user uuid, p_org uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  v_role text; v_super boolean; v_val jsonb;
BEGIN
  IF p_user IS NULL OR p_org IS NULL THEN RETURN false; END IF;
  SELECT p.role, COALESCE(p.is_super_admin, false) INTO v_role, v_super
    FROM public.profiles p
    JOIN public.organizations o ON o.id = p.organization_id
   WHERE p.id = p_user AND p.organization_id = p_org
     AND p.status = 'Active' AND COALESCE(o.status, 'active') = 'active';
  IF NOT FOUND OR v_role IS NULL THEN RETURN false; END IF;
  IF v_role = 'Admin' OR v_super THEN RETURN true; END IF;
  SELECT rp.permissions -> 'contacts' -> 'contacts.leads.import_google_sheets' INTO v_val
    FROM public.role_permissions rp
   WHERE rp.organization_id = p_org AND rp.role = v_role;
  IF v_val IS NOT NULL AND jsonb_typeof(v_val) = 'boolean' THEN RETURN v_val::boolean; END IF;
  RETURN COALESCE(public._contacts_permission_default(v_role, 'contacts.leads.import_google_sheets'), false);
END $$;

CREATE FUNCTION private.google_sheets_require_owner(p_user uuid, p_org uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
BEGIN
  IF NOT private.google_sheets_owner_eligible(p_user, p_org) THEN
    RAISE EXCEPTION 'not_permitted' USING ERRCODE = '42501';
  END IF;
END $$;

-- The import-contacts duplicate predicate, ported exactly (digits-only phone; lowercased/trimmed email;
-- four rules; assigned_only compares against the owner's leads). Candidate predicate matches the rule.
CREATE FUNCTION private.google_sheets_norm_email(p text)
 RETURNS text LANGUAGE sql IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT lower(regexp_replace(COALESCE(p, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g')) $$;

CREATE FUNCTION private.google_sheets_find_duplicate(
  p_org uuid, p_owner uuid, p_rule text, p_scope text, p_phone text, p_email text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  v_phone text := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
  v_email text := private.google_sheets_norm_email(p_email);
  v_id uuid;
BEGIN
  SELECT l.id INTO v_id
    FROM public.leads l
   WHERE l.organization_id = p_org
     AND (p_scope IS DISTINCT FROM 'assigned_only' OR l.assigned_agent_id = p_owner)
     AND CASE COALESCE(p_rule, 'phone_or_email')
       WHEN 'phone_only' THEN
         v_phone <> '' AND regexp_replace(COALESCE(l.phone, ''), '[^0-9]', '', 'g') = v_phone
       WHEN 'email_only' THEN
         v_email <> '' AND private.google_sheets_norm_email(l.email) = v_email
       WHEN 'phone_and_email' THEN
         v_phone <> '' AND v_email <> ''
         AND regexp_replace(COALESCE(l.phone, ''), '[^0-9]', '', 'g') = v_phone
         AND private.google_sheets_norm_email(l.email) = v_email
       ELSE
         (v_phone <> '' AND regexp_replace(COALESCE(l.phone, ''), '[^0-9]', '', 'g') = v_phone)
         OR (v_email <> '' AND private.google_sheets_norm_email(l.email) = v_email)
     END
   LIMIT 1;
  RETURN v_id;
END $$;

CREATE FUNCTION private.google_sheets_dup_settings(p_org uuid,
  OUT rule text, OUT scope text, OUT action text)
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
  SELECT COALESCE((SELECT c.duplicate_detection_rule  FROM public.contact_management_settings c WHERE c.organization_id = p_org), 'phone_or_email'),
         COALESCE((SELECT c.duplicate_detection_scope FROM public.contact_management_settings c WHERE c.organization_id = p_org), 'all_agents'),
         COALESCE((SELECT c.csv_action                FROM public.contact_management_settings c WHERE c.organization_id = p_org), 'flag');
$$;

CREATE FUNCTION private.google_sheets_default_status(p_org uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
  SELECT COALESCE((SELECT s.name FROM public.pipeline_stages s
                    WHERE s.organization_id = p_org AND s.pipeline_type = 'lead'
                    ORDER BY s.is_default DESC, s.sort_order ASC, s.created_at ASC LIMIT 1), 'New');
$$;

-- Locks and validates a source for a worker write. Raises 'stale' when anything moved underneath.
CREATE FUNCTION private.google_sheets_lock_for_work(p_source uuid, p_lease uuid, p_version integer, p_generation bigint)
 RETURNS public.google_sheets_sources
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  s public.google_sheets_sources; c public.google_sheets_connections;
BEGIN
  SELECT * INTO s FROM public.google_sheets_sources WHERE id = p_source FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stale: source removed' USING ERRCODE = 'P0001'; END IF;
  IF s.lease_owner IS DISTINCT FROM p_lease OR s.lease_expires_at IS NULL OR s.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'stale: lease lost' USING ERRCODE = 'P0001';
  END IF;
  IF s.config_version <> p_version THEN RAISE EXCEPTION 'stale: configuration changed' USING ERRCODE = 'P0001'; END IF;
  IF s.state <> 'enabled' OR s.health IN ('needs_review','access_lost') THEN
    RAISE EXCEPTION 'stale: source not active' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO c FROM public.google_sheets_connections WHERE id = s.connection_id FOR SHARE;
  IF NOT FOUND OR c.status <> 'connected' OR c.auth_generation <> p_generation
     OR c.user_id <> s.user_id OR c.organization_id <> s.organization_id THEN
    RAISE EXCEPTION 'stale: connection changed' USING ERRCODE = 'P0001';
  END IF;
  IF NOT private.google_sheets_owner_eligible(s.user_id, s.organization_id) THEN
    RAISE EXCEPTION 'stale: owner not eligible' USING ERRCODE = 'P0001';
  END IF;
  RETURN s;
END $$;

-- ---------------------------------------------------------------- OAuth state + connection
CREATE FUNCTION private.google_sheets_create_oauth_state(
  p_user uuid, p_org uuid, p_state_hash text, p_verifier_enc text, p_return_origin text)
 RETURNS bigint
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE v_gen bigint;
BEGIN
  PERFORM private.google_sheets_require_owner(p_user, p_org);
  IF p_verifier_enc IS NULL OR length(p_verifier_enc) < 20 OR p_return_origin !~ '^https?://[^/?#]+$' THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
  END IF;
  DELETE FROM private.google_sheets_oauth_states WHERE expires_at < now() - interval '1 day';
  SELECT auth_generation INTO v_gen FROM public.google_sheets_connections
   WHERE organization_id = p_org AND user_id = p_user;
  v_gen := COALESCE(v_gen, 0);
  INSERT INTO private.google_sheets_oauth_states
    (state_hash, user_id, organization_id, auth_generation, return_origin, verifier_enc, expires_at)
  VALUES (p_state_hash, p_user, p_org, v_gen, p_return_origin, p_verifier_enc, now() + interval '10 minutes');
  RETURN v_gen;
END $$;

-- Atomic single-use consume: exactly one caller can ever receive a given state.
CREATE FUNCTION private.google_sheets_consume_oauth_state(p_state_hash text)
 RETURNS TABLE (user_id uuid, organization_id uuid, auth_generation bigint, return_origin text, verifier_enc text)
 LANGUAGE sql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
  UPDATE private.google_sheets_oauth_states s
     SET consumed_at = now()
   WHERE s.state_hash = p_state_hash AND s.consumed_at IS NULL AND s.expires_at > now()
  RETURNING s.user_id, s.organization_id, s.auth_generation, s.return_origin, s.verifier_enc;
$$;

CREATE FUNCTION private.google_sheets_secret_name(p_connection uuid)
 RETURNS text LANGUAGE sql IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT 'google_sheets_refresh_' || p_connection::text $$;

-- Vault write + connection state in ONE transaction, conditioned on the generation captured at start.
-- Outcomes: connected | superseded | account_mismatch | no_refresh_token.
CREATE FUNCTION private.google_sheets_store_connection(
  p_user uuid, p_org uuid, p_expected_generation bigint, p_google_sub text, p_google_email text,
  p_scopes text[], p_refresh_token text)
 RETURNS TABLE (connection_id uuid, auth_generation bigint, outcome text)
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
#variable_conflict use_column
DECLARE
  c public.google_sheets_connections; v_secret uuid; v_has_sources boolean;
BEGIN
  PERFORM private.google_sheets_require_owner(p_user, p_org);
  IF p_google_sub IS NULL OR btrim(p_google_sub) = '' THEN RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.google_sheets_connections (organization_id, user_id)
  VALUES (p_org, p_user) ON CONFLICT (organization_id, user_id) DO NOTHING;
  SELECT * INTO c FROM public.google_sheets_connections
   WHERE organization_id = p_org AND user_id = p_user FOR UPDATE;

  IF c.auth_generation <> p_expected_generation THEN
    RETURN QUERY SELECT c.id, c.auth_generation, 'superseded'::text; RETURN;
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.google_sheets_sources s WHERE s.connection_id = c.id) INTO v_has_sources;
  IF c.google_sub IS NOT NULL AND c.google_sub <> p_google_sub AND v_has_sources THEN
    RETURN QUERY SELECT c.id, c.auth_generation, 'account_mismatch'::text; RETURN;
  END IF;

  SELECT id INTO v_secret FROM vault.secrets WHERE name = private.google_sheets_secret_name(c.id) LIMIT 1;
  IF p_refresh_token IS NULL OR btrim(p_refresh_token) = '' THEN
    -- Never overwrite a working token with an absent one; retain only for the same Google identity.
    IF v_secret IS NULL OR NOT c.has_refresh_token OR c.google_sub IS DISTINCT FROM p_google_sub THEN
      RETURN QUERY SELECT c.id, c.auth_generation, 'no_refresh_token'::text; RETURN;
    END IF;
  ELSIF v_secret IS NULL THEN
    PERFORM vault.create_secret(p_refresh_token, private.google_sheets_secret_name(c.id), 'AgentFlow Google Sheets refresh token');
  ELSE
    PERFORM vault.update_secret(v_secret, p_refresh_token, private.google_sheets_secret_name(c.id), 'AgentFlow Google Sheets refresh token');
  END IF;

  UPDATE public.google_sheets_connections g
     SET google_sub = p_google_sub, google_email = p_google_email, granted_scopes = COALESCE(p_scopes, '{}'),
         status = 'connected', auth_generation = g.auth_generation + 1, has_refresh_token = true,
         last_error_code = NULL, connected_at = now(), updated_at = now()
   WHERE g.id = c.id
  RETURNING g.auth_generation INTO c.auth_generation;
  RETURN QUERY SELECT c.id, c.auth_generation, 'connected'::text;
END $$;

CREATE FUNCTION private.google_sheets_get_refresh_token(p_connection uuid)
 RETURNS TABLE (refresh_token text, auth_generation bigint, user_id uuid, organization_id uuid)
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
  SELECT d.decrypted_secret, c.auth_generation, c.user_id, c.organization_id
    FROM public.google_sheets_connections c
    JOIN vault.decrypted_secrets d ON d.name = private.google_sheets_secret_name(c.id)
   WHERE c.id = p_connection AND c.status = 'connected' AND c.has_refresh_token;
$$;

-- invalid_grant etc. Only the generation that failed can be disabled (a newer connection survives).
CREATE FUNCTION private.google_sheets_mark_reconnect(p_connection uuid, p_generation bigint, p_code text)
 RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
BEGIN
  UPDATE public.google_sheets_connections
     SET status = 'reconnect_required', auth_generation = auth_generation + 1,
         last_error_code = left(COALESCE(p_code, 'reconnect_required'), 64), updated_at = now()
   WHERE id = p_connection AND auth_generation = p_generation AND status = 'connected';
  RETURN FOUND;
END $$;

CREATE FUNCTION private.google_sheets_disconnect(p_user uuid, p_org uuid)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE c public.google_sheets_connections;
BEGIN
  -- Disconnect is allowed even after the import permission was removed (it only removes access).
  SELECT * INTO c FROM public.google_sheets_connections
   WHERE organization_id = p_org AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  DELETE FROM vault.secrets WHERE name = private.google_sheets_secret_name(c.id);
  UPDATE public.google_sheets_connections
     SET status = 'disconnected', has_refresh_token = false, auth_generation = auth_generation + 1,
         last_error_code = NULL, updated_at = now()
   WHERE id = c.id;
END $$;

-- ---------------------------------------------------------------- source configuration
-- Create (p_source NULL) or update a source. Activated sources cannot change identity here (that is
-- the review path); saving clears a needs_review flag because the next check re-validates everything.
CREATE FUNCTION private.google_sheets_save_source(
  p_user uuid, p_org uuid, p_source uuid, p_expected_version integer, p_payload jsonb)
 RETURNS TABLE (source_id uuid, config_version integer)
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
#variable_conflict use_column
DECLARE
  s public.google_sheets_sources; c public.google_sheets_connections;
  v_mode text := COALESCE(p_payload->>'identity_mode', 'row_position');
  v_id_header text := NULLIF(btrim(COALESCE(p_payload->>'id_header', '')), '');
  v_mapping jsonb := COALESCE(p_payload->'mapping', '{}'::jsonb);
BEGIN
  PERFORM private.google_sheets_require_owner(p_user, p_org);
  IF jsonb_typeof(v_mapping) <> 'object' OR v_mode NOT IN ('source_id','row_position') THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
  END IF;
  IF v_mode = 'row_position' THEN v_id_header := NULL; END IF;

  IF p_source IS NULL THEN
    SELECT * INTO c FROM public.google_sheets_connections
     WHERE organization_id = p_org AND user_id = p_user AND status = 'connected';
    IF NOT FOUND THEN RAISE EXCEPTION 'not_connected' USING ERRCODE = 'P0001'; END IF;
    BEGIN
      INSERT INTO public.google_sheets_sources AS g
        (organization_id, user_id, connection_id, spreadsheet_id, sheet_id, spreadsheet_name, sheet_title,
         display_name, mapping, identity_mode, id_header, lead_source_default, include_existing)
      VALUES (p_org, p_user, c.id, p_payload->>'spreadsheet_id', (p_payload->>'sheet_id')::bigint,
              left(COALESCE(p_payload->>'spreadsheet_name', ''), 300), left(COALESCE(p_payload->>'sheet_title', ''), 300),
              btrim(p_payload->>'display_name'), v_mapping, v_mode, v_id_header,
              COALESCE(NULLIF(btrim(p_payload->>'lead_source_default'), ''), 'Google Sheets'),
              COALESCE((p_payload->>'include_existing')::boolean, false))
      RETURNING g.id, g.config_version INTO source_id, config_version;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'duplicate_source' USING ERRCODE = 'P0001';
    END;
    RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO s FROM public.google_sheets_sources
   WHERE id = p_source AND organization_id = p_org AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF s.config_version <> p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE = 'P0001'; END IF;
  IF s.state <> 'draft' AND (v_mode <> s.identity_mode OR v_id_header IS DISTINCT FROM s.id_header) THEN
    RAISE EXCEPTION 'identity_change_requires_review' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.google_sheets_sources g
     SET display_name = btrim(COALESCE(p_payload->>'display_name', g.display_name)),
         mapping = v_mapping,
         identity_mode = CASE WHEN g.state = 'draft' THEN v_mode ELSE g.identity_mode END,
         id_header = CASE WHEN g.state = 'draft' THEN v_id_header ELSE g.id_header END,
         lead_source_default = COALESCE(NULLIF(btrim(p_payload->>'lead_source_default'), ''), g.lead_source_default),
         include_existing = CASE WHEN g.state = 'draft'
                                 THEN COALESCE((p_payload->>'include_existing')::boolean, g.include_existing)
                                 ELSE g.include_existing END,
         sheet_title = left(COALESCE(p_payload->>'sheet_title', g.sheet_title), 300),
         health = CASE WHEN g.health = 'needs_review' THEN 'ok' ELSE g.health END,
         review_reason = CASE WHEN g.health = 'needs_review' THEN NULL ELSE g.review_reason END,
         next_sync_at = CASE WHEN g.state = 'enabled' THEN now() ELSE g.next_sync_at END,
         config_version = g.config_version + 1, updated_at = now()
   WHERE g.id = s.id
  RETURNING g.id, g.config_version INTO source_id, config_version;
  RETURN NEXT;
END $$;

-- Activation. p_rows: [{k,n,f}] for EVERY data row of one consistent server read.
-- Unchecked "include existing" → every row becomes a baseline record (excluded, not imported).
-- Checked → ID mode: no baseline (receipts protect earlier imports); no-ID mode: rows whose core
-- fingerprint equals a permanent receipt of an earlier source for this tab are baselined (shown in preview).
CREATE FUNCTION private.google_sheets_activate(
  p_user uuid, p_org uuid, p_source uuid, p_expected_version integer, p_generation bigint,
  p_rows jsonb, p_row_count integer)
 RETURNS TABLE (outcome text, config_version integer, baselined integer)
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
#variable_conflict use_column
DECLARE
  s public.google_sheets_sources; c public.google_sheets_connections; v_n integer := 0;
BEGIN
  PERFORM private.google_sheets_require_owner(p_user, p_org);
  SELECT * INTO s FROM public.google_sheets_sources
   WHERE id = p_source AND organization_id = p_org AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF s.state <> 'draft' THEN
    RETURN QUERY SELECT 'already_active'::text, s.config_version, 0; RETURN;
  END IF;
  IF s.config_version <> p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO c FROM public.google_sheets_connections WHERE id = s.connection_id FOR SHARE;
  IF c.status <> 'connected' OR c.auth_generation <> p_generation THEN
    RAISE EXCEPTION 'not_connected' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR p_row_count IS NULL OR p_row_count < 0 OR p_row_count > 10000 THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
  END IF;

  DELETE FROM private.google_sheets_source_rows WHERE source_id = s.id;
  IF NOT s.include_existing THEN
    INSERT INTO private.google_sheets_source_rows (source_id, row_key, row_number, fingerprint, kind)
    SELECT DISTINCT ON (r->>'k') s.id, r->>'k', (r->>'n')::int, r->>'f', 'baseline'
      FROM jsonb_array_elements(p_rows) r
     ORDER BY r->>'k', (r->>'n')::int;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSIF s.identity_mode = 'row_position' THEN
    INSERT INTO private.google_sheets_source_rows (source_id, row_key, row_number, fingerprint, kind)
    SELECT DISTINCT ON (r->>'k') s.id, r->>'k', (r->>'n')::int, r->>'f', 'baseline'
      FROM jsonb_array_elements(p_rows) r
     WHERE EXISTS (SELECT 1 FROM private.google_sheets_receipts x
                    WHERE x.organization_id = s.organization_id AND x.user_id = s.user_id
                      AND x.spreadsheet_id = s.spreadsheet_id AND x.sheet_id = s.sheet_id
                      AND x.fingerprint = r->>'f')
     ORDER BY r->>'k', (r->>'n')::int;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;

  UPDATE public.google_sheets_sources g
     SET state = 'enabled', health = 'ok', review_reason = NULL,
         phase = CASE WHEN g.include_existing THEN 'initial' ELSE 'steady' END,
         activated_at = now(), baseline_row_count = p_row_count, next_sync_at = now(),
         consecutive_failures = 0, config_version = g.config_version + 1, updated_at = now()
   WHERE g.id = s.id
  RETURNING g.config_version INTO s.config_version;
  RETURN QUERY SELECT 'activated'::text, s.config_version, v_n;
END $$;

CREATE FUNCTION private.google_sheets_set_state(p_user uuid, p_org uuid, p_source uuid, p_action text)
 RETURNS TABLE (state text, config_version integer)
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
#variable_conflict use_column
DECLARE s public.google_sheets_sources;
BEGIN
  SELECT * INTO s FROM public.google_sheets_sources
   WHERE id = p_source AND organization_id = p_org AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_action = 'remove' THEN
    -- Removal needs no import permission; receipts (no FK) survive; leads are untouched.
    DELETE FROM public.google_sheets_sources WHERE id = s.id;
    RETURN QUERY SELECT 'removed'::text, s.config_version; RETURN;
  END IF;
  IF p_action = 'pause' THEN
    IF s.state <> 'enabled' THEN RAISE EXCEPTION 'invalid_state' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.google_sheets_sources g SET state = 'paused', config_version = g.config_version + 1,
           lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
     WHERE g.id = s.id RETURNING g.state, g.config_version INTO state, config_version;
  ELSIF p_action = 'resume' THEN
    PERFORM private.google_sheets_require_owner(p_user, p_org);
    IF s.state <> 'paused' AND NOT (s.state = 'enabled' AND s.health IN ('access_lost','error')) THEN
      RAISE EXCEPTION 'invalid_state' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.google_sheets_sources g SET state = 'enabled',
           health = CASE WHEN g.health IN ('access_lost','error') THEN 'ok' ELSE g.health END,
           consecutive_failures = 0, next_sync_at = now(),
           config_version = g.config_version + 1, updated_at = now()
     WHERE g.id = s.id RETURNING g.state, g.config_version INTO state, config_version;
  ELSE
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
  END IF;
  RETURN NEXT;
END $$;

-- Recovery / identity change. p_rows: [{k,n,f,id}] under the NEW identity config from one fresh read.
-- "known" = an ID with a receipt/baseline, or a fingerprint matching a stored baseline/done fingerprint
-- of the current ledger (multiset: each stored fingerprint can vouch for one row). Unknown rows are
-- imported (left without a record) or excluded (baseline) per the agent's explicit choice.
CREATE FUNCTION private.google_sheets_review(
  p_user uuid, p_org uuid, p_source uuid, p_expected_version integer, p_identity_mode text,
  p_id_header text, p_mapping jsonb, p_rows jsonb, p_import_unknown boolean, p_dry_run boolean)
 RETURNS TABLE (known integer, unknown integer, config_version integer)
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
#variable_conflict use_column
DECLARE s public.google_sheets_sources; v_known integer; v_unknown integer;
BEGIN
  PERFORM private.google_sheets_require_owner(p_user, p_org);
  SELECT * INTO s FROM public.google_sheets_sources
   WHERE id = p_source AND organization_id = p_org AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF s.state = 'draft' THEN RAISE EXCEPTION 'invalid_state' USING ERRCODE = 'P0001'; END IF;
  IF s.config_version <> p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE = 'P0001'; END IF;
  IF p_identity_mode NOT IN ('source_id','row_position') OR jsonb_typeof(p_rows) <> 'array'
     OR (p_identity_mode = 'source_id' AND NULLIF(btrim(COALESCE(p_id_header, '')), '') IS NULL)
     OR jsonb_array_length(p_rows) > 10000 THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
  END IF;

  DROP TABLE IF EXISTS gs_review_rows, gs_review_fp, gs_review_cls;
  CREATE TEMP TABLE gs_review_rows ON COMMIT DROP AS
  SELECT (r->>'k') AS k, (r->>'n')::int AS n, (r->>'f') AS f, NULLIF(r->>'id', '') AS idv,
         row_number() OVER (PARTITION BY r->>'f' ORDER BY (r->>'n')::int) AS fp_rank
    FROM jsonb_array_elements(p_rows) r;

  CREATE TEMP TABLE gs_review_fp ON COMMIT DROP AS
  SELECT fingerprint AS f, count(*) AS cnt
    FROM private.google_sheets_source_rows
   WHERE source_id = s.id AND kind IN ('baseline','done')
   GROUP BY fingerprint;

  CREATE TEMP TABLE gs_review_cls ON COMMIT DROP AS
  SELECT rr.*,
         ( (rr.idv IS NOT NULL AND (
               EXISTS (SELECT 1 FROM private.google_sheets_receipts x
                        WHERE x.organization_id = s.organization_id AND x.user_id = s.user_id
                          AND x.spreadsheet_id = s.spreadsheet_id AND x.sheet_id = s.sheet_id
                          AND x.receipt_key = 'id:' || rr.idv)
            OR EXISTS (SELECT 1 FROM private.google_sheets_source_rows b
                        WHERE b.source_id = s.id AND b.kind = 'baseline' AND b.row_key = 'id:' || rr.idv)))
           OR rr.fp_rank <= COALESCE((SELECT fp.cnt FROM gs_review_fp fp WHERE fp.f = rr.f), 0)
         ) AS is_known
    FROM gs_review_rows rr;

  SELECT count(*) FILTER (WHERE is_known), count(*) FILTER (WHERE NOT is_known)
    INTO v_known, v_unknown FROM gs_review_cls;

  IF p_dry_run THEN
    RETURN QUERY SELECT v_known, v_unknown, s.config_version; RETURN;
  END IF;

  DELETE FROM private.google_sheets_source_rows WHERE source_id = s.id;
  INSERT INTO private.google_sheets_source_rows (source_id, row_key, row_number, fingerprint, kind)
  SELECT DISTINCT ON (k) s.id, k, n, f, 'baseline'
    FROM gs_review_cls
   WHERE is_known OR NOT p_import_unknown
   ORDER BY k, n;

  UPDATE public.google_sheets_sources g
     SET identity_mode = p_identity_mode,
         id_header = CASE WHEN p_identity_mode = 'source_id' THEN btrim(p_id_header) END,
         mapping = COALESCE(p_mapping, g.mapping),
         row_epoch = g.row_epoch + 1, health = 'ok', review_reason = NULL,
         phase = CASE WHEN p_import_unknown AND v_unknown > 0 THEN 'initial' ELSE g.phase END,
         next_sync_at = now(), consecutive_failures = 0,
         config_version = g.config_version + 1, updated_at = now()
   WHERE g.id = s.id
  RETURNING g.config_version INTO s.config_version;
  RETURN QUERY SELECT v_known, v_unknown, s.config_version;
END $$;

-- ---------------------------------------------------------------- worker: claim / load / ingest / finish
CREATE FUNCTION private.google_sheets_claim(p_lease uuid, p_limit integer, p_source uuid, p_user uuid, p_org uuid)
 RETURNS TABLE (source_id uuid, organization_id uuid, user_id uuid, connection_id uuid, auth_generation bigint,
                spreadsheet_id text, sheet_id bigint, mapping jsonb, identity_mode text, id_header text,
                lead_source_default text, config_version integer, phase text, row_epoch integer)
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
#variable_conflict use_column
BEGIN
  IF p_lease IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 10 THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
  END IF;
  IF p_source IS NOT NULL THEN
    PERFORM private.google_sheets_require_owner(p_user, p_org);
  END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT s.id
      FROM public.google_sheets_sources s
      JOIN public.google_sheets_connections c ON c.id = s.connection_id
     WHERE s.state = 'enabled' AND s.health IN ('ok','error')
       AND c.status = 'connected' AND c.has_refresh_token
       AND (s.lease_expires_at IS NULL OR s.lease_expires_at <= now())
       AND (CASE WHEN p_source IS NULL
                 THEN s.next_sync_at IS NOT NULL AND s.next_sync_at <= now()
                 ELSE s.id = p_source AND s.user_id = p_user AND s.organization_id = p_org
                      AND (s.last_checked_at IS NULL OR s.last_checked_at <= now() - interval '30 seconds') END)
       AND private.google_sheets_owner_eligible(s.user_id, s.organization_id)
     ORDER BY s.next_sync_at NULLS LAST
     LIMIT p_limit
     FOR UPDATE OF s SKIP LOCKED
  )
  UPDATE public.google_sheets_sources s
     SET lease_owner = p_lease, lease_expires_at = now() + interval '3 minutes'
    FROM picked, public.google_sheets_connections c
   WHERE s.id = picked.id AND c.id = s.connection_id
  RETURNING s.id, s.organization_id, s.user_id, s.connection_id, c.auth_generation, s.spreadsheet_id, s.sheet_id,
            s.mapping, s.identity_mode, s.id_header, s.lead_source_default, s.config_version, s.phase, s.row_epoch;
END $$;

-- Ledger + permanent receipt keys (ID mode) for one leased source. JSON keeps the PostgREST payload flat.
CREATE FUNCTION private.google_sheets_load_state(p_source uuid, p_lease uuid)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE s public.google_sheets_sources;
BEGIN
  SELECT * INTO s FROM public.google_sheets_sources WHERE id = p_source;
  IF NOT FOUND OR s.lease_owner IS DISTINCT FROM p_lease OR s.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'stale: lease lost' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', r.row_key, 'n', r.row_number, 'f', r.fingerprint,
                                                          'kind', r.kind, 'reason', r.pending_reason))
                        FROM private.google_sheets_source_rows r WHERE r.source_id = s.id), '[]'::jsonb),
    'receipt_ids', CASE WHEN s.identity_mode = 'source_id' THEN
       COALESCE((SELECT jsonb_agg(x.receipt_key)
                   FROM private.google_sheets_receipts x
                  WHERE x.organization_id = s.organization_id AND x.user_id = s.user_id
                    AND x.spreadsheet_id = s.spreadsheet_id AND x.sheet_id = s.sheet_id
                    AND x.receipt_key LIKE 'id:%'), '[]'::jsonb)
       ELSE '[]'::jsonb END);
END $$;

-- Atomic ingest. p_rows: [{k,n,f,lead:{...}}] valid candidates; p_pending: [{k,n,f,reason}] rows that
-- cannot be imported yet (invalid / blank ID / conflicting ID). Returns per-row outcomes and counts.
CREATE FUNCTION private.google_sheets_ingest(
  p_source uuid, p_lease uuid, p_version integer, p_generation bigint, p_rows jsonb, p_pending jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  s public.google_sheets_sources; d record;
  r jsonb; v_lead jsonb; v_key text; v_rkey text; v_receipt uuid; v_dup uuid; v_lead_id uuid;
  v_cf jsonb; v_meta jsonb; v_tags jsonb; v_status text; v_first text; v_last text; v_phone text; v_age int;
  v_imported int := 0; v_flagged int := 0; v_skipped int := 0; v_errors int := 0; v_new_pending int := 0;
  v_out jsonb := '[]'::jsonb; v_outcome text; v_prev text;
BEGIN
  s := private.google_sheets_lock_for_work(p_source, p_lease, p_version, p_generation);
  IF jsonb_typeof(COALESCE(p_rows, '[]')) <> 'array' OR jsonb_typeof(COALESCE(p_pending, '[]')) <> 'array'
     OR jsonb_array_length(COALESCE(p_rows, '[]')) > 50 OR jsonb_array_length(COALESCE(p_pending, '[]')) > 500 THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM private.google_sheets_dup_settings(s.organization_id);
  v_status := private.google_sheets_default_status(s.organization_id);
  -- Serialize Sheets duplicate evaluation + insertion for this agency (or agency+owner) scope.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'google_sheets_dup:' || s.organization_id::text || ':' ||
    CASE WHEN d.scope = 'assigned_only' THEN s.user_id::text ELSE '*' END, 0));

  -- Pending rows: counted as new errors only when new or changed (fingerprint/reason).
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_pending, '[]')) LOOP
    v_key := r->>'k';
    IF v_key IS NULL OR (s.identity_mode = 'source_id' AND v_key !~ '^(id|blank|dup):')
       OR (s.identity_mode = 'row_position' AND v_key !~ '^pos:[0-9]+$') THEN
      RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
    END IF;
    -- A blank-ID baseline row that later received an ID stays excluded under its new key.
    IF COALESCE((r->>'baseline')::boolean, false) THEN
      IF s.identity_mode <> 'source_id' OR v_key !~ '^id:.+' OR COALESCE(r->>'consume', '') !~ '^blank:[0-9]+$'
         OR NOT EXISTS (SELECT 1 FROM private.google_sheets_source_rows
                         WHERE source_id = s.id AND row_key = r->>'consume' AND kind = 'baseline') THEN
        RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
      END IF;
      INSERT INTO private.google_sheets_source_rows (source_id, row_key, row_number, fingerprint, kind)
      VALUES (s.id, v_key, (r->>'n')::int, r->>'f', 'baseline') ON CONFLICT (source_id, row_key) DO NOTHING;
      DELETE FROM private.google_sheets_source_rows WHERE source_id = s.id AND row_key = r->>'consume';
      CONTINUE;
    END IF;
    IF COALESCE((r->>'clear')::boolean, false) THEN
      DELETE FROM private.google_sheets_source_rows WHERE source_id = s.id AND row_key = v_key AND kind = 'pending';
      CONTINUE;
    END IF;
    v_prev := NULL;
    SELECT fingerprint || '|' || COALESCE(pending_reason, '') INTO v_prev
      FROM private.google_sheets_source_rows WHERE source_id = s.id AND row_key = v_key AND kind = 'pending';
    INSERT INTO private.google_sheets_source_rows AS t (source_id, row_key, row_number, fingerprint, kind, pending_reason)
    VALUES (s.id, v_key, (r->>'n')::int, r->>'f', 'pending', left(r->>'reason', 64))
    ON CONFLICT (source_id, row_key) DO UPDATE
       SET row_number = EXCLUDED.row_number, fingerprint = EXCLUDED.fingerprint,
           pending_reason = EXCLUDED.pending_reason, updated_at = now()
     WHERE t.kind = 'pending';
    IF v_prev IS DISTINCT FROM (r->>'f') || '|' || COALESCE(left(r->>'reason', 64), '') THEN
      v_new_pending := v_new_pending + 1;
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]')) LOOP
    v_key := r->>'k'; v_lead := r->'lead'; v_outcome := NULL;
    BEGIN
      IF s.identity_mode = 'source_id' THEN
        IF v_key IS NULL OR v_key !~ '^id:.+' THEN RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023'; END IF;
        v_rkey := v_key;
      ELSE
        IF v_key IS NULL OR v_key !~ '^pos:[0-9]+$' THEN RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023'; END IF;
        v_rkey := 'pos:' || s.id::text || ':' || s.row_epoch::text || ':' || substr(v_key, 5);
      END IF;
      -- Baseline (intentionally excluded) and done rows are never imported, in either mode.
      IF EXISTS (SELECT 1 FROM private.google_sheets_source_rows
                  WHERE source_id = s.id AND row_key = v_key AND kind IN ('baseline','done')) THEN
        v_out := v_out || jsonb_build_object('k', v_key, 'o', 'already'); CONTINUE;
      END IF;

      -- Core contract (defence in depth; the Edge validator is the primary check).
      v_first := btrim(COALESCE(v_lead->>'first_name', ''));
      v_last  := btrim(COALESCE(v_lead->>'last_name', ''));
      v_phone := regexp_replace(COALESCE(v_lead->>'phone', ''), '[^0-9]', '', 'g');
      IF v_first = '' OR v_last = '' OR v_phone = '' THEN RAISE EXCEPTION 'invalid_row' USING ERRCODE = 'P0003'; END IF;

      INSERT INTO private.google_sheets_receipts
        (organization_id, user_id, spreadsheet_id, sheet_id, receipt_key, outcome, source_id, fingerprint, row_number)
      VALUES (s.organization_id, s.user_id, s.spreadsheet_id, s.sheet_id, v_rkey, 'imported', s.id, r->>'f', (r->>'n')::int)
      ON CONFLICT (organization_id, user_id, spreadsheet_id, sheet_id, receipt_key) DO NOTHING
      RETURNING id INTO v_receipt;
      IF v_receipt IS NULL THEN
        v_out := v_out || jsonb_build_object('k', v_key, 'o', 'already'); CONTINUE;
      END IF;

      v_dup := private.google_sheets_find_duplicate(s.organization_id, s.user_id, d.rule, d.scope,
                                                    v_lead->>'phone', v_lead->>'email');
      v_cf := CASE WHEN jsonb_typeof(v_lead->'custom_fields') = 'object' THEN v_lead->'custom_fields' ELSE '{}'::jsonb END;
      v_cf := v_cf - 'additional_policies' - '__agentflow';

      IF v_dup IS NOT NULL AND d.action = 'skip' THEN
        UPDATE private.google_sheets_receipts SET outcome = 'skipped_duplicate' WHERE id = v_receipt;
        v_outcome := 'skipped'; v_skipped := v_skipped + 1;
      ELSE
        IF v_dup IS NOT NULL AND d.action = 'flag' THEN
          v_meta := jsonb_build_object('duplicateImport', true);
          v_tags := CASE WHEN jsonb_typeof(v_cf->'tags') = 'array'
                         THEN (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM jsonb_array_elements(v_cf->'tags') t
                                WHERE jsonb_typeof(t) = 'string')
                         ELSE '[]'::jsonb END;
          IF NOT v_tags @> '["Duplicate"]'::jsonb THEN v_tags := v_tags || '["Duplicate"]'::jsonb; END IF;
          v_cf := v_cf || jsonb_build_object('__agentflow', v_meta, 'tags', v_tags);
          v_outcome := 'flagged';
        ELSE
          v_outcome := 'imported';
        END IF;
        v_age := NULL;
        IF COALESCE(v_lead->>'age', '') ~ '^-?[0-9]{1,9}$' THEN v_age := (v_lead->>'age')::int; END IF;

        INSERT INTO public.leads
          (first_name, last_name, phone, email, state, notes, assigned_agent_id, organization_id, status,
           lead_source, lead_score, age, date_of_birth, best_time_to_call, custom_fields, user_id, imported_by_user_id)
        VALUES
          (v_first, v_last, COALESCE(v_lead->>'phone', ''), COALESCE(v_lead->>'email', ''),
           public.normalize_us_state(COALESCE(v_lead->>'state', '')),
           NULLIF(v_lead->>'notes', ''), s.user_id, s.organization_id, v_status,
           COALESCE(NULLIF(btrim(v_lead->>'lead_source'), ''), s.lead_source_default), 5, v_age,
           NULLIF(v_lead->>'date_of_birth', ''), NULLIF(v_lead->>'best_time_to_call', ''),
           CASE WHEN v_cf = '{}'::jsonb THEN NULL ELSE v_cf END, s.user_id, s.user_id)
        RETURNING id INTO v_lead_id;

        UPDATE private.google_sheets_receipts
           SET lead_id = v_lead_id, outcome = CASE WHEN v_outcome = 'flagged' THEN 'imported_flagged' ELSE 'imported' END
         WHERE id = v_receipt;
        v_imported := v_imported + 1;
        IF v_outcome = 'flagged' THEN v_flagged := v_flagged + 1; END IF;
      END IF;

      IF s.identity_mode = 'row_position' THEN
        INSERT INTO private.google_sheets_source_rows AS t (source_id, row_key, row_number, fingerprint, kind)
        VALUES (s.id, v_key, (r->>'n')::int, r->>'f', 'done')
        ON CONFLICT (source_id, row_key) DO UPDATE
           SET kind = 'done', fingerprint = EXCLUDED.fingerprint, pending_reason = NULL, updated_at = now();
      ELSE
        DELETE FROM private.google_sheets_source_rows
         WHERE source_id = s.id AND kind = 'pending' AND (row_key = v_key OR row_key = 'blank:' || (r->>'n'));
      END IF;
      v_out := v_out || jsonb_build_object('k', v_key, 'o', v_outcome, 'lead_id', v_lead_id);
    EXCEPTION
      WHEN invalid_parameter_value THEN RAISE;
      WHEN SQLSTATE 'P0003' THEN
        v_out := v_out || jsonb_build_object('k', v_key, 'o', 'error', 'reason', 'invalid_row');
        v_errors := v_errors + 1;
      WHEN OTHERS THEN
        v_out := v_out || jsonb_build_object('k', v_key, 'o', 'error', 'reason', 'insert_failed');
        v_errors := v_errors + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('imported', v_imported, 'flagged', v_flagged, 'skipped', v_skipped,
                            'errors', v_errors, 'new_pending', v_new_pending, 'rows', v_out);
END $$;

-- Health/result write for a run. Releases the lease whenever it still belongs to this worker; writes
-- status ONLY if the configuration version is unchanged (an old worker never overwrites a newer state).
CREATE FUNCTION private.google_sheets_finish(p_source uuid, p_lease uuid, p_version integer, p_trigger text, p_result jsonb)
 RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  s public.google_sheets_sources;
  v_health text := COALESCE(p_result->>'health', 'ok');
  v_backoff boolean := COALESCE((p_result->>'backoff')::boolean, false);
  v_backlog boolean := COALESCE((p_result->>'backlog')::boolean, false);
  v_code text := left(p_result->>'error_code', 64);
  v_fail int; v_next timestamptz;
BEGIN
  IF v_health NOT IN ('ok','needs_review','access_lost','error') OR p_trigger NOT IN ('schedule','manual','activation') THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.google_sheets_sources WHERE id = p_source FOR UPDATE;
  IF NOT FOUND OR s.lease_owner IS DISTINCT FROM p_lease THEN RETURN false; END IF;
  IF s.config_version <> p_version THEN
    UPDATE public.google_sheets_sources SET lease_owner = NULL, lease_expires_at = NULL WHERE id = s.id;
    RETURN false;
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
           'pending', COALESCE((p_result->>'pending')::int, 0), 'at', now()),
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
  RETURN true;
END $$;

-- Preview / mapping context for the owner (read-only).
CREATE FUNCTION private.google_sheets_context(p_user uuid, p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE d record; v_admin boolean;
BEGIN
  PERFORM private.google_sheets_require_owner(p_user, p_org);
  SELECT * INTO d FROM private.google_sheets_dup_settings(p_org);
  SELECT (p.role = 'Admin' OR COALESCE(p.is_super_admin, false)) INTO v_admin FROM public.profiles p WHERE p.id = p_user;
  RETURN jsonb_build_object(
    'duplicate_rule', d.rule, 'duplicate_scope', d.scope, 'duplicate_action', d.action,
    'default_status', private.google_sheets_default_status(p_org),
    'lead_sources', COALESCE((SELECT jsonb_agg(ls.name ORDER BY ls.sort_order, ls.name)
                                FROM public.lead_sources ls WHERE ls.organization_id = p_org AND ls.active), '[]'::jsonb),
    'has_lead_created_workflows', EXISTS (SELECT 1 FROM public.workflows w
                                           WHERE w.organization_id = p_org AND w.trigger_type = 'lead_created'
                                             AND w.status = 'active'),
    -- Same visibility as custom_fields_select for this user (agency-wide, own personal, all for Admin).
    'custom_fields', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name,
                                       'created_by', f.created_by, 'created_at', f.created_at))
                                 FROM public.custom_fields f
                                WHERE f.organization_id = p_org AND f.active
                                  AND f.applies_to @> '["Leads"]'::jsonb
                                  AND (f.created_by IS NULL OR f.created_by = p_user OR v_admin)), '[]'::jsonb));
END $$;

-- Read-only duplicate classification for preview rows, using the SAME predicate as ingest.
CREATE FUNCTION private.google_sheets_preview_duplicates(p_user uuid, p_org uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE d record;
BEGIN
  PERFORM private.google_sheets_require_owner(p_user, p_org);
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 50 THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM private.google_sheets_dup_settings(p_org);
  RETURN COALESCE((SELECT jsonb_agg(private.google_sheets_find_duplicate(p_org, p_user, d.rule, d.scope,
                                       r->>'phone', r->>'email') IS NOT NULL ORDER BY o)
                     FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(r, o)), '[]'::jsonb);
END $$;

-- Preview count of rows previously imported for this tab when re-adding with "include existing":
-- by core fingerprint (no-ID mode) or by stable receipt key (ID mode).
CREATE FUNCTION private.google_sheets_prior_receipt_count(p_user uuid, p_org uuid, p_spreadsheet text, p_sheet bigint,
  p_fps jsonb, p_keys jsonb DEFAULT '[]'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
BEGIN
  PERFORM private.google_sheets_require_owner(p_user, p_org);
  IF jsonb_array_length(COALESCE(p_fps, '[]')) + jsonb_array_length(COALESCE(p_keys, '[]')) > 20000 THEN
    RAISE EXCEPTION 'invalid_argument' USING ERRCODE = '22023';
  END IF;
  RETURN (SELECT count(*) FROM jsonb_array_elements_text(COALESCE(p_fps, '[]')) f
           WHERE EXISTS (SELECT 1 FROM private.google_sheets_receipts x
                          WHERE x.organization_id = p_org AND x.user_id = p_user AND x.spreadsheet_id = p_spreadsheet
                            AND x.sheet_id = p_sheet AND x.fingerprint = f))
       + (SELECT count(*) FROM jsonb_array_elements_text(COALESCE(p_keys, '[]')) k
           WHERE EXISTS (SELECT 1 FROM private.google_sheets_receipts x
                          WHERE x.organization_id = p_org AND x.user_id = p_user AND x.spreadsheet_id = p_spreadsheet
                            AND x.sheet_id = p_sheet AND x.receipt_key = k));
END $$;

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
-- Narrow PostgREST entry points for the Edge Functions. Each is SECURITY DEFINER, pins search_path and
-- delegates to the private helper; EXECUTE is granted to service_role only (see the ACL block below).
CREATE FUNCTION public.google_sheets_create_oauth_state(p_user uuid, p_org uuid, p_state_hash text, p_verifier_enc text, p_return_origin text)
 RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT private.google_sheets_create_oauth_state(p_user, p_org, p_state_hash, p_verifier_enc, p_return_origin) $$;

CREATE FUNCTION public.google_sheets_consume_oauth_state(p_state_hash text)
 RETURNS TABLE (user_id uuid, organization_id uuid, auth_generation bigint, return_origin text, verifier_enc text)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT * FROM private.google_sheets_consume_oauth_state(p_state_hash) $$;

CREATE FUNCTION public.google_sheets_store_connection(p_user uuid, p_org uuid, p_expected_generation bigint,
  p_google_sub text, p_google_email text, p_scopes text[], p_refresh_token text)
 RETURNS TABLE (connection_id uuid, auth_generation bigint, outcome text)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT * FROM private.google_sheets_store_connection(p_user, p_org, p_expected_generation, p_google_sub,
                                                            p_google_email, p_scopes, p_refresh_token) $$;

CREATE FUNCTION public.google_sheets_get_refresh_token(p_connection uuid)
 RETURNS TABLE (refresh_token text, auth_generation bigint, user_id uuid, organization_id uuid)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT * FROM private.google_sheets_get_refresh_token(p_connection) $$;

CREATE FUNCTION public.google_sheets_mark_reconnect(p_connection uuid, p_generation bigint, p_code text)
 RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT private.google_sheets_mark_reconnect(p_connection, p_generation, p_code) $$;

CREATE FUNCTION public.google_sheets_disconnect(p_user uuid, p_org uuid)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT private.google_sheets_disconnect(p_user, p_org) $$;

CREATE FUNCTION public.google_sheets_save_source(p_user uuid, p_org uuid, p_source uuid, p_expected_version integer, p_payload jsonb)
 RETURNS TABLE (source_id uuid, config_version integer)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT * FROM private.google_sheets_save_source(p_user, p_org, p_source, p_expected_version, p_payload) $$;

CREATE FUNCTION public.google_sheets_activate(p_user uuid, p_org uuid, p_source uuid, p_expected_version integer,
  p_generation bigint, p_rows jsonb, p_row_count integer)
 RETURNS TABLE (outcome text, config_version integer, baselined integer)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT * FROM private.google_sheets_activate(p_user, p_org, p_source, p_expected_version, p_generation, p_rows, p_row_count) $$;

CREATE FUNCTION public.google_sheets_set_state(p_user uuid, p_org uuid, p_source uuid, p_action text)
 RETURNS TABLE (state text, config_version integer)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT * FROM private.google_sheets_set_state(p_user, p_org, p_source, p_action) $$;

CREATE FUNCTION public.google_sheets_review(p_user uuid, p_org uuid, p_source uuid, p_expected_version integer,
  p_identity_mode text, p_id_header text, p_mapping jsonb, p_rows jsonb, p_import_unknown boolean, p_dry_run boolean)
 RETURNS TABLE (known integer, unknown integer, config_version integer)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT * FROM private.google_sheets_review(p_user, p_org, p_source, p_expected_version, p_identity_mode,
                                                 p_id_header, p_mapping, p_rows, p_import_unknown, p_dry_run) $$;

CREATE FUNCTION public.google_sheets_claim(p_lease uuid, p_limit integer, p_source uuid DEFAULT NULL,
  p_user uuid DEFAULT NULL, p_org uuid DEFAULT NULL)
 RETURNS TABLE (source_id uuid, organization_id uuid, user_id uuid, connection_id uuid, auth_generation bigint,
                spreadsheet_id text, sheet_id bigint, mapping jsonb, identity_mode text, id_header text,
                lead_source_default text, config_version integer, phase text, row_epoch integer)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT * FROM private.google_sheets_claim(p_lease, p_limit, p_source, p_user, p_org) $$;

CREATE FUNCTION public.google_sheets_load_state(p_source uuid, p_lease uuid)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT private.google_sheets_load_state(p_source, p_lease) $$;

CREATE FUNCTION public.google_sheets_ingest(p_source uuid, p_lease uuid, p_version integer, p_generation bigint,
  p_rows jsonb, p_pending jsonb)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT private.google_sheets_ingest(p_source, p_lease, p_version, p_generation, p_rows, p_pending) $$;

CREATE FUNCTION public.google_sheets_finish(p_source uuid, p_lease uuid, p_version integer, p_trigger text, p_result jsonb)
 RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT private.google_sheets_finish(p_source, p_lease, p_version, p_trigger, p_result) $$;

CREATE FUNCTION public.google_sheets_context(p_user uuid, p_org uuid)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT private.google_sheets_context(p_user, p_org) $$;

CREATE FUNCTION public.google_sheets_preview_duplicates(p_user uuid, p_org uuid, p_rows jsonb)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT private.google_sheets_preview_duplicates(p_user, p_org, p_rows) $$;

CREATE FUNCTION public.google_sheets_prior_receipt_count(p_user uuid, p_org uuid, p_spreadsheet text, p_sheet bigint,
  p_fps jsonb, p_keys jsonb DEFAULT '[]'::jsonb)
 RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT private.google_sheets_prior_receipt_count(p_user, p_org, p_spreadsheet, p_sheet, p_fps, p_keys) $$;

-- Owner-eligibility probe for the Edge layer (status + gating of user actions).
CREATE FUNCTION public.google_sheets_owner_eligible(p_user uuid, p_org uuid)
 RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $$ SELECT private.google_sheets_owner_eligible(p_user, p_org) $$;

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
