-- PKG-D closing-appointment attributions (D4 §3.5, §7) on the v3 fixture organization O1 (reports_v3_fixtures.sql),
-- after …40-…42. The helpers below are kept; every row is written inside a savepoint that is rolled back.
-- Claims with the profile's role (appointments_select and the authority predicate read it from the JWT).
CREATE FUNCTION rt.pd_as(p_who text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', rt.v3(p_who), 'role', 'authenticated',
    'app_metadata', json_build_object('organization_id', p.organization_id, 'role', p.role))::text, true)
    FROM public.profiles p WHERE p.id = rt.v3(p_who) $$;
-- One appointment for an O1 contact, written through the capture trigger as p_actor; returns its id.
CREATE FUNCTION rt.pd_appt(p_name text, p_contact text, p_assignee text, p_type text, p_start timestamptz, p_created timestamptz,
                           p_status text DEFAULT 'Scheduled', p_actor text DEFAULT 'ADM1') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := md5('pkgd:' || p_name)::uuid;
BEGIN
  PERFORM rt.pd_as(p_actor);
  INSERT INTO public.appointments (id, organization_id, title, contact_id, type, status, start_time, created_by, user_id, created_at, booking_kind)
  VALUES (v, rt.v3('O1'), 'Synthetic ' || p_name, rt.v3(p_contact), p_type, 'Scheduled', p_start, rt.v3(p_assignee), rt.v3(p_assignee),
          p_created, 'appointment');
  IF p_status <> 'Scheduled' THEN UPDATE public.appointments SET status = p_status WHERE id = v; END IF;
  RETURN v;
END $$;
CREATE FUNCTION rt.pd_link(p_who text, p_req text, p_win text, p_appt uuid, p_source text DEFAULT 'sale_entry', p_declaration text DEFAULT 'appointment')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM rt.pd_as(p_who); SET LOCAL ROLE authenticated;
  v := public.link_policy_appointment(md5('req:' || p_req)::uuid, rt.v3(p_win), p_appt, NULL, p_declaration, p_source);
  RESET ROLE; RETURN v;
END $$;
CREATE FUNCTION rt.pd_err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RESET ROLE; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RESET ROLE; RETURN SQLSTATE; END $$;

SAVEPOINT pd_links;
-- Test-only, rolled back with the savepoint: the synthetic id lookup is readable while a call runs as authenticated.
GRANT USAGE ON SCHEMA rt TO authenticated; GRANT SELECT ON rt.v3_ids TO authenticated;
SELECT rt.eq('…42 seal: the three RPCs are authenticated-only; the attributions are unreadable',
  (SELECT string_agg(f || '=' || has_function_privilege('authenticated', f, 'EXECUTE') || '/' || has_function_privilege('anon', f, 'EXECUTE')
                     || '/' || has_function_privilege('service_role', f, 'EXECUTE'), ' ' ORDER BY f)
     FROM unnest(ARRAY['public.correct_policy_appointment_link(uuid,uuid,uuid,uuid,timestamptz,text)', 'public.get_policy_appointment_links(uuid)',
                       'public.link_policy_appointment(uuid,uuid,uuid,timestamptz,text,text)']) f)
  || ' ' || has_table_privilege('authenticated', 'private.policy_appointment_attributions', 'SELECT'),
  'public.correct_policy_appointment_link(uuid,uuid,uuid,uuid,timestamptz,text)=true/false/false public.get_policy_appointment_links(uuid)=true/false/false '
  || 'public.link_policy_appointment(uuid,uuid,uuid,timestamptz,text,text)=true/false/false false');

-- A3 (C1's assignee, so inside the policy predicate) held a sales appointment with C1 on 2026-10-05; W17 (A2's sale to C1, 2026-10-12) is within 30 days.
CREATE TEMP TABLE pd AS SELECT
  rt.pd_appt('held', 'C1', 'A3', 'Sales Call', '2026-10-05 17:00+00', '2026-10-02 17:00+00', 'Completed', 'A3') AS held,
  rt.pd_appt('open', 'C1', 'A1', 'Sales Call', '2026-10-06 17:00+00', '2026-10-02 17:00+00', 'Scheduled', 'A1') AS open,
  rt.pd_appt('follow', 'C1', 'A1', 'Follow Up', '2026-10-07 17:00+00', '2026-10-02 17:00+00', 'Completed', 'A1') AS follow,
  rt.pd_appt('other_contact', 'C3', 'A1', 'Sales Call', '2026-10-05 17:00+00', '2026-10-02 17:00+00', 'Completed', 'A1') AS other_contact;
GRANT SELECT ON pd TO authenticated;

SELECT rt.eq('rejections never raise and name their reason',
  (SELECT string_agg(rt.pd_link('ADM1', 'r' || k, w, a) ->> 'reason', ',' ORDER BY k)
     FROM (VALUES (1, 'W17', (SELECT open FROM pd)), (2, 'W17', (SELECT follow FROM pd)), (3, 'W17', (SELECT other_contact FROM pd)),
                  (4, 'W1', (SELECT held FROM pd)), (5, 'W17', md5('missing')::uuid)) v(k, w, a)),
  'not_held,not_a_sales_appointment,different_contact,sale_before_appointment,appointment_not_found');
-- The seller A2 cannot see A3's appointment: the same answer as a missing id. TL1 (no ancestor of W17's client assignee A3, not its seller) has no authority: 42501.
SELECT rt.eq('an invisible appointment is not found', rt.pd_link('A2', 'r6', 'W17', (SELECT held FROM pd)) ->> 'reason', 'appointment_not_found');
SELECT rt.eq('no authority over the policy → 42501',
  rt.pd_err($q$SELECT rt.pd_link('TL1', 'r7', 'W17', (SELECT held FROM pd))$q$), '42501');
SELECT rt.eq('nothing was written by the rejections', (SELECT count(*) FROM private.policy_appointment_attributions), 0::bigint);

-- The seller declares "none" first; the assignee at start (A3) may supersede it once from the outcome entry.
SELECT rt.eq('a root none', rt.pd_link('A2', 'n1', 'W17', NULL, 'sale_entry', 'none') ->> 'status', 'declared_none');
SELECT rt.eq('a replay is unchanged', rt.pd_link('A2', 'n1', 'W17', NULL, 'sale_entry', 'none') ->> 'status', 'unchanged');
SELECT rt.eq('the same request with another payload → 22023',
  rt.pd_err($q$SELECT rt.pd_link('A2', 'n1', 'W17', NULL, 'policy_entry', 'none')$q$), '22023');
SELECT rt.eq('a sale-entry link cannot supersede a declaration', rt.pd_link('ADM1', 'l1', 'W17', (SELECT held FROM pd)) ->> 'reason', 'already_linked');
SELECT rt.eq('the assignee at start supersedes the none once', rt.pd_link('A3', 'l2', 'W17', (SELECT held FROM pd), 'outcome_entry') ->> 'status', 'linked');
SELECT rt.eq('a second supersession is refused', rt.pd_link('A3', 'l3', 'W17', (SELECT held FROM pd), 'policy_entry') ->> 'reason', 'already_linked');
SELECT rt.eq('one effective row per policy',
  (SELECT count(*) FROM private.policy_appointment_attributions a WHERE a.policy_id = rt.v3('P17')
      AND NOT EXISTS (SELECT 1 FROM private.policy_appointment_attributions n WHERE n.supersedes_attribution_id = a.id)), 1::bigint);

-- Admin correction: PT409 on a stale head; then a correction to none; agents cannot correct.
SELECT rt.eq('a stale correction → PT409', rt.pd_err(format($q$SELECT rt.pd_as('ADM1'); SET LOCAL ROLE authenticated;
  SELECT public.correct_policy_appointment_link(md5('c1')::uuid, rt.v3('W17'), %L::uuid, NULL, NULL, 'none')$q$, md5('stale')::uuid)), 'PT409');
SELECT rt.eq('an agent cannot correct', rt.pd_err(format($q$SELECT rt.pd_as('A1'); SET LOCAL ROLE authenticated;
  SELECT public.correct_policy_appointment_link(md5('c2')::uuid, rt.v3('W17'), %L::uuid, NULL, NULL, 'none')$q$,
  (SELECT id FROM private.policy_appointment_head(rt.v3('O1'), rt.v3('P17'))))), '42501');
CREATE TEMP TABLE pdh AS SELECT id FROM private.policy_appointment_head(rt.v3('O1'), rt.v3('P17'));
GRANT SELECT ON pdh TO authenticated;
SELECT rt.pd_as('ADM1');
SET LOCAL ROLE authenticated;
SELECT rt.eq('the Admin correction becomes the head',
  public.correct_policy_appointment_link(md5('c3')::uuid, rt.v3('W17'), (SELECT id FROM pdh), NULL, NULL, 'none') ->> 'status', 'declared_none');
-- The read: appointment fields only for a caller who can see the appointment.
SELECT rt.eq('get_policy_appointment_links lists the client''s visible policies',
  (SELECT string_agg(p ->> 'policy_id' || ':' || coalesce(p #>> '{link,declaration}', '-'), ',' ORDER BY p ->> 'policy_id')
     FROM jsonb_array_elements(public.get_policy_appointment_links(rt.v3('C1')) -> 'policies') p),
  rt.v3('P1') || ':-,' || rt.v3('P17') || ':none');
RESET ROLE;
SELECT rt.eq('append-only', rt.pd_err('UPDATE private.policy_appointment_attributions SET source = ''policy_entry'''), '23514');
ROLLBACK TO SAVEPOINT pd_links;
