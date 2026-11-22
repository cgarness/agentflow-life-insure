-- Run unchanged on the source and isolated restore using PostgreSQL 17 and UTF-8.
-- Normalize ACL entry ordering, implicit owner defaults, and visible column/enum order.
-- Only counts/digests leave the database. No application or scheduler rows, server files,
-- roles' password hashes, connection strings, foreign-server options, or individual DDL are returned.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='250ms'; SET LOCAL search_path=pg_catalog;
WITH ns AS MATERIALIZED (SELECT * FROM pg_namespace WHERE nspname!~'^pg_' AND nspname<>'information_schema'),
objects(kind,id,body) AS (SELECT 'namespaces',o.id,o.body FROM (
  SELECT n.nspname::text AS id,concat_ws('|',pg_get_userbyid(n.nspowner),ARRAY(SELECT acl::text FROM unnest(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl ORDER BY acl::text COLLATE "C")::text) AS body FROM ns n
) o
UNION ALL SELECT 'roles',o.id,o.body FROM (
  SELECT rolname AS id,concat_ws('|',rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolconnlimit,rolbypassrls,rolvaliduntil,rolconfig::text) body FROM pg_roles
) o
UNION ALL SELECT 'memberships',o.id,o.body FROM (
  SELECT concat_ws('/',pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor)) id,concat_ws('|',admin_option,inherit_option,set_option) body FROM pg_auth_members
) o
UNION ALL SELECT 'extensions',o.id,o.body FROM (
  SELECT e.extname id, concat_ws('|',e.extversion,n.nspname,pg_get_userbyid(e.extowner),e.extrelocatable) body FROM pg_extension e JOIN pg_namespace n ON e.extnamespace=n.oid
) o
UNION ALL SELECT 'extension_members',o.id,o.body FROM (
  SELECT e.extname||'/'||pg_describe_object(d.classid,d.objid,d.objsubid) id,'' body FROM pg_depend d JOIN pg_extension e ON d.refclassid='pg_extension'::regclass AND d.refobjid=e.oid WHERE d.deptype='e'
) o
UNION ALL SELECT 'default_privileges',o.id,o.body FROM (
  SELECT concat_ws('/',pg_get_userbyid(a.defaclrole),n.nspname,a.defaclobjtype) id,ARRAY(SELECT acl::text FROM unnest(a.defaclacl) acl ORDER BY acl::text COLLATE "C")::text body FROM pg_default_acl a LEFT JOIN pg_namespace n ON n.oid=a.defaclnamespace
) o
UNION ALL SELECT 'relations',o.id,o.body FROM (
  SELECT quote_ident(n.nspname)||'.'||quote_ident(c.relname) id,concat_ws('|',c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.relreplident,pg_get_userbyid(c.relowner),ARRAY(SELECT acl::text FROM unnest(coalesce(c.relacl,case when c.relkind='S' then acldefault('s',c.relowner) when c.relkind in ('p','r','f','v','m') then acldefault('r',c.relowner) end)) acl ORDER BY acl::text COLLATE "C")::text,c.reloptions::text,am.amname,c.relispartition,pg_get_expr(c.relpartbound,c.oid,true)) body FROM pg_class c JOIN ns n ON n.oid=c.relnamespace LEFT JOIN pg_am am ON am.oid=c.relam
) o
UNION ALL SELECT 'columns',o.id,o.body FROM (
  SELECT concat_ws('/',n.nspname,c.relname,row_number() over (partition by c.oid order by a.attnum),a.attname) id,concat_ws('|',format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,ARRAY(SELECT acl::text FROM unnest(a.attacl) acl ORDER BY acl::text COLLATE "C")::text,a.attcompression,a.attstorage,CASE WHEN a.attcollation<>0 THEN a.attcollation::regcollation::text END,pg_get_expr(d.adbin,d.adrelid)) body FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN ns n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('p','r','f','v','m','c')
) o
UNION ALL SELECT 'functions',o.id,o.body FROM (
  SELECT p.oid::regprocedure::text id,concat_ws('|',pg_get_userbyid(p.proowner),ARRAY(SELECT acl::text FROM unnest(coalesce(p.proacl,acldefault('f',p.proowner))) acl ORDER BY acl::text COLLATE "C")::text,pg_get_functiondef(p.oid)) body FROM pg_proc p JOIN ns n ON n.oid=p.pronamespace WHERE p.prokind IN ('w','p','f')
) o
UNION ALL SELECT 'types',o.id,o.body FROM (
  SELECT t.oid::regtype::text id,concat_ws('|',t.typtype,t.typcategory,t.typnotnull,t.typdefault,ARRAY(SELECT acl::text FROM unnest(coalesce(t.typacl,acldefault('T',t.typowner))) acl ORDER BY acl::text COLLATE "C")::text,pg_get_userbyid(t.typowner),format_type(t.typbasetype,t.typtypmod),t.typinput::regproc::text,t.typoutput::regproc::text) body FROM pg_type t JOIN ns n ON n.oid=t.typnamespace
) o
UNION ALL SELECT 'enums',o.id,o.body FROM (
  SELECT e.enumtypid::regtype::text||'/'||e.enumlabel id,row_number() over (partition by e.enumtypid order by e.enumsortorder)::text body FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN ns n ON n.oid=t.typnamespace
) o
UNION ALL SELECT 'constraints',o.id,o.body FROM (
  SELECT concat_ws('/',n.nspname,c.conrelid::regclass::text,c.conname) id,concat_ws('|',c.contype,c.convalidated,pg_get_constraintdef(c.oid)) body FROM pg_constraint c JOIN ns n ON n.oid=c.connamespace
) o
UNION ALL SELECT 'indexes',o.id,o.body FROM (
  SELECT i.indexrelid::regclass::text id,concat_ws('|',i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid)) body FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN ns n ON n.oid=c.relnamespace
) o
UNION ALL SELECT 'views',o.id,o.body FROM (
  SELECT c.oid::regclass::text id,pg_get_viewdef(c.oid) body FROM pg_class c JOIN ns n ON n.oid=c.relnamespace WHERE c.relkind IN ('v','m')
) o
UNION ALL SELECT 'triggers',o.id,o.body FROM (
  SELECT concat_ws('/',t.tgrelid::regclass,t.tgname) id,concat_ws('|',t.tgenabled,pg_get_triggerdef(t.oid)) body FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid JOIN ns n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal
) o
UNION ALL SELECT 'policies',o.id,o.body FROM (
  SELECT concat_ws('/',p.polrelid::regclass,p.polname) id,concat_ws('|',p.polcmd,p.polpermissive,(SELECT string_agg(v.name,',' ORDER BY v.name COLLATE "C") FROM unnest(p.polroles) r CROSS JOIN LATERAL (VALUES (CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r)::text END)) v(name)),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) body FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN ns n ON n.oid=c.relnamespace
) o
UNION ALL SELECT 'events',o.id,o.body FROM (
  SELECT evtname id,concat_ws('|',evtevent,evtfoid::regprocedure::text,evtenabled,evttags::text,pg_get_userbyid(evtowner)) body FROM pg_event_trigger
) o
UNION ALL SELECT 'publication_tables',o.id,o.body FROM (
  SELECT concat_ws('/',pubname,schemaname,tablename) id,concat_ws('|',attnames::text,rowfilter) body FROM pg_publication_tables
) o
UNION ALL SELECT 'database', o.id, o.body FROM (
  SELECT datname id,concat_ws('|',pg_get_userbyid(datdba),encoding,datlocprovider,datcollate,datctype,datlocale,datcollversion,ARRAY(SELECT acl::text FROM unnest(coalesce(datacl,acldefault('d',datdba))) acl ORDER BY acl::text COLLATE "C")::text) body FROM pg_database WHERE datname=current_database()

) o
UNION ALL SELECT 'database_role_settings', o.id, o.body FROM (
  SELECT concat_ws('/', CASE WHEN r.setdatabase=0 THEN '*' ELSE current_database() END, CASE WHEN r.setrole=0 THEN '*' ELSE pg_get_userbyid(r.setrole) END) id, r.setconfig::text body FROM pg_db_role_setting r WHERE r.setdatabase=0 OR r.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())

) o
UNION ALL SELECT 'sequences', o.id, o.body FROM (
  SELECT s.seqrelid::regclass::text id,concat_ws('|',s.seqtypid::regtype,s.seqstart,s.seqincrement,s.seqmax,s.seqmin,s.seqcache,s.seqcycle) body FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN ns n ON n.oid=c.relnamespace

) o
UNION ALL SELECT 'rules', o.id, o.body FROM (
  SELECT concat_ws('/',r.ev_class::regclass,r.rulename) id,concat_ws('|',r.ev_enabled,pg_get_ruledef(r.oid)) body FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class JOIN ns n ON n.oid=c.relnamespace

) o
UNION ALL SELECT 'inheritance', o.id, o.body FROM (
  SELECT concat_ws('/',i.inhrelid::regclass,i.inhparent::regclass) id,concat_ws('|',i.inhseqno,i.inhdetachpending) body FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid JOIN ns n ON n.oid=c.relnamespace

) o
UNION ALL SELECT 'publications', o.id, o.body FROM (
  SELECT pubname id,concat_ws('|',pg_get_userbyid(pubowner),puballtables,pubinsert,pubupdate,pubdelete,pubtruncate,pubviaroot) body FROM pg_publication

) o
UNION ALL SELECT 'languages', o.id, o.body FROM (
  SELECT lanname id, concat_ws('|',pg_get_userbyid(lanowner),lanispl,lanpltrusted,lanplcallfoid::regprocedure,lanvalidator::regprocedure,laninline::regprocedure,ARRAY(SELECT acl::text FROM unnest(coalesce(lanacl,acldefault('l',lanowner))) acl ORDER BY acl::text COLLATE "C")::text) body FROM pg_language

) o
UNION ALL SELECT 'casts', o.id, o.body FROM (
  SELECT concat_ws('/',c.castsource::regtype,c.casttarget::regtype) id,concat_ws('|',c.castfunc::regprocedure,c.castcontext,c.castmethod) body FROM pg_cast c JOIN pg_type s ON s.oid=c.castsource JOIN pg_type t ON t.oid=c.casttarget WHERE s.typnamespace IN (SELECT oid FROM ns) OR t.typnamespace IN (SELECT oid FROM ns)

) o
UNION ALL SELECT 'operators', o.id, o.body FROM (
  SELECT o.oid::regoperator::text id,concat_ws('|',pg_get_userbyid(o.oprowner),o.oprcanmerge,o.oprcanhash,o.oprresult::regtype,o.oprcode::regprocedure,o.oprrest::regprocedure,o.oprjoin::regprocedure) body FROM pg_operator o JOIN ns n ON n.oid=o.oprnamespace

) o
UNION ALL SELECT 'opclasses', o.id, o.body FROM (
  SELECT concat_ws('/',m.amname,n.nspname,c.opcname) id,concat_ws('|',pg_get_userbyid(c.opcowner),c.opcintype::regtype,c.opcdefault,c.opckeytype::regtype,f.opfname) body FROM pg_opclass c JOIN ns n ON n.oid=c.opcnamespace JOIN pg_am m ON m.oid=c.opcmethod JOIN pg_opfamily f ON f.oid=c.opcfamily

) o
UNION ALL SELECT 'acls', o.id, o.body FROM (
  SELECT concat_ws('/',i.type,i.identity,a.privtype) id, ARRAY(SELECT acl::text FROM unnest(a.initprivs) acl ORDER BY acl::text COLLATE "C")::text body FROM pg_init_privs a CROSS JOIN LATERAL pg_identify_object(a.classoid,a.objoid,a.objsubid) i WHERE i.schema IS NULL OR i.schema IN (SELECT nspname FROM ns)

) o
UNION ALL SELECT 'comments', o.id, o.body FROM (
  SELECT concat_ws('/',i.type,i.identity) id,d.description AS body FROM pg_description d CROSS JOIN LATERAL pg_identify_object(d.classoid,d.objoid,d.objsubid) i WHERE i.schema IN (SELECT nspname FROM ns) OR (i.type='schema' AND i.name IN (SELECT nspname FROM ns))
) o)
SELECT coalesce(jsonb_agg(to_jsonb(section) ORDER BY kind),'[]'::jsonb) AS schema_fingerprint FROM (
  SELECT kind,count(*) AS objects,
    encode(sha256(convert_to(string_agg(
      encode(sha256(convert_to(jsonb_build_array(id,body)::text,'UTF8')),'hex'),
      '' ORDER BY id COLLATE "C",body COLLATE "C"),'UTF8')),'hex') AS sha256
  FROM objects GROUP BY kind
) section;
COMMIT;
