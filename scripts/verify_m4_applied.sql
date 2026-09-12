-- M4 post-apply verification — READ ONLY. Checks policy EXPRESSIONS, effective privileges and function
-- security attributes, not counts or the mere presence of a GRANT. Safe to run at any time.
\echo '── tables: RLS enabled, not force-RLS, owned by postgres ──'
select c.relname, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls,
       pg_get_userbyid(c.relowner) as owner
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('agent_inbound_settings','agent_phone_registrations')
 order by 1;

\echo '── policy EXPRESSIONS (each must be organization-scoped; registrations must have NO write policy) ──'
select c.relname, p.polname,
       case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE'
                     when 'd' then 'DELETE' else p.polcmd::text end as cmd,
       (select string_agg(r.rolname, ',') from unnest(p.polroles) pr(oid) join pg_roles r on r.oid = pr.oid) as roles,
       pg_get_expr(p.polqual, p.polrelid) as using_expr,
       pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expr
  from pg_policy p join pg_class c on c.oid = p.polrelid
 where c.relname in ('agent_inbound_settings','agent_phone_registrations')
 order by c.relname, p.polname;

\echo '── EFFECTIVE table privileges — expect exactly the contract, TRUNCATE denied for authenticated ──'
select t.tbl, g.grantee, g.priv, has_table_privilege(g.grantee, 'public.'||t.tbl, g.priv) as granted
  from (values ('agent_inbound_settings'),('agent_phone_registrations')) t(tbl),
       (values ('authenticated'),('anon'),('service_role')) r(grantee),
       lateral (select r.grantee, p.priv from (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
                                                      ('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)) g
 order by t.tbl, g.grantee, g.priv;
-- expected · agent_inbound_settings    authenticated: SELECT/INSERT/UPDATE = t, everything else = f
--          · agent_phone_registrations authenticated: SELECT = t, everything else = f
--          · anon: all f · service_role: all t

\echo '── function security attributes and ACLs ──'
select p.proname, p.prosecdef as security_definer, p.provolatile,
       pg_get_userbyid(p.proowner) as owner, array_to_string(p.proacl, ', ') as acl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public','private')
   and p.proname in ('is_phone_connected','heartbeat_phone_registration','agent_inbound_settings_guard')
 order by 1;
-- expected · is_phone_connected            security_definer = f (INVOKER), acl: authenticated=X, service_role=X, NO anon
--          · heartbeat_phone_registration  security_definer = t (it writes the caller's own row under RLS)

\echo '── nothing else moved ──'
select 'calls' as rel, count(*) as policies from pg_policy where polrelid='public.calls'::regclass
union all select 'profiles', count(*) from pg_policy where polrelid='public.profiles'::regclass
union all select 'inbound_routing_settings', count(*) from pg_policy where polrelid='public.inbound_routing_settings'::regclass
order by 1;
-- expected 5 / 3 / 3

\echo '── recorded migration version ──'
select version, name from supabase_migrations.schema_migrations order by version desc limit 3;

\echo '── cross-organization isolation, SELF-CONTAINED (role stays set for the function call) ──'
\echo '   substitute two real uuids from different organizations, then run this block on its own:'
\echo '   begin;'
\echo "     select set_config('request.jwt.claims', json_build_object('sub','<ORG_B_USER>','role','authenticated')::text, true);"
\echo '     set local role authenticated;'
\echo "     select count(*) as rows_visible,                        -- expect 0"
\echo "            public.is_phone_connected('<ORG_A_AGENT>') as leaked   -- expect FALSE"
\echo '       from public.agent_phone_registrations;'
\echo '   rollback;'
\echo '   NOTE: an EMPTY registrations table proves nothing. Seed a live registration for <ORG_A_AGENT>'
\echo '   first (through heartbeat_phone_registration as that agent), so FALSE means "isolated", not "no data".'
