-- Disposable localhost fixture ONLY. No production rows.
-- Column definitions/policies and dependency functions captured read-only 2026-10-03.
-- This focused harness is not a full migration-history replay.
CREATE SCHEMA auth; CREATE SCHEMA private;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(nullif(current_setting('request.jwt.claims',true),'')::json->>'sub','')::uuid $$;
CREATE EXTENSION ltree;
CREATE TABLE public.organizations(id uuid PRIMARY KEY,name text);
CREATE TABLE public.profiles(id uuid PRIMARY KEY,organization_id uuid,role text,status text DEFAULT 'Active',is_super_admin boolean DEFAULT false,twilio_client_identity text UNIQUE,hierarchy_path ltree);
CREATE TABLE public.agency_group_members(agency_group_id uuid,organization_id uuid,status text);
CREATE TABLE public.pipeline_stages(id uuid PRIMARY KEY,organization_id uuid,name text,convert_to_client boolean DEFAULT false);
CREATE TABLE public.agent_state_licenses(agent_id uuid,organization_id uuid,state text);
CREATE TABLE public.phone_numbers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,phone_number text,status text DEFAULT 'active',assignment_type text DEFAULT 'agency',assigned_to uuid);
CREATE TABLE public.campaign_lead_agent_suppressions(campaign_lead_id uuid,campaign_id uuid,organization_id uuid,agent_id uuid,suppressed_until timestamptz);


CREATE TABLE public.campaigns (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  name text NOT NULL,
  type text DEFAULT 'Personal'::text NOT NULL,
  status text DEFAULT 'Draft'::text NOT NULL,
  description text DEFAULT ''::text,
  assigned_agent_ids jsonb DEFAULT '[]'::jsonb,
  created_by uuid,
  total_leads integer DEFAULT 0,
  leads_contacted integer DEFAULT 0,
  leads_converted integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  tags jsonb DEFAULT '[]'::jsonb,
  auto_dial_enabled boolean DEFAULT true,
  local_presence_enabled boolean DEFAULT true,
  max_attempts integer,
  calling_hours_start time without time zone DEFAULT '08:00:00'::time without time zone,
  calling_hours_end time without time zone DEFAULT '21:00:00'::time without time zone,
  retry_interval_hours integer DEFAULT 24,
  organization_id uuid,
  user_id uuid DEFAULT auth.uid(),
  ring_timeout_seconds integer,
  leads_called integer DEFAULT 0 NOT NULL,
  number_group_id uuid,
  queue_filters jsonb DEFAULT '{}'::jsonb NOT NULL,
  retry_interval_minutes integer DEFAULT 1440 NOT NULL,
  settings_edit_policy text DEFAULT 'creator_and_admins'::text NOT NULL,
  require_licensed_state_access boolean DEFAULT false NOT NULL
);

CREATE TABLE public.leads (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  first_name text DEFAULT ''::text NOT NULL,
  last_name text DEFAULT ''::text NOT NULL,
  phone text DEFAULT ''::text NOT NULL,
  email text DEFAULT ''::text NOT NULL,
  state text DEFAULT ''::text NOT NULL,
  status text DEFAULT 'New'::text NOT NULL,
  lead_source text DEFAULT ''::text NOT NULL,
  lead_score integer DEFAULT 5 NOT NULL,
  age integer,
  date_of_birth text,
  best_time_to_call text,
  spouse_info jsonb,
  notes text,
  assigned_agent_id uuid,
  last_contacted_at text,
  custom_fields jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  organization_id uuid,
  user_id uuid,
  imported_by_user_id uuid
);

-- Only identity columns are needed for standalone recruit call validation.
CREATE TABLE public.recruits (id uuid PRIMARY KEY, organization_id uuid NOT NULL);
CREATE TABLE public.clients (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  first_name text DEFAULT ''::text NOT NULL,
  last_name text DEFAULT ''::text NOT NULL,
  phone text DEFAULT ''::text NOT NULL,
  email text DEFAULT ''::text NOT NULL,
  policy_type text DEFAULT 'Term'::text NOT NULL,
  carrier text DEFAULT ''::text,
  policy_number text DEFAULT ''::text,
  premium numeric DEFAULT 0,
  beneficiary_name text DEFAULT ''::text,
  beneficiary_relationship text DEFAULT ''::text,
  beneficiary_phone text DEFAULT ''::text,
  notes text DEFAULT ''::text,
  assigned_agent_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  face_amount numeric DEFAULT 0,
  issue_date text,
  effective_date text,
  custom_fields jsonb,
  lead_id uuid,
  premium_amount numeric DEFAULT 0,
  organization_id uuid,
  state text,
  sold_date date,
  draft_date date,
  payment_frequency text
);

CREATE TABLE public.campaign_leads (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  campaign_id uuid NOT NULL,
  lead_id uuid,
  first_name text DEFAULT ''::text,
  last_name text DEFAULT ''::text,
  phone text DEFAULT ''::text,
  email text DEFAULT ''::text,
  state text DEFAULT ''::text,
  age integer,
  source text DEFAULT ''::text,
  status text DEFAULT 'Queued'::text,
  locked_by uuid,
  locked_at timestamp with time zone,
  claimed_by uuid,
  claimed_at timestamp with time zone,
  call_attempts integer DEFAULT 0,
  last_called_at timestamp with time zone,
  disposition text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  sort_order integer DEFAULT 0,
  organization_id uuid,
  user_id uuid DEFAULT auth.uid(),
  scheduled_callback_at timestamp with time zone,
  callback_due_at timestamp with time zone,
  retry_eligible_at timestamp with time zone,
  callback_agent_id uuid,
  callback_note text,
  last_advance_call_id uuid,
  import_history_id uuid
);

CREATE TABLE public.calls (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  contact_id uuid,
  contact_type text DEFAULT 'lead'::text,
  contact_name text DEFAULT ''::text,
  contact_phone text DEFAULT ''::text,
  agent_id uuid,
  campaign_id uuid,
  campaign_lead_id uuid,
  direction text DEFAULT 'outbound'::text,
  duration integer DEFAULT 0,
  recording_url text,
  disposition_id uuid,
  disposition_name text,
  notes text DEFAULT ''::text,
  outcome text DEFAULT ''::text,
  started_at timestamp with time zone DEFAULT now(),
  ended_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  status text DEFAULT 'completed'::text,
  caller_id_used text,
  amd_result text,
  provider_session_id text,
  transcript jsonb,
  sip_response_code integer,
  shaken_stir text,
  provider_error_code text,
  hangup_details text,
  quality_percentage numeric,
  mos numeric,
  pdd_seconds numeric,
  flagged_for_coaching boolean DEFAULT false,
  is_missed boolean DEFAULT false,
  organization_id uuid,
  updated_at timestamp with time zone DEFAULT now(),
  twilio_call_sid text,
  lead_id uuid,
  recording_storage_path text,
  recording_duration integer,
  routed_agent_ids uuid[],
  recording_source_sid text,
  answered_by_agent_id uuid,
  missed_reason text,
  missed_for_agent_id uuid,
  missed_recipient_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  missed_notified_at timestamp with time zone,
  missed_notify_attempts integer DEFAULT 0 NOT NULL,
  missed_notify_next_at timestamp with time zone,
  missed_notify_error text,
  routing_engine text,
  voicemail_id uuid
);

CREATE TABLE public.dispositions (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  name text NOT NULL,
  color text DEFAULT '#3B82F6'::text NOT NULL,
  require_notes boolean DEFAULT false NOT NULL,
  min_note_chars integer DEFAULT 0 NOT NULL,
  callback_scheduler boolean DEFAULT false NOT NULL,
  automation_trigger boolean DEFAULT false NOT NULL,
  automation_id text,
  automation_name text,
  usage_count integer DEFAULT 0 NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  appointment_scheduler boolean DEFAULT false NOT NULL,
  is_locked boolean DEFAULT false NOT NULL,
  remove_from_queue boolean DEFAULT false NOT NULL,
  auto_add_to_dnc boolean DEFAULT false NOT NULL,
  organization_id uuid NOT NULL,
  campaign_action text DEFAULT 'none'::text NOT NULL,
  dnc_auto_add boolean DEFAULT false NOT NULL,
  pipeline_stage_id uuid,
  counts_as_contacted boolean DEFAULT false NOT NULL
);

CREATE TABLE public.dnc_list (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  phone_number text NOT NULL,
  reason text,
  added_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  organization_id uuid NOT NULL
);

CREATE TABLE public.contact_activities (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  contact_id uuid NOT NULL,
  contact_type text DEFAULT 'lead'::text NOT NULL,
  activity_type text DEFAULT ''::text NOT NULL,
  description text DEFAULT ''::text NOT NULL,
  agent_id uuid,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  organization_id uuid
);

CREATE TABLE public.dialer_lead_locks (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  campaign_lead_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  locked_by uuid NOT NULL,
  organization_id uuid NOT NULL,
  locked_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  queue_issued_at timestamp with time zone
);

ALTER TABLE public.dnc_list ADD UNIQUE(organization_id,phone_number);

ALTER TABLE public.dialer_lead_locks ADD UNIQUE(campaign_lead_id);

CREATE OR REPLACE FUNCTION public.get_org_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
BEGIN
  -- Primary: JWT claim (fast path — no table access)
  v_org := NULLIF(
    current_setting('request.jwt.claims', true)::json
      ->'app_metadata'->>'organization_id',
    ''
  )::uuid;

  IF v_org IS NOT NULL THEN
    RETURN v_org;
  END IF;

  -- Fallback: profile table lookup (handles stale/missing JWT claims)
  SELECT organization_id INTO v_org
  FROM public.profiles
  WHERE id = auth.uid();

  RETURN v_org;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_org_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT organization_id FROM profiles WHERE id = auth.uid()
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_role()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->'app_metadata'->>'role', '');
$function$
;

CREATE OR REPLACE FUNCTION public.is_agency_group_peer_organization(p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.agency_group_members m1
    INNER JOIN public.agency_group_members m2
      ON m1.agency_group_id = m2.agency_group_id
      AND m2.status = 'active'
    WHERE m1.organization_id = public.get_org_id()
      AND m1.status = 'active'
      AND m2.organization_id = p_org_id
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_ancestor_of(ancestor_id uuid, descendant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles d
    WHERE d.id = descendant_id
    AND d.hierarchy_path <@ (
      SELECT p.hierarchy_path FROM public.profiles p WHERE p.id = ancestor_id
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::json->>'is_super_admin')::BOOLEAN,
    false
  );
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_us_state(p_raw text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_trim  text;
  v_upper text;
  v_code  text;
BEGIN
  IF p_raw IS NULL OR btrim(p_raw) = '' THEN
    RETURN p_raw;
  END IF;

  v_trim  := btrim(p_raw);
  v_upper := upper(v_trim);

  IF v_upper IN (
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
    'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
    'VA','WA','WV','WI','WY','DC'
  ) THEN
    RETURN v_upper;
  END IF;

  v_code := CASE lower(v_trim)
    WHEN 'alabama'              THEN 'AL'
    WHEN 'alaska'              THEN 'AK'
    WHEN 'arizona'             THEN 'AZ'
    WHEN 'arkansas'            THEN 'AR'
    WHEN 'california'          THEN 'CA'
    WHEN 'colorado'            THEN 'CO'
    WHEN 'connecticut'         THEN 'CT'
    WHEN 'delaware'            THEN 'DE'
    WHEN 'florida'             THEN 'FL'
    WHEN 'georgia'             THEN 'GA'
    WHEN 'hawaii'              THEN 'HI'
    WHEN 'idaho'               THEN 'ID'
    WHEN 'illinois'            THEN 'IL'
    WHEN 'indiana'             THEN 'IN'
    WHEN 'iowa'                THEN 'IA'
    WHEN 'kansas'              THEN 'KS'
    WHEN 'kentucky'            THEN 'KY'
    WHEN 'louisiana'           THEN 'LA'
    WHEN 'maine'               THEN 'ME'
    WHEN 'maryland'            THEN 'MD'
    WHEN 'massachusetts'       THEN 'MA'
    WHEN 'michigan'            THEN 'MI'
    WHEN 'minnesota'           THEN 'MN'
    WHEN 'mississippi'         THEN 'MS'
    WHEN 'missouri'            THEN 'MO'
    WHEN 'montana'             THEN 'MT'
    WHEN 'nebraska'            THEN 'NE'
    WHEN 'nevada'              THEN 'NV'
    WHEN 'new hampshire'       THEN 'NH'
    WHEN 'new jersey'          THEN 'NJ'
    WHEN 'new mexico'          THEN 'NM'
    WHEN 'new york'            THEN 'NY'
    WHEN 'north carolina'      THEN 'NC'
    WHEN 'north dakota'        THEN 'ND'
    WHEN 'ohio'                THEN 'OH'
    WHEN 'oklahoma'            THEN 'OK'
    WHEN 'oregon'              THEN 'OR'
    WHEN 'pennsylvania'        THEN 'PA'
    WHEN 'rhode island'        THEN 'RI'
    WHEN 'south carolina'      THEN 'SC'
    WHEN 'south dakota'        THEN 'SD'
    WHEN 'tennessee'           THEN 'TN'
    WHEN 'texas'               THEN 'TX'
    WHEN 'utah'                THEN 'UT'
    WHEN 'vermont'             THEN 'VT'
    WHEN 'virginia'            THEN 'VA'
    WHEN 'washington'          THEN 'WA'
    WHEN 'west virginia'       THEN 'WV'
    WHEN 'wisconsin'           THEN 'WI'
    WHEN 'wyoming'             THEN 'WY'
    WHEN 'district of columbia' THEN 'DC'
    ELSE NULL
  END;

  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  RETURN p_raw;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.super_admin_own_org(row_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN row_org IS NULL THEN false
    WHEN NOT public.is_super_admin() THEN false
    WHEN public.get_org_id() IS NULL THEN false
    ELSE row_org = public.get_org_id()
  END;
$function$
;

CREATE OR REPLACE FUNCTION public.advance_campaign_lead(p_campaign_lead_id uuid, p_call_id uuid DEFAULT NULL::uuid, p_disposition_id uuid DEFAULT NULL::uuid, p_callback_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_callback_note text DEFAULT NULL::text, p_release_lock boolean DEFAULT true)
 RETURNS campaign_leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org           uuid := public.get_org_id();
  v_uid           uuid := auth.uid();
  v_cl            public.campaign_leads;
  v_max_attempts  integer;
  v_retry_minutes integer;
  v_campaign_action text;
  v_dnc_auto_add    boolean := false;
  v_callback_sched  boolean := false;
  v_appt_sched      boolean := false;
  v_is_convert      boolean := false;
  v_already       boolean;
  v_new_attempts  integer;
  v_status        text;
  v_retry_at      timestamptz;
  v_cb_due        timestamptz := NULL;
  v_cb_sched      timestamptz := NULL;
  v_cb_agent      uuid := NULL;
  v_cb_note       text := NULL;
  v_result        public.campaign_leads;
BEGIN
  IF v_org IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_cl
  FROM public.campaign_leads
  WHERE id = p_campaign_lead_id
    AND organization_id = v_org
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT c.max_attempts,
         COALESCE(NULLIF(c.retry_interval_minutes, 0),
                  NULLIF(c.retry_interval_hours, 0) * 60,
                  1440)
  INTO v_max_attempts, v_retry_minutes
  FROM public.campaigns c
  WHERE c.id = v_cl.campaign_id
    AND c.organization_id = v_org;

  IF v_retry_minutes IS NULL OR v_retry_minutes <= 0 THEN
    v_retry_minutes := 1440;
  END IF;

  IF p_disposition_id IS NOT NULL THEN
    SELECT d.campaign_action,
           COALESCE(d.dnc_auto_add, false),
           COALESCE(d.callback_scheduler, false),
           COALESCE(d.appointment_scheduler, false),
           COALESCE(ps.convert_to_client, false)
    INTO v_campaign_action, v_dnc_auto_add, v_callback_sched, v_appt_sched, v_is_convert
    FROM public.dispositions d
    LEFT JOIN public.pipeline_stages ps ON ps.id = d.pipeline_stage_id
    WHERE d.id = p_disposition_id
      AND d.organization_id = v_org;
  END IF;

  v_already := (p_call_id IS NOT NULL
                AND v_cl.last_advance_call_id IS NOT DISTINCT FROM p_call_id);
  v_new_attempts := COALESCE(v_cl.call_attempts, 0) + (CASE WHEN v_already THEN 0 ELSE 1 END);

  IF v_is_convert THEN
    v_status := 'Completed';  v_retry_at := NULL;
  ELSIF v_dnc_auto_add THEN
    v_status := 'DNC';        v_retry_at := NULL;
  ELSIF v_campaign_action = 'remove_from_campaign' THEN
    v_status := 'Removed';    v_retry_at := NULL;
  ELSIF v_callback_sched THEN
    v_status := 'Called';     v_retry_at := NULL;
    v_cb_due := p_callback_due_at;  v_cb_sched := p_callback_due_at;  v_cb_agent := v_uid;
    v_cb_note := NULLIF(btrim(COALESCE(p_callback_note, '')), '');
  ELSIF v_appt_sched THEN
    v_status := 'Called';     v_retry_at := NULL;
  ELSE
    v_retry_at := now() + make_interval(mins => v_retry_minutes);
    IF v_max_attempts IS NOT NULL AND v_new_attempts >= v_max_attempts THEN
      v_status := 'Completed';
    ELSE
      v_status := 'Called';
    END IF;
  END IF;

  UPDATE public.campaign_leads
  SET call_attempts       = v_new_attempts,
      last_called_at      = now(),
      retry_eligible_at   = v_retry_at,
      status              = v_status,
      callback_due_at     = v_cb_due,
      scheduled_callback_at = v_cb_sched,
      callback_agent_id   = v_cb_agent,
      callback_note       = v_cb_note,
      last_advance_call_id = COALESCE(p_call_id, last_advance_call_id),
      updated_at          = now()
  WHERE id = p_campaign_lead_id
    AND organization_id = v_org
  RETURNING * INTO v_result;

  IF p_release_lock THEN
    PERFORM public.release_lead_lock(p_campaign_lead_id);
  END IF;

  RETURN v_result;
END;
$function$
;

ALTER FUNCTION public.advance_campaign_lead(p_campaign_lead_id uuid, p_call_id uuid, p_disposition_id uuid, p_callback_due_at timestamp with time zone, p_callback_note text, p_release_lock boolean) OWNER TO postgres;

CREATE OR REPLACE FUNCTION private.campaign_actor()
 RETURNS TABLE(uid uuid, org_id uuid, actor_role text, is_super boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid := public.get_org_id();
  v_p   RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'no organization context' USING ERRCODE = '42501';
  END IF;

  SELECT p.role, p.organization_id, COALESCE(p.is_super_admin, false) AS isa, p.status
    INTO v_p
    FROM public.profiles p
   WHERE p.id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = '42501';
  END IF;
  IF v_p.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'organization mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_p.status IS DISTINCT FROM 'Active' THEN
    RAISE EXCEPTION 'profile is not active' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT v_uid, v_org, v_p.role, v_p.isa;
END;
$function$
;

ALTER FUNCTION private.campaign_actor() OWNER TO postgres;

REVOKE ALL ON FUNCTION private.campaign_actor() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.can_dial_campaign(p_campaign_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_actor    RECORD;
  v_campaign public.campaigns%ROWTYPE;
  v_type     text;
BEGIN
  IF p_campaign_id IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    SELECT * INTO v_actor FROM private.campaign_actor();
  EXCEPTION WHEN OTHERS THEN
    RETURN false;  -- unauthenticated / inactive / no-org / org mismatch → fail closed
  END;

  SELECT * INTO v_campaign
    FROM public.campaigns
   WHERE id = p_campaign_id
     AND organization_id = v_actor.org_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_type := upper(btrim(COALESCE(v_campaign.type, '')));

  IF v_type IN ('OPEN POOL', 'OPEN') THEN
    RETURN true;
  END IF;

  IF v_type = 'PERSONAL' THEN
    RETURN v_campaign.user_id = v_actor.uid;   -- owner only. No admin/viewAll escape.
  END IF;

  IF v_type = 'TEAM' THEN
    RETURN v_actor.uid::text IN (
      SELECT jsonb_array_elements_text(COALESCE(v_campaign.assigned_agent_ids, '[]'::jsonb))
    );
  END IF;

  RETURN false;
END;
$function$
;

ALTER FUNCTION public.can_dial_campaign(p_campaign_id uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.claim_lead(p_campaign_lead_id uuid, p_lead_id uuid, p_campaign_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
BEGIN
  v_org_id := public.get_org_id();

  IF NOT EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE id = p_campaign_id AND organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'claim_lead: campaign not found or org mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.campaign_leads
    WHERE id = p_campaign_lead_id
      AND campaign_id = p_campaign_id
      AND organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'claim_lead: campaign_lead not found or org mismatch';
  END IF;

  UPDATE public.leads
  SET assigned_agent_id = auth.uid(),
      updated_at        = now()
  WHERE id              = p_lead_id
    AND organization_id = v_org_id;
END;
$function$
;

ALTER FUNCTION public.claim_lead(p_campaign_lead_id uuid, p_lead_id uuid, p_campaign_id uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.fetch_and_lock_next_lead(p_campaign_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS SETOF campaign_leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- DEPRECATED (Build 1): legacy alias retained for compatibility.
  -- All claim/lock logic now lives in public.get_next_queue_lead.
  RETURN QUERY SELECT * FROM public.get_next_queue_lead(p_campaign_id, p_filters);
END;
$function$
;

ALTER FUNCTION public.fetch_and_lock_next_lead(p_campaign_id uuid, p_filters jsonb) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.get_next_queue_lead(p_campaign_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS SETOF campaign_leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org            uuid := public.get_org_id();
  v_uid            uuid := auth.uid();
  v_campaign       RECORD;
  v_ctype          text;
  v_locked_id      uuid;
  v_result         public.campaign_leads;
  v_claimed_id     uuid;
  v_retry_minutes  integer;
  v_filter_state   text;
  v_filter_source  text;
  v_filter_status  text;
  v_filter_max_att integer;
  v_require_licensed boolean := false;
  v_licensed_states  text[]  := '{}';
BEGIN
  DELETE FROM public.dialer_lead_locks
  WHERE campaign_id = p_campaign_id
    AND expires_at <= now();

  SELECT c.id,
         upper(trim(c.type)) AS ctype,
         c.assigned_agent_ids,
         c.organization_id,
         c.max_attempts,
         c.require_licensed_state_access,
         COALESCE(NULLIF(c.retry_interval_minutes, 0), NULLIF(c.retry_interval_hours, 0) * 60, 1440) AS retry_minutes
  INTO v_campaign
  FROM public.campaigns c
  WHERE c.id = p_campaign_id
    AND c.organization_id = v_org;

  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_ctype := v_campaign.ctype;
  v_retry_minutes := CASE WHEN v_campaign.retry_minutes > 0 THEN v_campaign.retry_minutes ELSE 1440 END;

  IF v_ctype = 'TEAM' THEN
    IF NOT (
      v_uid::text = ANY (
        ARRAY(SELECT jsonb_array_elements_text(v_campaign.assigned_agent_ids))
      )
    ) THEN
      RETURN;
    END IF;
  END IF;

  v_require_licensed := COALESCE(v_campaign.require_licensed_state_access, false);
  IF v_require_licensed THEN
    SELECT COALESCE(array_agg(DISTINCT x.s), '{}')
    INTO v_licensed_states
    FROM (
      SELECT upper(public.normalize_us_state(asl.state)) AS s
      FROM public.agent_state_licenses asl
      WHERE asl.agent_id = v_uid
        AND asl.organization_id = v_org
    ) x
    WHERE x.s ~ '^[A-Z]{2}$';
  END IF;

  v_filter_state   := NULLIF(p_filters->>'state', '');
  v_filter_source  := NULLIF(p_filters->>'lead_source', '');
  v_filter_status  := NULLIF(p_filters->>'status', '');
  v_filter_max_att := NULLIF(p_filters->>'max_attempts', '')::integer;

  SELECT cl.id
  INTO v_locked_id
  FROM public.campaign_leads cl
  JOIN public.leads l ON l.id = cl.lead_id
  WHERE cl.campaign_id = p_campaign_id
    AND cl.organization_id = v_org
    AND cl.status NOT IN ('DNC', 'Completed', 'Removed', 'Failed')
    AND (v_campaign.max_attempts IS NULL
         OR COALESCE(cl.call_attempts, 0) < v_campaign.max_attempts)
    AND (cl.retry_eligible_at IS NULL OR cl.retry_eligible_at <= now())
    -- Calls exist before the browser saves a disposition. Enforce the retry
    -- globally from the canonical call record, even when advancement failed.
    AND (
      (cl.callback_agent_id = v_uid
       AND COALESCE(cl.callback_due_at, cl.scheduled_callback_at) <= now() + interval '5 minutes')
      OR NOT EXISTS (
      SELECT 1 FROM public.calls recent
      WHERE recent.campaign_lead_id = cl.id
        AND recent.campaign_id = p_campaign_id
        AND recent.direction = 'outbound'
        AND (
          (recent.ended_at IS NOT NULL OR recent.status IN ('completed', 'no-answer', 'busy', 'failed', 'canceled'))
          AND COALESCE(recent.ended_at, recent.started_at) + make_interval(mins => v_retry_minutes) > now()
          OR
          (recent.ended_at IS NULL AND recent.status NOT IN ('completed', 'no-answer', 'busy', 'failed', 'canceled')
           AND recent.started_at > now() - interval '30 minutes')
        )
      )
    )
    AND (cl.callback_agent_id IS NULL OR cl.callback_agent_id = v_uid)
    AND (l.assigned_agent_id IS NULL OR l.assigned_agent_id = v_uid)
    AND NOT EXISTS (
      SELECT 1 FROM public.dialer_lead_locks dll
      WHERE dll.campaign_lead_id = cl.id
        AND dll.expires_at > now()
        AND dll.locked_by <> v_uid
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.campaign_lead_agent_suppressions s
      WHERE s.campaign_lead_id = cl.id
        AND s.agent_id = v_uid
        AND s.suppressed_until > now()
    )
    AND (v_filter_status IS NULL OR cl.status = v_filter_status)
    AND (v_filter_state  IS NULL
         OR cl.state = v_filter_state
         OR (cl.state IS NULL AND l.state = v_filter_state))
    AND (v_filter_source IS NULL OR l.lead_source = v_filter_source)
    AND (v_filter_max_att IS NULL OR COALESCE(cl.call_attempts, 0) <= v_filter_max_att)
    AND (
      NOT v_require_licensed
      OR NULLIF(btrim(public.normalize_us_state(cl.state)), '') IS NULL
      OR upper(public.normalize_us_state(cl.state)) = ANY (v_licensed_states)
    )
  ORDER BY
    CASE
      WHEN COALESCE(cl.callback_due_at, cl.scheduled_callback_at) IS NOT NULL
           AND cl.callback_agent_id = v_uid
           AND COALESCE(cl.callback_due_at, cl.scheduled_callback_at) <= now() + interval '5 minutes'
        THEN 0
      WHEN COALESCE(cl.call_attempts, 0) = 0 THEN 1
      ELSE 2
    END,
    COALESCE(cl.callback_due_at, cl.scheduled_callback_at) ASC NULLS LAST,
    cl.last_called_at ASC NULLS FIRST,
    cl.created_at ASC
  LIMIT 1
  FOR UPDATE OF cl SKIP LOCKED;

  IF v_locked_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.dialer_lead_locks
    (campaign_lead_id, locked_by, campaign_id, organization_id, expires_at, queue_issued_at)
  VALUES
    (v_locked_id, v_uid, p_campaign_id, v_org, now() + interval '5 minutes', now())
  ON CONFLICT (campaign_lead_id) DO UPDATE
    SET expires_at = EXCLUDED.expires_at,
        queue_issued_at = EXCLUDED.queue_issued_at
    WHERE dialer_lead_locks.locked_by = EXCLUDED.locked_by
      AND dialer_lead_locks.expires_at > now()
  RETURNING campaign_lead_id INTO v_claimed_id;

  -- A conflict owned by another agent returns no row. Never hand out that lead.
  IF v_claimed_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_result FROM public.campaign_leads WHERE id = v_locked_id;
  RETURN NEXT v_result;
  RETURN;
END;
$function$
;

ALTER FUNCTION public.get_next_queue_lead(p_campaign_id uuid, p_filters jsonb) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.get_queue_metrics(p_campaign_id uuid)
 RETURNS TABLE(total_leads integer, eligible_leads integer, locked_leads integer, active_agents integer, available_leads integer, suppressed_for_current_agent integer, retry_blocked_leads integer, callback_waiting_leads integer, next_eligible_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org            uuid := public.get_org_id();
  v_uid            uuid := auth.uid();
  v_campaign       RECORD;
  v_ctype          text;
  -- Manager queue_filters (same supported keys as get_next_queue_lead).
  v_filter_state   text;
  v_filter_source  text;
  v_filter_status  text;
  v_filter_max_att integer;
BEGIN
  -- Load campaign, org-scoped (incl. queue_filters so metrics match the claim path).
  SELECT c.id,
         upper(trim(c.type))    AS ctype,
         c.assigned_agent_ids,
         c.organization_id,
         c.max_attempts,
         c.queue_filters
  INTO v_campaign
  FROM public.campaigns c
  WHERE c.id = p_campaign_id
    AND c.organization_id = v_org;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0, 0, 0, 0, 0, 0, 0, NULL::timestamptz;
    RETURN;
  END IF;
  v_ctype := v_campaign.ctype;

  -- Parse the stored manager filters (tolerant; absent/empty key = no filter).
  -- Mirrors get_next_queue_lead exactly. min_score/max_score are intentionally
  -- NOT applied here because the canonical claim RPC does not apply them either.
  v_filter_state   := NULLIF(v_campaign.queue_filters->>'state', '');
  v_filter_source  := NULLIF(v_campaign.queue_filters->>'lead_source', '');
  v_filter_status  := NULLIF(v_campaign.queue_filters->>'status', '');
  v_filter_max_att := NULLIF(v_campaign.queue_filters->>'max_attempts', '')::integer;

  -- TEAM eligibility gate: caller must be assigned. Return only the non-
  -- agent-specific total so the panel can still say "N total / 0 available".
  IF v_ctype = 'TEAM'
     AND NOT (
       v_uid::text = ANY (
         ARRAY(SELECT jsonb_array_elements_text(v_campaign.assigned_agent_ids))
       )
     ) THEN
    RETURN QUERY
      SELECT (SELECT count(*)::int
                FROM public.campaign_leads cl
               WHERE cl.campaign_id = p_campaign_id
                 AND cl.organization_id = v_org),
             0, 0, 0, 0, 0, 0, 0, NULL::timestamptz;
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT cl.id,
           cl.status,
           cl.call_attempts,
           cl.retry_eligible_at,
           cl.callback_agent_id,
           cl.callback_due_at,
           cl.scheduled_callback_at,
           cl.state           AS cl_state,
           l.state            AS lead_state,
           l.lead_source      AS lead_source,
           l.assigned_agent_id AS lead_assigned_agent_id
    FROM public.campaign_leads cl
    JOIN public.leads l ON l.id = cl.lead_id
    WHERE cl.campaign_id = p_campaign_id
      AND cl.organization_id = v_org
  ),
  locks AS (
    SELECT dll.campaign_lead_id, dll.locked_by, dll.expires_at
    FROM public.dialer_lead_locks dll
    WHERE dll.campaign_id = p_campaign_id
      AND dll.expires_at > now()
  ),
  supp AS (
    SELECT s.campaign_lead_id, s.suppressed_until
    FROM public.campaign_lead_agent_suppressions s
    WHERE s.campaign_id = p_campaign_id
      AND s.agent_id = v_uid
      AND s.suppressed_until > now()
  ),
  enriched AS (
    SELECT b.*,
      (b.status NOT IN ('DNC','Completed','Removed','Failed')
        AND (v_campaign.max_attempts IS NULL
             OR COALESCE(b.call_attempts, 0) < v_campaign.max_attempts)
        -- manager queue_filters — same supported keys as get_next_queue_lead
        AND (v_filter_status IS NULL OR b.status = v_filter_status)
        AND (v_filter_state  IS NULL
             OR b.cl_state = v_filter_state
             OR (b.cl_state IS NULL AND b.lead_state = v_filter_state))
        AND (v_filter_source IS NULL OR b.lead_source = v_filter_source)
        AND (v_filter_max_att IS NULL
             OR COALESCE(b.call_attempts, 0) <= v_filter_max_att)
      )                                                            AS is_eligible_universe,
      (b.callback_agent_id IS NULL OR b.callback_agent_id = v_uid) AS callback_ok,
      (b.lead_assigned_agent_id IS NULL
        OR b.lead_assigned_agent_id = v_uid)                       AS lead_ok,
      EXISTS (SELECT 1 FROM locks lk
               WHERE lk.campaign_lead_id = b.id
                 AND lk.locked_by <> v_uid)                        AS locked_by_other,
      EXISTS (SELECT 1 FROM supp sp
               WHERE sp.campaign_lead_id = b.id)                   AS suppressed_me
    FROM base b
  )
  SELECT
    (SELECT count(*)::int FROM base)                                AS total_leads,
    (SELECT count(*)::int FROM enriched
       WHERE is_eligible_universe)                                  AS eligible_leads,
    (SELECT count(*)::int FROM locks)                               AS locked_leads,
    (SELECT count(DISTINCT locked_by)::int FROM locks)             AS active_agents,
    (SELECT count(*)::int FROM enriched
       WHERE is_eligible_universe
         AND callback_ok AND lead_ok
         AND NOT locked_by_other AND NOT suppressed_me
         AND (retry_eligible_at IS NULL OR retry_eligible_at <= now())
    )                                                              AS available_leads,
    (SELECT count(*)::int FROM supp)                               AS suppressed_for_current_agent,
    (SELECT count(*)::int FROM enriched
       WHERE is_eligible_universe
         AND callback_ok AND lead_ok
         AND NOT locked_by_other AND NOT suppressed_me
         AND retry_eligible_at IS NOT NULL AND retry_eligible_at > now()
    )                                                              AS retry_blocked_leads,
    (SELECT count(*)::int FROM enriched
       WHERE is_eligible_universe
         AND callback_agent_id = v_uid
         AND COALESCE(callback_due_at, scheduled_callback_at) IS NOT NULL
         AND COALESCE(callback_due_at, scheduled_callback_at) > now()
    )                                                              AS callback_waiting_leads,
    (SELECT min(t) FROM (
        SELECT retry_eligible_at AS t FROM enriched
          WHERE is_eligible_universe AND callback_ok AND lead_ok
            AND NOT locked_by_other AND NOT suppressed_me
            AND retry_eligible_at IS NOT NULL AND retry_eligible_at > now()
        UNION ALL
        SELECT COALESCE(callback_due_at, scheduled_callback_at) FROM enriched
          WHERE is_eligible_universe AND callback_agent_id = v_uid
            AND COALESCE(callback_due_at, scheduled_callback_at) > now()
        UNION ALL
        SELECT suppressed_until FROM supp
        UNION ALL
        SELECT lk.expires_at FROM locks lk
          JOIN enriched e ON e.id = lk.campaign_lead_id
          WHERE lk.locked_by <> v_uid
            AND e.is_eligible_universe AND e.callback_ok AND e.lead_ok
            AND NOT e.suppressed_me
            AND (e.retry_eligible_at IS NULL OR e.retry_eligible_at <= now())
    ) future_times WHERE t > now())                                AS next_eligible_at;
END;
$function$
;

ALTER FUNCTION public.get_queue_metrics(p_campaign_id uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION private.phone_digits_e164ish(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  -- A bare 10-digit national number gets the NANP country code; an E.164 input ('+…') is taken as-is,
  -- so a 10-digit non-NANP E.164 number never collides with a +1 number.
  SELECT CASE
    WHEN d = '' THEN NULL
    WHEN length(d) = 10 AND btrim(coalesce(p, '')) NOT LIKE '+%' THEN '1' || d
    ELSE d END
  FROM (SELECT regexp_replace(coalesce(p, ''), '\D', '', 'g') AS d) x;
$function$
;

ALTER FUNCTION private.phone_digits_e164ish(p text) OWNER TO postgres;

REVOKE ALL ON FUNCTION private.phone_digits_e164ish(p text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.release_all_agent_locks(p_campaign_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.dialer_lead_locks
  WHERE campaign_id = p_campaign_id
    AND locked_by = auth.uid();
END;
$function$
;

ALTER FUNCTION public.release_all_agent_locks(p_campaign_id uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.release_lead_lock(p_campaign_lead_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.dialer_lead_locks
  WHERE campaign_lead_id = p_campaign_lead_id
    AND locked_by = auth.uid();
END;
$function$
;

ALTER FUNCTION public.release_lead_lock(p_campaign_lead_id uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.renew_lead_lock(p_campaign_lead_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.dialer_lead_locks
  SET expires_at = now() + interval '5 minutes'
  WHERE campaign_lead_id = p_campaign_lead_id
    AND locked_by = auth.uid()
    AND organization_id = public.get_org_id();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$function$
;

ALTER FUNCTION public.renew_lead_lock(p_campaign_lead_id uuid) OWNER TO postgres;

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.campaign_leads ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.dnc_list ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.dialer_lead_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Calls Agency Group Peer Read" ON public.calls AS PERMISSIVE FOR SELECT TO authenticated USING (is_agency_group_peer_organization(organization_id));

CREATE POLICY "Calls Hierarchical Delete" ON public.calls AS PERMISSIVE FOR DELETE TO authenticated USING ((((agent_id = auth.uid()) OR super_admin_own_org(organization_id) OR ((get_user_role() = 'Admin'::text) AND (organization_id = get_org_id())) OR ((get_user_role() = ANY (ARRAY['Team Leader'::text, 'Team Lead'::text])) AND (organization_id = get_org_id()) AND (agent_id IS NOT NULL) AND is_ancestor_of(auth.uid(), agent_id)) OR ((get_org_id() IS NOT NULL) AND (organization_id = get_org_id()) AND (direction = 'inbound'::text) AND (agent_id IS NULL))) AND ((direction IS DISTINCT FROM 'inbound'::text) OR (agent_id IS NOT NULL))));

CREATE POLICY "Calls Hierarchical Insert" ON public.calls AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((agent_id = auth.uid()) OR super_admin_own_org(organization_id) OR ((get_user_role() = 'Admin'::text) AND (organization_id = get_org_id())) OR ((get_user_role() = ANY (ARRAY['Team Leader'::text, 'Team Lead'::text])) AND (organization_id = get_org_id()) AND (agent_id IS NOT NULL) AND is_ancestor_of(auth.uid(), agent_id))));

CREATE POLICY "Calls Hierarchical Select" ON public.calls AS PERMISSIVE FOR SELECT TO authenticated USING (((agent_id = auth.uid()) OR super_admin_own_org(organization_id) OR ((get_user_role() = 'Admin'::text) AND (organization_id = get_org_id())) OR ((get_user_role() = ANY (ARRAY['Team Leader'::text, 'Team Lead'::text])) AND (organization_id = get_org_id()) AND (agent_id IS NOT NULL) AND is_ancestor_of(auth.uid(), agent_id)) OR ((get_org_id() IS NOT NULL) AND (organization_id = get_org_id()) AND (direction = 'inbound'::text) AND (agent_id IS NULL))));

CREATE POLICY "Calls Hierarchical Update" ON public.calls AS PERMISSIVE FOR UPDATE TO authenticated USING ((((agent_id = auth.uid()) OR super_admin_own_org(organization_id) OR ((get_user_role() = 'Admin'::text) AND (organization_id = get_org_id())) OR ((get_user_role() = ANY (ARRAY['Team Leader'::text, 'Team Lead'::text])) AND (organization_id = get_org_id()) AND (agent_id IS NOT NULL) AND is_ancestor_of(auth.uid(), agent_id)) OR ((get_org_id() IS NOT NULL) AND (organization_id = get_org_id()) AND (direction = 'inbound'::text) AND (agent_id IS NULL))) AND ((direction IS DISTINCT FROM 'inbound'::text) OR (agent_id IS NOT NULL)))) WITH CHECK (((agent_id = auth.uid()) OR super_admin_own_org(organization_id) OR ((get_user_role() = 'Admin'::text) AND (organization_id = get_org_id())) OR ((get_user_role() = ANY (ARRAY['Team Leader'::text, 'Team Lead'::text])) AND (organization_id = get_org_id()) AND (agent_id IS NOT NULL) AND is_ancestor_of(auth.uid(), agent_id))));

CREATE POLICY "campaign_leads_delete" ON public.campaign_leads AS PERMISSIVE FOR DELETE TO authenticated USING ((super_admin_own_org(organization_id) OR (organization_id = get_org_id())));

CREATE POLICY "campaign_leads_insert" ON public.campaign_leads AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((organization_id = get_org_id()));

CREATE POLICY "campaign_leads_select" ON public.campaign_leads AS PERMISSIVE FOR SELECT TO authenticated USING ((super_admin_own_org(organization_id) OR ((organization_id = get_org_id()) AND ((get_user_role() = ANY (ARRAY['Admin'::text, 'Team Leader'::text, 'Team Lead'::text])) OR ((get_user_role() = 'Agent'::text) AND ((EXISTS ( SELECT 1
   FROM campaigns c
  WHERE ((c.id = campaign_leads.campaign_id) AND (c.organization_id = get_org_id()) AND (upper(TRIM(BOTH FROM c.type)) = ANY (ARRAY['OPEN POOL'::text, 'OPEN'::text]))))) OR (EXISTS ( SELECT 1
   FROM campaigns c
  WHERE ((c.id = campaign_leads.campaign_id) AND (c.organization_id = get_org_id()) AND (upper(TRIM(BOTH FROM c.type)) = 'TEAM'::text) AND ((auth.uid())::text = ANY (ARRAY( SELECT jsonb_array_elements_text(c.assigned_agent_ids) AS jsonb_array_elements_text)))))) OR ((EXISTS ( SELECT 1
   FROM campaigns c
  WHERE ((c.id = campaign_leads.campaign_id) AND (c.type = 'Personal'::text) AND (c.organization_id = get_org_id())))) AND ((claimed_by = auth.uid()) OR (user_id = auth.uid())))))))));

CREATE POLICY "campaign_leads_update" ON public.campaign_leads AS PERMISSIVE FOR UPDATE TO authenticated USING ((super_admin_own_org(organization_id) OR (organization_id = get_org_id())));

CREATE POLICY "dialer_lead_locks_delete" ON public.dialer_lead_locks AS PERMISSIVE FOR DELETE TO authenticated USING (((locked_by = auth.uid()) OR (get_user_role() = ANY (ARRAY['Admin'::text, 'Team Leader'::text, 'Team Lead'::text]))));

CREATE POLICY "dialer_lead_locks_insert" ON public.dialer_lead_locks AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((locked_by = auth.uid()) AND (organization_id = get_org_id())));

CREATE POLICY "dialer_lead_locks_select" ON public.dialer_lead_locks AS PERMISSIVE FOR SELECT TO authenticated USING (((locked_by = auth.uid()) OR ((get_user_role() = ANY (ARRAY['Admin'::text, 'Team Leader'::text, 'Team Lead'::text])) AND (organization_id = get_org_id()))));

CREATE POLICY "dnc_list_delete" ON public.dnc_list AS PERMISSIVE FOR DELETE TO authenticated USING ((is_super_admin() OR ((organization_id = get_user_org_id()) AND (get_user_role() = 'Admin'::text))));

CREATE POLICY "dnc_list_insert" ON public.dnc_list AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_super_admin() OR ((organization_id = get_user_org_id()) AND (get_user_role() = 'Admin'::text))));

CREATE POLICY "dnc_list_select" ON public.dnc_list AS PERMISSIVE FOR SELECT TO authenticated USING (((organization_id = get_user_org_id()) OR is_super_admin()));

CREATE POLICY "dnc_list_update" ON public.dnc_list AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_super_admin() OR ((organization_id = get_user_org_id()) AND (get_user_role() = 'Admin'::text)))) WITH CHECK ((is_super_admin() OR ((organization_id = get_user_org_id()) AND (get_user_role() = 'Admin'::text))));

CREATE OR REPLACE FUNCTION public.workflow_on_call_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  BEGIN
    IF NEW.disposition_id IS NOT NULL AND NEW.contact_id IS NOT NULL THEN
      PERFORM private.workflow_dispatch_event(
        NEW.organization_id,
        'disposition',
        NEW.disposition_id::text,
        NEW.contact_id,
        'lead',
        jsonb_build_object('disposition_id', NEW.disposition_id)
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'workflow_on_call_created dispatch failed (call %): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$
;

CREATE TRIGGER trg_workflow_call_created AFTER INSERT ON public.calls FOR EACH ROW EXECUTE FUNCTION workflow_on_call_created();

CREATE OR REPLACE FUNCTION private.guard_dialer_lock_provenance()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = TG_RELID)) THEN
    IF TG_OP = 'INSERT' THEN
      NEW.queue_issued_at := NULL;
    ELSE
      IF (NEW.campaign_lead_id, NEW.campaign_id, NEW.organization_id, NEW.locked_by)
          IS DISTINCT FROM (OLD.campaign_lead_id, OLD.campaign_id, OLD.organization_id, OLD.locked_by) THEN
        RAISE EXCEPTION 'lock identity is immutable' USING ERRCODE = '42501';
      END IF;
      NEW.queue_issued_at := OLD.queue_issued_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE TRIGGER dialer_lead_locks_guard_provenance BEFORE INSERT OR UPDATE ON public.dialer_lead_locks FOR EACH ROW EXECUTE FUNCTION private.guard_dialer_lock_provenance();

CREATE OR REPLACE FUNCTION public.handle_dnc_workflow_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id     uuid;
  v_phone      text;
  v_contact_id uuid;
BEGIN
  v_org_id := NULLIF(to_jsonb(NEW) ->> 'organization_id', '')::uuid;
  v_phone  := NULLIF(to_jsonb(NEW) ->> 'phone_number', '');

  IF v_org_id IS NULL OR v_phone IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT id INTO v_contact_id
    FROM public.leads
    WHERE organization_id = v_org_id AND phone = v_phone
    LIMIT 1;

    IF v_contact_id IS NOT NULL THEN
      PERFORM public.workflow_dispatch_event(
        v_org_id, 'contact_dnc', NULL, v_contact_id, 'lead',
        jsonb_build_object('phone_number', v_phone, 'reason', to_jsonb(NEW) ->> 'reason')
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_dnc_workflow_events dispatch failed (phone %): %', v_phone, SQLERRM;
  END;

  RETURN NEW;
END;
$function$
;

CREATE TRIGGER workflow_dnc_insert_trigger AFTER INSERT ON public.dnc_list FOR EACH ROW EXECUTE FUNCTION handle_dnc_workflow_events();

GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
REVOKE ALL ON SCHEMA private FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA public TO anon,authenticated,service_role;
-- Synthetic workflow transport intentionally fails: all CRM writes must survive.
CREATE FUNCTION public.workflow_dispatch_event(uuid,text,text,uuid,text,jsonb) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic workflow outage'; END $$;
CREATE FUNCTION private.workflow_dispatch_event(uuid,text,text,uuid,text,jsonb) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic workflow outage'; END $$;

-- Real conversion function and the live ON DELETE SET NULL membership relationship.
-- Transfer tables have only the columns used by conversion; this remains a focused fixture.
ALTER TABLE public.campaign_leads ADD CONSTRAINT campaign_leads_lead_id_fkey FOREIGN KEY(lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;
CREATE TABLE public.contact_notes(id uuid DEFAULT gen_random_uuid(),contact_id uuid,contact_type text,organization_id uuid);
CREATE TABLE public.appointments(id uuid DEFAULT gen_random_uuid(),contact_id uuid,organization_id uuid);
CREATE TABLE public.tasks(id uuid DEFAULT gen_random_uuid(),contact_id uuid,contact_type text,organization_id uuid);
CREATE TABLE public.messages(id uuid DEFAULT gen_random_uuid(),contact_id uuid,contact_type text,lead_id uuid,organization_id uuid);
CREATE TABLE public.contact_emails(id uuid DEFAULT gen_random_uuid(),contact_id uuid,organization_id uuid);
CREATE TABLE public.workflow_executions(id uuid DEFAULT gen_random_uuid(),contact_id uuid,contact_type text,organization_id uuid);
CREATE OR REPLACE FUNCTION "public"."convert_lead_to_client_atomic"("p_lead_id" "uuid", "p_client" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'pg_temp'
    AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_org    uuid := public.get_org_id();
  v_lead   public.leads%ROWTYPE;
  v_prof   RECORD;
  v_existing uuid;
  v_client uuid;
  v_authorized boolean;
  v_cf jsonb;
  v_freq text;
  v_notes int := 0; v_acts int := 0; v_appts int := 0; v_tasks int := 0;
  v_calls int := 0; v_msgs int := 0; v_msgs2 int := 0; v_emails int := 0; v_wf int := 0;
  v_campaign_rows int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'no_org' USING ERRCODE = '28000'; END IF;

  SELECT id INTO v_existing FROM public.clients
   WHERE lead_id = p_lead_id AND organization_id = v_org LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('client_id', v_existing, 'idempotent', true);
  END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_lead.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'cross_org' USING ERRCODE = '42501';
  END IF;

  SELECT p.role, p.organization_id, p.is_super_admin
    INTO v_prof FROM public.profiles p WHERE p.id = v_uid;
  IF NOT FOUND OR v_prof.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  v_authorized :=
       (v_lead.user_id = v_uid)
    OR (v_lead.assigned_agent_id = v_uid)
    OR (v_lead.user_id IS NULL AND v_lead.assigned_agent_id IS NULL)
    OR (v_prof.role = 'Admin')
    OR (COALESCE(v_prof.is_super_admin, false) AND v_prof.organization_id = v_org)
    OR (v_prof.role IN ('Team Leader','Team Lead') AND (
          public.is_ancestor_of(v_uid, v_lead.user_id)
       OR public.is_ancestor_of(v_uid, v_lead.assigned_agent_id)));
  IF NOT v_authorized THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;

  SELECT id INTO v_existing FROM public.clients
   WHERE lead_id = p_lead_id AND organization_id = v_org LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('client_id', v_existing, 'idempotent', true);
  END IF;

  v_cf := CASE WHEN p_client ? 'custom_fields' AND jsonb_typeof(p_client->'custom_fields') = 'object'
               THEN p_client->'custom_fields' ELSE NULL END;

  -- Canonical payment frequency: blank → NULL; normalized spelling; anything else is a caller bug.
  v_freq := lower(replace(btrim(COALESCE(p_client->>'payment_frequency', '')), '-', '_'));
  v_freq := NULLIF(replace(v_freq, ' ', '_'), '');
  IF v_freq IS NOT NULL AND v_freq NOT IN ('monthly', 'quarterly', 'semi_annual', 'annual') THEN
    RAISE EXCEPTION 'invalid_payment_frequency' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.clients (
    first_name, last_name, phone, email,
    policy_type, carrier, policy_number, premium, face_amount, issue_date, effective_date,
    sold_date, draft_date, payment_frequency,
    beneficiary_name, beneficiary_relationship, beneficiary_phone, notes,
    assigned_agent_id, organization_id, custom_fields, lead_id
  ) VALUES (
    v_lead.first_name, v_lead.last_name, v_lead.phone, v_lead.email,
    COALESCE(NULLIF(p_client->>'policy_type', ''), 'Term'),
    COALESCE(p_client->>'carrier', ''),
    COALESCE(p_client->>'policy_number', ''),
    COALESCE((p_client->>'premium')::numeric, 0),
    COALESCE((p_client->>'face_amount')::numeric, 0),
    NULLIF(p_client->>'issue_date', ''),
    NULLIF(p_client->>'effective_date', ''),
    (NULLIF(p_client->>'sold_date', ''))::date,
    (NULLIF(p_client->>'draft_date', ''))::date,
    v_freq,
    NULLIF(p_client->>'beneficiary_name', ''),
    NULLIF(p_client->>'beneficiary_relationship', ''),
    NULLIF(p_client->>'beneficiary_phone', ''),
    COALESCE(NULLIF(p_client->>'notes', ''), v_lead.notes),
    v_lead.assigned_agent_id,
    v_org,
    v_cf,
    p_lead_id
  ) RETURNING id INTO v_client;

  UPDATE public.contact_notes SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND contact_type = 'lead';
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  UPDATE public.contact_activities SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND contact_type = 'lead';
  GET DIAGNOSTICS v_acts = ROW_COUNT;

  UPDATE public.appointments SET contact_id = v_client WHERE contact_id = p_lead_id;
  GET DIAGNOSTICS v_appts = ROW_COUNT;

  UPDATE public.tasks SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND contact_type = 'lead';
  GET DIAGNOSTICS v_tasks = ROW_COUNT;

  UPDATE public.calls SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND (contact_type = 'lead' OR contact_type IS NULL);
  GET DIAGNOSTICS v_calls = ROW_COUNT;

  UPDATE public.messages SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND (contact_type = 'lead' OR contact_type IS NULL);
  GET DIAGNOSTICS v_msgs = ROW_COUNT;
  UPDATE public.messages SET contact_id = v_client, contact_type = 'client'
   WHERE lead_id = p_lead_id AND contact_id IS NULL;
  GET DIAGNOSTICS v_msgs2 = ROW_COUNT;

  UPDATE public.contact_emails SET contact_id = v_client WHERE contact_id = p_lead_id;
  GET DIAGNOSTICS v_emails = ROW_COUNT;

  UPDATE public.workflow_executions SET contact_id = v_client, contact_type = 'client'
   WHERE contact_id = p_lead_id AND contact_type = 'lead';
  GET DIAGNOSTICS v_wf = ROW_COUNT;

  SELECT count(*) INTO v_campaign_rows FROM public.campaign_leads WHERE lead_id = p_lead_id;

  DELETE FROM public.leads WHERE id = p_lead_id;

  RETURN jsonb_build_object(
    'client_id', v_client,
    'idempotent', false,
    'transferred', jsonb_build_object(
      'notes', v_notes, 'activities', v_acts, 'appointments', v_appts, 'tasks', v_tasks,
      'calls', v_calls, 'messages', v_msgs + v_msgs2, 'contact_emails', v_emails,
      'workflow_executions', v_wf),
    'campaign_outcome', jsonb_build_object('campaign_leads_preserved', v_campaign_rows)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.convert_lead_to_client_atomic(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_lead_to_client_atomic(uuid,jsonb) TO authenticated;
