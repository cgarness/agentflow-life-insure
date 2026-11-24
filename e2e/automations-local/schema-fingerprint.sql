-- Format 2. Run unchanged on the source and on every isolated copy, using PostgreSQL 17 and UTF-8.
-- Normalize ACL entry ordering, implicit owner defaults, and visible column/enum order. The database is named
-- "current database", so a copy under another name compares equal to its source.
-- The settings that change how catalog text prints are fixed below and recorded in the "session" family, so a
-- capture through a channel that ignored them fails instead of differing quietly. Through a connector that returns
-- only the last statement's result, send everything before the final COMMIT.
-- Only counts/digests leave the database. No application or scheduler rows, server files,
-- roles' password hashes, connection strings, foreign-server or user-mapping options, or individual DDL are returned.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='250ms'; SET LOCAL search_path=pg_catalog;
SET LOCAL TimeZone='UTC'; SET LOCAL DateStyle='ISO, MDY'; SET LOCAL IntervalStyle='postgres';
SET LOCAL standard_conforming_strings=on; SET LOCAL extra_float_digits=1;
WITH ns AS MATERIALIZED (SELECT * FROM pg_namespace WHERE nspname!~'^pg_' AND nspname<>'information_schema'),
catalog_ns AS MATERIALIZED (SELECT * FROM pg_namespace WHERE nspname='pg_catalog' OR nspname='information_schema'),
objects(kind,id,body) AS (SELECT 'session',o.id,o.body FROM (
  SELECT 'settings' AS id,concat_ws('|',current_setting('server_version_num'),current_setting('server_encoding'),
    current_setting('search_path'),current_setting('TimeZone'),current_setting('DateStyle'),current_setting('IntervalStyle'),
    current_setting('standard_conforming_strings'),current_setting('extra_float_digits')) AS body
) o
UNION ALL SELECT 'namespaces',o.id,o.body FROM (
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
  SELECT 'current database' id,concat_ws('|',pg_get_userbyid(datdba),encoding,datlocprovider,datcollate,datctype,datlocale,datcollversion,datconnlimit,datallowconn,ARRAY(SELECT acl::text FROM unnest(coalesce(datacl,acldefault('d',datdba))) acl ORDER BY acl::text COLLATE "C")::text,(SELECT description FROM pg_shdescription s WHERE s.classoid='pg_database'::regclass AND s.objoid=d.oid)) body FROM pg_database d WHERE datname=current_database()

) o
UNION ALL SELECT 'database_role_settings', o.id, o.body FROM (
  SELECT concat_ws('/', CASE WHEN r.setdatabase=0 THEN '*' ELSE 'current database' END, CASE WHEN r.setrole=0 THEN '*' ELSE pg_get_userbyid(r.setrole) END) id, ARRAY(SELECT c FROM unnest(r.setconfig) c ORDER BY c COLLATE "C")::text body FROM pg_db_role_setting r WHERE r.setdatabase=0 OR r.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())

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
) o
UNION ALL SELECT 'shared_comments', o.id, o.body FROM (
  SELECT concat_ws('/',i.type,i.identity) id,s.description body FROM pg_shdescription s CROSS JOIN LATERAL pg_identify_object(s.classoid,s.objoid,0) i WHERE s.classoid<>'pg_database'::regclass
) o
UNION ALL SELECT 'aggregates', o.id, o.body FROM (
  SELECT p.oid::regprocedure::text id,concat_ws('|',pg_get_userbyid(p.proowner),ARRAY(SELECT acl::text FROM unnest(coalesce(p.proacl,acldefault('f',p.proowner))) acl ORDER BY acl::text COLLATE "C")::text,a.aggkind,a.aggnumdirectargs,a.aggtransfn::regprocedure,a.aggfinalfn::regprocedure,a.aggcombinefn::regprocedure,a.aggserialfn::regprocedure,a.aggdeserialfn::regprocedure,a.aggmtransfn::regprocedure,a.aggminvtransfn::regprocedure,a.aggmfinalfn::regprocedure,a.aggfinalextra,a.aggmfinalextra,a.aggfinalmodify,a.aggmfinalmodify,a.aggsortop::regoperator,a.aggtranstype::regtype,a.aggtransspace,a.aggmtranstype::regtype,a.aggmtransspace,a.agginitval,a.aggminitval) body FROM pg_aggregate a JOIN pg_proc p ON p.oid=a.aggfnoid JOIN ns n ON n.oid=p.pronamespace
) o
UNION ALL SELECT 'collations', o.id, o.body FROM (
  SELECT quote_ident(n.nspname)||'.'||quote_ident(c.collname) id,concat_ws('|',pg_get_userbyid(c.collowner),c.collprovider,c.collisdeterministic,c.collencoding,c.collcollate,c.collctype,c.colllocale,c.collicurules,c.collversion) body FROM pg_collation c JOIN ns n ON n.oid=c.collnamespace
) o
UNION ALL SELECT 'text_search', o.id, o.body FROM (
  SELECT 'configuration/'||c.oid::regconfig::text id,concat_ws('|',pg_get_userbyid(c.cfgowner),p.oid::regclass::text,p.prsname,(SELECT string_agg(m.maptokentype||':'||m.mapseqno||':'||m.mapdict::regdictionary::text,',' ORDER BY m.maptokentype,m.mapseqno) FROM pg_ts_config_map m WHERE m.mapcfg=c.oid)) body FROM pg_ts_config c JOIN ns n ON n.oid=c.cfgnamespace JOIN pg_ts_parser p ON p.oid=c.cfgparser
  UNION ALL SELECT 'dictionary/'||d.oid::regdictionary::text,concat_ws('|',pg_get_userbyid(d.dictowner),t.tmplname,d.dictinitoption) FROM pg_ts_dict d JOIN ns n ON n.oid=d.dictnamespace JOIN pg_ts_template t ON t.oid=d.dicttemplate
  UNION ALL SELECT 'parser/'||quote_ident(n.nspname)||'.'||quote_ident(p.prsname),concat_ws('|',p.prsstart::regprocedure,p.prstoken::regprocedure,p.prsend::regprocedure,p.prsheadline::regprocedure,p.prslextype::regprocedure) FROM pg_ts_parser p JOIN ns n ON n.oid=p.prsnamespace
  UNION ALL SELECT 'template/'||quote_ident(n.nspname)||'.'||quote_ident(t.tmplname),concat_ws('|',t.tmplinit::regprocedure,t.tmpllexize::regprocedure) FROM pg_ts_template t JOIN ns n ON n.oid=t.tmplnamespace
) o
UNION ALL SELECT 'conversions', o.id, o.body FROM (
  SELECT quote_ident(n.nspname)||'.'||quote_ident(c.conname) id,concat_ws('|',pg_get_userbyid(c.conowner),c.conforencoding,c.contoencoding,c.conproc::regprocedure,c.condefault) body FROM pg_conversion c JOIN ns n ON n.oid=c.connamespace
) o
UNION ALL SELECT 'statistics', o.id, o.body FROM (
  SELECT quote_ident(n.nspname)||'.'||quote_ident(s.stxname) id,concat_ws('|',pg_get_userbyid(s.stxowner),s.stxstattarget,pg_get_statisticsobjdef(s.oid)) body FROM pg_statistic_ext s JOIN ns n ON n.oid=s.stxnamespace
) o
UNION ALL SELECT 'opfamilies', o.id, o.body FROM (
  SELECT concat_ws('/',m.amname,n.nspname,f.opfname) id,pg_get_userbyid(f.opfowner) body FROM pg_opfamily f JOIN ns n ON n.oid=f.opfnamespace JOIN pg_am m ON m.oid=f.opfmethod
  UNION ALL SELECT 'member/'||pg_describe_object('pg_amop'::regclass,a.oid,0),concat_ws('|',a.amoppurpose,a.amopmethod) FROM pg_amop a JOIN pg_opfamily f ON f.oid=a.amopfamily JOIN ns n ON n.oid=f.opfnamespace
  UNION ALL SELECT 'member/'||pg_describe_object('pg_amproc'::regclass,a.oid,0),'' FROM pg_amproc a JOIN pg_opfamily f ON f.oid=a.amprocfamily JOIN ns n ON n.oid=f.opfnamespace
) o
UNION ALL SELECT 'transforms', o.id, o.body FROM (
  SELECT concat_ws('/',t.trftype::regtype,l.lanname) id,concat_ws('|',t.trffromsql::regprocedure,t.trftosql::regprocedure) body FROM pg_transform t JOIN pg_language l ON l.oid=t.trflang
) o
UNION ALL SELECT 'access_methods', o.id, o.body FROM (
  SELECT amname id,concat_ws('|',amtype,amhandler::regproc) body FROM pg_am
) o
UNION ALL SELECT 'foreign', o.id, o.body FROM (
  SELECT 'wrapper/'||w.fdwname id,concat_ws('|',pg_get_userbyid(w.fdwowner),w.fdwhandler::regproc,w.fdwvalidator::regproc,ARRAY(SELECT acl::text FROM unnest(w.fdwacl) acl ORDER BY acl::text COLLATE "C")::text,ARRAY(SELECT split_part(x,'=',1) FROM unnest(w.fdwoptions) x ORDER BY 1)::text) body FROM pg_foreign_data_wrapper w
  UNION ALL SELECT 'server/'||s.srvname,concat_ws('|',pg_get_userbyid(s.srvowner),w.fdwname,s.srvtype,s.srvversion,ARRAY(SELECT acl::text FROM unnest(s.srvacl) acl ORDER BY acl::text COLLATE "C")::text,ARRAY(SELECT split_part(x,'=',1) FROM unnest(s.srvoptions) x ORDER BY 1)::text) FROM pg_foreign_server s JOIN pg_foreign_data_wrapper w ON w.oid=s.srvfdw
  UNION ALL SELECT 'user mapping/'||m.srvname||'/'||m.usename,'' FROM pg_user_mappings m
) o
UNION ALL SELECT 'subscriptions', o.id, o.body FROM (
  SELECT s.subname id,concat_ws('|',pg_get_userbyid(s.subowner),s.subenabled,s.subpublications::text) body FROM pg_subscription s WHERE s.subdbid=(SELECT oid FROM pg_database WHERE datname=current_database())
) o
UNION ALL SELECT 'security_labels', o.id, o.body FROM (
  SELECT concat_ws('/',l.provider,i.type,i.identity) id,l.label body FROM pg_seclabel l CROSS JOIN LATERAL pg_identify_object(l.classoid,l.objoid,l.objsubid) i
  UNION ALL SELECT concat_ws('/',l.provider,i.type,i.identity),l.label FROM pg_shseclabel l CROSS JOIN LATERAL pg_identify_object(l.classoid,l.objoid,0) i WHERE l.classoid<>'pg_database'::regclass
) o
UNION ALL SELECT 'parameter_acls', o.id, o.body FROM (
  SELECT parname id,ARRAY(SELECT acl::text FROM unnest(paracl) acl ORDER BY acl::text COLLATE "C")::text body FROM pg_parameter_acl
) o
UNION ALL SELECT 'catalog_permissions', o.id, o.body FROM (
  SELECT 'schema/'||n.nspname id,concat_ws('|',pg_get_userbyid(n.nspowner),ARRAY(SELECT acl::text FROM unnest(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl ORDER BY acl::text COLLATE "C")::text) body FROM catalog_ns n
  UNION ALL SELECT 'relation/'||c.oid::regclass::text,ARRAY(SELECT acl::text FROM unnest(c.relacl) acl ORDER BY acl::text COLLATE "C")::text FROM pg_class c JOIN catalog_ns n ON n.oid=c.relnamespace WHERE c.relacl IS NOT NULL
  UNION ALL SELECT 'column/'||c.oid::regclass::text||'/'||a.attname,ARRAY(SELECT acl::text FROM unnest(a.attacl) acl ORDER BY acl::text COLLATE "C")::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN catalog_ns n ON n.oid=c.relnamespace WHERE a.attacl IS NOT NULL
  UNION ALL SELECT 'function/'||p.oid::regprocedure::text,ARRAY(SELECT acl::text FROM unnest(p.proacl) acl ORDER BY acl::text COLLATE "C")::text FROM pg_proc p JOIN catalog_ns n ON n.oid=p.pronamespace WHERE p.proacl IS NOT NULL
  UNION ALL SELECT 'type/'||t.oid::regtype::text,ARRAY(SELECT acl::text FROM unnest(t.typacl) acl ORDER BY acl::text COLLATE "C")::text FROM pg_type t JOIN catalog_ns n ON n.oid=t.typnamespace WHERE t.typacl IS NOT NULL
  UNION ALL SELECT 'language/'||l.lanname,ARRAY(SELECT acl::text FROM unnest(l.lanacl) acl ORDER BY acl::text COLLATE "C")::text FROM pg_language l WHERE l.lanacl IS NOT NULL AND l.lanname IN ('internal','c','sql')
) o
UNION ALL SELECT 'sequence_ownership', o.id, o.body FROM (
  SELECT d.objid::regclass::text id,concat_ws('/',d.refobjid::regclass::text,a.attname,d.deptype) body FROM pg_depend d JOIN pg_class s ON d.classid='pg_class'::regclass AND s.oid=d.objid AND s.relkind='S' JOIN ns n ON n.oid=s.relnamespace JOIN pg_attribute a ON d.refclassid='pg_class'::regclass AND a.attrelid=d.refobjid AND a.attnum=d.refobjsubid WHERE d.deptype IN ('a','i')
) o
UNION ALL SELECT 'tablespaces', o.id, o.body FROM (
  SELECT spcname id,concat_ws('|',pg_get_userbyid(spcowner),ARRAY(SELECT acl::text FROM unnest(spcacl) acl ORDER BY acl::text COLLATE "C")::text,spcoptions::text) body FROM pg_tablespace
) o
UNION ALL SELECT 'large_objects', o.id, o.body FROM (
  SELECT pg_get_userbyid(m.lomowner)||'/'||coalesce(ARRAY(SELECT acl::text FROM unnest(m.lomacl) acl ORDER BY acl::text COLLATE "C")::text,'') id,count(*)::text body FROM pg_largeobject_metadata m GROUP BY 1
) o)
-- "loose" is the same digest with the parentheses left out of each definition. A dump and restore parses stored
-- expressions again, and PostgreSQL flattens nested AND and OR chains (a BETWEEN followed by AND, for example) when
-- it does, so a restored copy prints some definitions with fewer parentheses than the source that created them.
SELECT jsonb_build_object('format','agentflow-schema-fingerprint/2',
  'captured_at',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'families',coalesce(jsonb_agg(to_jsonb(section) ORDER BY kind),'[]'::jsonb)) AS schema_fingerprint FROM (
  SELECT kind,count(*) AS objects,
    encode(sha256(convert_to(string_agg(
      encode(sha256(convert_to(jsonb_build_array(id,body)::text,'UTF8')),'hex'),
      '' ORDER BY id COLLATE "C",body COLLATE "C"),'UTF8')),'hex') AS sha256,
    encode(sha256(convert_to(string_agg(
      encode(sha256(convert_to(jsonb_build_array(id,translate(body,'()',''))::text,'UTF8')),'hex'),
      '' ORDER BY id COLLATE "C",translate(body,'()','') COLLATE "C"),'UTF8')),'hex') AS loose
  FROM objects GROUP BY kind
) section;
COMMIT;
