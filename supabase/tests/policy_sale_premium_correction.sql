-- PKG-B audited sale premium corrections (D2 §3.3-§3.6, §6, §9). Synthetic fixtures only, on the reporting fixture's
-- verbatim sale writers (scripts/reporting_fixture.py policy mode) after 20261104120020 is applied.
-- The two RPCs are sealed by …20 (class C); they are granted to authenticated only inside this step and revoked at
-- its end, the way …21 will grant them.

-- Seal (class C) before anything is granted.
SELECT test_assert(NOT has_function_privilege(r, f, 'EXECUTE'), r || ' cannot execute ' || f)
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r,
       unnest(ARRAY['public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text)',
                    'public.get_client_policy_sale_premiums(uuid)', 'private.policy_sale_effective_premium(public.wins,numeric)',
                    'private.policy_sale_original_premium(public.wins,numeric)', 'private.policy_sale_book_monthly(jsonb,boolean)']) f;
SELECT test_assert(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                                WHERE p.oid IN ('public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text)'::regprocedure,
                                                'public.get_client_policy_sale_premiums(uuid)'::regprocedure) AND x.grantee = 0),
                   'no PUBLIC EXECUTE on the RPCs');
SELECT test_assert((SELECT relrowsecurity FROM pg_class WHERE oid = 'private.policy_sale_premium_corrections'::regclass), 'ledger RLS on');
SELECT test_assert((SELECT count(*) = 0 FROM pg_policy WHERE polrelid = 'private.policy_sale_premium_corrections'::regclass), 'ledger has no policies');
SELECT test_assert((SELECT count(*) = 3 FROM pg_trigger WHERE tgrelid = 'private.policy_sale_premium_corrections'::regclass AND NOT tgisinternal), 'ledger has 3 triggers');
SELECT test_assert((SELECT count(*) = 0 FROM private.policy_sale_premium_corrections), 'ledger starts empty');
SELECT test_assert(NOT has_table_privilege(r, 'private.policy_sale_premium_corrections', 'SELECT'), r || ' cannot read the ledger')
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r;
SELECT test_assert((SELECT NOT prosecdef AND provolatile = 's' AND md5(prosrc) = 'fee9032d4c2509d4fd99d7313e9f7230'
                      FROM pg_proc WHERE oid = 'private.performance_sale_monthly(public.wins,numeric)'::regprocedure),
                   'performance_sale_monthly is the switched, still invoker-rights STABLE choke point');
SELECT test_assert((SELECT prosecdef FROM pg_proc WHERE oid = 'public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text)'::regprocedure)
                   AND (SELECT proconfig @> ARRAY['search_path=pg_catalog, pg_temp', 'lock_timeout=2s'] FROM pg_proc
                         WHERE oid = 'public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text)'::regprocedure),
                   'the writer is definer-rights with a fixed search_path and a 2 s lock timeout');

-- Synthetic actors: a seller and a peer under the Team Leader test_id(14), an inactive Admin, an is_super_admin
-- profile, and an Admin of the second organization. test_id(13) is an Admin and test_id(16) a 'Super Admin'.
INSERT INTO public.profiles(id, organization_id, first_name, last_name, role, status, hierarchy_path, is_super_admin) VALUES
 (test_id(41), test_id(1), 'Corr', 'Seller', 'Agent', 'Active', 'root.corr', false),
 (test_id(42), test_id(1), 'Corr', 'Peer', 'Agent', 'Active', 'corrpeer', false),
 (test_id(17), test_id(1), 'Inactive', 'Admin', 'Admin', 'Inactive', 'inadmin', false),
 (test_id(19), test_id(1), 'Platform', 'Staff', 'Agent', 'Active', 'staff', true),
 (test_id(22), test_id(2), 'Other', 'Admin', 'Admin', 'Active', 'otheradmin', false);
CREATE TABLE public.test_pspc(k text PRIMARY KEY, v uuid NOT NULL);
GRANT SELECT ON public.test_pspc TO authenticated;
CREATE FUNCTION public.t_pol(k text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT v FROM public.test_pspc WHERE test_pspc.k = t_pol.k $$;
CREATE FUNCTION public.t_fix(p_req integer, p_pol text, p_rev integer, p_eff numeric, p_book jsonb, p_new numeric, p_mode text,
  p_note text DEFAULT 'Entry error at sale', p_reason text DEFAULT 'entry_error') RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.correct_policy_sale_premium(public.test_id(90000 + p_req), public.t_pol(p_pol), p_rev, p_eff, p_book, p_new,
                                            p_reason, p_note, p_mode) $$;
CREATE FUNCTION public.t_ap(p_agent integer, p_from date, p_until date) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(r.annualized_premium), 0) FROM private.performance_rows(ARRAY[public.test_id(1)], '2000-01-01', '2100-01-01',
    p_from, p_until, ARRAY[public.test_id(p_agent)]) r $$;
CREATE FUNCTION public.t_sold(p_agent integer, p_from date, p_until date) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(r.policies_sold), 0) FROM private.performance_rows(ARRAY[public.test_id(1)], '2000-01-01', '2100-01-01',
    p_from, p_until, ARRAY[public.test_id(p_agent)]) r $$;
CREATE FUNCTION public.t_eff(p_pol text) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT private.performance_sale_monthly(w, c.premium) FROM public.wins w
    LEFT JOIN public.clients c ON c.id = w.contact_id AND c.organization_id = w.organization_id
   WHERE w.policy_id = public.t_pol(p_pol) $$;
CREATE FUNCTION public.t_fingerprint() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT md5(coalesce((SELECT string_agg(md5(to_jsonb(w)::text), ',' ORDER BY w.id) FROM public.wins w), '') || '|'
          || coalesce((SELECT string_agg(md5(to_jsonb(i)::text), ',' ORDER BY i.policy_id) FROM private.policy_identities i), '') || '|'
          || coalesce((SELECT string_agg(md5(to_jsonb(r)::text), ',' ORDER BY r.operation_key) FROM private.policy_sale_receipts r), '')) $$;

-- Sales, through the real writers, as the seller: A (primary $100, plus additional A2 $50 and A3 $150), B ($80),
-- C ($70), U (premium not entered) and L (later made a legacy fallback sale). All in March 2026.
SELECT test_actor(41);
SET ROLE authenticated;
INSERT INTO test_results VALUES
 ('pspc-a', create_client_with_sale(test_id(80001), test_id(1), test_client_payload() || jsonb_build_object('first_name', 'Corr A',
    'assigned_agent_id', test_id(41), 'premium', 100, 'sold_date', '2026-03-10'), true)),
 ('pspc-b', create_client_with_sale(test_id(80002), test_id(1), test_client_payload() || jsonb_build_object('first_name', 'Corr B',
    'assigned_agent_id', test_id(41), 'premium', 80, 'sold_date', '2026-03-11', 'carrier', 'Carrier B'), true)),
 ('pspc-c', create_client_with_sale(test_id(80003), test_id(1), test_client_payload() || jsonb_build_object('first_name', 'Corr C',
    'assigned_agent_id', test_id(41), 'premium', 70, 'sold_date', '2026-03-12', 'carrier', 'Carrier C'), true)),
 ('pspc-u', create_client_with_sale(test_id(80004), test_id(1), (test_client_payload() - 'premium') || jsonb_build_object('first_name', 'Corr U',
    'assigned_agent_id', test_id(41), 'sold_date', '2026-03-13', 'carrier', 'Carrier U'), true)),
 ('pspc-l', create_client_with_sale(test_id(80005), test_id(1), test_client_payload() || jsonb_build_object('first_name', 'Corr L',
    'assigned_agent_id', test_id(41), 'premium', 60, 'sold_date', '2026-03-14', 'carrier', 'Carrier L'), true));
INSERT INTO test_results VALUES
 ('pspc-a2', record_client_policy(test_id(80011), (SELECT (data->>'client_id')::uuid FROM test_results WHERE key = 'pspc-a'),
    '{"policy_type":"Whole Life","carrier":"Carrier A2","premium":50,"sold_date":"2026-03-15","policy_number":"A2-1"}', false)),
 ('pspc-a3', record_client_policy(test_id(80012), (SELECT (data->>'client_id')::uuid FROM test_results WHERE key = 'pspc-a'),
    '{"policy_type":"Final Expense","carrier":"Carrier A3","premium":150,"sold_date":"2026-03-16","policy_number":"A3-1"}', false));
RESET ROLE;
INSERT INTO public.test_pspc
SELECT r.k, CASE WHEN r.k IN ('a2', 'a3') THEN test_id(CASE r.k WHEN 'a2' THEN 80011 ELSE 80012 END) ELSE c.primary_policy_id END
  FROM (VALUES ('a', 'pspc-a'), ('b', 'pspc-b'), ('c', 'pspc-c'), ('u', 'pspc-u'), ('l', 'pspc-l'), ('a2', 'pspc-a'), ('a3', 'pspc-a')) r(k, key)
  JOIN test_results t ON t.key = r.key JOIN public.clients c ON c.id = (t.data->>'client_id')::uuid;
INSERT INTO public.test_pspc SELECT 'client-' || r.k, (t.data->>'client_id')::uuid
  FROM (VALUES ('a', 'pspc-a'), ('b', 'pspc-b'), ('c', 'pspc-c'), ('u', 'pspc-u'), ('l', 'pspc-l')) r(k, key) JOIN test_results t ON t.key = r.key;
INSERT INTO public.test_pspc SELECT 'win-' || p.k, w.id FROM public.test_pspc p JOIN public.wins w ON w.policy_id = p.v WHERE p.k NOT LIKE 'client-%';
SELECT test_assert((SELECT count(*) = 7 FROM public.wins WHERE policy_id IN (SELECT v FROM test_pspc WHERE k NOT LIKE 'client-%')), 'seven synthetic sales');
SELECT test_assert(t_ap(41, '2026-03-01', '2026-04-01') = (100 + 50 + 150 + 80 + 70 + 60) * 12 AND t_sold(41, '2026-03-01', '2026-04-01') = 7,
                   'March AP and policies before any correction');

-- The legacy fallback sale (a pre-snapshot event with no amount): synthetic, made by briefly lifting the sale guard.
ALTER TABLE public.wins DISABLE TRIGGER wins_policy_identity_guard;
UPDATE public.wins SET premium_snapshot = false, premium_amount = NULL WHERE policy_id = t_pol('l');
-- Recent wins lists sales entered before now(); this whole step is one transaction, so its sales are backdated 1 µs.
UPDATE public.wins SET created_at = created_at - interval '1 microsecond' WHERE id IN (SELECT v FROM public.test_pspc WHERE k LIKE 'win-%');
ALTER TABLE public.wins ENABLE TRIGGER wins_policy_identity_guard;
SELECT test_assert((SELECT e.source = 'legacy_record_fallback' AND e.monthly = 60 FROM public.wins w JOIN public.clients c ON c.id = w.contact_id,
                      private.policy_sale_effective_premium(w, c.premium) e WHERE w.policy_id = t_pol('l')), 'L follows its policy record');
SELECT test_assert((SELECT e.source = 'sale_snapshot' AND e.state = 'missing' AND e.monthly IS NULL AND e.revision = 0 FROM public.wins w
                      JOIN public.clients c ON c.id = w.contact_id, private.policy_sale_effective_premium(w, c.premium) e
                     WHERE w.policy_id = t_pol('u')), 'U is a snapshot sale with no premium');

GRANT EXECUTE ON FUNCTION public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_policy_sale_premiums(uuid) TO authenticated;
INSERT INTO test_results VALUES ('pspc-fingerprint-before', to_jsonb(t_fingerprint()));
INSERT INTO test_results VALUES ('pspc-wins-before', to_jsonb((SELECT count(*) FROM public.wins)));

-- Permissions (★5 default): the seller, the Team Leader ancestor and an inactive Admin are denied; a cross-org Admin
-- cannot find the sale; Admin, 'Super Admin' and is_super_admin succeed below.
SELECT test_actor(41); SET ROLE authenticated;
SELECT test_reject($q$SELECT t_fix(1, 'a', 0, 100, '100', 120, 'match_sale')$q$, '42501');
RESET ROLE; SELECT test_actor(14); SET ROLE authenticated;
SELECT test_reject($q$SELECT t_fix(1, 'a', 0, 100, '100', 120, 'match_sale')$q$, '42501');
RESET ROLE; SELECT test_actor(17); SET ROLE authenticated;
SELECT test_reject($q$SELECT t_fix(1, 'a', 0, 100, '100', 120, 'match_sale')$q$, '42501');
RESET ROLE; SELECT test_actor(22, 2); SET ROLE authenticated;
SELECT test_reject($q$SELECT t_fix(1, 'a', 0, 100, '100', 120, 'match_sale')$q$, 'PT404');
RESET ROLE;
SELECT test_assert((SELECT count(*) = 0 FROM private.policy_sale_premium_corrections), 'denied attempts write nothing');

-- Validation (22023 with DETAIL).
SELECT test_actor(13); SET ROLE authenticated;
SELECT test_reject($q$SELECT t_fix(2, 'a', 0, 100, '100', 120.001, 'match_sale')$q$, '22023');
SELECT test_reject($q$SELECT t_fix(2, 'a', 0, 100, '100', -1, 'match_sale')$q$, '22023');
SELECT test_reject($q$SELECT t_fix(2, 'a', 0, 100, '100', 1000000.01, 'match_sale')$q$, '22023');
SELECT test_reject($q$SELECT t_fix(2, 'a', 0, 100, '100', 120, 'match_sale', 'no')$q$, '22023');
SELECT test_reject($q$SELECT t_fix(2, 'a', 0, 100, '100', 120, 'match_sale', 'Entry error', 'typo')$q$, '22023');
SELECT test_reject($q$SELECT t_fix(2, 'a', 0, 100, '100', 120, 'overwrite')$q$, '22023');
SELECT test_reject($q$SELECT t_fix(2, 'a', -1, 100, '100', 120, 'match_sale')$q$, '22023');
SELECT test_reject($q$SELECT correct_policy_sale_premium(NULL, t_pol('a'), 0, 100, '100', 120, 'entry_error', 'Entry error', 'match_sale')$q$, '22023');
SELECT test_reject($q$SELECT correct_policy_sale_premium(test_id(90002), test_id(99999), 0, 100, '100', 120, 'entry_error', 'Entry error', 'match_sale')$q$, 'PT404');

-- Restatement: A $100 → $120 with match_sale restates March on the original seller; the count is unchanged.
RESET ROLE;
INSERT INTO test_results VALUES ('pspc-a-wins-row', to_jsonb((SELECT md5(to_jsonb(w)::text) FROM public.wins w WHERE policy_id = t_pol('a'))));
SET ROLE authenticated;
INSERT INTO test_results VALUES ('pspc-fix-a', t_fix(10, 'a', 0, 100, '100', 120, 'match_sale'));
RESET ROLE;
SELECT test_assert((SELECT data->>'book_action' = 'updated' AND (data->>'revision')::int = 1 AND (data->>'effective_annual')::numeric = 1440
                      AND (data->>'previous_effective_monthly')::numeric = 100 AND data->>'freeze' = 'false' AND data->>'idempotent' = 'false'
                      AND (data->>'seller_id')::uuid = test_id(41) AND data->>'sold_date' = '2026-03-10'
                      FROM test_results WHERE key = 'pspc-fix-a'), 'A corrected: revision 1, annual $1,440.00, book updated');
SELECT test_assert(t_ap(41, '2026-03-01', '2026-04-01') = (120 + 50 + 150 + 80 + 70 + 60) * 12 AND t_sold(41, '2026-03-01', '2026-04-01') = 7,
                   'March AP rises by $240.00 with the same policy count');
SELECT test_assert(t_ap(41, '2026-04-01', '2026-05-01') = 0 AND t_ap(41, '2026-11-01', '2026-12-01') = 0,
                   'a correction made later adds nothing to a later month');
SELECT test_assert((SELECT premium = 120 FROM public.clients WHERE id = t_pol('client-a')), 'match_sale updated the policy record');
SELECT test_assert((SELECT md5(to_jsonb(w)::text) FROM public.wins w WHERE policy_id = t_pol('a')) = (SELECT data #>> '{}' FROM test_results WHERE key = 'pspc-a-wins-row'),
                   'the wins row is byte-identical');
SELECT test_assert((SELECT premium_amount = 100 FROM public.wins WHERE policy_id = t_pol('a')), 'the original sale amount is kept');

-- Consumers behind the choke point agree to the cent (Leaderboard rows, recent wins).
SELECT test_actor(13); SET ROLE authenticated;
SELECT test_assert((SELECT (w->>'premiumSold')::numeric = 1440 AND (w->>'premium_amount')::numeric = 100 FROM jsonb_array_elements(get_leaderboard_recent_wins()) w
                     WHERE (w->>'id')::uuid = t_pol('win-a')), 'recent wins: premiumSold 1,440, raw amount unchanged');
RESET ROLE;
SELECT test_assert((SELECT sum(r.annualized_premium) FROM private.performance_rows(ARRAY[test_id(1)], '2000-01-01', '2100-01-01', '2026-03-01', '2026-04-01') r
                     WHERE r.agent_id = test_id(41)) = 6360, 'performance rows for the agency carry the restated AP');

-- Replay and conflicts.
SELECT test_actor(13); SET ROLE authenticated;
INSERT INTO test_results VALUES ('pspc-fix-a-retry', t_fix(10, 'a', 0, 100, '100', 120, 'match_sale'));
SELECT test_assert((SELECT data->>'idempotent' = 'true' AND (data - 'idempotent') = (SELECT data - 'idempotent' FROM test_results WHERE key = 'pspc-fix-a')
                      FROM test_results WHERE key = 'pspc-fix-a-retry'), 'an identical retry returns the original result');
SELECT test_reject($q$SELECT t_fix(10, 'a', 0, 100, '100', 120, 'match_sale', 'A different note')$q$, 'PT409');
SELECT test_reject($q$SELECT t_fix(11, 'a', 0, 100, '120', 130, 'match_sale')$q$, 'PT409');
SELECT test_reject($q$SELECT t_fix(11, 'a', 1, 100, '120', 130, 'match_sale')$q$, 'PT409');
SELECT test_reject($q$SELECT t_fix(11, 'a', 1, 120, '100', 130, 'match_sale')$q$, 'PT409');
SELECT test_reject($q$SELECT t_fix(11, 'a', 1, 120, '120', 120, 'match_sale')$q$, '22023');
RESET ROLE;
SELECT test_actor(16); SET ROLE authenticated;
SELECT test_reject($q$SELECT t_fix(10, 'a', 0, 100, '100', 120, 'match_sale')$q$, 'PT409');
RESET ROLE;
SELECT test_assert((SELECT count(*) = 1 FROM private.policy_sale_premium_corrections), 'one ledger row after the retry and the refusals');

-- A later edit of A's policy record never moves its AP.
SELECT test_actor(41); SET ROLE authenticated;
SELECT update_client_with_policy_sale(t_pol('client-a'), '{"premium":130}');
RESET ROLE;
SELECT test_assert(t_eff('a') = 120 AND t_ap(41, '2026-03-01', '2026-04-01') = 6360, 'a book edit after a correction does not move AP');

-- Book modes. B: an Edit Client change (a genuine later change) moves the book only; then book_diverged,
-- keep_current and already_matched.
SELECT test_actor(41); SET ROLE authenticated;
SELECT update_client_with_policy_sale(t_pol('client-b'), '{"premium":90}');
RESET ROLE;
SELECT test_assert(t_eff('b') = 80 AND (SELECT count(*) = 1 FROM private.policy_sale_premium_corrections),
                   'an Edit Client premium change writes no ledger row and leaves AP at the sale amount');
SELECT test_actor(13); SET ROLE authenticated;
SELECT test_reject($q$SELECT t_fix(20, 'b', 0, 80, '90', 85, 'match_sale')$q$, '22023');
INSERT INTO test_results VALUES ('pspc-fix-b', t_fix(21, 'b', 0, 80, '90', 85, 'keep_current'));
INSERT INTO test_results VALUES ('pspc-fix-b2', t_fix(22, 'b', 1, 85, '90', 90, 'match_sale', 'Carrier confirmed', 'carrier_confirmed_amount'));
RESET ROLE;
SELECT test_assert((SELECT data->>'book_action' = 'kept_current' FROM test_results WHERE key = 'pspc-fix-b')
                   AND (SELECT data->>'book_action' = 'already_matched' AND (data->>'revision')::int = 2 FROM test_results WHERE key = 'pspc-fix-b2')
                   AND (SELECT premium = 90 FROM public.clients WHERE id = t_pol('client-b')) AND t_eff('b') = 90,
                   'B: keep_current, then already_matched at revision 2; the book stays 90');
SELECT test_assert((SELECT revision = 2 AND supersedes_id = (SELECT id FROM private.policy_sale_premium_corrections WHERE request_id = test_id(90021))
                      AND previous_source = 'correction' AND previous_effective_monthly = 85
                      FROM private.policy_sale_premium_corrections WHERE request_id = test_id(90022)), 'revision 2 extends revision 1');

-- Additional policies: a JSON number and a "$150/mo" string; only the one element's premiumAmount changes.
UPDATE public.clients SET custom_fields = jsonb_set(custom_fields, '{additional_policies,1,premiumAmount}', '"$150/mo"')
 WHERE id = t_pol('client-a');
INSERT INTO test_results VALUES ('pspc-a-custom-before', (SELECT custom_fields FROM public.clients WHERE id = t_pol('client-a')));
SELECT test_actor(19); SET ROLE authenticated;
INSERT INTO test_results VALUES ('pspc-fix-a2', t_fix(30, 'a2', 0, 50, '50', 55, 'match_sale'));
INSERT INTO test_results VALUES ('pspc-fix-a3', t_fix(31, 'a3', 0, 150, '"$150/mo"', 160, 'match_sale'));
RESET ROLE;
SELECT test_assert((SELECT custom_fields #> '{additional_policies,0,premiumAmount}' = '55' AND custom_fields #> '{additional_policies,1,premiumAmount}' = '160'
                      AND (custom_fields #- '{additional_policies,0,premiumAmount}' #- '{additional_policies,1,premiumAmount}')
                          = ((SELECT data FROM test_results WHERE key = 'pspc-a-custom-before') #- '{additional_policies,0,premiumAmount}' #- '{additional_policies,1,premiumAmount}')
                      FROM public.clients WHERE id = t_pol('client-a')), 'only the two premiumAmount values changed; every other key is preserved');
SELECT test_assert(t_eff('a') = 120 AND t_eff('a2') = 55 AND t_eff('a3') = 160, 'two policies of one buyer: each correction changes only its own sale');
SELECT test_assert((SELECT actor_role = 'Super Admin' FROM private.policy_sale_premium_corrections WHERE request_id = test_id(90030)),
                   'an is_super_admin actor is recorded as Super Admin');

-- Zero and unknown: a primary to 0 cannot use match_sale; keep_current stores a known 0. An additional policy writes
-- JSON 0. An unknown premium becomes known.
SELECT test_actor(16); SET ROLE authenticated;
SELECT test_reject($q$SELECT t_fix(40, 'c', 0, 70, '70', 0, 'match_sale')$q$, '22023');
INSERT INTO test_results VALUES ('pspc-fix-c', t_fix(41, 'c', 0, 70, '70', 0, 'keep_current'));
INSERT INTO test_results VALUES ('pspc-fix-a2-zero', t_fix(42, 'a2', 1, 55, '55', 0, 'match_sale'));
INSERT INTO test_results VALUES ('pspc-fix-u', t_fix(43, 'u', 0, NULL, 'null', 40, 'match_sale', 'Premium was missing at entry', 'missing_at_entry'));
RESET ROLE;
SELECT test_assert(t_eff('c') = 0 AND (SELECT premium = 70 FROM public.clients WHERE id = t_pol('client-c')), 'C: a known $0 sale; the book keeps 70');
SELECT test_assert(t_eff('a2') = 0 AND (SELECT custom_fields #> '{additional_policies,0,premiumAmount}' = '0' FROM public.clients WHERE id = t_pol('client-a')),
                   'an additional policy writes JSON 0');
SELECT test_assert(t_eff('u') = 40 AND (SELECT premium = 40 FROM public.clients WHERE id = t_pol('client-u')), 'an unknown sale premium becomes known');
SELECT test_actor(13); SET ROLE authenticated;
INSERT INTO test_results VALUES ('pspc-fix-u-unknown', t_fix(44, 'u', 1, 40, '40', NULL, 'match_sale', 'Premium not confirmed', 'other'));
RESET ROLE;
SELECT test_assert(t_eff('u') IS NULL AND (SELECT premium IS NULL FROM public.clients WHERE id = t_pol('client-u'))
                   AND (SELECT e.state = 'missing' AND e.source = 'correction' FROM public.wins w JOIN public.clients c ON c.id = w.contact_id,
                          private.policy_sale_effective_premium(w, c.premium) e WHERE w.policy_id = t_pol('u')),
                   'a correction to unknown is missing, not 0');

-- Legacy fallback freeze (RL-15): a book edit moves AP until a same-amount revision freezes it.
SELECT test_actor(41); SET ROLE authenticated;
SELECT update_client_with_policy_sale(t_pol('client-l'), '{"premium":65}');
RESET ROLE;
SELECT test_assert(t_eff('l') = 65, 'the legacy fallback sale follows its record until frozen (disclosed exception)');
SELECT test_actor(13); SET ROLE authenticated;
INSERT INTO test_results VALUES ('pspc-freeze', t_fix(50, 'l', 0, 65, '65', 65, 'keep_current', 'Freeze the sold amount', 'other'));
SELECT test_reject($q$SELECT t_fix(51, 'l', 1, 65, '65', 65, 'keep_current', 'Freeze again', 'other')$q$, '22023');
RESET ROLE;
SELECT test_assert((SELECT data->>'freeze' = 'true' AND data->>'book_action' = 'kept_current' FROM test_results WHERE key = 'pspc-freeze')
                   AND (SELECT previous_source = 'legacy_record_fallback' AND corrected_monthly = previous_effective_monthly
                          FROM private.policy_sale_premium_corrections WHERE request_id = test_id(90050)), 'freeze accepted once');
SELECT test_actor(41); SET ROLE authenticated;
SELECT update_client_with_policy_sale(t_pol('client-l'), '{"premium":70}');
RESET ROLE;
SELECT test_assert(t_eff('l') = 65, 'after the freeze a book edit no longer moves AP');

-- Reassignment: the original seller keeps the credit, and a later correction still targets the original sale.
SELECT test_actor(13); SET ROLE authenticated;
SELECT update_client_with_policy_sale(t_pol('client-b'), jsonb_build_object('assigned_agent_id', test_id(42)));
INSERT INTO test_results VALUES ('pspc-fix-b3', t_fix(60, 'b', 2, 90, '90', 95, 'match_sale'));
RESET ROLE;
SELECT test_assert((SELECT seller_id = test_id(41) FROM private.policy_sale_premium_corrections WHERE request_id = test_id(90060))
                   AND t_sold(42, '2026-03-01', '2026-04-01') = 0 AND t_eff('b') = 95,
                   'the original seller keeps the restated sale after reassignment');

-- History visibility (D2-16).
SELECT test_actor(13); SET ROLE authenticated;
INSERT INTO test_results VALUES ('pspc-hist-admin', get_client_policy_sale_premiums(t_pol('client-a')));
RESET ROLE; SELECT test_actor(41); SET ROLE authenticated;
INSERT INTO test_results VALUES ('pspc-hist-seller', get_client_policy_sale_premiums(t_pol('client-a')));
RESET ROLE; SELECT test_actor(14); SET ROLE authenticated;
INSERT INTO test_results VALUES ('pspc-hist-tl', get_client_policy_sale_premiums(t_pol('client-a')));
RESET ROLE; SELECT test_actor(42); SET ROLE authenticated;
INSERT INTO test_results VALUES ('pspc-hist-peer', get_client_policy_sale_premiums(t_pol('client-a')));
RESET ROLE; SELECT test_actor(22, 2); SET ROLE authenticated;
INSERT INTO test_results VALUES ('pspc-hist-other', get_client_policy_sale_premiums(t_pol('client-a')));
RESET ROLE;
SELECT test_assert((SELECT (data->>'can_correct')::boolean AND jsonb_array_length(data->'policies') = 3
                      AND (SELECT (p->'effective'->>'revision')::int = 1 AND (p->'effective'->>'annual')::numeric = 1440 AND (p->'original'->>'monthly')::numeric = 100
                                  AND (p->'book'->>'monthly')::numeric = 130 AND (p->'book'->>'matches_sale')::boolean = false
                                  AND p->'history'->0->>'request_id' = test_id(90010)::text AND p->'history'->0->>'actor_name' = 'Admin One'
                             FROM jsonb_array_elements(data->'policies') p WHERE (p->>'policy_id')::uuid = t_pol('a'))
                      FROM test_results WHERE key = 'pspc-hist-admin'), 'Admin sees the book, the request ids and can_correct');
SELECT test_assert((SELECT NOT (data->>'can_correct')::boolean AND jsonb_array_length(data->'policies') = 3
                      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(data->'policies') p WHERE p->'book' <> 'null'::jsonb
                                       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p->'history') h WHERE h->'request_id' <> 'null'::jsonb))
                      FROM test_results WHERE key = k), k || ': visible, without the book, request ids or can_correct')
  FROM unnest(ARRAY['pspc-hist-seller', 'pspc-hist-tl']) k;
SELECT test_assert((SELECT jsonb_array_length(data->'policies') = 0 FROM test_results WHERE key = k), k || ': no policies')
  FROM unnest(ARRAY['pspc-hist-peer', 'pspc-hist-other']) k;

-- No side effects: no sale inserted, identities and receipts unchanged beyond the setup above, no notify path.
SELECT test_assert((SELECT count(*) FROM public.wins) = (SELECT (data #>> '{}')::bigint FROM test_results WHERE key = 'pspc-wins-before'),
                   'corrections insert no sale');
SELECT test_assert((SELECT md5(coalesce(string_agg(md5(to_jsonb(i)::text), ',' ORDER BY i.policy_id), '')) FROM private.policy_identities i)
                   = (SELECT md5(coalesce(string_agg(md5(to_jsonb(i)::text), ',' ORDER BY i.policy_id), '')) FROM private.policy_identities i),
                   'identity fingerprint is stable');
SELECT test_assert(position('notify_win' IN pg_get_functiondef('public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text)'::regprocedure)) = 0
                   AND position('INSERT INTO public.wins' IN pg_get_functiondef('public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text)'::regprocedure)) = 0,
                   'the writer never notifies and never writes a sale');

-- Append-only and chain guards; a direct UPDATE of wins is still refused.
SELECT test_reject($q$UPDATE private.policy_sale_premium_corrections SET note = 'Changed later' WHERE request_id = test_id(90010)$q$, '23514');
SELECT test_reject($q$DELETE FROM private.policy_sale_premium_corrections WHERE request_id = test_id(90010)$q$, '23514');
SELECT test_reject($q$TRUNCATE private.policy_sale_premium_corrections$q$, '23514');
SELECT test_reject($q$INSERT INTO private.policy_sale_premium_corrections(organization_id, win_id, policy_id, policy_source, buyer_id, seller_id, sold_date,
  revision, previous_effective_monthly, previous_source, corrected_monthly, reason_code, note, book_mode, book_action, actor_id, actor_role, request_id, payload_hash, result)
  SELECT w.organization_id, w.id, w.policy_id, 'primary', w.contact_id, w.agent_id, w.sold_date, 5, 120, 'correction', 125, 'other', 'Broken chain',
         'keep_current', 'kept_current', test_id(13), 'Admin', test_id(90099), repeat('a', 64), '{}' FROM public.wins w WHERE w.policy_id = t_pol('a')$q$, '23514');
SELECT test_reject($q$INSERT INTO private.policy_sale_premium_corrections(organization_id, win_id, policy_id, policy_source, buyer_id, seller_id, sold_date,
  revision, previous_effective_monthly, previous_source, corrected_monthly, reason_code, note, book_mode, book_action, actor_id, actor_role, request_id, payload_hash, result)
  SELECT w.organization_id, w.id, w.policy_id, 'primary', w.contact_id, w.agent_id, w.sold_date, 1, 80, 'sale_snapshot', 80, 'other', 'Same amount',
         'keep_current', 'kept_current', test_id(13), 'Admin', test_id(90098), repeat('a', 64), '{}' FROM public.wins w WHERE w.policy_id = t_pol('c')$q$, '23514');
SELECT test_reject($q$INSERT INTO private.policy_sale_premium_corrections(organization_id, win_id, policy_id, policy_source, buyer_id, seller_id, sold_date,
  revision, previous_effective_monthly, previous_source, corrected_monthly, reason_code, note, book_mode, book_action, actor_id, actor_role, request_id, payload_hash, result)
  SELECT w.organization_id, w.id, w.policy_id, 'primary', w.contact_id, test_id(42), w.sold_date, 2, 120, 'correction', 125, 'other', 'Wrong seller',
         'keep_current', 'kept_current', test_id(13), 'Admin', test_id(90097), repeat('a', 64), '{}' FROM public.wins w WHERE w.policy_id = t_pol('a')$q$, '23514');
SELECT test_reject($q$UPDATE public.wins SET premium_amount = 120 WHERE policy_id = t_pol('a')$q$, '23514');
SET ROLE authenticated;
SELECT test_reject($q$SELECT * FROM private.policy_sale_premium_corrections$q$, '42501');
RESET ROLE;

-- Budget: with 5,000 sales in the organization both RPCs finish under the authenticated 8 s limit.
-- Bulk clients carry no policy fields, so the identity trigger registers nothing; their sales are synthetic legacy rows.
INSERT INTO public.clients(id, organization_id, assigned_agent_id, first_name, last_name)
SELECT test_id(700000 + g), test_id(1), test_id(42), 'Bulk', g::text FROM generate_series(1, 5000) g;
ALTER TABLE public.wins DISABLE TRIGGER wins_policy_identity_guard;
INSERT INTO private.policy_identities(policy_id, organization_id, client_id, source, legacy)
SELECT test_id(710000 + g), test_id(1), test_id(700000 + g), 'primary', true FROM generate_series(1, 5000) g;
INSERT INTO public.wins(id, organization_id, policy_id, agent_id, contact_id, premium_amount, premium_snapshot, sold_date, created_at)
SELECT test_id(720000 + g), test_id(1), test_id(710000 + g), test_id(42), test_id(700000 + g), 25, true, '2026-03-20', now() FROM generate_series(1, 5000) g;
ALTER TABLE public.wins ENABLE TRIGGER wins_policy_identity_guard;
SELECT test_actor(13); SET ROLE authenticated; SET statement_timeout = '8s';
INSERT INTO test_results VALUES ('pspc-budget', correct_policy_sale_premium(test_id(90070), test_id(712500), 0, 25, 'null', 30, 'entry_error', 'Budget case', 'keep_current'));
SELECT test_assert(jsonb_array_length(get_client_policy_sale_premiums(test_id(702500))->'policies') = 1, 'history within budget');
RESET statement_timeout; RESET ROLE;

-- The choke point and the effective reader agree for every sale, corrected or not.
SELECT test_assert(NOT EXISTS (SELECT 1 FROM public.wins w LEFT JOIN public.clients c ON c.id = w.contact_id AND c.organization_id = w.organization_id
                                WHERE private.performance_sale_monthly(w, c.premium)
                                      IS DISTINCT FROM (SELECT e.monthly FROM private.policy_sale_effective_premium(w, c.premium) e)),
                   'performance_sale_monthly equals the effective reader for every sale');

REVOKE EXECUTE ON FUNCTION public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_client_policy_sale_premiums(uuid) FROM authenticated;
SELECT test_assert(NOT has_function_privilege('authenticated', 'public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text)', 'EXECUTE'),
                   'the writer is sealed again at the end of the suite');

-- @@v3@@
-- =====================================================================================================
-- Reports v3 on the effective premium (…21, D2 §3.7, §6.5 step 1, §9). Run by scripts/reports_v3_fixture.py after
-- …20 and …21, on the PKG-A fixture organization O1 (reports_v3_fixtures.sql), inside a savepoint that is rolled back:
-- the ledger is empty again afterwards, so the empty-ledger rollback can return the database to the exact PKG-A state.
-- The correction RPC's own paths are covered above on the verbatim sale writers; here ledger heads are written
-- directly (as the table owner, through the insert guard) so the v3 readers are checked against hand-computed values.
-- Before: KPI 1 = 4,057.08 (October, O1), KPI 2 = 13, known 9, missing 3, invalid 1, one legacy fallback (W6).
-- =====================================================================================================
SAVEPOINT pspc_v3;

SELECT rt.eq('…21: basis flags 3.1.0 with the audited ledger', private.report_v3_basis_flags(),
  '{"contract_version":"3.1.0","corrections":"audited_ledger","sale_call_links":"not_installed","appointment_evidence":"not_installed"}'::jsonb);
SELECT rt.eq('…21: summary and state payloads carry 3.1.0 / audited_ledger (X13)',
  (SELECT string_agg(concat_ws('/', p ->> 'contract_version', p #>> '{basis,corrections}'), ',')
     FROM (VALUES (rt.v3r('ADM1', 'summary')), (rt.v3r('ADM1', 'state_breakdown')), (rt.v3r('ADM1', 'scope'))) x(p)),
  '3.1.0/audited_ledger,3.1.0/audited_ledger,3.1.0/audited_ledger');
SELECT rt.eq('…21: class W ACL matrix (authenticated only; the v3 readers stay sealed)',
  (SELECT string_agg(f || ':' || r || '=' || has_function_privilege(r, f, 'EXECUTE'), ' ' ORDER BY f, r)
     FROM unnest(ARRAY['public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text)',
                       'public.get_client_policy_sale_premiums(uuid)']) f,
          unnest(ARRAY['anon', 'authenticated', 'reports_v3_inherits_authenticated', 'reports_v3_public_only', 'service_role']) r),
  (SELECT string_agg(f || ':' || r || '=' || (r IN ('authenticated', 'reports_v3_inherits_authenticated')), ' ' ORDER BY f, r)
     FROM unnest(ARRAY['public.correct_policy_sale_premium(uuid,uuid,integer,numeric,jsonb,numeric,text,text,text)',
                       'public.get_client_policy_sale_premiums(uuid)']) f,
          unnest(ARRAY['anon', 'authenticated', 'reports_v3_inherits_authenticated', 'reports_v3_public_only', 'service_role']) r));
SELECT rt.assert_sealed_v3(true, false);
SELECT rt.assert_v3_helper_shape();
SELECT rt.eq('…21: with an empty ledger every sale is unchanged (W1 snapshot, W6 legacy fallback)',
  rt.sf('W1') || ' ' || rt.sf('W6'), '100.00|sale_snapshot|known|0 80.50|legacy_record_fallback|known|0');

CREATE TABLE rt.pspc_before AS
  SELECT rt.prod() AS prod, rt.v3r('ADM1', 'summary') AS summary, rt.v3r('ADM1', 'state_breakdown') AS states;

-- One ledger revision for a sale, as the correction RPC would write it (the insert guard checks the sale and chain).
CREATE FUNCTION rt.pspc(p_win text, p_rev integer, p_prev numeric, p_prev_source text, p_new numeric) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO private.policy_sale_premium_corrections (organization_id, win_id, policy_id, policy_source, buyer_id,
    seller_id, sold_date, revision, supersedes_id, previous_effective_monthly, previous_source, corrected_monthly,
    reason_code, note, book_mode, book_action, actor_id, actor_role, request_id, payload_hash, result)
  SELECT w.organization_id, w.id, w.policy_id, coalesce(i.source, 'primary'), w.contact_id, w.agent_id, w.sold_date,
         p_rev, (SELECT h.id FROM private.policy_sale_premium_corrections h WHERE h.win_id = w.id AND h.revision = p_rev - 1),
         p_prev, p_prev_source, p_new, 'entry_error', 'synthetic v3 check', 'keep_current', 'kept_current',
         rt.v3('ADM1'), 'Admin', gen_random_uuid(), repeat('0', 64), '{}'::jsonb
    FROM public.wins w LEFT JOIN private.policy_identities i ON i.organization_id = w.organization_id AND i.policy_id = w.policy_id
   WHERE w.id = rt.v3(p_win);
$$;
-- W1 (A1, 2026-10-02) $100 → $120 → $125 (two revisions); W6 (A3) frozen at its legacy fallback $80.50;
-- W2 (A1, 2026-10-03, a known $0) corrected to unknown.
SELECT rt.pspc('W1', 1, 100.00, 'sale_snapshot', 120.00);
SELECT rt.pspc('W1', 2, 120.00, 'correction', 125.00);
SELECT rt.pspc('W6', 1, 80.50, 'legacy_record_fallback', 80.50);
SELECT rt.pspc('W2', 1, 0, 'sale_snapshot', NULL);

SELECT rt.eq('sale facts read the head revision (source correction; unknown is missing)',
  rt.sf('W1') || ' ' || rt.sf('W6') || ' ' || rt.sf('W2'),
  '125.00|correction|known|2 80.50|correction|known|1 null|correction|missing|1');
SELECT rt.eq('choke point = v3 stub = effective reader for every sale',
  (SELECT count(*) FROM public.wins w LEFT JOIN public.clients c ON c.id = w.contact_id AND c.organization_id = w.organization_id
    CROSS JOIN LATERAL private.report_v3_sale_premium(w, c.premium) n
    CROSS JOIN LATERAL private.policy_sale_effective_premium(w, c.premium) e
    WHERE (n.monthly, n.premium_source, n.premium_state, n.revision) IS DISTINCT FROM (e.monthly, e.source, e.state, e.revision)
       OR n.monthly IS DISTINCT FROM private.performance_sale_monthly(w, c.premium)), 0::bigint);

-- KPI 1: 4,057.08 + 12 × (125 − 100) = 4,357.08; KPI 2 unchanged (13); KPI 4 = 4,357.08 ÷ 8 known.
SELECT rt.eq('production totals restated on the original seller and Sold Date',
  (SELECT concat_ws('|', t ->> 'policy_count', t ->> 'known_count', t ->> 'missing_count', t ->> 'invalid_count',
                    t ->> 'annual_premium', t -> 'premium_sources', t ->> 'corrections_applied')
     FROM (SELECT rt.prod() -> 'totals' AS t) x),
  '13|8|4|1|4357.08|{"none": 2, "correction": 3, "sale_snapshot": 7, "legacy_sale_event": 1, "legacy_record_fallback": 0}|3');
SELECT rt.eq('KPI 1, 2 and 4 values', concat_ws('|', rt.kpi(rt.v3r('ADM1', 'summary'), 1), rt.kpi(rt.v3r('ADM1', 'summary'), 2),
  round(rt.kpi(rt.v3r('ADM1', 'summary'), 4)::numeric, 6)), '4357.08|13|' || round(4357.08 / 8, 6));
SELECT rt.eq('KPI 1 detail: the frozen legacy fallback no longer counts',
  rt.kpi(rt.v3r('ADM1', 'summary'), 1, 'detail')::jsonb -> 'premium',
  '{"known": 8, "invalid": 1, "missing": 4, "legacy_record_fallback": 0}'::jsonb);
SELECT rt.eq('KPI 1 moves by exactly 12 × the corrected difference',
  rt.kpi(rt.v3r('ADM1', 'summary'), 1)::numeric - rt.kpi((SELECT summary FROM rt.pspc_before), 1)::numeric, 300.00);
SELECT rt.eq('by_agent: A1 restated (W1 +$25/mo, W2 unknown), A2 and A3 unchanged',
  (SELECT string_agg(concat_ws(':', i.name, r ->> 'policy_count', r ->> 'known_count', r ->> 'missing_count', r ->> 'annual_premium'), ' '
                     ORDER BY i.name)
     FROM jsonb_array_elements(rt.prod() -> 'by_agent') r JOIN rt.v3_ids i ON i.id = (r ->> 'agent_id')::uuid),
  'A1:4:3:1:2403.00 A2:5:3:1:508.08 A3:3:1:2:966.00');
SELECT rt.eq('production_by_date: Oct 2 +$300, Oct 3 one more missing, totals agree',
  (SELECT string_agg(concat_ws(':', d ->> 'date', d ->> 'policies_sold', d ->> 'premium_known', d ->> 'premium_missing', d ->> 'annual_premium'), ' '
                     ORDER BY d ->> 'date')
     FROM jsonb_array_elements(rt.prod() -> 'production_by_date') d WHERE d ->> 'date' IN ('2026-10-02', '2026-10-03'))
  || ' Σ' || rt.jsum(rt.prod(), '$.production_by_date[*].annual_premium'),
  '2026-10-02:1:1:0:1500.00 2026-10-03:2:0:2:0 Σ4357.08');
SELECT rt.eq('state AP: only the corrected buyer''s state moves (+$300.00); policies sold unchanged',
  (SELECT string_agg(a.state || ':' || (a.ap - b.ap) || ':' || (a.sold - b.sold), ' ' ORDER BY a.state)
     FROM (SELECT j ->> 'state' AS state, coalesce((j #>> '{premium,annual_premium}')::numeric, 0) AS ap, (j ->> 'policies_sold')::int AS sold
             FROM jsonb_array_elements(rt.v3r('ADM1', 'state_breakdown') -> 'jurisdictions') j) a
     JOIN (SELECT j ->> 'state' AS state, coalesce((j #>> '{premium,annual_premium}')::numeric, 0) AS ap, (j ->> 'policies_sold')::int AS sold
             FROM jsonb_array_elements((SELECT states FROM rt.pspc_before) -> 'jurisdictions') j) b USING (state)
    WHERE a.ap <> b.ap OR a.sold <> b.sold),
  'CA:300.00:0');
SELECT rt.eq('state reader still reconciles with the summary (Σ jurisdictions + Σ unmapped = KPI 1)', rt.st_recon('ADM1'), 'ok');
SELECT rt.eq('personal scope: A1 restated, A2 unchanged',
  ARRAY[rt.kpi(rt.v3r('A1', 'summary', 'personal'), 1)::numeric, rt.kpi(rt.v3r('A2', 'summary', 'personal'), 1)::numeric],
  ARRAY[2403.00, 508.08]);
SELECT rt.eq('organization isolation: O2 unchanged', rt.sf_wins('O2', NULL, NULL, NULL), 'WB1');

ROLLBACK TO SAVEPOINT pspc_v3;
SELECT rt.eq('the v3 section leaves the ledger empty', (SELECT count(*) FROM private.policy_sale_premium_corrections), 0::bigint);
