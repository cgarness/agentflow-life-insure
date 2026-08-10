-- =====================================================================================================
-- generate_acl_sync.sql — deterministic generator for the baseline's ACL-sync appendix (Appendix D).
-- =====================================================================================================
-- WHY THIS EXISTS (Phase 0 finding, 2026-08-08): `supabase db dump` emits GRANTs computed against
-- pg_init_privs, assuming the target database starts with NO acl. A fresh local stack, however,
-- pre-applies ALTER DEFAULT PRIVILEGES for the postgres role in schema public, so every function
-- created during replay silently receives EXECUTE for anon/authenticated/service_role. The dump
-- never emits the compensating REVOKEs, so the replayed environment re-granted anon EXECUTE on 31
-- of production's 32 hardened functions. This generator emits the exact compensating statements.
--
-- CONTRACT:
--   * Run READ-ONLY against production. Output is a single DO block; paste it verbatim as
--     "APPENDIX D" of the baseline migration. NEVER hand-edit the appendix — regenerate it.
--     (The DO-block wrapper is required: the CLI statement splitter mis-parses bare REVOKE
--     statements whose signatures contain OUT parameters.)
--   * Scope: functions and tables in schemas public/private whose live ACL differs from what a
--     fresh replay would produce (functions: the default-privileges template
--     {postgres,anon,authenticated,service_role}=X; public tables: the same four roles with full
--     table privileges; private tables: NULL).
--   * Extension-owned objects (grantor supabase_admin) are excluded: the local CREATE EXTENSION
--     reproduces their ACLs natively and postgres cannot forge supabase_admin-grantor entries.
--   * Ordering rules preserve aclitem array order so the fingerprint 'function'/'grants'
--     categories compare byte-identical (REVOKE removes entries in place; GRANT appends).
--   * Verification: scripts/fingerprint_rollup.sql 'function' and 'grants' md5s must match
--     production exactly after replay. That check, not this generator, is the authority.
-- =====================================================================================================
with fn as (
  select p.oid,
         n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as sig,
         array(select coalesce(nullif(a.grantee::regrole::text,'-'),'PUBLIC')
               from aclexplode(p.proacl) a where a.privilege_type='EXECUTE') as target_roles,
         array(select distinct a.grantor::regrole::text from aclexplode(p.proacl) a) as grantors
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.prokind='f' and p.proacl is not null
),
fn_dev as (
  select sig, target_roles from fn
  where grantors = array['postgres']
    and target_roles is distinct from array['postgres','anon','authenticated','service_role']
),
fn_stmts as (
  select sig, 1 as ord,
         'REVOKE ALL ON FUNCTION '||sig||' FROM '||r as stmt
  from fn_dev, unnest(array['anon','authenticated','service_role','supabase_auth_admin']) r
  where not (r = any(target_roles))
  union all
  select sig, 2 + t.ord as ord,
         'GRANT EXECUTE ON FUNCTION '||sig||' TO '||t.r as stmt
  from fn_dev, lateral unnest(target_roles) with ordinality t(r, ord)
  where t.r not in ('postgres','anon','authenticated','service_role') and t.r <> 'PUBLIC'
),
tbl as (
  select c.oid, n.nspname as sch, n.nspname||'.'||c.relname as tname,
         c.relacl as acl, (c.relacl is null) as acl_null
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind = 'r'
),
tbl_roles as (
  select t.tname, t.sch, t.acl_null,
         coalesce(nullif(a.grantee::regrole::text,'-'),'PUBLIC') as role,
         string_agg(a.privilege_type, ',' order by case a.privilege_type
           when 'INSERT' then 1 when 'SELECT' then 2 when 'UPDATE' then 3 when 'DELETE' then 4
           when 'TRUNCATE' then 5 when 'REFERENCES' then 6 when 'TRIGGER' then 7 when 'MAINTAIN' then 8 else 9 end) as privs
  from tbl t, aclexplode(t.acl) a
  where t.acl is not null
  group by 1,2,3,4
),
-- deviation tables: public tables whose grantee->priv map differs from the 4-role full template,
-- or private tables that carry any explicit acl (fresh replay leaves private tables NULL).
tbl_dev as (
  select distinct t.tname, t.sch from tbl t
  where (t.sch='public' and (
          (select count(*) from tbl_roles r where r.tname=t.tname) <> 4
          or exists (select 1 from tbl_roles r where r.tname=t.tname
                     and (r.role not in ('postgres','anon','authenticated','service_role')
                          or r.privs <> 'INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'))))
     or (t.sch='private' and not t.acl_null)
),
tbl_stmts as (
  -- public: role in fresh-replay template but absent from target -> revoke all
  select d.tname, 1 as ord, 'REVOKE ALL ON TABLE '||d.tname||' FROM '||r as stmt
  from tbl_dev d, unnest(array['anon','authenticated','service_role']) r
  where d.sch='public'
    and not exists (select 1 from tbl_roles tr where tr.tname=d.tname and tr.role=r)
  union all
  -- public: role present with narrower privileges -> revoke only the missing ones (preserves order)
  select d.tname, 2,
         'REVOKE '||(select string_agg(p,', ') from unnest(array['INSERT','SELECT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
                     where position(p in tr.privs)=0)
         ||' ON TABLE '||d.tname||' FROM '||tr.role
  from tbl_dev d join tbl_roles tr on tr.tname=d.tname
  where d.sch='public' and tr.role in ('anon','authenticated','service_role')
    and tr.privs <> 'INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
  union all
  -- roles in target beyond the template (e.g. supabase_auth_admin) -> grant their exact privileges
  select d.tname, 3, 'GRANT '||replace(tr.privs,',',', ')||' ON TABLE '||d.tname||' TO '||tr.role
  from tbl_dev d join tbl_roles tr on tr.tname=d.tname
  where tr.role not in ('postgres','anon','authenticated','service_role') and tr.role <> 'PUBLIC'
  union all
  -- private tables with an explicit acl: materialize the owner entry a fresh replay leaves NULL
  select d.tname, 4, 'GRANT ALL ON TABLE '||d.tname||' TO postgres'
  from tbl_dev d where d.sch='private'
),
all_stmts as (
  select sig as obj, ord, stmt from fn_stmts
  union all
  select tname, ord, stmt from tbl_stmts
),
colacl_stmts as (
  -- Column-level ACLs (pg_attribute.attacl). A table-level REVOKE cascades to same-type column
  -- privileges, so these re-grants MUST run AFTER the table section above (they are emitted as a
  -- second DO block appended to the appendix). Privilege letters: r=SELECT a=INSERT w=UPDATE x=REFERENCES.
  select n.nspname||'.'||c.relname as obj, a.attname as col,
         'GRANT '||string_agg(distinct case ae.privilege_type when 'UPDATE' then 'UPDATE' when 'SELECT' then 'SELECT'
                                        when 'INSERT' then 'INSERT' when 'REFERENCES' then 'REFERENCES' end, ', ')
         ||'("'||a.attname||'") ON TABLE '||n.nspname||'.'||c.relname||' TO '||coalesce(nullif(ae.grantee::regrole::text,'-'),'PUBLIC') as stmt
  from pg_attribute a
  join pg_class c on c.oid=a.attrelid
  join pg_namespace n on n.oid=c.relnamespace,
  lateral aclexplode(a.attacl) ae
  where n.nspname in ('public','private') and a.attnum>0 and not a.attisdropped and a.attacl is not null
  group by n.nspname, c.relname, a.attname, ae.grantee
)
select E'-- ===== APPENDIX D: ACL sync (generated by scripts/generate_acl_sync.sql — DO NOT HAND-EDIT) =====\n'
    || E'DO $aclsync$\nBEGIN\n'
    || (select string_agg('  EXECUTE '''||replace(stmt,'''','''''')||''';', E'\n' order by obj, ord, stmt) from all_stmts)
    || E'\nEND\n$aclsync$;\n'
    || E'-- ===== APPENDIX D2: column-level ACL sync (generated; runs after the table section) =====\n'
    || E'DO $colaclsync$\nBEGIN\n'
    || (select string_agg('  EXECUTE '''||replace(stmt,'''','''''')||''';', E'\n' order by obj, col) from colacl_stmts)
    || E'\nEND\n$colaclsync$;' as appendix_d;
