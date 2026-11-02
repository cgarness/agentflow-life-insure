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
--                                 attempt class (attempt / non_attempt / unverified), contact flags and identity,
--                                 by the readers' own call-row, pointer and identity blocks (one planned statement)
--   report_v3_identity_receipts   the earliest recorded lead start of each root lead (five sources)
--   report_v3_identity_numbers    a person's current numbers (lead, client, campaign memberships)
--   report_v3_sale_call_links     PKG-A stub: no rows until PKG-C
--   report_v3_first_sales         each identity's first sale and whether it is assessable
--   report_v3_journey_rows        one pass over the whole call history: a row per member and journey KPI and a
--                                 row per unresolved call (internal; never returned to a client)
--   report_v3_journey_members     the member rows of report_v3_journey_rows
--   report_v3_journey_facts_by    the journey KPI counts for the scope and each credited agent, from one read
--   report_v3_journey_facts       the journey KPI counts for one scope (no key, number, time or id)
--   report_v3_call_counts         the call KPI counts for one scope
--   report_v3_duplicates_excluded reviewed duplicate calls excluded from a window (call_population)
--   report_v3_attempt_kpis        KPI 5 and 6 envelopes from the attempt evidence (shared by call_kpis and the state modes)
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
    -- The cast sits under CASE: a join condition gives no evaluation order, so a hash join could otherwise
    -- cast a client or recruit key (22P02 at production volume).
    LEFT JOIN public.clients ck
           ON ck.lead_id = CASE WHEN r.identity_key LIKE 'lead:%' THEN substr(r.identity_key, 6)::uuid END
          AND ck.organization_id = p_org;
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
BEGIN
  IF p_org IS NULL OR p_start IS NULL OR p_end IS NULL THEN
    RAISE EXCEPTION 'reports v3 call facts: the organization and both bounds are required' USING ERRCODE = '22023';
  END IF;
  -- The readers' own call-row, pointer and identity blocks (byte-identical), as one constant statement planned for
  -- these bounds (EXECUTE ... USING); $4 NULL reads every pointer of the window.
  RETURN QUERY EXECUTE $q$
  WITH
  -- @call-rows begin: every call in [$2, $3) of organization $1, one row each, by the pinned v2 report_call_facts rules
  -- (same rows, same carried columns, reviewed duplicates excluded) plus the v3 evidence columns. The text between the
  -- markers is byte-identical wherever it appears (reportsV3Contracts.test.ts); a reader keeps only what it reads.
  dm AS (   -- the organization's dispositions keyed by id ('i:') and by lower(name) ('n:'), with the stage conversion flag
    SELECT 'i:' || d.id::text AS k, d.id, d.name, d.color, d.counts_as_contacted, d.dnc_auto_add, d.callback_scheduler,
           d.appointment_scheduler, ps.convert_to_client
      FROM public.dispositions d
      LEFT JOIN public.pipeline_stages ps ON ps.id = d.pipeline_stage_id AND ps.organization_id = $1
     WHERE d.organization_id = $1
    UNION ALL
    SELECT 'n:' || lower(d.name), d.id, d.name, d.color, d.counts_as_contacted, d.dnc_auto_add, d.callback_scheduler,
           d.appointment_scheduler, ps.convert_to_client
      FROM public.dispositions d
      LEFT JOIN public.pipeline_stages ps ON ps.id = d.pipeline_stage_id AND ps.organization_id = $1
     WHERE d.organization_id = $1
  ), cr AS (
    SELECT c.id AS call_id, c.created_at, c.agent_id AS placing_agent_id, c.contact_id, c.contact_type,
           c.campaign_lead_id AS raw_campaign_lead_id, c.contact_phone, c.answered_by_agent_id, c.outcome, c.voicemail_id,
           c.dialer_admission_required, adm.admitted, c.duration AS raw_duration, c.duration_source, c.duration_conflict,
           c.disposition_name AS raw_disposition_name,
           CASE WHEN lower(coalesce(c.direction, '')) = ANY (ARRAY['outbound', 'outgoing']) THEN 'outbound'
                WHEN lower(coalesce(c.direction, '')) = ANY (ARRAY['inbound', 'incoming']) THEN 'inbound'
                ELSE 'other' END AS direction_class,
           greatest(coalesce(c.duration, 0), 0)::bigint AS duration_seconds,
           CASE WHEN c.campaign_id IS NOT NULL THEN cmp.id ELSE mc.campaign_id END AS campaign_id,
           coalesce(l1.id, l2.id) AS lead_id,
           coalesce(nullif(btrim(coalesce(l1.lead_source, l2.lead_source)), ''), '(No source)') AS lead_source,
           dm.id AS resolved_disposition_id,
           dm.name AS resolved_disposition_name,
           coalesce(dm.color, '#6B7280') AS disposition_color,
           coalesce(dm.counts_as_contacted, false) AS disp_counts_contacted,
           coalesce(dm.convert_to_client, false) AS disp_converts,
           coalesce(dm.dnc_auto_add, false) AS disp_dnc,
           coalesce(dm.callback_scheduler, false) AS disp_callback,
           coalesce(dm.appointment_scheduler, false) AS disp_appointment
      FROM public.calls c
      -- v2: by id when the call has one, else by lower(name); the stage of whichever matched.
      LEFT JOIN dm ON dm.k = CASE WHEN c.disposition_id IS NOT NULL THEN 'i:' || c.disposition_id::text
                                  WHEN c.disposition_name IS NOT NULL THEN 'n:' || lower(c.disposition_name) END
      -- v2: the campaign is campaigns(coalesce(call campaign, membership campaign)) in the organization. Two joins, each
      -- provably unique, so a reader that does not read the campaign keeps neither.
      LEFT JOIN public.campaigns cmp ON cmp.id = c.campaign_id AND cmp.organization_id = $1
      LEFT JOIN (SELECT cl.id, (array_agg(k.id))[1] AS campaign_id
                   FROM public.campaign_leads cl
                   JOIN public.campaigns k ON k.id = cl.campaign_id AND k.organization_id = $1
                  GROUP BY cl.id) mc ON mc.id = c.campaign_lead_id
      LEFT JOIN public.leads l1 ON l1.id = c.lead_id AND l1.organization_id = $1
      LEFT JOIN public.leads l2
             ON c.lead_id IS NULL AND l2.id = c.contact_id AND (c.contact_type = 'lead' OR c.contact_type IS NULL)
            AND l2.organization_id = $1
      LEFT JOIN private.dialer_outbound_admissions adm ON adm.organization_id = $1 AND adm.call_id = c.id
     WHERE c.organization_id = $1 AND c.created_at >= $2 AND c.created_at < $3
       AND NOT EXISTS (SELECT 1 FROM private.performance_duplicate_rows d
                        WHERE d.organization_id = $1 AND d.kind = 'call' AND d.duplicate_id = c.id)
  ), cf AS (
    SELECT cr.*,
           CASE WHEN cr.direction_class = 'inbound' THEN coalesce(cr.placing_agent_id, cr.answered_by_agent_id)
                ELSE cr.placing_agent_id END AS credited_agent_id,
           CASE WHEN cr.resolved_disposition_id IS NOT NULL THEN cr.resolved_disposition_id::text
                WHEN nullif(btrim(cr.raw_disposition_name), '') IS NOT NULL THEN 'name:' || lower(btrim(cr.raw_disposition_name))
                ELSE 'none' END AS disposition_key,
           coalesce(cr.resolved_disposition_name, nullif(btrim(cr.raw_disposition_name), ''), '(No disposition)') AS disposition_name,
           CASE WHEN cr.direction_class <> 'outbound' THEN false
                WHEN lower(coalesce(cr.resolved_disposition_name, cr.raw_disposition_name, '')) = 'no answer' THEN false
                WHEN cr.duration_seconds > 45 THEN true
                WHEN cr.disp_counts_contacted THEN true
                ELSE false END AS is_contacted,
           CASE WHEN cr.direction_class <> 'outbound' THEN NULL
                WHEN NOT cr.dialer_admission_required OR cr.admitted IS TRUE THEN 'attempt'
                WHEN cr.admitted IS FALSE THEN 'non_attempt'
                ELSE 'unverified' END AS attempt_class,
           (cr.direction_class = 'inbound' AND (cr.placing_agent_id IS NOT NULL OR cr.outcome = 'forwarded_answered')
              AND cr.voicemail_id IS NULL) AS is_answered_inbound
      FROM cr
  ), cg AS (
    SELECT cf.*,
           coalesce(cf.attempt_class = 'attempt', false) AS is_attempt,
           (coalesce(cf.attempt_class = 'attempt', false) AND cf.is_contacted)
             OR (cf.is_answered_inbound AND CASE WHEN lower(cf.disposition_name) = 'no answer' THEN false
                                                 WHEN cf.duration_seconds > 45 THEN true
                                                 WHEN cf.disp_counts_contacted THEN true
                                                 ELSE false END) AS is_journey_contact,
           (lower(cf.disposition_name) <> 'no answer'
             AND (cf.disp_counts_contacted OR cf.raw_duration IS NULL OR cf.raw_duration > 45)) AS could_qualify,
           public.phone_last10(cf.contact_phone) AS phone_last10
      FROM cf
  ),
  -- @call-rows end
  -- @call-pointers begin: each pointer of the window resolved once (report_v3_contact_identity rules 1–8, its exact
  -- CASE order), one row per pointer. Pointers are read only from calls a scope could credit ($4: placing or answering
  -- agent), a superset of every row a caller keeps. Byte-identical wherever it appears (reportsV3Contracts.test.ts).
  ic AS (   -- contact pointers (rules 1–6)
    SELECT p.id,
           CASE WHEN r.id IS NOT NULL THEN 'recruit'
                WHEN k.id IS NOT NULL THEN CASE WHEN k.lead_id IS NOT NULL THEN 'lead' ELSE 'client' END
                WHEN l.id IS NOT NULL OR kc.id IS NOT NULL OR coalesce(cl.lead_id, lin.original_lead_id) IS NOT NULL THEN 'lead'
           END AS identity_kind,
           CASE WHEN r.id IS NOT NULL THEN r.id
                WHEN k.id IS NOT NULL THEN coalesce(k.lead_id, k.id)
                WHEN l.id IS NOT NULL THEN l.id
                WHEN kc.id IS NOT NULL THEN p.id
                ELSE coalesce(cl.lead_id, lin.original_lead_id)
           END AS identity_uuid,
           CASE WHEN r.id IS NOT NULL THEN 'recruit'
                WHEN k.id IS NOT NULL THEN 'client'
                WHEN l.id IS NOT NULL THEN 'lead'
                WHEN kc.id IS NOT NULL THEN 'converted_lead_pointer'
                WHEN cl.id IS NOT NULL AND coalesce(cl.lead_id, lin.original_lead_id) IS NOT NULL THEN 'legacy_membership_as_contact'
                WHEN cl.id IS NOT NULL THEN 'unresolved_membership_without_lead'
                ELSE 'unresolved_dangling_contact'
           END AS resolution,
           CASE WHEN ck.id IS NOT NULL THEN coalesce((ck.lead_conversion ->> 'converted_at')::timestamptz, ck.created_at) END
             AS converted_at
      FROM (SELECT DISTINCT c.contact_id AS id FROM public.calls c
             WHERE c.organization_id = $1 AND c.created_at >= $2 AND c.created_at < $3 AND c.contact_id IS NOT NULL
               AND ($4::uuid[] IS NULL OR c.agent_id = ANY ($4) OR c.answered_by_agent_id = ANY ($4))) p
      LEFT JOIN public.recruits r ON r.id = p.id AND r.organization_id = $1
      LEFT JOIN public.clients k ON k.id = p.id AND k.organization_id = $1
      LEFT JOIN public.leads l ON l.id = p.id AND l.organization_id = $1
      LEFT JOIN public.clients kc ON kc.lead_id = p.id AND kc.organization_id = $1
      LEFT JOIN public.campaign_leads cl ON cl.id = p.id AND cl.organization_id = $1
      LEFT JOIN private.dialer_conversion_lineage lin ON lin.organization_id = $1 AND lin.campaign_lead_id = p.id
      LEFT JOIN public.clients ck
             ON ck.lead_id = CASE WHEN r.id IS NULL AND (k.id IS NULL OR k.lead_id IS NOT NULL) THEN
                               CASE WHEN k.id IS NOT NULL THEN k.lead_id WHEN l.id IS NOT NULL THEN l.id
                                    WHEN kc.id IS NOT NULL THEN p.id ELSE coalesce(cl.lead_id, lin.original_lead_id) END END
            AND ck.organization_id = $1
  ), im AS (   -- campaign-membership pointers of calls with no contact (rules 7–8)
    SELECT p.id,
           CASE WHEN coalesce(cl.lead_id, lin.original_lead_id) IS NOT NULL THEN 'lead' END AS identity_kind,
           coalesce(cl.lead_id, lin.original_lead_id) AS identity_uuid,
           CASE WHEN cl.lead_id IS NOT NULL THEN 'campaign_membership'
                WHEN lin.original_lead_id IS NOT NULL THEN 'campaign_lineage'
                WHEN cl.id IS NOT NULL THEN 'unresolved_membership_without_lead'
                ELSE 'unresolved_no_link' END AS resolution,
           CASE WHEN ck.id IS NOT NULL THEN coalesce((ck.lead_conversion ->> 'converted_at')::timestamptz, ck.created_at) END
             AS converted_at
      FROM (SELECT DISTINCT c.campaign_lead_id AS id FROM public.calls c
             WHERE c.organization_id = $1 AND c.created_at >= $2 AND c.created_at < $3
               AND c.contact_id IS NULL AND c.campaign_lead_id IS NOT NULL
               AND ($4::uuid[] IS NULL OR c.agent_id = ANY ($4) OR c.answered_by_agent_id = ANY ($4))) p
      LEFT JOIN public.campaign_leads cl ON cl.id = p.id AND cl.organization_id = $1
      LEFT JOIN private.dialer_conversion_lineage lin ON lin.organization_id = $1 AND lin.campaign_lead_id = p.id
      LEFT JOIN public.clients ck ON ck.lead_id = coalesce(cl.lead_id, lin.original_lead_id) AND ck.organization_id = $1
  ),
  -- @call-pointers end
  -- @call-identity begin: each call's identity from its pointer (the contact pointer when the call has one, else its
  -- campaign membership; a recruit contact stays a recruit). identity_key is rebuilt as kind || ':' || uuid, the
  -- resolver's own format. Byte-identical wherever it appears (reportsV3Contracts.test.ts).
  cy AS (
    SELECT cg.*,
           CASE WHEN cg.contact_type = 'recruit' AND cg.contact_id IS NOT NULL THEN 'recruit'
                ELSE coalesce(xc.identity_kind, xm.identity_kind) END AS identity_kind,
           CASE WHEN cg.contact_type = 'recruit' AND cg.contact_id IS NOT NULL THEN cg.contact_id
                ELSE coalesce(xc.identity_uuid, xm.identity_uuid) END AS identity_uuid,
           CASE WHEN cg.contact_type = 'recruit' AND cg.contact_id IS NOT NULL THEN 'recruit'
                ELSE coalesce(xc.resolution, xm.resolution, 'unresolved_no_link') END AS resolution,
           coalesce(xc.converted_at, xm.converted_at) AS converted_at
      FROM cg
      -- The contact pointer when the call has one, else its campaign membership: two single-key hash joins. ic and im
      -- hold one row per pointer (each join above is on a primary or unique key), so DISTINCT ON changes no row; it
      -- tells the planner the key is unique even when the set is materialized for a second reader, so the pointer set
      -- is hashed and the calls stream past it.
      LEFT JOIN (SELECT DISTINCT ON (u.id) u.* FROM ic u) xc ON xc.id = cg.contact_id
      LEFT JOIN (SELECT DISTINCT ON (u.id) u.* FROM im u) xm ON cg.contact_id IS NULL AND xm.id = cg.raw_campaign_lead_id
  ), cx AS (
    SELECT cy.*, cy.identity_kind || ':' || cy.identity_uuid AS identity_key,
           (cy.identity_kind = 'lead' AND (cy.converted_at IS NULL OR cy.created_at < cy.converted_at)) AS is_lead_stage
      FROM cy
  ),
  -- @call-identity end
  facts AS (
    SELECT cx.call_id, cx.created_at, cx.direction_class, cx.placing_agent_id, cx.credited_agent_id, cx.duration_seconds,
           cx.duration_source, cx.duration_conflict, cx.attempt_class, cx.is_attempt, cx.is_contacted, cx.is_answered_inbound,
           cx.is_journey_contact, cx.could_qualify, cx.identity_key, cx.identity_kind, cx.is_lead_stage, cx.resolution,
           cx.phone_last10, cx.campaign_id, cx.lead_id, cx.lead_source, cx.disposition_key, cx.disposition_name,
           cx.disposition_color, cx.disp_counts_contacted, cx.disp_converts, cx.disp_dnc, cx.disp_callback, cx.disp_appointment
      FROM cx
  )
  SELECT * FROM facts
  $q$ USING p_org, p_start, p_end, NULL::uuid[];
END $$;

-- -----------------------------------------------------------------------------------------------------
-- Lead receipts and current numbers (D3 §3.2)
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_v3_identity_receipts(p_org uuid, p_root_lead_ids uuid[])
RETURNS TABLE (root_lead_id uuid, receipt_at timestamptz, receipt_source text)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  -- One constant statement planned for the identities given (EXECUTE ... USING), not for a parameter's default size.
  RETURN QUERY EXECUTE $q$
    -- A repeated id only repeats source rows, and the earliest is still taken once per id.
    WITH ids AS MATERIALIZED (
      SELECT i.id FROM unnest(coalesce($2, '{}'::uuid[])) AS i(id) WHERE i.id IS NOT NULL
    ), imports AS MATERIALIZED (
      -- Each import's strings once: string elements of a top-level array, keys of a top-level object, a top-level
      -- string. These are exactly the values the jsonb ? operator matches.
      SELECT h.created_at, s.v
        FROM public.import_history h
        CROSS JOIN LATERAL (
          SELECT e.v #>> '{}' AS v
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(h.imported_lead_ids) = 'array' THEN h.imported_lead_ids END) AS e(v)
           WHERE jsonb_typeof(e.v) = 'string'
          UNION ALL
          SELECT o.v FROM jsonb_object_keys(CASE WHEN jsonb_typeof(h.imported_lead_ids) = 'object'
                                                 THEN h.imported_lead_ids END) AS o(v)
          UNION ALL
          SELECT h.imported_lead_ids #>> '{}' WHERE jsonb_typeof(h.imported_lead_ids) = 'string') s
       WHERE h.organization_id = $1 AND h.undo_status IS NULL
    ), src AS (
      SELECT l.id, l.created_at AS at, 'lead_row' AS source
        FROM public.leads l JOIN ids ON ids.id = l.id WHERE l.organization_id = $1
      UNION ALL
      SELECT e.contact_id, e.recorded_at, 'contact_history'
        FROM public.contact_history_events e JOIN ids ON ids.id = e.contact_id
       WHERE e.organization_id = $1 AND e.contact_type = 'lead' AND e.action IN ('created', 'imported')
      UNION ALL
      SELECT c.lead_id, (c.lead_conversion ->> 'lead_created_at')::timestamptz, 'lead_conversion'
        FROM public.clients c JOIN ids ON ids.id = c.lead_id
       WHERE c.organization_id = $1 AND c.lead_conversion ? 'lead_created_at'
      UNION ALL
      SELECT ids.id, i.created_at, 'import_history'
        FROM imports i JOIN ids ON ids.id::text = i.v
      UNION ALL
      SELECT r.lead_id, r.created_at, 'google_sheets'
        FROM private.google_sheets_receipts r JOIN ids ON ids.id = r.lead_id
       WHERE r.organization_id = $1 AND r.outcome IN ('imported', 'imported_flagged')
    )
    SELECT DISTINCT ON (s.id) s.id, s.at, s.source FROM src s WHERE s.at IS NOT NULL ORDER BY s.id, s.at, s.source
  $q$ USING p_org, p_root_lead_ids;
END $$;

CREATE FUNCTION private.report_v3_identity_numbers(p_org uuid, p_identity_keys text[])
RETURNS TABLE (identity_key text, phone_last10 text, number_source text)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  -- One constant statement planned for the identities given (EXECUTE ... USING), not for a parameter's default size.
  RETURN QUERY EXECUTE $q$
    -- A repeated key only repeats raw rows; the final DISTINCT returns each number once.
    WITH k AS MATERIALIZED (
      SELECT y.* FROM (
        SELECT x.key,
               CASE WHEN x.key LIKE 'lead:%' THEN substr(x.key, 6)::uuid END AS lead_id,
               CASE WHEN x.key LIKE 'client:%' THEN substr(x.key, 8)::uuid END AS client_id
          FROM unnest(coalesce($2, '{}'::text[])) AS x(key)) y
       WHERE y.lead_id IS NOT NULL OR y.client_id IS NOT NULL
    ), raw AS (
      SELECT k.key, l.phone, 'lead' AS source FROM k JOIN public.leads l ON l.id = k.lead_id AND l.organization_id = $1
      UNION ALL
      SELECT k.key, c.phone, 'client' FROM k JOIN public.clients c ON c.organization_id = $1 AND c.id = k.client_id
      UNION ALL
      SELECT k.key, c.phone, 'client' FROM k JOIN public.clients c ON c.organization_id = $1 AND c.lead_id = k.lead_id
      UNION ALL
      SELECT k.key, cl.phone, 'campaign_membership' FROM k JOIN public.campaign_leads cl
        ON cl.organization_id = $1 AND k.lead_id IS NOT NULL AND cl.lead_id = k.lead_id
      UNION ALL
      SELECT k.key, cl.phone, 'campaign_lineage' FROM k
        JOIN private.dialer_conversion_lineage lin ON lin.organization_id = $1 AND lin.original_lead_id = k.lead_id
        JOIN public.campaign_leads cl ON cl.id = lin.campaign_lead_id AND cl.organization_id = $1
    )
    SELECT DISTINCT r.key, public.phone_last10(r.phone), r.source
      FROM raw r WHERE public.phone_last10(r.phone) IS NOT NULL
  $q$ USING p_org, p_identity_keys;
END $$;

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
  ), sets AS (   -- each identity's sales of one Sold Date (an undated first sale has no set)
    SELECT s.key, s.sold_date, array_agg(s.id ORDER BY s.id) AS win_ids
      FROM sales s WHERE s.sold_date IS NOT NULL GROUP BY s.key, s.sold_date
  )
  SELECT r.key,
         CASE WHEN r.key LIKE 'lead:%' THEN 'lead' ELSE 'client' END,
         r.contact_id, r.id, r.policy_id, r.sold_date, r.agent_id, r.event_time_source,
         st.win_ids,
         NOT r.any_undated AND r.policy_id IS NOT NULL AND r.sold_date IS NOT NULL,
         CASE WHEN r.any_undated THEN 'undated_sale' WHEN r.policy_id IS NULL THEN 'unlinked_legacy_sale' END
    FROM ranked r
    LEFT JOIN sets st ON st.key = r.key AND st.sold_date = r.sold_date
   WHERE r.rn = 1;
$$;

-- -----------------------------------------------------------------------------------------------------
-- Journey rows (proposed design; D3 §3.2 gates, BC1, BC2): one pass over the organization's whole call history,
-- shared by every scope that reads it. One internal row per member and KPI ('member'), and one per unresolved
-- outbound or answered inbound call ('unresolved', what report_v3_journey_facts counts):
--   19, 21  identities whose first journey contact (by any agent) is in [p_start_at, p_end_at) and is credited
--           in scope; prior buyers are not members (E1); prospects who never buy ARE members
--   14, 38  identities whose first sale is in [p_sold_from, p_sold_until) with an in-scope original seller
-- A gate makes a member unassessable for one KPI, only on evidence specific to that member and KPI. Phone
-- numbers only rule relatedness out for one member; they never link or attribute anything. Activity of
-- other people never changes a member's row (BC1). History is never narrowed to the reporting dates or to an
-- agent: p_agents only selects which first contacts and first sales are members.
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_v3_journey_rows(p_org uuid, p_agents uuid[], p_time_zone text, p_start_at timestamptz,
                                               p_end_at timestamptz, p_sold_from date, p_sold_until date, p_as_of timestamptz)
RETURNS TABLE (row_kind text, kpi integer, identity_key text, credited_agent_id uuid, anchor_at timestamptz, anchor_date date,
               gate text, coverage_code text, assessable boolean, metric_value numeric, success boolean, mature boolean,
               classification text, call_at timestamptz, numberless boolean, is_attempt boolean, is_contacted boolean,
               is_answered_inbound boolean)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_org IS NULL OR p_time_zone IS NULL OR p_start_at IS NULL OR p_end_at IS NULL OR p_sold_from IS NULL
     OR p_sold_until IS NULL OR p_as_of IS NULL THEN
    RAISE EXCEPTION 'reports v3 journey: the organization, time zone, windows and as_of are required' USING ERRCODE = '22023';
  END IF;
  -- One constant statement planned for these arguments (EXECUTE ... USING): the readers' own call-row, pointer and
  -- identity blocks over (-infinity, as_of) with no agent narrowing ($4 NULL), then each rule set-based.
  -- $5 agents, $6 time zone, $7/$8 contact window, $9/$10 sold window, $11 as_of.
  RETURN QUERY EXECUTE $q$
  WITH
  -- @call-rows begin: every call in [$2, $3) of organization $1, one row each, by the pinned v2 report_call_facts rules
  -- (same rows, same carried columns, reviewed duplicates excluded) plus the v3 evidence columns. The text between the
  -- markers is byte-identical wherever it appears (reportsV3Contracts.test.ts); a reader keeps only what it reads.
  dm AS (   -- the organization's dispositions keyed by id ('i:') and by lower(name) ('n:'), with the stage conversion flag
    SELECT 'i:' || d.id::text AS k, d.id, d.name, d.color, d.counts_as_contacted, d.dnc_auto_add, d.callback_scheduler,
           d.appointment_scheduler, ps.convert_to_client
      FROM public.dispositions d
      LEFT JOIN public.pipeline_stages ps ON ps.id = d.pipeline_stage_id AND ps.organization_id = $1
     WHERE d.organization_id = $1
    UNION ALL
    SELECT 'n:' || lower(d.name), d.id, d.name, d.color, d.counts_as_contacted, d.dnc_auto_add, d.callback_scheduler,
           d.appointment_scheduler, ps.convert_to_client
      FROM public.dispositions d
      LEFT JOIN public.pipeline_stages ps ON ps.id = d.pipeline_stage_id AND ps.organization_id = $1
     WHERE d.organization_id = $1
  ), cr AS (
    SELECT c.id AS call_id, c.created_at, c.agent_id AS placing_agent_id, c.contact_id, c.contact_type,
           c.campaign_lead_id AS raw_campaign_lead_id, c.contact_phone, c.answered_by_agent_id, c.outcome, c.voicemail_id,
           c.dialer_admission_required, adm.admitted, c.duration AS raw_duration, c.duration_source, c.duration_conflict,
           c.disposition_name AS raw_disposition_name,
           CASE WHEN lower(coalesce(c.direction, '')) = ANY (ARRAY['outbound', 'outgoing']) THEN 'outbound'
                WHEN lower(coalesce(c.direction, '')) = ANY (ARRAY['inbound', 'incoming']) THEN 'inbound'
                ELSE 'other' END AS direction_class,
           greatest(coalesce(c.duration, 0), 0)::bigint AS duration_seconds,
           CASE WHEN c.campaign_id IS NOT NULL THEN cmp.id ELSE mc.campaign_id END AS campaign_id,
           coalesce(l1.id, l2.id) AS lead_id,
           coalesce(nullif(btrim(coalesce(l1.lead_source, l2.lead_source)), ''), '(No source)') AS lead_source,
           dm.id AS resolved_disposition_id,
           dm.name AS resolved_disposition_name,
           coalesce(dm.color, '#6B7280') AS disposition_color,
           coalesce(dm.counts_as_contacted, false) AS disp_counts_contacted,
           coalesce(dm.convert_to_client, false) AS disp_converts,
           coalesce(dm.dnc_auto_add, false) AS disp_dnc,
           coalesce(dm.callback_scheduler, false) AS disp_callback,
           coalesce(dm.appointment_scheduler, false) AS disp_appointment
      FROM public.calls c
      -- v2: by id when the call has one, else by lower(name); the stage of whichever matched.
      LEFT JOIN dm ON dm.k = CASE WHEN c.disposition_id IS NOT NULL THEN 'i:' || c.disposition_id::text
                                  WHEN c.disposition_name IS NOT NULL THEN 'n:' || lower(c.disposition_name) END
      -- v2: the campaign is campaigns(coalesce(call campaign, membership campaign)) in the organization. Two joins, each
      -- provably unique, so a reader that does not read the campaign keeps neither.
      LEFT JOIN public.campaigns cmp ON cmp.id = c.campaign_id AND cmp.organization_id = $1
      LEFT JOIN (SELECT cl.id, (array_agg(k.id))[1] AS campaign_id
                   FROM public.campaign_leads cl
                   JOIN public.campaigns k ON k.id = cl.campaign_id AND k.organization_id = $1
                  GROUP BY cl.id) mc ON mc.id = c.campaign_lead_id
      LEFT JOIN public.leads l1 ON l1.id = c.lead_id AND l1.organization_id = $1
      LEFT JOIN public.leads l2
             ON c.lead_id IS NULL AND l2.id = c.contact_id AND (c.contact_type = 'lead' OR c.contact_type IS NULL)
            AND l2.organization_id = $1
      LEFT JOIN private.dialer_outbound_admissions adm ON adm.organization_id = $1 AND adm.call_id = c.id
     WHERE c.organization_id = $1 AND c.created_at >= $2 AND c.created_at < $3
       AND NOT EXISTS (SELECT 1 FROM private.performance_duplicate_rows d
                        WHERE d.organization_id = $1 AND d.kind = 'call' AND d.duplicate_id = c.id)
  ), cf AS (
    SELECT cr.*,
           CASE WHEN cr.direction_class = 'inbound' THEN coalesce(cr.placing_agent_id, cr.answered_by_agent_id)
                ELSE cr.placing_agent_id END AS credited_agent_id,
           CASE WHEN cr.resolved_disposition_id IS NOT NULL THEN cr.resolved_disposition_id::text
                WHEN nullif(btrim(cr.raw_disposition_name), '') IS NOT NULL THEN 'name:' || lower(btrim(cr.raw_disposition_name))
                ELSE 'none' END AS disposition_key,
           coalesce(cr.resolved_disposition_name, nullif(btrim(cr.raw_disposition_name), ''), '(No disposition)') AS disposition_name,
           CASE WHEN cr.direction_class <> 'outbound' THEN false
                WHEN lower(coalesce(cr.resolved_disposition_name, cr.raw_disposition_name, '')) = 'no answer' THEN false
                WHEN cr.duration_seconds > 45 THEN true
                WHEN cr.disp_counts_contacted THEN true
                ELSE false END AS is_contacted,
           CASE WHEN cr.direction_class <> 'outbound' THEN NULL
                WHEN NOT cr.dialer_admission_required OR cr.admitted IS TRUE THEN 'attempt'
                WHEN cr.admitted IS FALSE THEN 'non_attempt'
                ELSE 'unverified' END AS attempt_class,
           (cr.direction_class = 'inbound' AND (cr.placing_agent_id IS NOT NULL OR cr.outcome = 'forwarded_answered')
              AND cr.voicemail_id IS NULL) AS is_answered_inbound
      FROM cr
  ), cg AS (
    SELECT cf.*,
           coalesce(cf.attempt_class = 'attempt', false) AS is_attempt,
           (coalesce(cf.attempt_class = 'attempt', false) AND cf.is_contacted)
             OR (cf.is_answered_inbound AND CASE WHEN lower(cf.disposition_name) = 'no answer' THEN false
                                                 WHEN cf.duration_seconds > 45 THEN true
                                                 WHEN cf.disp_counts_contacted THEN true
                                                 ELSE false END) AS is_journey_contact,
           (lower(cf.disposition_name) <> 'no answer'
             AND (cf.disp_counts_contacted OR cf.raw_duration IS NULL OR cf.raw_duration > 45)) AS could_qualify,
           public.phone_last10(cf.contact_phone) AS phone_last10
      FROM cf
  ),
  -- @call-rows end
  -- @call-pointers begin: each pointer of the window resolved once (report_v3_contact_identity rules 1–8, its exact
  -- CASE order), one row per pointer. Pointers are read only from calls a scope could credit ($4: placing or answering
  -- agent), a superset of every row a caller keeps. Byte-identical wherever it appears (reportsV3Contracts.test.ts).
  ic AS (   -- contact pointers (rules 1–6)
    SELECT p.id,
           CASE WHEN r.id IS NOT NULL THEN 'recruit'
                WHEN k.id IS NOT NULL THEN CASE WHEN k.lead_id IS NOT NULL THEN 'lead' ELSE 'client' END
                WHEN l.id IS NOT NULL OR kc.id IS NOT NULL OR coalesce(cl.lead_id, lin.original_lead_id) IS NOT NULL THEN 'lead'
           END AS identity_kind,
           CASE WHEN r.id IS NOT NULL THEN r.id
                WHEN k.id IS NOT NULL THEN coalesce(k.lead_id, k.id)
                WHEN l.id IS NOT NULL THEN l.id
                WHEN kc.id IS NOT NULL THEN p.id
                ELSE coalesce(cl.lead_id, lin.original_lead_id)
           END AS identity_uuid,
           CASE WHEN r.id IS NOT NULL THEN 'recruit'
                WHEN k.id IS NOT NULL THEN 'client'
                WHEN l.id IS NOT NULL THEN 'lead'
                WHEN kc.id IS NOT NULL THEN 'converted_lead_pointer'
                WHEN cl.id IS NOT NULL AND coalesce(cl.lead_id, lin.original_lead_id) IS NOT NULL THEN 'legacy_membership_as_contact'
                WHEN cl.id IS NOT NULL THEN 'unresolved_membership_without_lead'
                ELSE 'unresolved_dangling_contact'
           END AS resolution,
           CASE WHEN ck.id IS NOT NULL THEN coalesce((ck.lead_conversion ->> 'converted_at')::timestamptz, ck.created_at) END
             AS converted_at
      FROM (SELECT DISTINCT c.contact_id AS id FROM public.calls c
             WHERE c.organization_id = $1 AND c.created_at >= $2 AND c.created_at < $3 AND c.contact_id IS NOT NULL
               AND ($4::uuid[] IS NULL OR c.agent_id = ANY ($4) OR c.answered_by_agent_id = ANY ($4))) p
      LEFT JOIN public.recruits r ON r.id = p.id AND r.organization_id = $1
      LEFT JOIN public.clients k ON k.id = p.id AND k.organization_id = $1
      LEFT JOIN public.leads l ON l.id = p.id AND l.organization_id = $1
      LEFT JOIN public.clients kc ON kc.lead_id = p.id AND kc.organization_id = $1
      LEFT JOIN public.campaign_leads cl ON cl.id = p.id AND cl.organization_id = $1
      LEFT JOIN private.dialer_conversion_lineage lin ON lin.organization_id = $1 AND lin.campaign_lead_id = p.id
      LEFT JOIN public.clients ck
             ON ck.lead_id = CASE WHEN r.id IS NULL AND (k.id IS NULL OR k.lead_id IS NOT NULL) THEN
                               CASE WHEN k.id IS NOT NULL THEN k.lead_id WHEN l.id IS NOT NULL THEN l.id
                                    WHEN kc.id IS NOT NULL THEN p.id ELSE coalesce(cl.lead_id, lin.original_lead_id) END END
            AND ck.organization_id = $1
  ), im AS (   -- campaign-membership pointers of calls with no contact (rules 7–8)
    SELECT p.id,
           CASE WHEN coalesce(cl.lead_id, lin.original_lead_id) IS NOT NULL THEN 'lead' END AS identity_kind,
           coalesce(cl.lead_id, lin.original_lead_id) AS identity_uuid,
           CASE WHEN cl.lead_id IS NOT NULL THEN 'campaign_membership'
                WHEN lin.original_lead_id IS NOT NULL THEN 'campaign_lineage'
                WHEN cl.id IS NOT NULL THEN 'unresolved_membership_without_lead'
                ELSE 'unresolved_no_link' END AS resolution,
           CASE WHEN ck.id IS NOT NULL THEN coalesce((ck.lead_conversion ->> 'converted_at')::timestamptz, ck.created_at) END
             AS converted_at
      FROM (SELECT DISTINCT c.campaign_lead_id AS id FROM public.calls c
             WHERE c.organization_id = $1 AND c.created_at >= $2 AND c.created_at < $3
               AND c.contact_id IS NULL AND c.campaign_lead_id IS NOT NULL
               AND ($4::uuid[] IS NULL OR c.agent_id = ANY ($4) OR c.answered_by_agent_id = ANY ($4))) p
      LEFT JOIN public.campaign_leads cl ON cl.id = p.id AND cl.organization_id = $1
      LEFT JOIN private.dialer_conversion_lineage lin ON lin.organization_id = $1 AND lin.campaign_lead_id = p.id
      LEFT JOIN public.clients ck ON ck.lead_id = coalesce(cl.lead_id, lin.original_lead_id) AND ck.organization_id = $1
  ),
  -- @call-pointers end
  -- @call-identity begin: each call's identity from its pointer (the contact pointer when the call has one, else its
  -- campaign membership; a recruit contact stays a recruit). identity_key is rebuilt as kind || ':' || uuid, the
  -- resolver's own format. Byte-identical wherever it appears (reportsV3Contracts.test.ts).
  cy AS (
    SELECT cg.*,
           CASE WHEN cg.contact_type = 'recruit' AND cg.contact_id IS NOT NULL THEN 'recruit'
                ELSE coalesce(xc.identity_kind, xm.identity_kind) END AS identity_kind,
           CASE WHEN cg.contact_type = 'recruit' AND cg.contact_id IS NOT NULL THEN cg.contact_id
                ELSE coalesce(xc.identity_uuid, xm.identity_uuid) END AS identity_uuid,
           CASE WHEN cg.contact_type = 'recruit' AND cg.contact_id IS NOT NULL THEN 'recruit'
                ELSE coalesce(xc.resolution, xm.resolution, 'unresolved_no_link') END AS resolution,
           coalesce(xc.converted_at, xm.converted_at) AS converted_at
      FROM cg
      -- The contact pointer when the call has one, else its campaign membership: two single-key hash joins. ic and im
      -- hold one row per pointer (each join above is on a primary or unique key), so DISTINCT ON changes no row; it
      -- tells the planner the key is unique even when the set is materialized for a second reader, so the pointer set
      -- is hashed and the calls stream past it.
      LEFT JOIN (SELECT DISTINCT ON (u.id) u.* FROM ic u) xc ON xc.id = cg.contact_id
      LEFT JOIN (SELECT DISTINCT ON (u.id) u.* FROM im u) xm ON cg.contact_id IS NULL AND xm.id = cg.raw_campaign_lead_id
  ), cx AS (
    SELECT cy.*, cy.identity_kind || ':' || cy.identity_uuid AS identity_key,
           (cy.identity_kind = 'lead' AND (cy.converted_at IS NULL OR cy.created_at < cy.converted_at)) AS is_lead_stage
      FROM cy
  ),
  -- @call-identity end
  hist AS MATERIALIZED (
    -- Every same-org call before as_of, by any agent, that the journey reads: a linked call (lead or client identity)
    -- or an unresolved outbound or answered inbound call, with a number only on unresolved rows (the only rows ever
    -- compared by number). The two kinds are flagged as plain columns so each reader's row count is estimated.
    SELECT y.* FROM (
      SELECT cx.call_id, cx.created_at, cx.credited_agent_id, cx.direction_class, cx.attempt_class, cx.is_attempt,
             cx.is_contacted, cx.is_answered_inbound, cx.is_journey_contact, cx.could_qualify, cx.identity_key,
             coalesce(cx.identity_kind IN ('lead', 'client'), false) AS is_linked,
             (cx.identity_key IS NULL AND (cx.direction_class = 'outbound' OR cx.is_answered_inbound)) AS is_unresolved,
             CASE WHEN cx.identity_key IS NULL THEN cx.phone_last10 END AS phone_last10
        FROM cx) y
     WHERE y.is_linked OR y.is_unresolved
  ), fs AS MATERIALIZED (
    SELECT * FROM private.report_v3_first_sales($1, $11)
  ), buyers AS (
    SELECT s.* FROM fs s
     WHERE s.first_sold_date >= $9 AND s.first_sold_date < $10
       AND ($5::uuid[] IS NULL OR s.first_seller_id = ANY ($5))
  ), cands AS MATERIALIZED (
    -- Candidate identities first: a member's first journey contact is in the window and credited in scope, so it has
    -- an in-window journey contact credited in scope; a buyer is a candidate as such. Each candidate's history below
    -- is then its whole same-org history: every agent, every date before as_of.
    SELECT h.identity_key FROM hist h
     WHERE h.is_linked AND h.is_journey_contact AND h.created_at >= $7 AND h.created_at < $8
       AND ($5::uuid[] IS NULL OR h.credited_agent_id = ANY ($5))
    UNION
    SELECT b.identity_key FROM buyers b
  ), lw AS MATERIALIZED (
    -- Each candidate's linked calls in (created_at, call_id) order, read once: its first journey contact (the first
    -- row that is one), the attempts before that row, its first linked call and its first unverified attempt.
    SELECT l.identity_key, l.call_id, l.created_at, l.credited_agent_id, l.direction_class, l.is_journey_contact,
           l.is_journey_contact AND NOT coalesce(bool_or(l.is_journey_contact) OVER w, false) AS is_first_contact,
           count(*) FILTER (WHERE l.is_attempt) OVER w AS attempts_before,
           min(l.created_at) OVER p AS first_at,
           min(l.created_at) FILTER (WHERE l.attempt_class = 'unverified') OVER p AS first_unverified_at
      FROM hist l
     WHERE l.is_linked AND l.identity_key IN (SELECT c.identity_key FROM cands c)
    WINDOW p AS (PARTITION BY l.identity_key COLLATE "C"),
           w AS (p ORDER BY l.created_at, l.call_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
  ), fc AS (
    SELECT f.identity_key, f.call_id AS anchor_call_id, f.created_at AS anchor_at,
           (f.created_at AT TIME ZONE $6)::date AS anchor_date, f.credited_agent_id, f.direction_class, f.attempts_before,
           f.first_unverified_at, s.first_sold_date
      FROM lw f LEFT JOIN fs s ON s.identity_key = f.identity_key
     WHERE f.is_first_contact AND f.created_at >= $7 AND f.created_at < $8
       AND ($5::uuid[] IS NULL OR f.credited_agent_id = ANY ($5))
       AND (s.first_sold_date IS NULL OR s.first_sold_date >= (f.created_at AT TIME ZONE $6)::date)
  ), keyinfo AS MATERIALIZED (
    -- A lead identity's converted client is unique (uq_clients_lead_id).
    SELECT k.identity_key, k.root_lead_id,
           CASE WHEN k.identity_key LIKE 'client:%' THEN substr(k.identity_key, 8)::uuid ELSE c.id END AS client_id
      FROM (SELECT u.identity_key,
                   CASE WHEN u.identity_key LIKE 'lead:%' THEN substr(u.identity_key, 6)::uuid END AS root_lead_id
              FROM (SELECT fc.identity_key FROM fc UNION SELECT b.identity_key FROM buyers b) u) k
      LEFT JOIN public.clients c ON c.organization_id = $1 AND c.lead_id = k.root_lead_id
  ), rec AS (
    SELECT * FROM private.report_v3_identity_receipts($1,
      (SELECT array_agg(ki.root_lead_id) FROM keyinfo ki WHERE ki.root_lead_id IS NOT NULL))
  ), nums AS MATERIALIZED (
    SELECT * FROM private.report_v3_identity_numbers($1, (SELECT array_agg(ki.identity_key) FROM keyinfo ki))
  ), cand AS MATERIALIZED (
    -- Unresolved calls (no link, dangling pointer, membership without a lead) by any agent: outbound rows and
    -- answered inbound rows; unanswered inbound rows never count.
    SELECT h.* FROM hist h WHERE h.is_unresolved
  ), rel AS (
    -- Per member, its earliest unresolved call on one of its own numbers (any, and one that could qualify): the member
    -- has such a call before a moment exactly when that earliest one is earlier.
    SELECT n.identity_key, min(c.created_at) AS any_at, min(c.created_at) FILTER (WHERE c.could_qualify) AS qual_at
      FROM nums n JOIN cand c ON n.phone_last10 = c.phone_last10
     GROUP BY n.identity_key
  ), chg AS (
    -- Per member, its earliest captured phone change on its own lead or client record.
    SELECT x.identity_key, min(x.recorded_at) AS first_at
      FROM (SELECT ki.identity_key, e.recorded_at
              FROM keyinfo ki
              JOIN public.contact_history_events e
                ON e.organization_id = $1 AND 'phone' = ANY (e.changed_fields)
               AND e.contact_type = 'lead' AND e.contact_id = ki.root_lead_id
            UNION ALL
            SELECT ki.identity_key, e.recorded_at
              FROM keyinfo ki
              JOIN public.contact_history_events e
                ON e.organization_id = $1 AND 'phone' = ANY (e.changed_fields)
               AND e.contact_type = 'client' AND e.contact_id = ki.client_id) x
     GROUP BY x.identity_key
  ), links AS (
    SELECT * FROM private.report_v3_sale_call_links($1, $11)
  ), m AS (
    SELECT fc.*, ki.root_lead_id, r.receipt_at,
           coalesce(rl.qual_at < fc.anchor_at, false) AS related_qualifying,
           coalesce(rl.any_at < fc.anchor_at, false) AS related_any,
           coalesce(ch.first_at < fc.anchor_at, false) AS phone_changed,
           coalesce(fc.first_unverified_at < fc.anchor_at, false) AS unverified_before,
           fc.attempts_before + CASE WHEN fc.direction_class = 'outbound' THEN 1 ELSE 0 END AS attempts
      FROM fc JOIN keyinfo ki ON ki.identity_key = fc.identity_key
      LEFT JOIN rec r ON r.root_lead_id = ki.root_lead_id
      LEFT JOIN rel rl ON rl.identity_key = fc.identity_key
      LEFT JOIN chg ch ON ch.identity_key = fc.identity_key
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
           ($11 >= private.report_v3_local_day_start(m.anchor_date + 31, $6)) AS is_mature
      FROM m
  ), fl AS (
    SELECT l.identity_key, min(l.first_at) AS first_at FROM lw l GROUP BY l.identity_key
  ), b AS (
    SELECT bu.*, ki.root_lead_id, ki.client_id, r.receipt_at, fl.first_at,
           (SELECT lk.call_id FROM links lk WHERE lk.win_id = ANY (bu.first_set_win_ids) ORDER BY lk.call_id LIMIT 1) AS link_call_id
      FROM buyers bu JOIN keyinfo ki ON ki.identity_key = bu.identity_key
      LEFT JOIN rec r ON r.root_lead_id = ki.root_lead_id
      LEFT JOIN fl ON fl.identity_key = bu.identity_key
  ), b2 AS (
    SELECT b.*, lc.created_at AS link_at, lc.is_journey_contact AS link_is_contact,
           CASE WHEN b.root_lead_id IS NULL THEN 'hand_entered_client'
                WHEN b.receipt_at IS NULL THEN 'lead_receipt_unknown'
                WHEN b.first_at IS NOT NULL AND b.receipt_at > b.first_at THEN 'receipt_contradicted'
                WHEN (b.receipt_at AT TIME ZONE $6)::date > b.first_sold_date THEN 'sold_before_receipt'
                WHEN NOT b.assessable OR b.first_event_time_source = 'sold_date_proxy' THEN 'imported_already_sold' END AS gate14
      FROM b LEFT JOIN lw lc ON lc.call_id = b.link_call_id AND lc.identity_key = b.identity_key
  ), b3 AS (
    -- A journey contact before the link exists exactly when the identity's first journey contact is before it.
    SELECT b2.*,
           CASE WHEN NOT b2.assessable OR b2.first_event_time_source = 'sold_date_proxy' THEN 'unclassified:imported_already_sold'
                WHEN b2.link_at IS NULL THEN 'unclassified:link'
                WHEN (fx.created_at, fx.call_id) < (b2.link_at, b2.link_call_id) THEN 'no'
                WHEN coalesce(rl.qual_at < b2.link_at, false) THEN 'unclassified:possibly_related_unlinked_call'
                WHEN coalesce(ch.first_at < b2.link_at, false) THEN 'unclassified:phone_changed'
                WHEN b2.link_is_contact THEN 'yes'
                ELSE 'unclassified:link' END AS class38
      FROM b2
      LEFT JOIN lw fx ON fx.identity_key = b2.identity_key AND fx.is_first_contact
      LEFT JOIN rel rl ON rl.identity_key = b2.identity_key
      LEFT JOIN chg ch ON ch.identity_key = b2.identity_key
  )
  SELECT 'member'::text, 14, b3.identity_key, b3.first_seller_id, NULL::timestamptz, b3.first_sold_date, b3.gate14,
         CASE WHEN b3.gate14 IN ('hand_entered_client', 'lead_receipt_unknown') THEN 'lead_receipt_unknown'
              WHEN b3.gate14 IS NOT NULL THEN 'history_incomplete' END,
         b3.gate14 IS NULL,
         CASE WHEN b3.gate14 IS NULL THEN (b3.first_sold_date - (b3.receipt_at AT TIME ZONE $6)::date)::numeric END,
         NULL::boolean, NULL::boolean, NULL::text,
         NULL::timestamptz, NULL::boolean, NULL::boolean, NULL::boolean, NULL::boolean
    FROM b3
  UNION ALL
  SELECT 'member', 19, m2.identity_key, m2.credited_agent_id, m2.anchor_at, m2.anchor_date, m2.gate19,
         CASE WHEN m2.gate19 IN ('hand_entered_client', 'lead_receipt_unknown') THEN 'lead_receipt_unknown'
              WHEN m2.gate19 IS NOT NULL THEN 'history_incomplete' END,
         m2.gate19 IS NULL, NULL::numeric, m2.won, m2.is_mature, NULL::text,
         NULL::timestamptz, NULL::boolean, NULL::boolean, NULL::boolean, NULL::boolean
    FROM m2
  UNION ALL
  SELECT 'member', 21, m2.identity_key, m2.credited_agent_id, m2.anchor_at, m2.anchor_date, m2.gate21,
         CASE WHEN m2.gate21 IN ('hand_entered_client', 'lead_receipt_unknown') THEN 'lead_receipt_unknown'
              WHEN m2.gate21 IS NOT NULL THEN 'history_incomplete'
              WHEN m2.unverified_before THEN 'attempt_unverified' END,
         m2.gate21 IS NULL AND NOT m2.unverified_before,
         CASE WHEN m2.gate21 IS NULL AND NOT m2.unverified_before THEN m2.attempts::numeric END,
         NULL::boolean, NULL::boolean, NULL::text,
         NULL::timestamptz, NULL::boolean, NULL::boolean, NULL::boolean, NULL::boolean
    FROM m2
  UNION ALL
  SELECT 'member', 38, b3.identity_key, b3.first_seller_id, b3.link_at, b3.first_sold_date,
         CASE WHEN b3.class38 LIKE 'unclassified:%' AND b3.class38 <> 'unclassified:link' THEN substr(b3.class38, 14) END,
         CASE WHEN b3.class38 = 'unclassified:link' THEN 'sale_call_link_missing'
              WHEN b3.class38 LIKE 'unclassified:%' THEN 'history_incomplete' END,
         b3.class38 IN ('yes', 'no'), NULL::numeric, NULL::boolean, NULL::boolean,
         CASE WHEN b3.class38 LIKE 'unclassified:%' THEN 'unclassified' ELSE b3.class38 END,
         NULL::timestamptz, NULL::boolean, NULL::boolean, NULL::boolean, NULL::boolean
    FROM b3
  UNION ALL
  SELECT 'unresolved', NULL::integer, NULL::text, c.credited_agent_id, NULL::timestamptz, NULL::date, NULL::text, NULL::text,
         NULL::boolean, NULL::numeric, NULL::boolean, NULL::boolean, NULL::text,
         c.created_at, c.phone_last10 IS NULL, c.is_attempt, c.is_contacted, c.is_answered_inbound
    FROM cand c
  $q$ USING p_org, '-infinity'::timestamptz, p_as_of, NULL::uuid[], p_agents, p_time_zone, p_start_at, p_end_at,
            p_sold_from, p_sold_until, p_as_of;
END $$;

-- The member rows of report_v3_journey_rows, unchanged in meaning and shape.
CREATE FUNCTION private.report_v3_journey_members(p_org uuid, p_agents uuid[], p_time_zone text, p_start_at timestamptz,
                                                  p_end_at timestamptz, p_sold_from date, p_sold_until date, p_as_of timestamptz)
RETURNS TABLE (kpi integer, identity_key text, credited_agent_id uuid, anchor_at timestamptz, anchor_date date, gate text,
               coverage_code text, assessable boolean, metric_value numeric, success boolean, mature boolean,
               classification text)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT r.kpi, r.identity_key, r.credited_agent_id, r.anchor_at, r.anchor_date, r.gate, r.coverage_code, r.assessable,
         r.metric_value, r.success, r.mature, r.classification
    FROM private.report_v3_journey_rows(p_org, p_agents, p_time_zone, p_start_at, p_end_at, p_sold_from, p_sold_until,
                                        p_as_of) r
   WHERE r.row_kind = 'member';
$$;

-- -----------------------------------------------------------------------------------------------------
-- Journey KPI counts (D3 §3.3) for the scope and, with p_by_agent, for each credited agent, all from one read of
-- report_v3_journey_rows. Each group counts only its own member rows (the scope: all; an agent: those credited to
-- it), so nothing is summed or averaged across groups and every median is its own group's. Group rows: 'scope'; an
-- 'agent' row per agent with members; one 'empty' row, an agent group with no members (what any other roster agent
-- reads). No key, number, timestamp or call id leaves this function.
-- Numberless unresolved calls are read only at unfiltered agency scope (p_agents NULL); below it they have
-- no effect (BC1). A group's unresolved activity counts calls credited to it (the scope: to p_agents) before its
-- own lookback.
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_v3_journey_facts_by(p_org uuid, p_agents uuid[], p_by_agent boolean, p_time_zone text,
                                                   p_start_at timestamptz, p_end_at timestamptz, p_sold_from date,
                                                   p_sold_until date, p_as_of timestamptz)
RETURNS TABLE (grp text, agent_id uuid, facts jsonb)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  WITH jr AS MATERIALIZED (
    SELECT * FROM private.report_v3_journey_rows(p_org, p_agents, p_time_zone, p_start_at, p_end_at,
                                                 p_sold_from, p_sold_until, p_as_of)
  ), jm AS (
    SELECT * FROM jr WHERE jr.row_kind = 'member'
  ), g AS MATERIALIZED (   -- the groups: g_kind, g_agent (NULL but for an agent group)
    SELECT 'scope'::text AS g_kind, NULL::uuid AS g_agent
    UNION ALL
    SELECT 'agent', a.credited_agent_id FROM (SELECT DISTINCT j.credited_agent_id FROM jm j) a
     WHERE p_by_agent AND a.credited_agent_id IS NOT NULL
    UNION ALL
    SELECT 'empty', NULL WHERE p_by_agent
  ), gm AS (   -- every member row in the scope group and in its credited agent's group
    SELECT 'scope'::text AS g_kind, NULL::uuid AS g_agent, j.* FROM jm j
    UNION ALL
    SELECT 'agent', j.credited_agent_id, j.* FROM jm j WHERE p_by_agent AND j.credited_agent_id IS NOT NULL
  ), lookback AS (
    -- A group's lookback ends at its latest KPI 19 anchor or at the start of the day after its latest KPI 14 anchor
    -- (report_v3_local_day_start rises with the day, so the latest day gives the latest start).
    SELECT m.g_kind, m.g_agent,
           greatest(max(m.anchor_at) FILTER (WHERE m.kpi = 19),
                    private.report_v3_local_day_start(max(m.anchor_date) FILTER (WHERE m.kpi = 14) + 1, p_time_zone))
             AS until_at
      FROM gm m GROUP BY m.g_kind, m.g_agent
  ), unresolved AS (
    SELECT u.* FROM jr u WHERE u.row_kind = 'unresolved'
  ), gu AS (   -- each group's unresolved calls before its own lookback
    SELECT l.g_kind, l.g_agent, u.*
      FROM lookback l JOIN unresolved u ON u.call_at < l.until_at
     WHERE l.g_kind = 'scope'
    UNION ALL
    SELECT l.g_kind, l.g_agent, u.*
      FROM lookback l JOIN unresolved u ON u.credited_agent_id = l.g_agent AND u.call_at < l.until_at
     WHERE l.g_kind = 'agent'
  ), ua AS (
    SELECT u.g_kind, u.g_agent,
           count(*) FILTER (WHERE u.numberless) AS numberless,
           count(*) FILTER (WHERE u.is_attempt AND (u.g_kind = 'agent' OR p_agents IS NULL
                                                    OR u.credited_agent_id = ANY (p_agents))) AS outbound_attempts,
           count(*) FILTER (WHERE u.is_attempt AND u.is_contacted AND (u.g_kind = 'agent' OR p_agents IS NULL
                                                                     OR u.credited_agent_id = ANY (p_agents))) AS contacted_calls,
           count(*) FILTER (WHERE u.is_answered_inbound AND (u.g_kind = 'agent' OR p_agents IS NULL
                                                            OR u.credited_agent_id = ANY (p_agents))) AS answered_inbound
      FROM gu u GROUP BY u.g_kind, u.g_agent
  ), gates AS (
    SELECT j.g_kind, j.g_agent, j.kpi, jsonb_build_object(
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
      FROM gm j GROUP BY j.g_kind, j.g_agent, j.kpi
  ), k AS (
    SELECT g.g_kind, g.g_agent, x.kpi AS kpi_id, ga.by_gate, ga.members, ga.assessable, ga.c_receipt, ga.c_history,
           ga.c_unverified, ga.c_link, ga.median, ga.successes, ga.pending, ga.mature_successes, ga.last_anchor, ga.yes,
           ga.no, ga.unclassified,
           CASE WHEN g.g_kind = 'scope' AND p_agents IS NULL THEN coalesce(a.numberless, 0) END AS numberless
      FROM g CROSS JOIN (VALUES (14), (19), (21), (38)) AS x(kpi)
      LEFT JOIN gates ga ON ga.g_kind = g.g_kind AND ga.g_agent IS NOT DISTINCT FROM g.g_agent AND ga.kpi = x.kpi
      LEFT JOIN ua a ON a.g_kind = g.g_kind AND a.g_agent IS NOT DISTINCT FROM g.g_agent
  ), kj AS (   -- each group's KPI object, built once per group
    SELECT k.g_kind, k.g_agent, jsonb_object_agg(k.kpi_id::text, jsonb_build_object(
      'members', coalesce(k.members, 0),
      'assessable', coalesce(k.assessable, 0),
      'unassessable_by', coalesce(k.by_gate, jsonb_build_object(
        'lead_receipt_unknown', 0, 'receipt_contradicted', 0, 'possibly_related_unlinked_call', 0, 'phone_changed', 0,
        'sold_before_receipt', 0, 'imported_already_sold', 0, 'hand_entered_client', 0)),
      'reasons', jsonb_strip_nulls(jsonb_build_object(
        'lead_receipt_unknown', nullif(coalesce(k.c_receipt, 0), 0),
        'history_incomplete', nullif(coalesce(k.c_history, 0)
          + CASE WHEN k.kpi_id IN (19, 21, 38) THEN coalesce(k.numberless, 0) ELSE 0 END, 0),
        'attempt_unverified', nullif(coalesce(k.c_unverified, 0), 0),
        'sale_call_link_missing', nullif(coalesce(k.c_link, 0), 0))),
      'median', k.median,
      'successes', coalesce(k.successes, 0),
      'pending', coalesce(k.pending, 0),
      'mature_successes', coalesce(k.mature_successes, 0),
      'fully_mature_on', to_char(k.last_anchor + 31, 'YYYY-MM-DD'),
      'yes', coalesce(k.yes, 0), 'no', coalesce(k.no, 0), 'unclassified', coalesce(k.unclassified, 0))) AS kpis
      FROM k GROUP BY k.g_kind, k.g_agent
  )
  SELECT g.g_kind, g.g_agent, jsonb_build_object(
    'numberless_unresolved_calls', CASE WHEN g.g_kind = 'scope' AND p_agents IS NULL THEN coalesce(a.numberless, 0) END,
    'unresolved_activity', jsonb_build_object('outbound_attempts', coalesce(a.outbound_attempts, 0),
                                              'contacted_calls', coalesce(a.contacted_calls, 0),
                                              'answered_inbound', coalesce(a.answered_inbound, 0)),
    'kpis', kj.kpis)
    FROM g
    LEFT JOIN ua a ON a.g_kind = g.g_kind AND a.g_agent IS NOT DISTINCT FROM g.g_agent
    LEFT JOIN kj ON kj.g_kind = g.g_kind AND kj.g_agent IS NOT DISTINCT FROM g.g_agent;
$$;

-- -----------------------------------------------------------------------------------------------------
-- Journey KPI counts for one scope (D3 §3.3): the scope group of report_v3_journey_facts_by.
-- -----------------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_v3_journey_facts(p_org uuid, p_agents uuid[], p_time_zone text, p_start_at timestamptz,
                                                p_end_at timestamptz, p_sold_from date, p_sold_until date, p_as_of timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT f.facts FROM private.report_v3_journey_facts_by(p_org, p_agents, false, p_time_zone, p_start_at, p_end_at,
                                                         p_sold_from, p_sold_until, p_as_of) f
   WHERE f.grp = 'scope';
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

-- Reviewed duplicates excluded from the window (call_population.duplicates_excluded): placing agent in scope, as
-- report_v3_call_counts has always counted them.
CREATE FUNCTION private.report_v3_duplicates_excluded(p_org uuid, p_agents uuid[], p_start timestamptz, p_end timestamptz)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  -- Driven from the reviewed rows (few per organization): one primary-key lookup each, whatever the window.
  SELECT count(*) FROM private.performance_duplicate_rows d
   CROSS JOIN LATERAL (SELECT 1 FROM public.calls c
                        WHERE c.id = d.duplicate_id AND c.organization_id = p_org
                          AND c.created_at >= p_start AND c.created_at < p_end
                          AND (p_agents IS NULL OR c.agent_id = ANY (p_agents))) x
   WHERE d.organization_id = p_org AND d.kind = 'call';
$$;

-- KPI 5 and 6 envelopes from one counts object's attempt evidence (attempts, unverified, non_attempts,
-- duplicates_excluded, contacted), only through the builders. report_v3_call_kpis and the state reader's modes share it.
CREATE FUNCTION private.report_v3_attempt_kpis(p_counts jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_att numeric := (p_counts ->> 'attempts')::numeric;
  v_unv numeric := (p_counts ->> 'unverified')::numeric;
  v_con numeric := (p_counts ->> 'contacted')::numeric;
BEGIN
  IF v_att IS NULL OR v_unv IS NULL OR v_con IS NULL THEN
    RAISE EXCEPTION 'reports v3 calls: inconsistent call KPI counts' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_array(
    private.report_v3_total(5, v_att, jsonb_build_object(
      'eligible', v_att + v_unv, 'assessable', v_att, 'unassessable', v_unv,
      'reasons', jsonb_strip_nulls(jsonb_build_object('attempt_unverified', nullif(v_unv, 0)))), NULL,
      jsonb_build_object('call_population', jsonb_build_object(
        'attempts', v_att, 'non_attempts', p_counts -> 'non_attempts', 'unverified', v_unv,
        'duplicates_excluded', p_counts -> 'duplicates_excluded'))),
    private.report_v3_total(6, v_con));
END $$;

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
  RETURN private.report_v3_attempt_kpis(p_counts) || jsonb_build_array(
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
REVOKE ALL ON FUNCTION private.report_v3_journey_rows(uuid, uuid[], text, timestamptz, timestamptz, date, date, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_journey_members(uuid, uuid[], text, timestamptz, timestamptz, date, date, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_journey_facts_by(uuid, uuid[], boolean, text, timestamptz, timestamptz, date, date,
                                                            timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_journey_facts(uuid, uuid[], text, timestamptz, timestamptz, date, date, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_call_counts(uuid, uuid[], timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_duplicates_excluded(uuid, uuid[], timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_attempt_kpis(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_call_kpis(jsonb, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_journey_kpis(jsonb) FROM PUBLIC, anon, authenticated, service_role;

DO $postcondition$
DECLARE f record; r text; n int := 0;
BEGIN
  FOR f IN SELECT p.oid, p.prosecdef, p.proconfig, p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'private' AND p.proname IN ('report_v3_contact_predicate', 'report_v3_local_day_start',
                  'report_v3_client_identity_key', 'report_v3_contact_identity', 'report_v3_call_facts',
                  'report_v3_identity_receipts', 'report_v3_identity_numbers', 'report_v3_sale_call_links',
                  'report_v3_first_sales', 'report_v3_journey_rows', 'report_v3_journey_members', 'report_v3_journey_facts_by',
                  'report_v3_journey_facts', 'report_v3_call_counts',
                  'report_v3_duplicates_excluded', 'report_v3_attempt_kpis', 'report_v3_call_kpis', 'report_v3_journey_kpis') LOOP
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
  IF n <> 18 THEN
    RAISE EXCEPTION 'Reports v3 call journey: expected 18 helpers, found %', n;
  END IF;
END $postcondition$;
