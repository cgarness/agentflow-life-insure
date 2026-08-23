-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- RLS Phase 1 authorization matrix — run TWICE: `-v phase=pre` (baseline) and `-v phase=post`.
--
--   pre  : documents today's behavior and PROVES the vulnerability Phase 1 closes (any authenticated
--          org member can directly UPDATE-claim an unassigned inbound row).
--   post : the acceptance matrix — every authenticated role is denied direct UPDATE/DELETE on
--          unassigned inbound rows, every previously-permitted assigned-row operation still works,
--          SELECT visibility is unchanged, and the service-role claim RPC still wins.
--
-- RLS denial surfaces as ZERO AFFECTED ROWS, not an exception: every assertion below counts rows
-- (RETURNING/ROW_COUNT) and re-reads a to_jsonb snapshot to prove byte-identity, `updated_at`
-- included. Absence of an error is never treated as proof.
--
-- Roles exercised: Agent, Team Leader, legacy 'Team Lead' alias, Admin, Super Admin, service role.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- The phase is carried in a server-side GUC so DO bodies never depend on psql interpolation.
-- (Captured OUTSIDE the assertion transaction: the truth table must survive to be compared.)
SELECT set_config('rls.phase', :'phase', false);

-- ═════ 1. SELECT truth table — captured for EVERY actor, compared pre vs post ═════════════════════
DO $$
DECLARE a rls_probe.actor%ROWTYPE; v_phase text := current_setting('rls.phase');
BEGIN
  DELETE FROM rls_probe.select_truth WHERE phase = v_phase;
  FOR a IN SELECT * FROM rls_probe.actor LOOP
    PERFORM set_config('request.jwt.claims', rls_probe.claims(a.uid, a.org, a.role), true);
    SET LOCAL ROLE authenticated;
    INSERT INTO rls_probe.select_truth (phase, actor, row_id)
      SELECT v_phase, a.name, c.id FROM public.calls c;
    RESET ROLE;
  END LOOP;
END $$;


BEGIN;
SELECT set_config('rls.phase', :'phase', true);

-- ── Probe helpers ────────────────────────────────────────────────────────────────────────────────
-- Each probe runs ONE statement as `authenticated` with the actor's JWT claims and returns the
-- number of rows the statement actually affected (RLS-denied ⇒ 0).
-- Outcome vocabulary (RLS denies in TWO distinct ways and the difference matters):
--   'rows=N'          — the statement ran; N rows were actually affected. 'rows=0' is a USING denial
--                       (the source row was not even visible to the write) — the Phase 1 target.
--   'check_violation' — USING admitted the row but WITH CHECK rejected the RESULT row. This is
--                       today's behavior for a generic metadata update by a role whose WITH CHECK
--                       branch cannot match an agent_id-NULL row, and it proves the row IS reachable
--                       for writes (i.e. NOT excluded) — which is exactly what Phase 1 changes.
CREATE OR REPLACE FUNCTION pg_temp.probe_update(p_actor text, p_row uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE a rls_probe.actor%ROWTYPE; n integer;
BEGIN
  SELECT * INTO a FROM rls_probe.actor WHERE name = p_actor;
  PERFORM set_config('request.jwt.claims', rls_probe.claims(a.uid, a.org, a.role), true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE format(p_sql, p_row);
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RETURN 'check_violation';
  END;
  RESET ROLE;
  RETURN 'rows=' || n;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.probe_delete(p_actor text, p_row uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE a rls_probe.actor%ROWTYPE; n integer;
BEGIN
  SELECT * INTO a FROM rls_probe.actor WHERE name = p_actor;
  PERFORM set_config('request.jwt.claims', rls_probe.claims(a.uid, a.org, a.role), true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.calls WHERE id = p_row;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.probe_can_select(p_actor text, p_row uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE a rls_probe.actor%ROWTYPE; v boolean;
BEGIN
  SELECT * INTO a FROM rls_probe.actor WHERE name = p_actor;
  PERFORM set_config('request.jwt.claims', rls_probe.claims(a.uid, a.org, a.role), true);
  SET LOCAL ROLE authenticated;
  SELECT EXISTS (SELECT 1 FROM public.calls WHERE id = p_row) INTO v;
  RESET ROLE;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.snap(p_row uuid) RETURNS jsonb
LANGUAGE sql AS $$ SELECT to_jsonb(c) FROM public.calls c WHERE c.id = p_row $$;

-- Baseline SELECT expectations — identical in both phases (Phase 1 must not narrow visibility).
DO $$
DECLARE
  v_phase text := current_setting('rls.phase');
  f_ring uuid; f_term uuid; f_orgb uuid; a text;
BEGIN
  SELECT id INTO f_ring FROM rls_probe.fixture WHERE name='unassigned_ring';
  SELECT id INTO f_term FROM rls_probe.fixture WHERE name='unassigned_term';
  SELECT id INTO f_orgb FROM rls_probe.fixture WHERE name='org_b';

  -- (1) same-org unassigned inbound rows stay SELECT-visible to EVERY authenticated org role,
  --     ringing AND terminal alike
  FOREACH a IN ARRAY ARRAY['agent','agent2','team_leader','team_lead','admin','super_admin'] LOOP
    IF NOT pg_temp.probe_can_select(a, f_ring) THEN
      RAISE EXCEPTION '[%] % lost SELECT on the unassigned RINGING inbound row', v_phase, a; END IF;
    IF NOT pg_temp.probe_can_select(a, f_term) THEN
      RAISE EXCEPTION '[%] % lost SELECT on the unassigned TERMINAL inbound row', v_phase, a; END IF;
  END LOOP;

  -- (6) cross-org access stays denied in both directions
  IF pg_temp.probe_can_select('agent', f_orgb) THEN
    RAISE EXCEPTION '[%] cross-org SELECT leaked (org A agent saw an org B row)', v_phase; END IF;
  IF pg_temp.probe_can_select('cross_org', f_ring) THEN
    RAISE EXCEPTION '[%] cross-org SELECT leaked (org B admin saw an org A row)', v_phase; END IF;

  -- the independent peer-read SELECT policy still grants its access (Phase 1 must not touch it)
  IF NOT pg_temp.probe_can_select('peer_org', f_ring) THEN
    RAISE EXCEPTION '[%] Calls Agency Group Peer Read stopped granting peer SELECT', v_phase; END IF;
END $$;

-- ═════ 2. UNASSIGNED-INBOUND direct claim / metadata update / delete, per role ════════════════════
DO $$
DECLARE
  v_phase text := current_setting('rls.phase');
  denied  boolean := (current_setting('rls.phase') = 'post');
  f_ring uuid; f_term uuid; a text; r text; n integer; before jsonb; v_tmp uuid;
  claim_sql text := 'UPDATE public.calls SET agent_id = auth.uid(), updated_at = now() WHERE id = %L';
  meta_sql  text := 'UPDATE public.calls SET status = ''completed'', updated_at = now() WHERE id = %L';
BEGIN
  SELECT id INTO f_ring FROM rls_probe.fixture WHERE name='unassigned_ring';
  SELECT id INTO f_term FROM rls_probe.fixture WHERE name='unassigned_term';

  FOREACH a IN ARRAY ARRAY['agent','agent2','team_leader','team_lead','admin','super_admin'] LOOP
    ---------------------------------------------------------------- (2) direct claim attempt
    before := pg_temp.snap(f_ring);
    r := pg_temp.probe_update(a, f_ring, claim_sql);
    IF denied THEN
      IF r <> 'rows=0' THEN
        RAISE EXCEPTION '[post] % could still direct-CLAIM an unassigned inbound row (outcome %)', a, r; END IF;
      IF pg_temp.snap(f_ring) IS DISTINCT FROM before THEN     -- (5) byte-identical incl. updated_at
        RAISE EXCEPTION '[post] % mutated the row despite a denied claim', a; END IF;
    ELSE
      -- the known vulnerability: every authenticated org role can set agent_id = auth.uid()
      IF r <> 'rows=1' THEN
        RAISE EXCEPTION '[pre] baseline drift: % claim outcome was % (expected rows=1)', a, r; END IF;
      UPDATE public.calls SET agent_id = NULL, updated_at = (before->>'updated_at')::timestamptz WHERE id = f_ring;
    END IF;

    ------------------------------------------- (3) generic metadata update, terminal unassigned row
    before := pg_temp.snap(f_term);
    r := pg_temp.probe_update(a, f_term, meta_sql);
    IF denied THEN
      IF r <> 'rows=0' THEN
        RAISE EXCEPTION '[post] % could still update an unassigned inbound row (outcome %)', a, r; END IF;
      IF pg_temp.snap(f_term) IS DISTINCT FROM before THEN
        RAISE EXCEPTION '[post] % mutated the terminal unassigned row despite denial', a; END IF;
    ELSE
      -- baseline: the row IS reachable for writes — either the update lands, or it reaches WITH CHECK
      -- (which only proves USING admitted it). A silent rows=0 would mean it was already excluded.
      IF r = 'rows=0' THEN
        RAISE EXCEPTION '[pre] baseline drift: % was already USING-denied on an unassigned inbound row', a; END IF;
      IF r = 'rows=1' THEN
        UPDATE public.calls SET status = before->>'status',
                                updated_at = (before->>'updated_at')::timestamptz WHERE id = f_term;
      END IF;
    END IF;

    ------------------------------------------------------- (4) DELETE (probed on a disposable twin)
    v_tmp := gen_random_uuid();
    INSERT INTO public.calls (id, organization_id, direction, status, agent_id, twilio_call_sid)
    VALUES (v_tmp, '11111111-0000-0000-0000-00000000000a', 'inbound', 'ringing', NULL,
            'CA' || replace(v_tmp::text, '-', ''));
    before := pg_temp.snap(v_tmp);
    n := pg_temp.probe_delete(a, v_tmp);
    IF denied THEN
      IF n <> 0 THEN RAISE EXCEPTION '[post] % DELETED an unassigned inbound row (% rows)', a, n; END IF;
      IF pg_temp.snap(v_tmp) IS DISTINCT FROM before THEN
        RAISE EXCEPTION '[post] % mutated the row despite a denied delete', a; END IF;
    ELSE
      IF n <> 1 THEN RAISE EXCEPTION '[pre] baseline drift: % delete outcome was % rows (expected 1)', a, n; END IF;
    END IF;
    DELETE FROM public.calls WHERE id = v_tmp;
  END LOOP;
END $$;

-- ═════ 3. POSITIVE COMPATIBILITY — every previously permitted operation still works ═══════════════
DO $$
DECLARE
  v_phase text := current_setting('rls.phase');
  f_a1 uuid; f_a2 uuid; f_out uuid; f_null uuid; n integer; before jsonb; v_tmp uuid;
  bump_sql text := 'UPDATE public.calls SET notes = ''ok'', updated_at = now() WHERE id = %L';
BEGIN
  SELECT id INTO f_a1   FROM rls_probe.fixture WHERE name='assigned_a1';
  SELECT id INTO f_a2   FROM rls_probe.fixture WHERE name='assigned_a2';
  SELECT id INTO f_out  FROM rls_probe.fixture WHERE name='outbound_null';
  SELECT id INTO f_null FROM rls_probe.fixture WHERE name='null_direction';

  -- own assigned-row Agent update
  IF pg_temp.probe_update('agent', f_a1, bump_sql) <> 'rows=1' THEN
    RAISE EXCEPTION '[%] Agent lost UPDATE on its OWN assigned row', v_phase; END IF;
  -- Admin same-org assigned-row update
  IF pg_temp.probe_update('admin', f_a2, bump_sql) <> 'rows=1' THEN
    RAISE EXCEPTION '[%] Admin lost UPDATE on a same-org assigned row', v_phase; END IF;
  -- Team Leader downline assigned-row update (a1 is in tl''s hierarchy_path)
  IF pg_temp.probe_update('team_leader', f_a1, bump_sql) <> 'rows=1' THEN
    RAISE EXCEPTION '[%] Team Leader lost UPDATE on a downline assigned row', v_phase; END IF;
  -- Team Leader must still NOT reach a non-downline assigned row (unchanged pre-existing behavior)
  IF pg_temp.probe_update('team_leader', f_a2, bump_sql) <> 'rows=0' THEN
    RAISE EXCEPTION '[%] Team Leader gained UPDATE on a NON-downline assigned row', v_phase; END IF;
  -- Super Admin own-org assigned-row update
  IF pg_temp.probe_update('super_admin', f_a1, bump_sql) <> 'rows=1' THEN
    RAISE EXCEPTION '[%] Super Admin lost UPDATE on an own-org assigned row', v_phase; END IF;

  -- NON-TARGET rows keep their old behavior: outbound with NULL agent, and NULL direction
  IF pg_temp.probe_update('admin', f_out, bump_sql) <> 'rows=1' THEN
    RAISE EXCEPTION '[%] Admin lost UPDATE on an OUTBOUND unassigned row (non-target)', v_phase; END IF;
  IF pg_temp.probe_update('admin', f_null, bump_sql) <> 'rows=1' THEN
    RAISE EXCEPTION '[%] Admin lost UPDATE on a NULL-direction row — three-valued-logic regression', v_phase; END IF;
  -- ... and the Agent branch on a NULL-direction row is still governed by agent_id only
  IF pg_temp.probe_update('agent', f_null, bump_sql) <> 'rows=0' THEN
    RAISE EXCEPTION '[%] Agent gained UPDATE on a NULL-direction row it does not own', v_phase; END IF;

  -- previously permitted assigned-row DELETEs remain permitted (probed on disposable twins)
  v_tmp := gen_random_uuid();
  INSERT INTO public.calls (id, organization_id, direction, status, agent_id, twilio_call_sid)
  VALUES (v_tmp,'11111111-0000-0000-0000-00000000000a','inbound','completed',
          'aaaa1111-0000-0000-0000-000000000001','CA'||replace(v_tmp::text,'-',''));
  IF pg_temp.probe_delete('agent', v_tmp) <> 1 THEN
    RAISE EXCEPTION '[%] Agent lost DELETE on its own assigned row', v_phase; END IF;

  v_tmp := gen_random_uuid();
  INSERT INTO public.calls (id, organization_id, direction, status, agent_id, twilio_call_sid)
  VALUES (v_tmp,'11111111-0000-0000-0000-00000000000a','inbound','completed',
          'aaaa1111-0000-0000-0000-000000000002','CA'||replace(v_tmp::text,'-',''));
  IF pg_temp.probe_delete('admin', v_tmp) <> 1 THEN
    RAISE EXCEPTION '[%] Admin lost DELETE on a same-org assigned row', v_phase; END IF;

  v_tmp := gen_random_uuid();
  INSERT INTO public.calls (id, organization_id, direction, status, agent_id, twilio_call_sid)
  VALUES (v_tmp,'11111111-0000-0000-0000-00000000000a','outbound','completed', NULL,
          'CA'||replace(v_tmp::text,'-',''));
  IF pg_temp.probe_delete('admin', v_tmp) <> 1 THEN
    RAISE EXCEPTION '[%] Admin lost DELETE on an OUTBOUND unassigned row (non-target)', v_phase; END IF;

  -- V3: the DELETE matrix now covers EVERY role the report claims, not just Agent and Admin.
  -- Team Leader → DOWNLINE assigned row (a1 sits at ltree 'tl.a1', under the Team Leader 'tl').
  v_tmp := gen_random_uuid();
  INSERT INTO public.calls (id, organization_id, direction, status, agent_id, twilio_call_sid)
  VALUES (v_tmp,'11111111-0000-0000-0000-00000000000a','inbound','completed',
          'aaaa1111-0000-0000-0000-000000000001','CA'||replace(v_tmp::text,'-',''));
  IF pg_temp.probe_delete('team_leader', v_tmp) <> 1 THEN
    RAISE EXCEPTION '[%] Team Leader lost DELETE on a DOWNLINE assigned row', v_phase; END IF;

  -- Legacy 'Team Lead' alias → DOWNLINE assigned row (a2 sits at 'tl2.a2', under the alias actor).
  v_tmp := gen_random_uuid();
  INSERT INTO public.calls (id, organization_id, direction, status, agent_id, twilio_call_sid)
  VALUES (v_tmp,'11111111-0000-0000-0000-00000000000a','inbound','completed',
          'aaaa1111-0000-0000-0000-000000000002','CA'||replace(v_tmp::text,'-',''));
  IF pg_temp.probe_delete('team_lead', v_tmp) <> 1 THEN
    RAISE EXCEPTION '[%] legacy Team Lead alias lost DELETE on a DOWNLINE assigned row', v_phase; END IF;

  -- Team Leader must STILL NOT delete a NON-downline assigned row (a2 is under tl2, not tl).
  v_tmp := gen_random_uuid();
  INSERT INTO public.calls (id, organization_id, direction, status, agent_id, twilio_call_sid)
  VALUES (v_tmp,'11111111-0000-0000-0000-00000000000a','inbound','completed',
          'aaaa1111-0000-0000-0000-000000000002','CA'||replace(v_tmp::text,'-',''));
  IF pg_temp.probe_delete('team_leader', v_tmp) <> 0 THEN
    RAISE EXCEPTION '[%] Team Leader gained DELETE on a NON-downline assigned row', v_phase; END IF;
  DELETE FROM public.calls WHERE id = v_tmp;

  -- Super Admin → assigned row in its OWN organization.
  v_tmp := gen_random_uuid();
  INSERT INTO public.calls (id, organization_id, direction, status, agent_id, twilio_call_sid)
  VALUES (v_tmp,'11111111-0000-0000-0000-00000000000a','inbound','completed',
          'aaaa1111-0000-0000-0000-000000000001','CA'||replace(v_tmp::text,'-',''));
  IF pg_temp.probe_delete('super_admin', v_tmp) <> 1 THEN
    RAISE EXCEPTION '[%] Super Admin lost DELETE on an own-org assigned row', v_phase; END IF;
END $$;

-- ═════ 3b. CROSS-ORG WRITE DENIAL on ASSIGNED rows (V3) ══════════════════════════════════════════
DO $$
DECLARE
  v_phase text := current_setting('rls.phase');
  f_a1 uuid; f_b1 uuid; v_tmp uuid; a text;
  bump_sql text := 'UPDATE public.calls SET notes = ''cross-org'', updated_at = now() WHERE id = %L';
BEGIN
  SELECT id INTO f_a1 FROM rls_probe.fixture WHERE name='assigned_a1';
  SELECT id INTO f_b1 FROM rls_probe.fixture WHERE name='assigned_b1';

  -- org B Admin against an ASSIGNED org A row: no UPDATE, no DELETE, in either phase.
  IF pg_temp.probe_update('cross_org', f_a1, bump_sql) <> 'rows=0' THEN
    RAISE EXCEPTION '[%] cross-org actor UPDATED an assigned row outside its organization', v_phase; END IF;
  IF pg_temp.probe_delete('cross_org', f_a1) <> 0 THEN
    RAISE EXCEPTION '[%] cross-org actor DELETED an assigned row outside its organization', v_phase; END IF;

  -- ... and every org A role against an ASSIGNED org B row.
  FOREACH a IN ARRAY ARRAY['agent','team_leader','team_lead','admin','super_admin'] LOOP
    IF pg_temp.probe_update(a, f_b1, bump_sql) <> 'rows=0' THEN
      RAISE EXCEPTION '[%] % UPDATED an assigned row in another organization', v_phase, a; END IF;
    IF pg_temp.probe_delete(a, f_b1) <> 0 THEN
      RAISE EXCEPTION '[%] % DELETED an assigned row in another organization', v_phase, a; END IF;
  END LOOP;

  -- the peer-read actor may SELECT org A rows but must never write them
  IF pg_temp.probe_update('peer_org', f_a1, bump_sql) <> 'rows=0' THEN
    RAISE EXCEPTION '[%] agency-group peer UPDATED a peer-org row (peer read is SELECT-only)', v_phase; END IF;
  IF pg_temp.probe_delete('peer_org', f_a1) <> 0 THEN
    RAISE EXCEPTION '[%] agency-group peer DELETED a peer-org row (peer read is SELECT-only)', v_phase; END IF;
END $$;

-- ═════ 4. INSERT eligibility is unchanged (WITH CHECK preserved verbatim) ═════════════════════════
DO $$
DECLARE
  v_phase text := current_setting('rls.phase');
  a rls_probe.actor%ROWTYPE; v_tmp uuid; n integer;
BEGIN
  -- Agent may insert a row it owns; may NOT insert an unassigned inbound row (baseline WITH CHECK
  -- never contained the unassigned-inbound branch).
  SELECT * INTO a FROM rls_probe.actor WHERE name='agent';
  v_tmp := gen_random_uuid();
  PERFORM set_config('request.jwt.claims', rls_probe.claims(a.uid, a.org, a.role), true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.calls (id, organization_id, direction, status, agent_id, twilio_call_sid)
  VALUES (v_tmp, a.org, 'outbound', 'ringing', a.uid, 'CA'||replace(v_tmp::text,'-',''));
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  IF n <> 1 THEN RAISE EXCEPTION '[%] Agent lost INSERT of an own-agent row', v_phase; END IF;
  DELETE FROM public.calls WHERE id = v_tmp;

  v_tmp := gen_random_uuid();
  BEGIN
    PERFORM set_config('request.jwt.claims', rls_probe.claims(a.uid, a.org, a.role), true);
    SET LOCAL ROLE authenticated;
    INSERT INTO public.calls (id, organization_id, direction, status, agent_id, twilio_call_sid)
    VALUES (v_tmp, a.org, 'inbound', 'ringing', NULL, 'CA'||replace(v_tmp::text,'-',''));
    RESET ROLE;
    RAISE EXCEPTION '[%] Agent gained INSERT of an UNASSIGNED inbound row', v_phase;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;   -- expected: WITH CHECK rejects it, in both phases
  END;
END $$;

-- ═════ 5. The service-role claim RPC still wins, and normal assigned behavior follows ════════════
DO $$
DECLARE
  v_phase text := current_setting('rls.phase');
  v_row uuid := gen_random_uuid();
  v_sid text; j jsonb;
  bump_sql text := 'UPDATE public.calls SET notes = ''post-claim'', updated_at = now() WHERE id = %L';
BEGIN
  v_sid := 'CA' || replace(v_row::text, '-', '');
  INSERT INTO public.calls (id, organization_id, direction, status, agent_id, twilio_call_sid,
                            provider_session_id, routed_agent_ids)
  VALUES (v_row, '11111111-0000-0000-0000-00000000000a', 'inbound', 'ringing', NULL, v_sid, NULL,
          ARRAY['aaaa1111-0000-0000-0000-000000000001'::uuid]);

  SET LOCAL ROLE service_role;
  j := public.claim_inbound_call(
         'aaaa1111-0000-0000-0000-000000000001',
         v_row,
         'CA' || repeat('c', 32),
         v_sid);
  RESET ROLE;

  IF (j->>'claimed')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION '[%] service-role claim RPC failed on the routed unassigned row: %', v_phase, j; END IF;
  IF (SELECT agent_id FROM public.calls WHERE id = v_row)
       IS DISTINCT FROM 'aaaa1111-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION '[%] claim RPC did not set agent_id', v_phase; END IF;

  -- after the claim, the winning agent has normal assigned-row access again
  IF pg_temp.probe_update('agent', v_row, bump_sql) <> 'rows=1' THEN
    RAISE EXCEPTION '[%] claiming agent lost UPDATE on its now-assigned row', v_phase; END IF;
  -- and a different agent still cannot touch it
  IF pg_temp.probe_update('agent2', v_row, bump_sql) <> 'rows=0' THEN
    RAISE EXCEPTION '[%] a non-owner agent could update the claimed row', v_phase; END IF;

  DELETE FROM public.calls WHERE id = v_row;
END $$;

-- ═════ 6. SELECT TRUTH-TABLE EQUALITY (post only) ════════════════════════════════════════════════
-- Not hand-picked assertions: the FULL row-id set each actor can see must be identical pre vs post.
DO $$
DECLARE v_phase text := current_setting('rls.phase'); r record; v_pre bigint; v_post bigint;
BEGIN
  IF v_phase <> 'post' THEN RETURN; END IF;

  SELECT count(*) INTO v_pre  FROM rls_probe.select_truth WHERE phase='pre';
  SELECT count(*) INTO v_post FROM rls_probe.select_truth WHERE phase='post';
  IF v_pre = 0 OR v_post = 0 THEN
    RAISE EXCEPTION 'truth table incomplete (pre=%, post=%) — capture both phases', v_pre, v_post; END IF;

  FOR r IN
    SELECT COALESCE(p.actor, q.actor) AS actor,
           COALESCE(p.ids, '{}') AS pre_ids, COALESCE(q.ids, '{}') AS post_ids
      FROM (SELECT actor, array_agg(row_id ORDER BY row_id) AS ids
              FROM rls_probe.select_truth WHERE phase='pre'  GROUP BY actor) p
      FULL JOIN (SELECT actor, array_agg(row_id ORDER BY row_id) AS ids
              FROM rls_probe.select_truth WHERE phase='post' GROUP BY actor) q
        ON p.actor = q.actor
  LOOP
    IF r.pre_ids IS DISTINCT FROM r.post_ids THEN
      RAISE EXCEPTION 'SELECT truth table changed for %: pre=% post=%', r.actor, r.pre_ids, r.post_ids;
    END IF;
  END LOOP;
  RAISE NOTICE 'SELECT truth table identical pre/post for all % actors',
    (SELECT count(DISTINCT actor) FROM rls_probe.select_truth WHERE phase='post');
END $$;

-- ═════ 7. CATALOG + SECURITY ASSERTIONS (post only) ══════════════════════════════════════════════
DO $$
DECLARE
  v_phase text := current_setting('rls.phase');
  n integer; v_sel text; v_ins text; v_upd text; v_del text; v_peer text; r record;
BEGIN
  IF v_phase <> 'post' THEN RETURN; END IF;

  -- the old ALL policy is gone
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='calls'
              AND policyname='Calls Hierarchical Access') THEN
    RAISE EXCEPTION 'the old ALL policy "Calls Hierarchical Access" still exists'; END IF;

  -- V3: every named policy must have its EXACT command, permissive mode and role list — a policy
  -- created with the wrong FOR clause (e.g. an UPDATE policy landing as ALL) would otherwise slip
  -- through a bare name/count check.
  FOR r IN
    SELECT * FROM (VALUES
      ('Calls Hierarchical Select',   'SELECT'),
      ('Calls Hierarchical Insert',   'INSERT'),
      ('Calls Hierarchical Update',   'UPDATE'),
      ('Calls Hierarchical Delete',   'DELETE'),
      ('Calls Agency Group Peer Read','SELECT')
    ) AS t(pname, pcmd)
  LOOP
    SELECT count(*) INTO n FROM pg_policies
     WHERE schemaname='public' AND tablename='calls'
       AND policyname = r.pname AND cmd = r.pcmd
       AND permissive = 'PERMISSIVE' AND roles::text = '{authenticated}';
    IF n <> 1 THEN
      RAISE EXCEPTION 'policy "%" is not exactly one PERMISSIVE % policy TO authenticated (found %)',
        r.pname, r.pcmd, n;
    END IF;
  END LOOP;

  -- and nothing else exists on the table
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname='public' AND tablename='calls';
  IF n <> 5 THEN RAISE EXCEPTION 'expected exactly 5 policies on public.calls, found %', n; END IF;

  -- NO permissive ALL/UPDATE/DELETE policy may exist that could OR around the exclusion
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='calls' AND permissive='PERMISSIVE'
     AND cmd IN ('ALL','UPDATE','DELETE')
     AND policyname NOT IN ('Calls Hierarchical Update','Calls Hierarchical Delete');
  IF n <> 0 THEN RAISE EXCEPTION '% extra permissive write polic(ies) could bypass the exclusion', n; END IF;

  -- SELECT/INSERT expressions preserve the approved baseline behavior EXACTLY
  SELECT qual INTO v_sel FROM pg_policies WHERE tablename='calls' AND policyname='Calls Hierarchical Select';
  SELECT with_check INTO v_ins FROM pg_policies WHERE tablename='calls' AND policyname='Calls Hierarchical Insert';
  IF v_sel IS DISTINCT FROM (SELECT v FROM rls_probe.baseline_policy WHERE k='using') THEN
    RAISE EXCEPTION 'SELECT USING drifted from the baseline ALL policy USING: %', v_sel; END IF;
  IF v_ins IS DISTINCT FROM (SELECT v FROM rls_probe.baseline_policy WHERE k='check') THEN
    RAISE EXCEPTION 'INSERT WITH CHECK drifted from the baseline WITH CHECK'; END IF;

  -- UPDATE/DELETE carry the NULL-safe exclusion, and UPDATE keeps the baseline WITH CHECK verbatim
  SELECT qual INTO v_upd FROM pg_policies WHERE tablename='calls' AND policyname='Calls Hierarchical Update';
  SELECT qual INTO v_del FROM pg_policies WHERE tablename='calls' AND policyname='Calls Hierarchical Delete';
  IF v_upd NOT LIKE '%direction IS DISTINCT FROM ''inbound''::text%' OR v_upd NOT LIKE '%agent_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'UPDATE USING is missing the NULL-safe unassigned-inbound exclusion: %', v_upd; END IF;
  IF v_del NOT LIKE '%direction IS DISTINCT FROM ''inbound''::text%' OR v_del NOT LIKE '%agent_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'DELETE USING is missing the NULL-safe unassigned-inbound exclusion: %', v_del; END IF;
  SELECT with_check INTO v_upd FROM pg_policies WHERE tablename='calls' AND policyname='Calls Hierarchical Update';
  IF v_upd IS DISTINCT FROM (SELECT v FROM rls_probe.baseline_policy WHERE k='check') THEN
    RAISE EXCEPTION 'UPDATE WITH CHECK drifted from the baseline WITH CHECK'; END IF;

  -- the peer-read SELECT policy is untouched
  SELECT qual INTO v_peer FROM pg_policies WHERE tablename='calls' AND policyname='Calls Agency Group Peer Read';
  IF v_peer IS DISTINCT FROM (SELECT v FROM rls_probe.baseline_policy WHERE k='peer_read') THEN
    RAISE EXCEPTION 'Calls Agency Group Peer Read changed: %', v_peer; END IF;
  IF (SELECT cmd FROM pg_policies WHERE tablename='calls' AND policyname='Calls Agency Group Peer Read') <> 'SELECT' THEN
    RAISE EXCEPTION 'Calls Agency Group Peer Read is no longer SELECT-only'; END IF;

  -- RLS state unchanged: enabled, NOT forced
  IF (SELECT relrowsecurity::text || '/' || relforcerowsecurity::text
        FROM pg_class WHERE oid='public.calls'::regclass)
     IS DISTINCT FROM (SELECT v FROM rls_probe.baseline_policy WHERE k='rls_state') THEN
    RAISE EXCEPTION 'the RLS enabled/forced state changed'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.calls'::regclass) THEN
    RAISE EXCEPTION 'RLS is no longer enabled on public.calls'; END IF;

  -- grants unchanged — compared against the fingerprint captured before Phase 1, not a fixed count
  IF (SELECT string_agg(grantee || ':' || privilege_type, ', ' ORDER BY grantee, privilege_type)
        FROM information_schema.role_table_grants
       WHERE table_schema='public' AND table_name='calls')
     IS DISTINCT FROM (SELECT v FROM rls_probe.baseline_policy WHERE k='grants') THEN
    RAISE EXCEPTION 'calls table grants changed'; END IF;

  -- the claim RPC ACL is unchanged: service_role only
  IF has_function_privilege('authenticated', 'public.claim_inbound_call(uuid,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.claim_inbound_call(uuid,uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'claim_inbound_call ACL changed'; END IF;
  IF NOT has_function_privilege('service_role', 'public.claim_inbound_call(uuid,uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lost EXECUTE on claim_inbound_call'; END IF;
END $$;

ROLLBACK;
