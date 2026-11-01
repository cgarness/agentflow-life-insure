-- =====================================================================================================
-- Reports V2, PKG-A file 3 of 8: call and journey helpers (plan §2.6, §2.10, §2.11; D3 §3.1–§3.3; BC1, BC2,
-- BC4).
--
-- PLACEHOLDER VERSION. Renumbered above the then-current production head, order kept, in a
-- filename-only commit before the PKG-A backend merge. Branch work only: not applied to production.
--
-- Privilege class C (plan §2.8): private helpers only, each created sealed. No privilege is added and no
-- data is written. Runs after …10 and …11.
--
-- PROPOSED DESIGN for the journey history gates (★1 and ★4 are pending): developed and tested in isolation.
-- A phone number is exclusion evidence only. It never links, merges, deduplicates or attributes a call or a
-- sale, never reaches a payload, and the absence of a match is never treated as proof of complete history.
--
--   report_v3_contact_predicate   the live Contacted rule: No Answer first, then duration > 45 s, then a
--                                 qualifying disposition (20261006043731:130-136)
--   report_v3_local_day_start     the first instant of an agency date (report_window's DST-safe rule)
--   report_v3_client_identity_key 'lead:<root lead>' or 'client:<id>'
--   report_v3_contact_identity    the single call-pointer resolver (D3 §3.2 rules 1–8)
--   report_v3_call_facts          every call in [p_start, p_end): the pinned v2 report_call_facts rows plus the
--                                 attempt class (attempt / non_attempt / unverified), contact flags and identity
--   report_v3_identity_receipts   the earliest recorded lead start of each root lead (five sources)
--   report_v3_identity_numbers    a person's current numbers (lead, client, campaign memberships)
--   report_v3_sale_call_links     PKG-A stub: no rows until PKG-C
--   report_v3_first_sales         each identity's first sale and whether it is assessable
--   report_v3_journey_members     one internal row per member and journey KPI (never returned to a client)
--   report_v3_journey_facts       the journey KPI counts for one scope (no key, number, time or id)
--   report_v3_call_counts         the call KPI counts for one scope
--   report_v3_call_kpis           KPI 5–11 and 34 envelopes, only through the foundation builders
--   report_v3_journey_kpis        KPI 14, 19, 21 and 38 envelopes, only through the foundation builders
-- =====================================================================================================
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE c text;
BEGIN
  IF to_regprocedure('private.report_v3_call_facts(uuid,timestamptz,timestamptz)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'private' AND p.proname IN ('report_v3_contact_predicate', 'report_v3_contact_identity',
                       'report_v3_journey_facts', 'report_v3_call_kpis', 'report_v3_journey_kpis')) THEN
    RAISE EXCEPTION 'Reports v3 call journey: refusing replay; call and journey helpers already exist';
  END IF;
  IF to_regprocedure('private.report_v3_total(integer,numeric,jsonb,text,jsonb)') IS NULL
     OR to_regprocedure('private.report_v3_ratio(integer,numeric,numeric,jsonb,jsonb,text,jsonb)') IS NULL
     OR to_regprocedure('private.report_v3_rate(integer,numeric,numeric,jsonb,jsonb,text,jsonb)') IS NULL
     OR to_regprocedure('private.report_v3_median(integer,numeric,numeric,jsonb,text,jsonb)') IS NULL
     OR to_regprocedure('private.report_v3_basis_flags()') IS NULL
     OR to_regprocedure('private.report_v3_sale_facts(uuid,uuid[],date,date)') IS NULL THEN
    RAISE EXCEPTION 'Reports v3 call journey: the foundation (…10) and sale facts (…11) must be applied first';
  END IF;
  -- The pinned v2 call and session readers this file builds on (full-window class, D3 §3.1).
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('private.report_call_facts(uuid,timestamptz,timestamptz,uuid[])')
                   AND md5(prosrc) = 'bacbfd0629221957cae28ba28728c8bd' AND prosecdef AND proowner = 'postgres'::regrole
                   AND proconfig = ARRAY['search_path=pg_catalog, pg_temp'])
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('private.report_session_seconds(uuid,timestamptz,timestamptz,uuid[])')
                   AND md5(prosrc) = '3d33b720751a1913c81ad284ae6ffd43')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('private.report_session_facts(uuid,timestamptz,timestamptz,uuid[])')
                   AND md5(prosrc) = '245c7ce4f7bf47f6347595822f70a947') THEN
    RAISE EXCEPTION 'Reports v3 call journey: v2 call reader drift';
  END IF;
  IF to_regprocedure('public.phone_last10(text)') IS NULL
     OR to_regclass('public.idx_calls_org_outbound_contact_phone_last10') IS NULL
     OR to_regclass('public.dispositions_org_lower_name_unique') IS NULL THEN
    RAISE EXCEPTION 'Reports v3 call journey: phone normalizer or disposition index missing';
  END IF;
  FOR c IN SELECT * FROM unnest(ARRAY[
      'public.calls.contact_id', 'public.calls.contact_type', 'public.calls.contact_phone', 'public.calls.campaign_lead_id',
      'public.calls.duration', 'public.calls.disposition_name', 'public.calls.answered_by_agent_id', 'public.calls.outcome',
      'public.calls.voicemail_id', 'public.calls.dialer_admission_required', 'public.calls.duration_source',
      'public.calls.duration_conflict', 'public.clients.lead_id', 'public.clients.lead_conversion', 'public.clients.phone',
      'public.leads.phone', 'public.campaign_leads.lead_id', 'public.campaign_leads.phone', 'public.recruits.id',
      'private.dialer_outbound_admissions.admitted', 'private.dialer_conversion_lineage.original_lead_id',
      'public.contact_history_events.changed_fields', 'public.import_history.imported_lead_ids',
      'private.google_sheets_receipts.outcome']) LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = split_part(c, '.', 1) AND table_name = split_part(c, '.', 2)
                      AND column_name = split_part(c, '.', 3)) THEN
      RAISE EXCEPTION 'Reports v3 call journey: dependency column missing: %', c;
    END IF;
  END LOOP;
END $preflight$;

-- -----------------------------------------------------------------------------------------------------
-- Small shared rules
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_v3_contact_predicate(p_duration_seconds bigint, p_resolved_disposition_name text,
                                                    p_raw_disposition_name text, p_counts_as_contacted boolean)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN lower(coalesce(p_resolved_disposition_name, p_raw_disposition_name, '')) = 'no answer' THEN false
              WHEN coalesce(p_duration_seconds, 0) > 45 THEN true
              WHEN coalesce(p_counts_as_contacted, false) THEN true
              ELSE false END;
$$;

CREATE FUNCTION private.report_v3_local_day_start(p_day date, p_time_zone text)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT least(p_day::timestamp AT TIME ZONE p_time_zone,
               ((p_day::timestamp - interval '1 hour') AT TIME ZONE p_time_zone) + interval '1 hour');
$$;

CREATE FUNCTION private.report_v3_client_identity_key(p_org uuid, p_client_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce((SELECT 'lead:' || c.lead_id FROM public.clients c
                    WHERE c.id = p_client_id AND c.organization_id = p_org AND c.lead_id IS NOT NULL),
                  'client:' || p_client_id);
$$;

-- -----------------------------------------------------------------------------------------------------
-- The single call-pointer resolver (D3 §3.2). Primary-key and unique lookups only; every join is same-org.
-- Contact pointers follow rules 1–6; campaign-membership pointers (calls with no contact_id) rules 7–8.
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_v3_contact_identity(p_org uuid, p_contact_ids uuid[], p_campaign_lead_ids uuid[])
RETURNS TABLE (pointer_kind text, pointer_id uuid, identity_key text, identity_kind text, root_lead_id uuid, client_id uuid,
               converted_at timestamptz, resolution text)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  WITH contact_pointers AS (
    SELECT DISTINCT p.id FROM unnest(coalesce(p_contact_ids, '{}'::uuid[])) AS p(id) WHERE p.id IS NOT NULL
  ), contact_resolved AS (
    SELECT p.id,
           CASE WHEN r.id IS NOT NULL THEN 'recruit:' || r.id
                WHEN c.id IS NOT NULL THEN CASE WHEN c.lead_id IS NOT NULL THEN 'lead:' || c.lead_id ELSE 'client:' || c.id END
                WHEN l.id IS NOT NULL THEN 'lead:' || l.id
                WHEN cc.id IS NOT NULL THEN 'lead:' || p.id
                WHEN coalesce(cl.lead_id, lin.original_lead_id) IS NOT NULL THEN 'lead:' || coalesce(cl.lead_id, lin.original_lead_id)
           END AS identity_key,
           CASE WHEN r.id IS NOT NULL THEN 'recruit'
                WHEN c.id IS NOT NULL THEN 'client'
                WHEN l.id IS NOT NULL THEN 'lead'
                WHEN cc.id IS NOT NULL THEN 'converted_lead_pointer'
                WHEN cl.id IS NOT NULL AND coalesce(cl.lead_id, lin.original_lead_id) IS NOT NULL THEN 'legacy_membership_as_contact'
                WHEN cl.id IS NOT NULL THEN 'unresolved_membership_without_lead'
                ELSE 'unresolved_dangling_contact'
           END AS resolution
      FROM contact_pointers p
      LEFT JOIN public.recruits r ON r.id = p.id AND r.organization_id = p_org
      LEFT JOIN public.clients c ON c.id = p.id AND c.organization_id = p_org
      LEFT JOIN public.leads l ON l.id = p.id AND l.organization_id = p_org
      LEFT JOIN public.clients cc ON cc.lead_id = p.id AND cc.organization_id = p_org
      LEFT JOIN public.campaign_leads cl ON cl.id = p.id AND cl.organization_id = p_org
      LEFT JOIN private.dialer_conversion_lineage lin ON lin.organization_id = p_org AND lin.campaign_lead_id = p.id
  ), member_pointers AS (
    SELECT DISTINCT p.id FROM unnest(coalesce(p_campaign_lead_ids, '{}'::uuid[])) AS p(id) WHERE p.id IS NOT NULL
  ), member_resolved AS (
    SELECT p.id,
           CASE WHEN cl.lead_id IS NOT NULL THEN 'lead:' || cl.lead_id
                WHEN lin.original_lead_id IS NOT NULL THEN 'lead:' || lin.original_lead_id END AS identity_key,
           CASE WHEN cl.lead_id IS NOT NULL THEN 'campaign_membership'
                WHEN lin.original_lead_id IS NOT NULL THEN 'campaign_lineage'
                WHEN cl.id IS NOT NULL THEN 'unresolved_membership_without_lead'
                ELSE 'unresolved_no_link' END AS resolution
      FROM member_pointers p
      LEFT JOIN public.campaign_leads cl ON cl.id = p.id AND cl.organization_id = p_org
      LEFT JOIN private.dialer_conversion_lineage lin ON lin.organization_id = p_org AND lin.campaign_lead_id = p.id
  ), resolved AS (
    SELECT 'contact'::text AS pointer_kind, x.id, x.identity_key, x.resolution FROM contact_resolved x
    UNION ALL
    SELECT 'campaign_lead', y.id, y.identity_key, y.resolution FROM member_resolved y
  )
  SELECT r.pointer_kind, r.id, r.identity_key,
         CASE WHEN r.identity_key LIKE 'lead:%' THEN 'lead' WHEN r.identity_key LIKE 'client:%' THEN 'client'
              WHEN r.identity_key LIKE 'recruit:%' THEN 'recruit' END,
         CASE WHEN r.identity_key LIKE 'lead:%' THEN substr(r.identity_key, 6)::uuid END,
         coalesce(ck.id, CASE WHEN r.identity_key LIKE 'client:%' THEN substr(r.identity_key, 8)::uuid END),
         CASE WHEN ck.id IS NOT NULL THEN coalesce((ck.lead_conversion ->> 'converted_at')::timestamptz, ck.created_at) END,
         r.resolution
    FROM resolved r
    LEFT JOIN public.clients ck
           ON r.identity_key LIKE 'lead:%' AND ck.lead_id = substr(r.identity_key, 6)::uuid AND ck.organization_id = p_org;
$$;

-- -----------------------------------------------------------------------------------------------------
-- Call facts (plan §2.10; D3 §3.2). Exactly the rows and carried columns of the pinned v2
-- report_call_facts(p_org, p_start, p_end, NULL), plus the evidence class of each outbound row:
--   attempt      pre-admission rows (dialer_admission_required false) or an admitted row; genuine failed,
--                busy or no-answer attempts are attempts
--   non_attempt  an admission row refused by the server (no <Dial>): proven, excluded, disclosed
--   unverified   admission required but no admission row: excluded from the value, kept as unknown evidence
-- Raw rows are never changed. Callers filter on credited_agent_id.
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_v3_call_facts(p_org uuid, p_start timestamptz, p_end timestamptz)
RETURNS TABLE (call_id uuid, created_at timestamptz, direction_class text, placing_agent_id uuid, credited_agent_id uuid,
               duration_seconds bigint, duration_source text, duration_conflict boolean, attempt_class text, is_attempt boolean,
               is_contacted boolean, is_answered_inbound boolean, is_journey_contact boolean, could_qualify boolean,
               identity_key text, identity_kind text, is_lead_stage boolean, resolution text, phone_last10 text,
               campaign_id uuid, lead_id uuid, lead_source text, disposition_key text, disposition_name text,
               disposition_color text, disp_counts_contacted boolean, disp_converts boolean, disp_dnc boolean,
               disp_callback boolean, disp_appointment boolean)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF p_org IS NULL OR p_start IS NULL OR p_end IS NULL THEN
    RAISE EXCEPTION 'reports v3 call facts: the organization and both bounds are required' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH f AS MATERIALIZED (
    SELECT v.*, c.contact_id, c.contact_type, c.campaign_lead_id AS raw_campaign_lead_id, c.contact_phone,
           c.answered_by_agent_id, c.outcome, c.voicemail_id, c.dialer_admission_required, c.duration AS raw_duration,
           c.disposition_name AS raw_disposition_name, c.duration_source AS raw_duration_source,
           c.duration_conflict AS raw_duration_conflict, a.admitted
      FROM private.report_call_facts(p_org, p_start, p_end, NULL) v
      JOIN public.calls c ON c.id = v.call_id AND c.organization_id = p_org
      LEFT JOIN private.dialer_outbound_admissions a ON a.organization_id = p_org AND a.call_id = v.call_id
  ), ids AS MATERIALIZED (
    SELECT * FROM private.report_v3_contact_identity(p_org,
      (SELECT array_agg(DISTINCT f.contact_id) FROM f WHERE f.contact_id IS NOT NULL),
      (SELECT array_agg(DISTINCT f.raw_campaign_lead_id) FROM f WHERE f.contact_id IS NULL AND f.raw_campaign_lead_id IS NOT NULL))
  ), x AS (
    SELECT f.*,
           CASE WHEN f.contact_type = 'recruit' AND f.contact_id IS NOT NULL THEN 'recruit:' || f.contact_id
                ELSE coalesce(ci.identity_key, cm.identity_key) END AS key,
           CASE WHEN f.contact_type = 'recruit' AND f.contact_id IS NOT NULL THEN 'recruit'
                ELSE coalesce(ci.resolution, cm.resolution, 'unresolved_no_link') END AS how,
           coalesce(ci.converted_at, cm.converted_at) AS converted,
           CASE WHEN f.direction_class <> 'outbound' THEN NULL
                WHEN NOT f.dialer_admission_required OR f.admitted IS TRUE THEN 'attempt'
                WHEN f.admitted IS FALSE THEN 'non_attempt'
                ELSE 'unverified' END AS evidence_class,
           (f.direction_class = 'inbound' AND (f.agent_id IS NOT NULL OR f.outcome = 'forwarded_answered')
              AND f.voicemail_id IS NULL) AS answered_inbound
      FROM f
      LEFT JOIN ids ci ON ci.pointer_kind = 'contact' AND ci.pointer_id = f.contact_id
      LEFT JOIN ids cm ON f.contact_id IS NULL AND cm.pointer_kind = 'campaign_lead' AND cm.pointer_id = f.raw_campaign_lead_id
  )
  SELECT x.call_id, x.created_at, x.direction_class, x.agent_id,
         CASE WHEN x.direction_class = 'inbound' THEN coalesce(x.agent_id, x.answered_by_agent_id) ELSE x.agent_id END,
         x.duration_seconds, x.raw_duration_source, x.raw_duration_conflict, x.evidence_class,
         coalesce(x.evidence_class = 'attempt', false),
         x.is_contacted,
         x.answered_inbound,
         (coalesce(x.evidence_class = 'attempt', false) AND x.is_contacted)
           OR (x.answered_inbound AND private.report_v3_contact_predicate(x.duration_seconds, x.disposition_name,
                                                                           x.raw_disposition_name, x.disp_counts_contacted)),
         (lower(coalesce(x.disposition_name, '')) <> 'no answer'
           AND (x.disp_counts_contacted OR x.raw_duration IS NULL OR x.raw_duration > 45)),
         x.key,
         CASE WHEN x.key LIKE 'lead:%' THEN 'lead' WHEN x.key LIKE 'client:%' THEN 'client'
              WHEN x.key LIKE 'recruit:%' THEN 'recruit' END,
         (x.key LIKE 'lead:%' AND (x.converted IS NULL OR x.created_at < x.converted)),
         x.how,
         public.phone_last10(x.contact_phone),
         x.campaign_id, x.lead_id, x.lead_source, x.disposition_key, x.disposition_name, x.disposition_color,
         x.disp_counts_contacted, x.disp_converts, x.disp_dnc, x.disp_callback, x.disp_appointment
    FROM x;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- Lead receipts and current numbers (D3 §3.2)
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_v3_identity_receipts(p_org uuid, p_root_lead_ids uuid[])
RETURNS TABLE (root_lead_id uuid, receipt_at timestamptz, receipt_source text)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  WITH ids AS (
    SELECT DISTINCT i.id FROM unnest(coalesce(p_root_lead_ids, '{}'::uuid[])) AS i(id) WHERE i.id IS NOT NULL
  ), src AS (
    SELECT l.id, l.created_at AS at, 'lead_row' AS source
      FROM public.leads l JOIN ids ON ids.id = l.id WHERE l.organization_id = p_org
    UNION ALL
    SELECT e.contact_id, e.recorded_at, 'contact_history'
      FROM public.contact_history_events e JOIN ids ON ids.id = e.contact_id
     WHERE e.organization_id = p_org AND e.contact_type = 'lead' AND e.action IN ('created', 'imported')
    UNION ALL
    SELECT c.lead_id, (c.lead_conversion ->> 'lead_created_at')::timestamptz, 'lead_conversion'
      FROM public.clients c JOIN ids ON ids.id = c.lead_id
     WHERE c.organization_id = p_org AND c.lead_conversion ? 'lead_created_at'
    UNION ALL
    SELECT ids.id, h.created_at, 'import_history'
      FROM public.import_history h JOIN ids ON h.imported_lead_ids ? ids.id::text
     WHERE h.organization_id = p_org AND h.undo_status IS NULL
    UNION ALL
    SELECT r.lead_id, r.created_at, 'google_sheets'
      FROM private.google_sheets_receipts r JOIN ids ON ids.id = r.lead_id
     WHERE r.organization_id = p_org AND r.outcome IN ('imported', 'imported_flagged')
  )
  SELECT DISTINCT ON (s.id) s.id, s.at, s.source FROM src s WHERE s.at IS NOT NULL ORDER BY s.id, s.at, s.source;
$$;

CREATE FUNCTION private.report_v3_identity_numbers(p_org uuid, p_identity_keys text[])
RETURNS TABLE (identity_key text, phone_last10 text, number_source text)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  WITH k AS (
    SELECT DISTINCT x.key,
           CASE WHEN x.key LIKE 'lead:%' THEN substr(x.key, 6)::uuid END AS lead_id,
           CASE WHEN x.key LIKE 'client:%' THEN substr(x.key, 8)::uuid END AS client_id
      FROM unnest(coalesce(p_identity_keys, '{}'::text[])) AS x(key)
     WHERE x.key LIKE 'lead:%' OR x.key LIKE 'client:%'
  ), raw AS (
    SELECT k.key, l.phone, 'lead' AS source FROM k JOIN public.leads l ON l.id = k.lead_id AND l.organization_id = p_org
    UNION ALL
    SELECT k.key, c.phone, 'client' FROM k JOIN public.clients c
      ON c.organization_id = p_org AND (c.id = k.client_id OR (k.lead_id IS NOT NULL AND c.lead_id = k.lead_id))
    UNION ALL
    SELECT k.key, cl.phone, 'campaign_membership' FROM k JOIN public.campaign_leads cl
      ON cl.organization_id = p_org AND k.lead_id IS NOT NULL AND cl.lead_id = k.lead_id
    UNION ALL
    SELECT k.key, cl.phone, 'campaign_lineage' FROM k
      JOIN private.dialer_conversion_lineage lin ON lin.organization_id = p_org AND lin.original_lead_id = k.lead_id
      JOIN public.campaign_leads cl ON cl.id = lin.campaign_lead_id AND cl.organization_id = p_org
  )
  SELECT DISTINCT r.key, public.phone_last10(r.phone), r.source
    FROM raw r WHERE public.phone_last10(r.phone) IS NOT NULL;
$$;

-- PKG-C replaces this stub (…32) with captured sale-call links, under a preimage guard.
CREATE FUNCTION private.report_v3_sale_call_links(p_org uuid, p_as_of timestamptz)
RETURNS TABLE (win_id uuid, call_id uuid, call_direction text, link_source text)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT NULL::uuid, NULL::uuid, NULL::text, NULL::text WHERE false;
$$;

-- -----------------------------------------------------------------------------------------------------
-- First sales (D3 owns them). Keyed by client_identity_key, ordered (sold_date, recorded, id); recorded
-- <= as_of only. An identity with an undated sale, or whose first sale has no policy identity, is not
-- assessable for KPIs 14 and 38.
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_v3_first_sales(p_org uuid, p_as_of timestamptz)
RETURNS TABLE (identity_key text, identity_kind text, buyer_id uuid, first_win_id uuid, first_policy_id uuid,
               first_sold_date date, first_seller_id uuid, first_event_time_source text, first_set_win_ids uuid[],
               assessable boolean, reason text)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  WITH sales AS (
    SELECT private.report_v3_client_identity_key(p_org, w.contact_id) AS key, w.contact_id, w.id, w.policy_id, w.sold_date,
           w.agent_id, w.event_time_source, coalesce(w.recorded_at, w.created_at) AS recorded
      FROM public.wins w
     WHERE w.organization_id = p_org AND w.contact_id IS NOT NULL AND coalesce(w.recorded_at, w.created_at) <= p_as_of
  ), ranked AS (
    SELECT s.*, row_number() OVER (PARTITION BY s.key ORDER BY s.sold_date NULLS LAST, s.recorded, s.id) AS rn,
           bool_or(s.sold_date IS NULL) OVER (PARTITION BY s.key) AS any_undated
      FROM sales s
  )
  SELECT r.key,
         CASE WHEN r.key LIKE 'lead:%' THEN 'lead' ELSE 'client' END,
         r.contact_id, r.id, r.policy_id, r.sold_date, r.agent_id, r.event_time_source,
         (SELECT array_agg(s2.id ORDER BY s2.id) FROM sales s2 WHERE s2.key = r.key AND s2.sold_date = r.sold_date),
         NOT r.any_undated AND r.policy_id IS NOT NULL AND r.sold_date IS NOT NULL,
         CASE WHEN r.any_undated THEN 'undated_sale' WHEN r.policy_id IS NULL THEN 'unlinked_legacy_sale' END
    FROM ranked r
   WHERE r.rn = 1;
$$;

-- -----------------------------------------------------------------------------------------------------
-- Journey members (proposed design; D3 §3.2 gates, BC1, BC2). One internal row per member and KPI:
--   19, 21  identities whose first journey contact (by any agent) is in [p_start_at, p_end_at) and is credited
--           in scope; prior buyers are not members (E1); prospects who never buy ARE members
--   14, 38  identities whose first sale is in [p_sold_from, p_sold_until) with an in-scope original seller
-- A gate makes a member unassessable for one KPI, only on evidence specific to that member and KPI. Phone
-- numbers only rule relatedness out for one member; they never link or attribute anything. Activity of
-- other people never changes a member's row (BC1).
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_v3_journey_members(p_org uuid, p_agents uuid[], p_time_zone text, p_start_at timestamptz,
                                                  p_end_at timestamptz, p_sold_from date, p_sold_until date, p_as_of timestamptz)
RETURNS TABLE (kpi integer, identity_key text, credited_agent_id uuid, anchor_at timestamptz, anchor_date date, gate text,
               coverage_code text, assessable boolean, metric_value numeric, success boolean, mature boolean,
               classification text)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF p_org IS NULL OR p_time_zone IS NULL OR p_start_at IS NULL OR p_end_at IS NULL OR p_sold_from IS NULL
     OR p_sold_until IS NULL OR p_as_of IS NULL THEN
    RAISE EXCEPTION 'reports v3 journey: the organization, time zone, windows and as_of are required' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH hist AS MATERIALIZED (
    SELECT * FROM private.report_v3_call_facts(p_org, '-infinity'::timestamptz, p_as_of)
  ), linked AS MATERIALIZED (
    SELECT * FROM hist h WHERE h.identity_kind IN ('lead', 'client')
  ), first_contact AS (
    SELECT DISTINCT ON (l.identity_key) l.identity_key, l.call_id, l.created_at, l.credited_agent_id, l.direction_class
      FROM linked l WHERE l.is_journey_contact ORDER BY l.identity_key, l.created_at, l.call_id
  ), first_linked AS (
    SELECT l.identity_key, min(l.created_at) AS first_at FROM linked l GROUP BY l.identity_key
  ), fs AS MATERIALIZED (
    SELECT * FROM private.report_v3_first_sales(p_org, p_as_of)
  ), fc AS (
    SELECT f.identity_key, f.call_id AS anchor_call_id, f.created_at AS anchor_at,
           (f.created_at AT TIME ZONE p_time_zone)::date AS anchor_date, f.credited_agent_id, f.direction_class,
           s.first_sold_date
      FROM first_contact f LEFT JOIN fs s ON s.identity_key = f.identity_key
     WHERE f.created_at >= p_start_at AND f.created_at < p_end_at
       AND (p_agents IS NULL OR f.credited_agent_id = ANY (p_agents))
       AND (s.first_sold_date IS NULL OR s.first_sold_date >= (f.created_at AT TIME ZONE p_time_zone)::date)
  ), buyers AS (
    SELECT s.* FROM fs s
     WHERE s.first_sold_date >= p_sold_from AND s.first_sold_date < p_sold_until
       AND (p_agents IS NULL OR s.first_seller_id = ANY (p_agents))
  ), keyinfo AS (
    SELECT k.identity_key,
           CASE WHEN k.identity_key LIKE 'lead:%' THEN substr(k.identity_key, 6)::uuid END AS root_lead_id,
           CASE WHEN k.identity_key LIKE 'client:%' THEN substr(k.identity_key, 8)::uuid
                ELSE (SELECT c.id FROM public.clients c
                       WHERE c.organization_id = p_org AND c.lead_id = substr(k.identity_key, 6)::uuid) END AS client_id
      FROM (SELECT fc.identity_key FROM fc UNION SELECT b.identity_key FROM buyers b) k
  ), rec AS (
    SELECT * FROM private.report_v3_identity_receipts(p_org,
      (SELECT array_agg(ki.root_lead_id) FROM keyinfo ki WHERE ki.root_lead_id IS NOT NULL))
  ), nums AS MATERIALIZED (
    SELECT * FROM private.report_v3_identity_numbers(p_org, (SELECT array_agg(ki.identity_key) FROM keyinfo ki))
  ), cand AS MATERIALIZED (
    -- Unresolved calls (no link, dangling pointer, membership without a lead) by any agent: outbound rows and
    -- answered inbound rows; unanswered inbound rows never count.
    SELECT * FROM hist h WHERE h.identity_key IS NULL AND (h.direction_class = 'outbound' OR h.is_answered_inbound)
  ), changes AS (
    SELECT ki.identity_key, e.recorded_at
      FROM keyinfo ki
      JOIN public.contact_history_events e
        ON e.organization_id = p_org AND 'phone' = ANY (e.changed_fields)
       AND ((e.contact_type = 'lead' AND e.contact_id = ki.root_lead_id)
         OR (e.contact_type = 'client' AND e.contact_id = ki.client_id))
  ), links AS (
    SELECT * FROM private.report_v3_sale_call_links(p_org, p_as_of)
  ), m AS (
    SELECT fc.*, ki.root_lead_id, r.receipt_at,
           EXISTS (SELECT 1 FROM cand c JOIN nums n ON n.identity_key = fc.identity_key AND n.phone_last10 = c.phone_last10
                    WHERE c.created_at < fc.anchor_at AND c.could_qualify) AS related_qualifying,
           EXISTS (SELECT 1 FROM cand c JOIN nums n ON n.identity_key = fc.identity_key AND n.phone_last10 = c.phone_last10
                    WHERE c.created_at < fc.anchor_at) AS related_any,
           EXISTS (SELECT 1 FROM changes ch WHERE ch.identity_key = fc.identity_key AND ch.recorded_at < fc.anchor_at) AS phone_changed,
           EXISTS (SELECT 1 FROM linked l WHERE l.identity_key = fc.identity_key AND l.attempt_class = 'unverified'
                    AND l.created_at < fc.anchor_at) AS unverified_before,
           (SELECT count(*) FROM linked l WHERE l.identity_key = fc.identity_key AND l.is_attempt
             AND (l.created_at, l.call_id) < (fc.anchor_at, fc.anchor_call_id))
             + CASE WHEN fc.direction_class = 'outbound' THEN 1 ELSE 0 END AS attempts
      FROM fc JOIN keyinfo ki ON ki.identity_key = fc.identity_key
      LEFT JOIN rec r ON r.root_lead_id = ki.root_lead_id
  ), m2 AS (
    SELECT m.*,
           CASE WHEN m.root_lead_id IS NULL THEN 'hand_entered_client'
                WHEN m.receipt_at IS NULL THEN 'lead_receipt_unknown'
                WHEN m.receipt_at > m.anchor_at THEN 'receipt_contradicted'
                WHEN m.related_qualifying THEN 'possibly_related_unlinked_call'
                WHEN m.phone_changed THEN 'phone_changed' END AS gate19,
           CASE WHEN m.root_lead_id IS NULL THEN 'hand_entered_client'
                WHEN m.receipt_at IS NULL THEN 'lead_receipt_unknown'
                WHEN m.receipt_at > m.anchor_at THEN 'receipt_contradicted'
                WHEN m.related_any THEN 'possibly_related_unlinked_call'
                WHEN m.phone_changed THEN 'phone_changed' END AS gate21,
           (m.first_sold_date IS NOT NULL AND m.first_sold_date BETWEEN m.anchor_date AND m.anchor_date + 30) AS won,
           (p_as_of >= private.report_v3_local_day_start(m.anchor_date + 31, p_time_zone)) AS is_mature
      FROM m
  ), b AS (
    SELECT bu.*, ki.root_lead_id, ki.client_id, r.receipt_at, fl.first_at,
           (SELECT lk.call_id FROM links lk WHERE lk.win_id = ANY (bu.first_set_win_ids) ORDER BY lk.call_id LIMIT 1) AS link_call_id
      FROM buyers bu JOIN keyinfo ki ON ki.identity_key = bu.identity_key
      LEFT JOIN rec r ON r.root_lead_id = ki.root_lead_id
      LEFT JOIN first_linked fl ON fl.identity_key = bu.identity_key
  ), b2 AS (
    SELECT b.*, lc.created_at AS link_at, lc.is_journey_contact AS link_is_contact,
           CASE WHEN b.root_lead_id IS NULL THEN 'hand_entered_client'
                WHEN b.receipt_at IS NULL THEN 'lead_receipt_unknown'
                WHEN b.first_at IS NOT NULL AND b.receipt_at > b.first_at THEN 'receipt_contradicted'
                WHEN (b.receipt_at AT TIME ZONE p_time_zone)::date > b.first_sold_date THEN 'sold_before_receipt'
                WHEN NOT b.assessable OR b.first_event_time_source = 'sold_date_proxy' THEN 'imported_already_sold' END AS gate14
      FROM b LEFT JOIN linked lc ON lc.call_id = b.link_call_id AND lc.identity_key = b.identity_key
  ), b3 AS (
    SELECT b2.*,
           CASE WHEN NOT b2.assessable OR b2.first_event_time_source = 'sold_date_proxy' THEN 'unclassified:imported_already_sold'
                WHEN b2.link_at IS NULL THEN 'unclassified:link'
                WHEN EXISTS (SELECT 1 FROM linked l WHERE l.identity_key = b2.identity_key AND l.is_journey_contact
                              AND (l.created_at, l.call_id) < (b2.link_at, b2.link_call_id)) THEN 'no'
                WHEN EXISTS (SELECT 1 FROM cand c JOIN nums n ON n.identity_key = b2.identity_key AND n.phone_last10 = c.phone_last10
                              WHERE c.created_at < b2.link_at AND c.could_qualify) THEN 'unclassified:possibly_related_unlinked_call'
                WHEN EXISTS (SELECT 1 FROM changes ch WHERE ch.identity_key = b2.identity_key AND ch.recorded_at < b2.link_at)
                  THEN 'unclassified:phone_changed'
                WHEN b2.link_is_contact THEN 'yes'
                ELSE 'unclassified:link' END AS class38
      FROM b2
  )
  SELECT 14, b3.identity_key, b3.first_seller_id, NULL::timestamptz, b3.first_sold_date, b3.gate14,
         CASE WHEN b3.gate14 IN ('hand_entered_client', 'lead_receipt_unknown') THEN 'lead_receipt_unknown'
              WHEN b3.gate14 IS NOT NULL THEN 'history_incomplete' END,
         b3.gate14 IS NULL,
         CASE WHEN b3.gate14 IS NULL THEN (b3.first_sold_date - (b3.receipt_at AT TIME ZONE p_time_zone)::date)::numeric END,
         NULL::boolean, NULL::boolean, NULL::text
    FROM b3
  UNION ALL
  SELECT 19, m2.identity_key, m2.credited_agent_id, m2.anchor_at, m2.anchor_date, m2.gate19,
         CASE WHEN m2.gate19 IN ('hand_entered_client', 'lead_receipt_unknown') THEN 'lead_receipt_unknown'
              WHEN m2.gate19 IS NOT NULL THEN 'history_incomplete' END,
         m2.gate19 IS NULL, NULL::numeric, m2.won, m2.is_mature, NULL::text
    FROM m2
  UNION ALL
  SELECT 21, m2.identity_key, m2.credited_agent_id, m2.anchor_at, m2.anchor_date, m2.gate21,
         CASE WHEN m2.gate21 IN ('hand_entered_client', 'lead_receipt_unknown') THEN 'lead_receipt_unknown'
              WHEN m2.gate21 IS NOT NULL THEN 'history_incomplete'
              WHEN m2.unverified_before THEN 'attempt_unverified' END,
         m2.gate21 IS NULL AND NOT m2.unverified_before,
         CASE WHEN m2.gate21 IS NULL AND NOT m2.unverified_before THEN m2.attempts::numeric END,
         NULL::boolean, NULL::boolean, NULL::text
    FROM m2
  UNION ALL
  SELECT 38, b3.identity_key, b3.first_seller_id, b3.link_at, b3.first_sold_date,
         CASE WHEN b3.class38 LIKE 'unclassified:%' AND b3.class38 <> 'unclassified:link' THEN substr(b3.class38, 14) END,
         CASE WHEN b3.class38 = 'unclassified:link' THEN 'sale_call_link_missing'
              WHEN b3.class38 LIKE 'unclassified:%' THEN 'history_incomplete' END,
         b3.class38 IN ('yes', 'no'), NULL::numeric, NULL::boolean, NULL::boolean,
         CASE WHEN b3.class38 LIKE 'unclassified:%' THEN 'unclassified' ELSE b3.class38 END
    FROM b3;
END $$;

-- -----------------------------------------------------------------------------------------------------
-- Journey KPI counts for one scope (D3 §3.3). No key, number, timestamp or call id leaves this function.
-- Numberless unresolved calls are read only at unfiltered agency scope (p_agents NULL); below it they have
-- no effect (BC1). Unresolved activity below agency scope counts only calls credited to p_agents.
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_v3_journey_facts(p_org uuid, p_agents uuid[], p_time_zone text, p_start_at timestamptz,
                                                p_end_at timestamptz, p_sold_from date, p_sold_until date, p_as_of timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  WITH jm AS MATERIALIZED (
    SELECT * FROM private.report_v3_journey_members(p_org, p_agents, p_time_zone, p_start_at, p_end_at,
                                                    p_sold_from, p_sold_until, p_as_of)
  ), lookback AS (
    SELECT greatest(
             (SELECT max(j.anchor_at) FROM jm j WHERE j.kpi = 19),
             (SELECT max(private.report_v3_local_day_start(j.anchor_date + 1, p_time_zone)) FROM jm j WHERE j.kpi = 14)) AS until_at
  ), unresolved AS MATERIALIZED (
    SELECT h.* FROM private.report_v3_call_facts(p_org, '-infinity'::timestamptz, p_as_of) h, lookback lb
     WHERE h.identity_key IS NULL AND lb.until_at IS NOT NULL AND h.created_at < lb.until_at
  ), numberless AS (
    SELECT CASE WHEN p_agents IS NULL THEN (SELECT count(*) FROM unresolved u
                                             WHERE u.phone_last10 IS NULL
                                               AND (u.direction_class = 'outbound' OR u.is_answered_inbound)) END AS n
  ), activity AS (
    SELECT jsonb_build_object(
             'outbound_attempts', count(*) FILTER (WHERE u.is_attempt),
             'contacted_calls', count(*) FILTER (WHERE u.is_attempt AND u.is_contacted),
             'answered_inbound', count(*) FILTER (WHERE u.is_answered_inbound)) AS a
      FROM unresolved u
     WHERE p_agents IS NULL OR u.credited_agent_id = ANY (p_agents)
  ), gates AS (
    SELECT j.kpi, jsonb_build_object(
             'lead_receipt_unknown', count(*) FILTER (WHERE j.gate = 'lead_receipt_unknown'),
             'receipt_contradicted', count(*) FILTER (WHERE j.gate = 'receipt_contradicted'),
             'possibly_related_unlinked_call', count(*) FILTER (WHERE j.gate = 'possibly_related_unlinked_call'),
             'phone_changed', count(*) FILTER (WHERE j.gate = 'phone_changed'),
             'sold_before_receipt', count(*) FILTER (WHERE j.gate = 'sold_before_receipt'),
             'imported_already_sold', count(*) FILTER (WHERE j.gate = 'imported_already_sold'),
             'hand_entered_client', count(*) FILTER (WHERE j.gate = 'hand_entered_client')) AS by_gate,
           count(*) AS members,
           count(*) FILTER (WHERE j.assessable) AS assessable,
           count(*) FILTER (WHERE j.coverage_code = 'lead_receipt_unknown') AS c_receipt,
           count(*) FILTER (WHERE j.coverage_code = 'history_incomplete') AS c_history,
           count(*) FILTER (WHERE j.coverage_code = 'attempt_unverified') AS c_unverified,
           count(*) FILTER (WHERE j.coverage_code = 'sale_call_link_missing') AS c_link,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY j.metric_value) FILTER (WHERE j.assessable) AS median,
           count(*) FILTER (WHERE j.assessable AND j.success) AS successes,
           count(*) FILTER (WHERE NOT j.mature) AS pending,
           count(*) FILTER (WHERE j.assessable AND j.success AND j.mature) AS mature_successes,
           max(j.anchor_date) AS last_anchor,
           count(*) FILTER (WHERE j.classification = 'yes') AS yes,
           count(*) FILTER (WHERE j.classification = 'no') AS no,
           count(*) FILTER (WHERE j.classification = 'unclassified') AS unclassified
      FROM jm j GROUP BY j.kpi
  ), k AS (
    SELECT x.kpi AS kpi_id, g.*
      FROM (VALUES (14), (19), (21), (38)) AS x(kpi) LEFT JOIN gates g ON g.kpi = x.kpi
  )
  SELECT jsonb_build_object(
    'numberless_unresolved_calls', (SELECT n FROM numberless),
    'unresolved_activity', (SELECT a FROM activity),
    'kpis', jsonb_object_agg(k.kpi_id::text, jsonb_build_object(
      'members', coalesce(k.members, 0),
      'assessable', coalesce(k.assessable, 0),
      'unassessable_by', coalesce(k.by_gate, jsonb_build_object(
        'lead_receipt_unknown', 0, 'receipt_contradicted', 0, 'possibly_related_unlinked_call', 0, 'phone_changed', 0,
        'sold_before_receipt', 0, 'imported_already_sold', 0, 'hand_entered_client', 0)),
      'reasons', jsonb_strip_nulls(jsonb_build_object(
        'lead_receipt_unknown', nullif(coalesce(k.c_receipt, 0), 0),
        'history_incomplete', nullif(coalesce(k.c_history, 0)
          + CASE WHEN k.kpi_id IN (19, 21, 38) THEN coalesce((SELECT n FROM numberless), 0) ELSE 0 END, 0),
        'attempt_unverified', nullif(coalesce(k.c_unverified, 0), 0),
        'sale_call_link_missing', nullif(coalesce(k.c_link, 0), 0))),
      'median', k.median,
      'successes', coalesce(k.successes, 0),
      'pending', coalesce(k.pending, 0),
      'mature_successes', coalesce(k.mature_successes, 0),
      'fully_mature_on', to_char(k.last_anchor + 31, 'YYYY-MM-DD'),
      'yes', coalesce(k.yes, 0), 'no', coalesce(k.no, 0), 'unclassified', coalesce(k.unclassified, 0))))
    FROM k;
$$;

-- -----------------------------------------------------------------------------------------------------
-- Call KPI counts for one scope (D3 §3.3): outbound credit is the placing agent; NULL-credited rows count
-- only at agency scope. Unverified rows are unknown evidence, never zero activity.
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_v3_call_counts(p_org uuid, p_agents uuid[], p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  WITH f AS (
    SELECT * FROM private.report_v3_call_facts(p_org, p_start, p_end) x
     WHERE x.direction_class = 'outbound' AND (p_agents IS NULL OR x.credited_agent_id = ANY (p_agents))
  )
  SELECT jsonb_build_object(
    'attempts', count(*) FILTER (WHERE f.is_attempt),
    'non_attempts', count(*) FILTER (WHERE f.attempt_class = 'non_attempt'),
    'unverified', count(*) FILTER (WHERE f.attempt_class = 'unverified'),
    'duplicates_excluded', (SELECT count(*) FROM private.performance_duplicate_rows d
                              JOIN public.calls c ON c.id = d.duplicate_id AND c.organization_id = p_org
                             WHERE d.organization_id = p_org AND d.kind = 'call'
                               AND c.created_at >= p_start AND c.created_at < p_end
                               AND (p_agents IS NULL OR c.agent_id = ANY (p_agents))),
    'contacted', count(*) FILTER (WHERE f.is_attempt AND f.is_contacted),
    'contacted_eligible', count(*) FILTER (WHERE f.is_attempt AND f.is_contacted AND f.identity_kind IS DISTINCT FROM 'recruit'),
    'contacted_resolved', count(*) FILTER (WHERE f.is_attempt AND f.is_contacted AND f.identity_kind IN ('lead', 'client')),
    'contacted_unresolved', count(*) FILTER (WHERE f.is_attempt AND f.is_contacted AND f.identity_key IS NULL),
    'reached', count(DISTINCT f.identity_key) FILTER (WHERE f.is_attempt AND f.is_contacted AND f.identity_kind IN ('lead', 'client')),
    'lead_stage_attempts', count(*) FILTER (WHERE f.is_attempt AND f.is_lead_stage),
    'lead_identities', count(DISTINCT f.identity_key) FILTER (WHERE f.is_attempt AND f.is_lead_stage),
    'unresolved_attempts', count(*) FILTER (WHERE f.is_attempt AND f.identity_key IS NULL),
    'lead_unverified', count(*) FILTER (WHERE f.attempt_class = 'unverified' AND (f.is_lead_stage OR f.identity_key IS NULL)))
    FROM f;
$$;

-- KPI 5–11 and 34 envelopes for one counts object and its policy count P (D2 KPI 2), only through the builders.
CREATE FUNCTION private.report_v3_call_kpis(p_counts jsonb, p_policies numeric)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_att numeric := (p_counts ->> 'attempts')::numeric;
  v_unv numeric := (p_counts ->> 'unverified')::numeric;
  v_con numeric := (p_counts ->> 'contacted')::numeric;
  v_ce numeric := (p_counts ->> 'contacted_eligible')::numeric;
  v_cr numeric := (p_counts ->> 'contacted_resolved')::numeric;
  v_cu numeric := (p_counts ->> 'contacted_unresolved')::numeric;
  v_reach numeric := (p_counts ->> 'reached')::numeric;
  v_ls numeric := (p_counts ->> 'lead_stage_attempts')::numeric;
  v_li numeric := (p_counts ->> 'lead_identities')::numeric;
  v_ua numeric := (p_counts ->> 'unresolved_attempts')::numeric;
  v_lu numeric := (p_counts ->> 'lead_unverified')::numeric;
  v_cov_att jsonb;
  v_cov_reach jsonb;
  v_cov_lead jsonb;
BEGIN
  IF v_att IS NULL OR v_unv IS NULL OR v_con IS NULL OR v_ce IS NULL OR v_cr IS NULL OR v_cu IS NULL OR v_reach IS NULL
     OR v_ls IS NULL OR v_li IS NULL OR v_ua IS NULL OR v_lu IS NULL OR p_policies IS NULL OR v_ce <> v_cr + v_cu THEN
    RAISE EXCEPTION 'reports v3 calls: inconsistent call KPI counts' USING ERRCODE = 'P0001';
  END IF;
  v_cov_att := jsonb_build_object('eligible', v_att + v_unv, 'assessable', v_att, 'unassessable', v_unv,
                                  'reasons', jsonb_strip_nulls(jsonb_build_object('attempt_unverified', nullif(v_unv, 0))));
  v_cov_reach := jsonb_build_object('eligible', v_ce, 'assessable', v_cr, 'unassessable', v_cu,
                                    'reasons', jsonb_strip_nulls(jsonb_build_object('unlinked_contacted_calls', nullif(v_cu, 0))));
  v_cov_lead := jsonb_build_object('eligible', v_ls + v_ua + v_lu, 'assessable', v_ls, 'unassessable', v_ua + v_lu,
                                   'reasons', jsonb_strip_nulls(jsonb_build_object('attempt_unverified', nullif(v_lu, 0),
                                                                                   'unlinked_calls_excluded', nullif(v_ua, 0))));
  RETURN jsonb_build_array(
    private.report_v3_total(5, v_att, v_cov_att, NULL, jsonb_build_object('call_population', jsonb_build_object(
      'attempts', v_att, 'non_attempts', p_counts -> 'non_attempts', 'unverified', v_unv,
      'duplicates_excluded', p_counts -> 'duplicates_excluded'))),
    private.report_v3_total(6, v_con),
    private.report_v3_total(7, v_reach, v_cov_reach),
    private.report_v3_rate(8, v_con, v_att, v_cov_att),
    private.report_v3_ratio(9, v_att, p_policies, v_cov_att),
    private.report_v3_ratio(10, v_con, p_policies),
    private.report_v3_ratio(11, v_reach, p_policies, v_cov_reach),
    private.report_v3_ratio(34, v_ls, v_li, v_cov_lead));
END $$;

-- KPI 14, 19, 21 and 38 envelopes from journey facts, only through the builders. KPI 38 reports
-- sale_call_link_not_captured until PKG-C installs captured links (basis flag).
CREATE FUNCTION private.report_v3_journey_kpis(p_facts jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_out jsonb := '[]'::jsonb;
  v_id int;
  v_k jsonb;
  v_members numeric;
  v_assessable numeric;
  v_cov jsonb;
  v_history jsonb;
  v_detail jsonb;
  v_maturity jsonb;
  v_numberless jsonb := p_facts -> 'numberless_unresolved_calls';
BEGIN
  FOREACH v_id IN ARRAY ARRAY[14, 19, 21, 38] LOOP
    v_k := p_facts -> 'kpis' -> v_id::text;
    IF v_k IS NULL THEN
      RAISE EXCEPTION 'reports v3 journey: facts missing for KPI %', v_id USING ERRCODE = 'P0001';
    END IF;
    v_members := (v_k ->> 'members')::numeric;
    v_assessable := CASE WHEN v_id = 38 THEN (v_k ->> 'yes')::numeric + (v_k ->> 'no')::numeric
                         ELSE (v_k ->> 'assessable')::numeric END;
    v_cov := CASE WHEN v_members > 0 OR v_k -> 'reasons' <> '{}'::jsonb THEN jsonb_build_object(
               'eligible', v_members, 'assessable', v_assessable, 'unassessable', v_members - v_assessable,
               'reasons', v_k -> 'reasons') END;
    v_history := jsonb_build_object('assessable', v_assessable, 'unassessable_by', v_k -> 'unassessable_by',
                                    'numberless_unresolved_calls', CASE WHEN v_id = 14 THEN 'null'::jsonb ELSE v_numberless END);
    v_detail := jsonb_build_object('history', v_history, 'unresolved_activity', p_facts -> 'unresolved_activity');
    IF v_id = 14 THEN
      v_out := v_out || jsonb_build_array(private.report_v3_median(14, (v_k ->> 'median')::numeric, v_assessable, v_cov, NULL, v_detail));
    ELSIF v_id = 21 THEN
      v_out := v_out || jsonb_build_array(private.report_v3_median(21, (v_k ->> 'median')::numeric, v_assessable, v_cov, NULL, v_detail));
    ELSIF v_id = 19 THEN
      v_maturity := CASE WHEN v_members > 0 THEN jsonb_build_object(
        'window_days', 30,
        'state', CASE WHEN (v_k ->> 'pending')::numeric > 0 THEN 'in_progress' ELSE 'complete' END,
        'members', v_members, 'pending', (v_k ->> 'pending')::numeric,
        'successes_to_date', (v_k ->> 'successes')::numeric,
        'mature_members', v_members - (v_k ->> 'pending')::numeric,
        'mature_successes', (v_k ->> 'mature_successes')::numeric,
        'fully_mature_on', v_k ->> 'fully_mature_on') END;
      v_out := v_out || jsonb_build_array(private.report_v3_rate(19, (v_k ->> 'successes')::numeric, v_assessable, v_cov,
                                                                 v_maturity, NULL, v_detail));
    ELSIF private.report_v3_basis_flags() ->> 'sale_call_links' = 'not_installed' THEN
      v_out := v_out || jsonb_build_array(private.report_v3_rate(38, 0, 0, NULL, NULL, 'sale_call_link_not_captured', NULL));
    ELSE
      v_out := v_out || jsonb_build_array(private.report_v3_rate(38, (v_k ->> 'yes')::numeric, v_assessable, v_cov, NULL, NULL,
        v_detail || jsonb_build_object('classification', jsonb_build_object(
          'yes', (v_k ->> 'yes')::numeric, 'no', (v_k ->> 'no')::numeric, 'unclassified', (v_k ->> 'unclassified')::numeric))));
    END IF;
  END LOOP;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION private.report_v3_contact_predicate(bigint, text, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_local_day_start(date, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_client_identity_key(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_contact_identity(uuid, uuid[], uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_call_facts(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_identity_receipts(uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_identity_numbers(uuid, text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_sale_call_links(uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_first_sales(uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_journey_members(uuid, uuid[], text, timestamptz, timestamptz, date, date, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_journey_facts(uuid, uuid[], text, timestamptz, timestamptz, date, date, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_call_counts(uuid, uuid[], timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_call_kpis(jsonb, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_journey_kpis(jsonb) FROM PUBLIC, anon, authenticated, service_role;

DO $postcondition$
DECLARE f record; r text; n int := 0;
BEGIN
  FOR f IN SELECT p.oid, p.prosecdef, p.proconfig, p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'private' AND p.proname IN ('report_v3_contact_predicate', 'report_v3_local_day_start',
                  'report_v3_client_identity_key', 'report_v3_contact_identity', 'report_v3_call_facts',
                  'report_v3_identity_receipts', 'report_v3_identity_numbers', 'report_v3_sale_call_links',
                  'report_v3_first_sales', 'report_v3_journey_members', 'report_v3_journey_facts', 'report_v3_call_counts',
                  'report_v3_call_kpis', 'report_v3_journey_kpis') LOOP
    n := n + 1;
    IF f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp'] OR f.proowner <> 'postgres'::regrole THEN
      RAISE EXCEPTION 'Reports v3 call journey: helper metadata mismatch: %', f.oid::regprocedure;
    END IF;
    FOREACH r IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(r, f.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'Reports v3 call journey: % can execute %', r, f.oid::regprocedure;
      END IF;
    END LOOP;
  END LOOP;
  IF n <> 14 THEN
    RAISE EXCEPTION 'Reports v3 call journey: expected 14 helpers, found %', n;
  END IF;
END $postcondition$;
