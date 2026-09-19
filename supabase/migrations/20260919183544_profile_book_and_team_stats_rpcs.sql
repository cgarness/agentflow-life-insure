-- =====================================================================================================
-- Agent Profile / Team Profile aggregates
--   private.profile_parse_currency(text)      -> numeric
--   private.profile_parse_iso_date(text)      -> date
--   private.resolve_downline_ids(uuid, uuid)  -> setof uuid
--   public.get_profile_book_stats(text, text) -> 1 row
--   public.get_profile_team_readiness()       -> 1 row
--   index public.clients (assigned_agent_id)
-- =====================================================================================================
-- STATUS: AUTHORED for the Agent Profile + Team Profile rebuild (implementation_plan.md section B,
-- rev 1, decisions D-1 to D-9 approved by Chris 2026-09-19). Applied ONLY to disposable localhost
-- databases. NOT APPLIED to jncvvsvckxhqgqvkppmj or any other hosted project. PRODUCTION APPLY IS
-- SEPARATELY GATED and requires Chris's explicit approval of this exact file.
--
-- -----------------------------------------------------------------------------------------------
-- WHY THESE FUNCTIONS EXIST
-- -----------------------------------------------------------------------------------------------
-- public.clients RLS ("Clients Hierarchical Access") resolves a Team Leader's downline through
-- public.is_ancestor_of, which reads profiles.hierarchy_path. In production 7 of 12 stored paths do
-- not match public.compute_hierarchy_path(), and 7 profiles that carry an upline_id still hold a
-- depth-1 self-label, so is_ancestor_of can succeed for at most 1 of 8 real upline relationships.
-- A plain Agent has no downline branch in that policy at all.
--
-- The consequence is not a performance problem: for an Agent or a Team Leader the downline's client
-- rows are NEVER RETURNED over PostgREST, at any volume, under any pagination. A client-side team
-- book-of-business aggregate is therefore structurally impossible, which is why this work is in SQL.
--
-- These functions do NOT change any RLS policy. "Clients Hierarchical Access" is untouched and every
-- existing PostgREST surface behaves exactly as before. What they add is an aggregate-only view of a
-- scope the product already intends a Team Leader to have, and it is strictly narrower than
-- public.get_org_leaderboard_stats, which already returns ORG-WIDE, PER-AGENT policies sold and
-- annualized premium to every authenticated caller including a plain Agent.
--
-- -----------------------------------------------------------------------------------------------
-- METRIC CANON (implementation_plan.md section B.4; AGENT_RULES invariant #34)
-- -----------------------------------------------------------------------------------------------
--  * THE BOOK OF BUSINESS IS clients + clients.custom_fields.additional_policies. public.wins is
--    NEVER read here. wins is a frozen sale-time event log: one win per conversion regardless of
--    policy count, no win at all for a manually created or CSV-imported client, a disposition name
--    in policy_type for quick-call wins, and no update when the client is later edited. Production
--    already holds one win whose policy_type disagrees with its client's.
--  * PREMIUM IS MONTHLY and is NEVER multiplied by 12 here. clients.premium is canonical;
--    clients.premium_amount is deferred schema debt and is neither read nor written.
--    src/lib/policyPaymentFields.ts states the rule: payment_frequency is schedule metadata only,
--    and clients.premium stays MONTHLY dollars regardless of frequency.
--  * A PRIMARY POLICY IS EVIDENCE-BASED (decision D-3b). clients.policy_type is NOT NULL DEFAULT
--    'Term' and supabase/functions/import-contacts sets no policy columns at all, so every
--    CSV-imported contact would otherwise register as a Term policy worth $0. A clients row
--    contributes a primary policy only when at least one of carrier / policy_number / premium > 0 /
--    face_amount > 0 / sold_date is populated. Clients that contribute none are still counted in
--    total_clients and are reported separately as clients_without_policy_detail.
--  * 0 MEANS "NOT RECORDED" for premium and face_amount (both DEFAULT 0), matching
--    formatCurrencyValue's rule that a missing or zero value renders blank and never a fabricated $0.
--  * ADDITIONAL-POLICY AMOUNTS ARE RAW USER STRINGS ("$150/mo"), never parsed by the writer, and the
--    sale date lives under soldDate OR the legacy issueDate key (documented at
--    src/lib/supabase-conversion.ts:8-10). Both are handled below.
--  * LICENSED STATES ARE NORMALIZED. agent_state_licenses.state is mixed-format in production ("CA"
--    and "California" are distinct rows under the raw (agent_id, state) unique index), so every state
--    measure goes through public.normalize_us_state().
--
-- -----------------------------------------------------------------------------------------------
-- SECURITY MODEL
-- -----------------------------------------------------------------------------------------------
--  * Actor resolution is DELEGATED to private.campaign_actor(), deliberately rather than duplicated.
--    Its body contains nothing campaign-specific: it requires auth.uid(), requires organization
--    context, reads role / organization_id / is_super_admin / status from public.profiles (the
--    DB-authoritative row, NEVER the JWT role claim, which public.get_user_role() reads with no
--    profiles fallback), and raises SQLSTATE 42501 when the caller is unauthenticated, has no org
--    context, has no profile, is in a different organization, or is not Active. Writing a second
--    actor resolver is the drift AGENT_RULES repeatedly forbids. THE COUPLING IS REAL AND
--    INTENTIONAL: a future change to private.campaign_actor() changes profile authorization too,
--    which is why supabase/tests/profile_book_stats_rpc.sql pins its contract.
--  * NO CALLER-SUPPLIED AGENT LIST. Neither function accepts an agent id, an organization id, or a
--    role. The scope is derived from auth.uid() alone, matching get_org_leaderboard_stats' contract.
--    Passing ids from the browser would require the server to re-derive the scope in order to
--    authorize them, so it would buy nothing and add an attack surface.
--  * AGGREGATE ONLY, NO CLIENT PII. Counts, sums, carrier names, policy-type labels, state codes and
--    month/day buckets cross the boundary. No client name, phone, email, address, policy number or
--    client id is ever returned. The team readiness function returns counts only, never a per-agent
--    row: the roster is already available client-side because public.profiles is org-wide readable.
--  * FAIL CLOSED. An unknown p_scope raises 22023. An unknown IANA time zone raises 22023. A downline
--    traversal that resolves nothing still constrains every aggregate to the empty set - there is no
--    branch anywhere below in which an unresolved scope widens to the organization.
--  * search_path is pinned to pg_catalog, pg_temp and every non-catalog object is schema-qualified,
--    following the newest house form (20260820233402_get_dialer_campaign_presence_rpc.sql).
--
-- -----------------------------------------------------------------------------------------------
-- SCOPE BY ROLE (decisions D-1, D-2; mirrors src/lib/effectiveViewer.ts isOrganizationWideViewer)
-- -----------------------------------------------------------------------------------------------
--   p_scope = 'self'  -> exactly auth.uid(), for every role.
--   p_scope = 'team'  -> Admin / Super Admin / is_super_admin: every Active profile in the caller's
--                        own organization (the established agency-wide contract that clients RLS and
--                        get_org_leaderboard_stats already grant those roles).
--                     -> everyone else, Agent included (D-2): private.resolve_downline_ids from
--                        auth.uid() over profiles.upline_id. Role does not gate the traversal; the
--                        upline_id edges do, so an Agent with nobody beneath them resolves to
--                        exactly [self] and the UI shows its "No team yet" state.
--   Impersonation cannot reach here: "View As" is a client-side swap of useAuth().profile and never
--   changes the database actor, and /agent-profile is excluded from the View As allow-list anyway.
--
-- -----------------------------------------------------------------------------------------------
-- ROLLBACK
-- -----------------------------------------------------------------------------------------------
--   supabase/migrations/rollback/20260919210000_profile_book_and_team_stats_rpcs.rollback.sql
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------
-- 1. private.profile_parse_currency(text) -> numeric
--
-- A byte-for-byte behavioural mirror of parseCurrencyToNumberOrNull (src/lib/supabase-clients.ts:189).
-- The TypeScript is: String(s).replace(/[^0-9.-]+/g, "") then parseFloat, with "", "-" and "." all
-- returning null. parseFloat consumes a LEADING number and ignores trailing junk, so "1-2" is 1 and
-- "1.2.3" is 1.2 - the leading-number regex below reproduces exactly that rather than attempting a
-- cast that would raise on the same input.
--
-- The repo has TWO currency parsers with OPPOSITE blank semantics: parseCurrencyToNumberOrNull
-- (blank -> null) and parseCurrencyToNumber (src/lib/supabase-conversion.ts:46, blank -> 0). This
-- build uses the OrNull semantics everywhere, so a blank premium can never become a 0 that silently
-- drags a book total down.
-- -----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.profile_parse_currency(p_raw text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE
           WHEN p_raw IS NULL THEN NULL
           ELSE pg_catalog.substring(
                  pg_catalog.regexp_replace(p_raw, '[^0-9.-]+', '', 'g'),
                  '^-?[0-9]*\.?[0-9]+'
                )::numeric
         END;
$$;

COMMENT ON FUNCTION private.profile_parse_currency(text) IS
  'Behavioural mirror of parseCurrencyToNumberOrNull (src/lib/supabase-clients.ts): strips everything but digits, dot and minus, then takes the leading number exactly as JS parseFloat would. Blank / "-" / "." yield NULL, never 0.';

-- -----------------------------------------------------------------------------------------------
-- 2. private.profile_parse_iso_date(text) -> date
--
-- additional_policies.soldDate / issueDate / effectiveDate are free-form text written by the browser.
-- Only a strict YYYY-MM-DD is accepted, and a syntactically valid but nonexistent date (2026-02-31)
-- yields NULL instead of to_date's silent roll-forward to 2026-03-03. An undated policy is excluded
-- from month bucketing and counted in undated_policies - it is never folded into a guessed month.
-- -----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.profile_parse_iso_date(p_raw text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_trimmed text;
BEGIN
  IF p_raw IS NULL THEN
    RETURN NULL;
  END IF;

  v_trimmed := pg_catalog.btrim(p_raw);

  IF v_trimmed !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RETURN NULL;
  END IF;

  BEGIN
    RETURN v_trimmed::date;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END;
$$;

COMMENT ON FUNCTION private.profile_parse_iso_date(text) IS
  'Strict YYYY-MM-DD parser for additional_policies date strings. An impossible date (2026-02-31) returns NULL rather than rolling forward the way to_date would.';

-- -----------------------------------------------------------------------------------------------
-- 3. private.resolve_downline_ids(p_root uuid, p_org uuid) -> setof uuid
--
-- The SQL half of the one downline rule. Its TypeScript counterpart is
-- usersSupabaseApi.getAgentScopeIds (src/lib/supabase-users.ts:196-252), and the two are held equal
-- by a shared fixture table asserted against both (src/lib/__tests__/hierarchyParity.test.ts and
-- supabase/tests/profile_book_stats_rpc.sql). Every rule below mirrors that function deliberately:
--
--   * upline_id edges only. profiles.hierarchy_path is NOT read - it is defective in production and
--     repairing it is a separate, tracked security follow-up that would re-activate Team Leader
--     branches in several RLS policies at once (AGENT_RULES invariant #26).
--   * organization_id is constrained at EVERY level, not just the root, so a cross-organization
--     upline_id edge can never pull a foreign profile into scope.
--   * self-edges (upline_id = id) and cycles are broken by the visited-path array, so a mis-wired
--     hierarchy terminates instead of looping.
--   * depth is capped at 100 levels, matching AGENT_SCOPE_MAX_ROUNDS.
--   * the traversal passes THROUGH status='Deleted' profiles but excludes them from the result, so a
--     deleted intermediate manager does not sever the authorized descendants beneath them.
--   * the root is returned unconditionally, matching getAgentScopeIds seeding its scope set with the
--     viewer id before the walk begins.
--
-- The base case additionally requires the root profile to exist in p_org. If it does not, the
-- function returns the empty set and every aggregate built on it collapses to zero rows - it cannot
-- widen. In practice private.campaign_actor() has already proven the row exists, is Active and is in
-- the caller's organization before this is ever reached.
-- -----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.resolve_downline_ids(p_root uuid, p_org uuid)
RETURNS TABLE (agent_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  WITH RECURSIVE walk AS (
    SELECT p.id,
           p.status,
           ARRAY[p.id] AS visited,
           1           AS depth
    FROM public.profiles p
    WHERE p.id = p_root
      AND p.organization_id = p_org
    UNION ALL
    SELECT c.id,
           c.status,
           w.visited || c.id,
           w.depth + 1
    FROM public.profiles c
    JOIN walk w ON c.upline_id = w.id
    WHERE c.organization_id = p_org
      AND c.id <> w.id
      AND NOT (c.id = ANY (w.visited))
      AND w.depth < 100
  )
  SELECT DISTINCT w.id
  FROM walk w
  WHERE w.id = p_root
     OR coalesce(w.status, '') IS DISTINCT FROM 'Deleted';
$$;

COMMENT ON FUNCTION private.resolve_downline_ids(uuid, uuid) IS
  'Self + authorized downline over profiles.upline_id ONLY (never hierarchy_path), organization-constrained at every level, cycle-safe, depth-capped at 100, walking through status=Deleted profiles while excluding them from the result. SQL counterpart of usersSupabaseApi.getAgentScopeIds; the two are pinned equal by a shared fixture suite.';

REVOKE ALL ON FUNCTION private.profile_parse_currency(text)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.profile_parse_iso_date(text)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.resolve_downline_ids(uuid, uuid)   FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------------------------
-- 4. public.get_profile_book_stats(p_scope text, p_time_zone text) -> exactly one row
--
-- p_scope      : 'self' | 'team'. Anything else raises 22023.
-- p_time_zone  : optional IANA zone name, validated against pg_catalog.pg_timezone_names. Used ONLY
--                by the most_dials_day achievement, and only for p_scope='self'. profiles.timezone
--                cannot be used: it stores Rails/ActiveSupport labels ("Eastern Time (US & Canada)")
--                which are not IANA and cannot drive date math (AGENT_RULES invariant #14). An
--                unknown zone raises rather than silently bucketing in UTC.
--
-- Truncation is never silent: carrier_breakdown and policy_type_mix are capped and the remainder is
-- reported in the *_overflow_* scalars, so the UI can always state what it folded away.
-- -----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_profile_book_stats(
  p_scope     text,
  p_time_zone text DEFAULT NULL
)
RETURNS TABLE (
  scope_agent_count              integer,
  total_clients                  bigint,
  clients_without_policy_detail  bigint,
  total_policies                 bigint,
  additional_policy_count        bigint,
  malformed_additional_policies  bigint,
  total_premium_monthly          numeric,
  policies_missing_premium       bigint,
  undated_policies               bigint,
  distinct_carriers              integer,
  distinct_licensed_states       integer,
  carrier_breakdown              jsonb,
  carrier_overflow_policies      bigint,
  policy_type_mix                jsonb,
  policy_type_overflow_policies  bigint,
  achievements                   jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor    RECORD;
  v_org_wide boolean;
  v_scope    uuid[];
BEGIN
  -- Raises 42501 for unauthenticated / no org context / missing profile / org mismatch / non-Active.
  SELECT * INTO v_actor FROM private.campaign_actor();

  IF p_scope IS NULL OR p_scope NOT IN ('self', 'team') THEN
    RAISE EXCEPTION 'get_profile_book_stats: p_scope must be ''self'' or ''team''' USING ERRCODE = '22023';
  END IF;

  IF p_time_zone IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = p_time_zone) THEN
    RAISE EXCEPTION 'get_profile_book_stats: unknown IANA time zone' USING ERRCODE = '22023';
  END IF;

  v_org_wide := v_actor.actor_role IN ('Admin', 'Super Admin') OR v_actor.is_super;

  IF p_scope = 'self' THEN
    v_scope := ARRAY[v_actor.uid];
  ELSIF v_org_wide THEN
    SELECT pg_catalog.array_agg(p.id)
      INTO v_scope
      FROM public.profiles p
     WHERE p.organization_id = v_actor.org_id
       AND p.status = 'Active';
  ELSE
    SELECT pg_catalog.array_agg(d.agent_id)
      INTO v_scope
      FROM private.resolve_downline_ids(v_actor.uid, v_actor.org_id) d;
  END IF;

  -- Fail closed. An unresolved scope aggregates over the empty set; it never widens.
  IF v_scope IS NULL THEN
    v_scope := ARRAY[]::uuid[];
  END IF;

  RETURN QUERY
  WITH scoped_clients AS (
    SELECT c.id,
           c.policy_type,
           c.carrier,
           c.policy_number,
           c.premium,
           c.face_amount,
           c.sold_date,
           c.custom_fields
    FROM public.clients c
    WHERE c.organization_id = v_actor.org_id
      AND c.assigned_agent_id = ANY (v_scope)
  ),
  primary_policies AS (
    SELECT sc.id                                                      AS client_id,
           nullif(pg_catalog.btrim(sc.policy_type), '')    AS policy_type,
           nullif(pg_catalog.btrim(sc.carrier), '')        AS carrier,
           CASE WHEN sc.premium     > 0 THEN sc.premium     END       AS premium_monthly,
           CASE WHEN sc.face_amount > 0 THEN sc.face_amount END       AS face_amount,
           sc.sold_date                                               AS sold_date
    FROM scoped_clients sc
    -- D-3b: evidence-based. A clients row with no policy signal at all contributes no policy.
    WHERE nullif(pg_catalog.btrim(sc.carrier), '')       IS NOT NULL
       OR nullif(pg_catalog.btrim(sc.policy_number), '') IS NOT NULL
       OR sc.premium     > 0
       OR sc.face_amount > 0
       OR sc.sold_date   IS NOT NULL
  ),
  -- jsonb_array_elements() RAISES on a non-array ("cannot extract elements from a scalar"), and a
  -- non-array is exactly what the FullScreenContactView corruption produces. Guarding that with a
  -- WHERE clause would make correctness depend on the planner pushing a single-relation restriction
  -- below the LATERAL join — which it does today, but which is a plan property rather than a
  -- contract. Substituting an empty array INSIDE the LATERAL argument is unconditionally safe
  -- whatever plan is chosen, and the corrupted rows are still counted by the `malformed` CTE below.
  additional_elements AS (
    SELECT sc.id AS client_id, e.value AS entry
    FROM scoped_clients sc
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
      CASE
        WHEN pg_catalog.jsonb_typeof(sc.custom_fields -> 'additional_policies') = 'array'
        THEN sc.custom_fields -> 'additional_policies'
        ELSE '[]'::jsonb
      END
    ) e
  ),
  additional_policies AS (
    SELECT ae.client_id,
           nullif(pg_catalog.btrim(ae.entry ->> 'policyType'), '') AS policy_type,
           nullif(pg_catalog.btrim(ae.entry ->> 'carrier'), '')    AS carrier,
           CASE WHEN private.profile_parse_currency(ae.entry ->> 'premiumAmount') > 0
                THEN private.profile_parse_currency(ae.entry ->> 'premiumAmount') END AS premium_monthly,
           CASE WHEN private.profile_parse_currency(ae.entry ->> 'faceAmount') > 0
                THEN private.profile_parse_currency(ae.entry ->> 'faceAmount') END    AS face_amount,
           -- Legacy tolerance: rows written before the Sold Date build carry issueDate.
           private.profile_parse_iso_date(
             coalesce(ae.entry ->> 'soldDate', ae.entry ->> 'issueDate')
           ) AS sold_date
    FROM additional_elements ae
    WHERE pg_catalog.jsonb_typeof(ae.entry) = 'object'
  ),
  all_policies AS (
    SELECT 'primary'::text AS source, * FROM primary_policies
    UNION ALL
    SELECT 'additional'::text AS source, * FROM additional_policies
  ),
  -- Honest data-quality signal, never a silent zero: a container that is present but is not an
  -- array (the FullScreenContactView text-input corruption path), plus any non-object element.
  malformed AS (
    SELECT (
      (SELECT pg_catalog.count(*)
         FROM scoped_clients sc
        WHERE sc.custom_fields ? 'additional_policies'
          AND pg_catalog.jsonb_typeof(sc.custom_fields -> 'additional_policies') <> 'array')
      +
      (SELECT pg_catalog.count(*)
         FROM additional_elements ae
        WHERE pg_catalog.jsonb_typeof(ae.entry) <> 'object')
    )::bigint AS malformed_count
  ),
  carrier_rows AS (
    SELECT ap.carrier                                                       AS carrier,
           pg_catalog.count(*)::bigint                                      AS policies,
           coalesce(pg_catalog.sum(ap.premium_monthly), 0)::numeric AS premium_monthly
    FROM all_policies ap
    GROUP BY ap.carrier
  ),
  carrier_ranked AS (
    SELECT cr.*, pg_catalog.row_number() OVER (
             ORDER BY cr.policies DESC, cr.premium_monthly DESC, cr.carrier ASC NULLS LAST
           ) AS rn
    FROM carrier_rows cr
  ),
  type_rows AS (
    SELECT ap.policy_type                                                   AS policy_type,
           pg_catalog.count(*)::bigint                                      AS policies,
           coalesce(pg_catalog.sum(ap.premium_monthly), 0)::numeric AS premium_monthly
    FROM all_policies ap
    GROUP BY ap.policy_type
  ),
  type_ranked AS (
    SELECT tr.*, pg_catalog.row_number() OVER (
             ORDER BY tr.policies DESC, tr.premium_monthly DESC, tr.policy_type ASC NULLS LAST
           ) AS rn
    FROM type_rows tr
  ),
  months AS (
    SELECT pg_catalog.to_char(pg_catalog.date_trunc('month', ap.sold_date), 'YYYY-MM') AS bucket,
           pg_catalog.count(*)::bigint                                                 AS policies,
           coalesce(pg_catalog.sum(ap.premium_monthly), 0)::numeric         AS premium_monthly
    FROM all_policies ap
    WHERE ap.sold_date IS NOT NULL
    GROUP BY 1
  ),
  dial_day AS (
    SELECT pg_catalog.to_char((cl.created_at AT TIME ZONE p_time_zone)::date, 'YYYY-MM-DD') AS bucket,
           pg_catalog.count(*)::bigint AS dials
    FROM public.calls cl
    WHERE p_time_zone IS NOT NULL
      AND p_scope = 'self'
      AND cl.organization_id = v_actor.org_id
      AND cl.agent_id = ANY (v_scope)
      AND pg_catalog.lower(coalesce(cl.direction, '')) = ANY (ARRAY['outbound', 'outgoing'])
    GROUP BY 1
  )
  SELECT
    pg_catalog.cardinality(v_scope)::integer,
    (SELECT pg_catalog.count(*)::bigint FROM scoped_clients),
    (SELECT pg_catalog.count(*)::bigint FROM scoped_clients sc
      WHERE NOT EXISTS (SELECT 1 FROM primary_policies pp WHERE pp.client_id = sc.id)),
    (SELECT pg_catalog.count(*)::bigint FROM all_policies),
    (SELECT pg_catalog.count(*)::bigint FROM additional_policies),
    (SELECT m.malformed_count FROM malformed m),
    (SELECT coalesce(pg_catalog.sum(ap.premium_monthly), 0)::numeric FROM all_policies ap),
    (SELECT pg_catalog.count(*)::bigint FROM all_policies ap WHERE ap.premium_monthly IS NULL),
    (SELECT pg_catalog.count(*)::bigint FROM all_policies ap WHERE ap.sold_date IS NULL),
    (SELECT pg_catalog.count(*)::integer FROM carrier_rows cr WHERE cr.carrier IS NOT NULL),
    (SELECT pg_catalog.count(DISTINCT public.normalize_us_state(l.state))::integer
       FROM public.agent_state_licenses l
      WHERE l.organization_id = v_actor.org_id
        AND l.agent_id = ANY (v_scope)),
    (SELECT coalesce(
              pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                  'carrier',         cr.carrier,
                  'policies',        cr.policies,
                  'premium_monthly', cr.premium_monthly
                ) ORDER BY cr.rn
              ), '[]'::jsonb)
       FROM carrier_ranked cr WHERE cr.rn <= 100),
    (SELECT coalesce(pg_catalog.sum(cr.policies), 0)::bigint
       FROM carrier_ranked cr WHERE cr.rn > 100),
    (SELECT coalesce(
              pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                  'policy_type',     tr.policy_type,
                  'policies',        tr.policies,
                  'premium_monthly', tr.premium_monthly
                ) ORDER BY tr.rn
              ), '[]'::jsonb)
       FROM type_ranked tr WHERE tr.rn <= 100),
    (SELECT coalesce(pg_catalog.sum(tr.policies), 0)::bigint
       FROM type_ranked tr WHERE tr.rn > 100),
    pg_catalog.jsonb_build_object(
      'largest_face', (
        SELECT pg_catalog.jsonb_build_object(
                 'face_amount', ap.face_amount,
                 'carrier',     ap.carrier,
                 'policy_type', ap.policy_type,
                 'sold_date',   ap.sold_date
               )
        FROM all_policies ap
        WHERE ap.face_amount IS NOT NULL
        ORDER BY ap.face_amount DESC, ap.sold_date DESC NULLS LAST
        LIMIT 1
      ),
      'largest_premium', (
        SELECT pg_catalog.jsonb_build_object(
                 'premium_monthly', ap.premium_monthly,
                 'carrier',         ap.carrier,
                 'policy_type',     ap.policy_type,
                 'sold_date',       ap.sold_date
               )
        FROM all_policies ap
        WHERE ap.premium_monthly IS NOT NULL
        ORDER BY ap.premium_monthly DESC, ap.sold_date DESC NULLS LAST
        LIMIT 1
      ),
      'best_premium_month', (
        SELECT pg_catalog.jsonb_build_object(
                 'month', m.bucket, 'premium_monthly', m.premium_monthly, 'policies', m.policies)
        FROM months m
        WHERE m.premium_monthly > 0
        ORDER BY m.premium_monthly DESC, m.bucket DESC
        LIMIT 1
      ),
      'most_policies_month', (
        SELECT pg_catalog.jsonb_build_object(
                 'month', m.bucket, 'policies', m.policies, 'premium_monthly', m.premium_monthly)
        FROM months m
        ORDER BY m.policies DESC, m.bucket DESC
        LIMIT 1
      ),
      'most_dials_day', (
        SELECT pg_catalog.jsonb_build_object(
                 'day', d.bucket, 'dials', d.dials, 'time_zone', p_time_zone)
        FROM dial_day d
        ORDER BY d.dials DESC, d.bucket DESC
        LIMIT 1
      )
    );
END;
$$;

COMMENT ON FUNCTION public.get_profile_book_stats(text, text) IS
  'Lifetime book-of-business aggregate for the Agent Profile (p_scope=''self'') and Team Profile (p_scope=''team''). Reads clients + clients.custom_fields.additional_policies ONLY - never public.wins. Premium is MONTHLY and is never annualized; clients.premium_amount is never read. Scope derives from auth.uid() alone via private.campaign_actor and private.resolve_downline_ids (upline_id, never hierarchy_path) and fails closed. Aggregate only: no client PII crosses the boundary.';

REVOKE ALL ON FUNCTION public.get_profile_book_stats(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_book_stats(text, text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------------------------
-- 5. public.get_profile_team_readiness() -> exactly one row
--
-- Counts only. The roster itself is NOT returned: public.profiles is already org-wide readable
-- (profiles_select_org is TO public with organization_id = get_user_org_id(), and permissive
-- policies combine with OR), so the browser builds the downline preview and the org tree from its
-- own query-scoped read. Duplicating the roster here would move PII across a boundary for nothing.
--
-- licenses_without_expiration is returned deliberately. agent_state_licenses.expiration_date is NULL
-- on 17 of 18 production rows, and expirationStatus() classifies those as 'none', not 'ok'. Omitting
-- the count would let the card read healthier than the data supports.
-- -----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_profile_team_readiness()
RETURNS TABLE (
  scope_agent_count            integer,
  direct_reports               integer,
  total_downline               integer,
  max_depth                    integer,
  ready_count                  integer,
  needs_npn                    integer,
  needs_resident_state         integer,
  needs_resident_license       integer,
  needs_carrier                integer,
  expired_licenses             integer,
  expiring_licenses_30d        integer,
  licenses_without_expiration  integer,
  agents_with_licenses         integer,
  states_covered               integer,
  top_states                   jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor    RECORD;
  v_org_wide boolean;
  v_scope    uuid[];
BEGIN
  SELECT * INTO v_actor FROM private.campaign_actor();

  v_org_wide := v_actor.actor_role IN ('Admin', 'Super Admin') OR v_actor.is_super;

  IF v_org_wide THEN
    SELECT pg_catalog.array_agg(p.id)
      INTO v_scope
      FROM public.profiles p
     WHERE p.organization_id = v_actor.org_id
       AND p.status = 'Active';
  ELSE
    SELECT pg_catalog.array_agg(d.agent_id)
      INTO v_scope
      FROM private.resolve_downline_ids(v_actor.uid, v_actor.org_id) d;
  END IF;

  IF v_scope IS NULL THEN
    v_scope := ARRAY[]::uuid[];
  END IF;

  RETURN QUERY
  WITH scoped_profiles AS (
    SELECT p.id, p.npn, p.resident_state, p.carriers
    FROM public.profiles p
    WHERE p.organization_id = v_actor.org_id
      AND p.id = ANY (v_scope)
  ),
  scoped_licenses AS (
    SELECT l.agent_id,
           public.normalize_us_state(l.state) AS state_code,
           l.expiration_date
    FROM public.agent_state_licenses l
    WHERE l.organization_id = v_actor.org_id
      AND l.agent_id = ANY (v_scope)
  ),
  per_agent AS (
    SELECT sp.id,
           (nullif(pg_catalog.btrim(coalesce(sp.npn, '')), '') IS NOT NULL) AS has_npn,
           (nullif(pg_catalog.btrim(coalesce(sp.resident_state, '')), '') IS NOT NULL) AS has_resident_state,
           EXISTS (
             SELECT 1 FROM scoped_licenses sl
             WHERE sl.agent_id = sp.id
               AND sl.state_code = public.normalize_us_state(sp.resident_state)
           ) AS has_resident_license,
           (pg_catalog.jsonb_typeof(sp.carriers) = 'array'
             AND pg_catalog.jsonb_array_length(sp.carriers) > 0) AS has_carrier,
           NOT EXISTS (
             SELECT 1 FROM scoped_licenses sl
             WHERE sl.agent_id = sp.id
               AND sl.expiration_date IS NOT NULL
               AND sl.expiration_date < CURRENT_DATE
           ) AS no_expired_license
    FROM scoped_profiles sp
  ),
  depth_walk AS (
    SELECT pg_catalog.max(w.depth)::integer AS max_depth
    FROM (
      WITH RECURSIVE walk AS (
        SELECT p.id, ARRAY[p.id] AS visited, 1 AS depth
        FROM public.profiles p
        WHERE p.id = v_actor.uid AND p.organization_id = v_actor.org_id
        UNION ALL
        SELECT c.id, w.visited || c.id, w.depth + 1
        FROM public.profiles c
        JOIN walk w ON c.upline_id = w.id
        WHERE c.organization_id = v_actor.org_id
          AND c.id <> w.id
          AND NOT (c.id = ANY (w.visited))
          AND w.depth < 100
      )
      SELECT walk.depth FROM walk
    ) w
  ),
  state_counts AS (
    SELECT sl.state_code, pg_catalog.count(DISTINCT sl.agent_id)::bigint AS agents
    FROM scoped_licenses sl
    WHERE sl.state_code IS NOT NULL
    GROUP BY sl.state_code
  )
  SELECT
    pg_catalog.cardinality(v_scope)::integer,
    (SELECT pg_catalog.count(*)::integer FROM public.profiles p
      WHERE p.organization_id = v_actor.org_id
        AND p.upline_id = v_actor.uid
        AND p.id <> v_actor.uid
        AND coalesce(p.status, '') IS DISTINCT FROM 'Deleted'),
    -- Total Downline EXCLUDES self (brief requirement).
    greatest(pg_catalog.cardinality(v_scope) - 1, 0)::integer,
    (SELECT coalesce(dw.max_depth, 1) FROM depth_walk dw),
    (SELECT pg_catalog.count(*)::integer FROM per_agent pa
      WHERE pa.has_npn AND pa.has_resident_state AND pa.has_resident_license
        AND pa.has_carrier AND pa.no_expired_license),
    (SELECT pg_catalog.count(*)::integer FROM per_agent pa WHERE NOT pa.has_npn),
    (SELECT pg_catalog.count(*)::integer FROM per_agent pa WHERE NOT pa.has_resident_state),
    (SELECT pg_catalog.count(*)::integer FROM per_agent pa WHERE NOT pa.has_resident_license),
    (SELECT pg_catalog.count(*)::integer FROM per_agent pa WHERE NOT pa.has_carrier),
    (SELECT pg_catalog.count(*)::integer FROM scoped_licenses sl
      WHERE sl.expiration_date IS NOT NULL AND sl.expiration_date < CURRENT_DATE),
    (SELECT pg_catalog.count(*)::integer FROM scoped_licenses sl
      WHERE sl.expiration_date IS NOT NULL
        AND sl.expiration_date >= CURRENT_DATE
        AND sl.expiration_date <= CURRENT_DATE + 30),
    (SELECT pg_catalog.count(*)::integer FROM scoped_licenses sl WHERE sl.expiration_date IS NULL),
    (SELECT pg_catalog.count(DISTINCT sl.agent_id)::integer FROM scoped_licenses sl),
    (SELECT pg_catalog.count(*)::integer FROM state_counts),
    (SELECT coalesce(
              pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object('state', s.state_code, 'agents', s.agents)
                ORDER BY s.agents DESC, s.state_code ASC
              ), '[]'::jsonb)
       FROM (SELECT * FROM state_counts ORDER BY agents DESC, state_code ASC LIMIT 10) s);
END;
$$;

COMMENT ON FUNCTION public.get_profile_team_readiness() IS
  'Team Profile readiness and licensing-coverage aggregate. Counts only - never a per-agent row, because public.profiles is already org-wide readable and the browser builds the roster itself. Scope derives from auth.uid() alone and fails closed. total_downline excludes self. licenses_without_expiration is reported because a NULL expiration is expirationStatus() = none, not Active.';

REVOKE ALL ON FUNCTION public.get_profile_team_readiness() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_team_readiness() TO authenticated, service_role;

-- -----------------------------------------------------------------------------------------------
-- 6. Index on the ownership column every aggregate above filters on (decision D-8)
--
-- public.clients carries clients_pkey, idx_clients_org, idx_clients_org_phone_last10, three
-- gin_trgm search indexes and uq_clients_lead_id - but nothing on assigned_agent_id, which is the
-- column "WHERE assigned_agent_id = ANY (v_scope)" uses. Plain CREATE INDEX (not CONCURRENTLY)
-- because it must run inside the migration transaction; at production's current 6 rows the lock is
-- instantaneous. Re-evaluate before applying if clients has grown materially by then.
-- -----------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_clients_assigned_agent_id
  ON public.clients USING btree (assigned_agent_id);
