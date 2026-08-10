-- Normalized catalog fingerprint. Deterministic ordered rows: kind|identity|detail
-- Run identically against production (read-only) and the disposable local replay.
-- Scope: public + private schemas, storage.objects policies, auth.users triggers,
-- realtime publication membership, storage bucket definitions, extensions.
with fp as (
  -- columns
  select 'column' as kind,
         n.nspname||'.'||c.relname||'.'||a.attname as identity,
         format_type(a.atttypid,a.atttypmod)
           ||'|nn:'||a.attnotnull::text
           ||'|def:'||coalesce(md5(pg_get_expr(d.adbin,d.adrelid)),'-') as detail
  from pg_attribute a
  join pg_class c on c.oid=a.attrelid
  join pg_namespace n on n.oid=c.relnamespace
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname in ('public','private') and c.relkind in ('r','p','v','m')
    and a.attnum>0 and not a.attisdropped
  union all
  -- table-level: rls flags
  select 'rls', n.nspname||'.'||c.relname,
         'enabled:'||c.relrowsecurity::text||'|forced:'||c.relforcerowsecurity::text
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind='r'
  union all
  -- constraints
  select 'constraint', n.nspname||'.'||c.relname||'.'||con.conname,
         md5(pg_get_constraintdef(con.oid))
  from pg_constraint con
  join pg_class c on c.oid=con.conrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private')
  union all
  -- indexes
  select 'index', schemaname||'.'||tablename||'.'||indexname,
         md5(replace(indexdef, 'USING btree', 'USING  btree'))
  from pg_indexes where schemaname in ('public','private')
  union all
  -- policies (public/private + storage.objects)
  select 'policy', n.nspname||'.'||c.relname||'.'||pol.polname,
         'cmd:'||pol.polcmd::text
         ||'|roles:'||coalesce((select string_agg(r::regrole::text,',' order by r::regrole::text) from unnest(pol.polroles) r),'-')
         ||'|using:'||coalesce(md5(pg_get_expr(pol.polqual,pol.polrelid)),'-')
         ||'|check:'||coalesce(md5(pg_get_expr(pol.polwithcheck,pol.polrelid)),'-')
  from pg_policy pol
  join pg_class c on c.oid=pol.polrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') or (n.nspname='storage' and c.relname='objects')
  union all
  -- triggers (public/private tables + auth.users)
  select 'trigger', n.nspname||'.'||c.relname||'.'||t.tgname,
         md5(pg_get_triggerdef(t.oid))
  from pg_trigger t
  join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal
    and (n.nspname in ('public','private') or (n.nspname='auth' and c.relname='users'))
  union all
  -- functions: identity+def(md5 covers body, security, search_path)+acl
  select 'function', n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
         md5(pg_get_functiondef(p.oid))||'|own:'||p.proowner::regrole::text||'|acl:'||coalesce(p.proacl::text,'-')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.prokind='f'
  union all
  -- views / matviews
  select 'view', n.nspname||'.'||c.relname, md5(pg_get_viewdef(c.oid))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind in ('v','m')
  union all
  -- table grants
  select 'grants', n.nspname||'.'||c.relname, coalesce(c.relacl::text,'-')
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind in ('r','v','m')
  union all
  -- publication membership
  select 'publication', p.pubname||'::'||n.nspname||'.'||c.relname, 'member'
  from pg_publication_rel pr
  join pg_publication p on p.oid=pr.prpubid
  join pg_class c on c.oid=pr.prrelid
  join pg_namespace n on n.oid=c.relnamespace
  union all
  -- extensions (name only; versions differ across platform images)
  select 'extension', extname, 'installed' from pg_extension
  union all
  -- storage buckets
  select 'bucket', id,
         'public:'||public::text
         ||'|limit:'||coalesce(file_size_limit::text,'-')
         ||'|mime:'||coalesce(array_to_string(allowed_mime_types,','),'-')
  from storage.buckets
  union all
  -- column-level ACLs (attacl) — invariant #20 column grants; missed pre-2026-08-09
  select 'colacl', n.nspname||'.'||c.relname||'.'||a.attname, a.attacl::text
  from pg_attribute a
  join pg_class c on c.oid=a.attrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and a.attnum>0 and not a.attisdropped and a.attacl is not null
  union all
  -- sequences: definition, ownership, ACL (none expected today; category guards regressions)
  select 'sequence', n.nspname||'.'||c.relname,
         'own:'||c.relowner::regrole::text
         ||'|start:'||sq.seqstart||'|min:'||sq.seqmin||'|max:'||sq.seqmax||'|incr:'||sq.seqincrement
         ||'|acl:'||coalesce(c.relacl::text,'-')
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  join pg_sequence sq on sq.seqrelid=c.oid
  where n.nspname in ('public','private') and c.relkind='S'
  union all
  -- default privileges (platform+project); role|schema|objtype -> acl
  select 'defacl',
         d.defaclrole::regrole::text||'|'||coalesce(d.defaclnamespace::regnamespace::text,'GLOBAL')||'|'||d.defaclobjtype::text,
         d.defaclacl::text
  from pg_default_acl d
  union all
  -- replica identity per table
  select 'replident', n.nspname||'.'||c.relname, c.relreplident::text
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind='r'
  union all
  -- user-defined types (enums incl. labels, domains, composites) NOT owned by an extension
  select 'type', tn.nspname||'.'||t.typname,
         t.typtype::text||'|'||
         case t.typtype
           when 'e' then md5((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid))
           when 'd' then md5(format_type(t.typbasetype,t.typtypmod)||'|'||coalesce((select string_agg(pg_get_constraintdef(cc.oid),';' order by cc.conname) from pg_constraint cc where cc.contypid=t.oid),'-'))
           else md5(coalesce((select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod), ',' order by a.attnum) from pg_attribute a where a.attrelid=t.typrelid and a.attnum>0),'-'))
         end
  from pg_type t
  join pg_namespace tn on tn.oid=t.typnamespace
  where tn.nspname in ('public','private') and t.typtype in ('e','d','c')
    and not exists (select 1 from pg_depend dep where dep.objid=t.oid and dep.deptype='e')
    and not exists (select 1 from pg_class rc where rc.oid=t.typrelid and rc.relkind in ('r','v','m','S','p'))
  union all
  -- comments on public/private tables & columns & functions
  select 'comment', sub.identity, md5(sub.cmt) from (
    select n.nspname||'.'||c.relname as identity, obj_description(c.oid) as cmt
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind='r'
  ) sub where sub.cmt is not null
)
select kind||'|'||identity||'|'||detail as line
from fp
order by 1;
