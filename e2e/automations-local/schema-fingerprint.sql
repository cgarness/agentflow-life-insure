-- Format 3. Run unchanged on the source and on every isolated copy, using PostgreSQL 17 and UTF-8. Each definition is
-- recorded field by field in order (a JSON array), so a missing field never lets the next one take its place: a
-- policy's USING and WITH CHECK, for example, stay apart.
-- Normalize ACL entry ordering, implicit owner defaults, and visible column/enum order. The database is named
-- "current database", so a copy under another name compares equal to its source.
-- The settings that change how catalog text prints are fixed below and recorded in the "session" family, so a
-- capture through a channel that ignored them fails instead of differing quietly. Through a connector that returns
-- only the last statement's result, send everything before the final COMMIT. The reading also names the connection
-- that took it (its application name and session user, outside the families), so a receipt read through another
-- channel can be told apart from the bundle's own readings.
-- Only counts/digests leave the database. No application or scheduler rows, server files,
-- roles' password hashes, connection strings, foreign-server or user-mapping options, or individual DDL are returned.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='250ms'; SET LOCAL search_path=pg_catalog;
SET LOCAL TimeZone='UTC'; SET LOCAL DateStyle='ISO, MDY'; SET LOCAL IntervalStyle='postgres';
SET LOCAL standard_conforming_strings=on; SET LOCAL extra_float_digits=1; SET LOCAL bytea_output='hex';
WITH ns AS MATERIALIZED (SELECT * FROM pg_namespace WHERE nspname!~'^pg_' AND nspname<>'information_schema'),
catalog_ns AS MATERIALIZED (SELECT * FROM pg_namespace WHERE nspname='pg_catalog' OR nspname='information_schema'),
created_ns AS MATERIALIZED (SELECT * FROM pg_namespace WHERE nspname IN ('pg_catalog','information_schema','pg_toast')),
objects(kind,id,body,pretty) AS (SELECT 'session',o.id,o.body,o.body FROM (
  SELECT 'settings' AS id,jsonb_build_array(current_setting('server_version_num'),current_setting('server_encoding'),
    current_setting('search_path'),current_setting('TimeZone'),current_setting('DateStyle'),current_setting('IntervalStyle'),
    current_setting('standard_conforming_strings'),current_setting('extra_float_digits'),current_setting('bytea_output'))::text AS body
) o
UNION ALL SELECT 'namespaces',o.id,o.body,o.body FROM (
  SELECT n.nspname::text AS id,jsonb_build_array(pg_get_userbyid(n.nspowner),ARRAY(SELECT acl::text FROM unnest(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl ORDER BY acl::text COLLATE "C")::text)::text AS body FROM ns n
) o
UNION ALL SELECT 'roles',o.id,o.body,o.body FROM (
  SELECT rolname AS id,jsonb_build_array(rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolconnlimit,rolbypassrls,rolvaliduntil,rolconfig::text)::text body FROM pg_roles
) o
UNION ALL SELECT 'memberships',o.id,o.body,o.body FROM (
  SELECT concat_ws('/',pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor)) id,jsonb_build_array(admin_option,inherit_option,set_option)::text body FROM pg_auth_members
) o
UNION ALL SELECT 'extensions',o.id,o.body,o.body FROM (
  SELECT e.extname id, jsonb_build_array(e.extversion,n.nspname,pg_get_userbyid(e.extowner),e.extrelocatable)::text body FROM pg_extension e JOIN pg_namespace n ON e.extnamespace=n.oid
) o
UNION ALL SELECT 'extension_members',o.id,o.body,o.body FROM (
  SELECT e.extname||'/'||pg_describe_object(d.classid,d.objid,d.objsubid) id,'' body FROM pg_depend d JOIN pg_extension e ON d.refclassid='pg_extension'::regclass AND d.refobjid=e.oid WHERE d.deptype='e'
) o
UNION ALL SELECT 'default_privileges',o.id,o.body,o.body FROM (
  SELECT concat_ws('/',pg_get_userbyid(a.defaclrole),n.nspname,a.defaclobjtype) id,ARRAY(SELECT acl::text FROM unnest(a.defaclacl) acl ORDER BY acl::text COLLATE "C")::text body FROM pg_default_acl a LEFT JOIN pg_namespace n ON n.oid=a.defaclnamespace
) o
UNION ALL SELECT 'relations',o.id,o.body,o.body FROM (
  SELECT quote_ident(n.nspname)||'.'||quote_ident(c.relname) id,(jsonb_build_array(c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.relreplident,pg_get_userbyid(c.relowner),ARRAY(SELECT acl::text FROM unnest(coalesce(c.relacl,case when c.relkind='S' then acldefault('s',c.relowner) when c.relkind in ('p','r','f','v','m') then acldefault('r',c.relowner) end)) acl ORDER BY acl::text COLLATE "C")::text,c.reloptions::text,am.amname,c.relispartition,pg_get_expr(c.relpartbound,c.oid,true),CASE WHEN c.relkind='p' THEN pg_get_partkeydef(c.oid) END)||CASE WHEN tr.reloptions IS NOT NULL THEN jsonb_build_array(jsonb_build_object('toast',tr.reloptions::text)) ELSE '[]'::jsonb END)::text body FROM pg_class c JOIN ns n ON n.oid=c.relnamespace LEFT JOIN pg_am am ON am.oid=c.relam LEFT JOIN pg_class tr ON tr.oid=c.reltoastrelid
) o
UNION ALL SELECT 'columns',o.id,o.body,o.pretty FROM (
  SELECT concat_ws('/',n.nspname,c.relname,row_number() over (partition by c.oid order by a.attnum),a.attname) id,jsonb_build_array(format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,ARRAY(SELECT acl::text FROM unnest(a.attacl) acl ORDER BY acl::text COLLATE "C")::text,a.attcompression,a.attstorage,CASE WHEN a.attcollation<>0 THEN a.attcollation::regcollation::text END,pg_get_expr(d.adbin,d.adrelid))::text body,jsonb_build_array(format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,ARRAY(SELECT acl::text FROM unnest(a.attacl) acl ORDER BY acl::text COLLATE "C")::text,a.attcompression,a.attstorage,CASE WHEN a.attcollation<>0 THEN a.attcollation::regcollation::text END,pg_get_expr(d.adbin,d.adrelid,true))::text pretty FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN ns n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('p','r','f','v','m','c')
) o
UNION ALL SELECT 'functions',o.id,o.body,o.body FROM (
  SELECT p.oid::regprocedure::text id,jsonb_build_array(pg_get_userbyid(p.proowner),ARRAY(SELECT acl::text FROM unnest(coalesce(p.proacl,acldefault('f',p.proowner))) acl ORDER BY acl::text COLLATE "C")::text,pg_get_functiondef(p.oid))::text body FROM pg_proc p JOIN ns n ON n.oid=p.pronamespace WHERE p.prokind IN ('w','p','f')
) o
UNION ALL SELECT 'types',o.id,o.body,o.body FROM (
  SELECT t.oid::regtype::text id,jsonb_build_array(t.typtype,t.typcategory,t.typnotnull,t.typdefault,ARRAY(SELECT acl::text FROM unnest(coalesce(t.typacl,acldefault('T',t.typowner))) acl ORDER BY acl::text COLLATE "C")::text,pg_get_userbyid(t.typowner),format_type(t.typbasetype,t.typtypmod),t.typinput::regproc::text,t.typoutput::regproc::text)::text body FROM pg_type t JOIN ns n ON n.oid=t.typnamespace
) o
UNION ALL SELECT 'enums',o.id,o.body,o.body FROM (
  SELECT e.enumtypid::regtype::text||'/'||e.enumlabel id,row_number() over (partition by e.enumtypid order by e.enumsortorder)::text body FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN ns n ON n.oid=t.typnamespace
) o
UNION ALL SELECT 'constraints',o.id,o.body,o.pretty FROM (
  SELECT concat_ws('/',n.nspname,CASE WHEN c.contypid<>0 THEN 'domain '||c.contypid::regtype::text ELSE c.conrelid::regclass::text END,c.conname) id,jsonb_build_array(c.contype,c.convalidated,pg_get_constraintdef(c.oid))::text body,jsonb_build_array(c.contype,c.convalidated,pg_get_constraintdef(c.oid,true))::text pretty FROM pg_constraint c JOIN ns n ON n.oid=c.connamespace
) o
UNION ALL SELECT 'indexes',o.id,o.body,o.pretty FROM (
  SELECT i.indexrelid::regclass::text id,jsonb_build_array(i.indisvalid,i.indisready,i.indisreplident,i.indisclustered,pg_get_indexdef(i.indexrelid))::text body,jsonb_build_array(i.indisvalid,i.indisready,i.indisreplident,i.indisclustered,pg_get_indexdef(i.indexrelid,0,true))::text pretty FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN ns n ON n.oid=c.relnamespace
) o
UNION ALL SELECT 'views',o.id,o.body,o.pretty FROM (
  SELECT c.oid::regclass::text id,pg_get_viewdef(c.oid) body,pg_get_viewdef(c.oid,true) pretty FROM pg_class c JOIN ns n ON n.oid=c.relnamespace WHERE c.relkind IN ('v','m')
) o
UNION ALL SELECT 'triggers',o.id,o.body,o.pretty FROM (
  SELECT concat_ws('/',t.tgrelid::regclass,t.tgname) id,jsonb_build_array(t.tgenabled,pg_get_triggerdef(t.oid))::text body,jsonb_build_array(t.tgenabled,pg_get_triggerdef(t.oid,true))::text pretty FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid JOIN ns n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal
  UNION ALL SELECT concat_ws('/',t.tgrelid::regclass,'constraint',k.conname,t.tgfoid::regproc::text,t.tgtype::text),jsonb_build_array(t.tgenabled)::text,jsonb_build_array(t.tgenabled)::text FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid JOIN ns n ON n.oid=c.relnamespace LEFT JOIN pg_constraint k ON k.oid=t.tgconstraint WHERE t.tgisinternal AND t.tgenabled<>'O'
) o
UNION ALL SELECT 'policies',o.id,o.body,o.pretty FROM (
  SELECT concat_ws('/',p.polrelid::regclass,p.polname) id,jsonb_build_array(p.polcmd,p.polpermissive,(SELECT string_agg(v.name,',' ORDER BY v.name COLLATE "C") FROM unnest(p.polroles) r CROSS JOIN LATERAL (VALUES (CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r)::text END)) v(name)),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))::text body,jsonb_build_array(p.polcmd,p.polpermissive,(SELECT string_agg(v.name,',' ORDER BY v.name COLLATE "C") FROM unnest(p.polroles) r CROSS JOIN LATERAL (VALUES (CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r)::text END)) v(name)),pg_get_expr(p.polqual,p.polrelid,true),pg_get_expr(p.polwithcheck,p.polrelid,true))::text pretty FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN ns n ON n.oid=c.relnamespace
) o
UNION ALL SELECT 'events',o.id,o.body,o.body FROM (
  SELECT evtname id,jsonb_build_array(evtevent,evtfoid::regprocedure::text,evtenabled,evttags::text,pg_get_userbyid(evtowner))::text body FROM pg_event_trigger
) o
UNION ALL SELECT 'publication_tables',o.id,o.body,o.body FROM (
  SELECT concat_ws('/',pubname,schemaname,tablename) id,jsonb_build_array(attnames::text,rowfilter)::text body FROM pg_publication_tables
) o
UNION ALL SELECT 'database', o.id, o.body,o.body FROM (
  SELECT 'current database' id,jsonb_build_array(pg_get_userbyid(datdba),encoding,datlocprovider,datcollate,datctype,datlocale,datcollversion,datconnlimit,datallowconn,ARRAY(SELECT acl::text FROM unnest(coalesce(datacl,acldefault('d',datdba))) acl ORDER BY acl::text COLLATE "C")::text,(SELECT description FROM pg_shdescription s WHERE s.classoid='pg_database'::regclass AND s.objoid=d.oid))::text body FROM pg_database d WHERE datname=current_database()

) o
UNION ALL SELECT 'database_role_settings', o.id, o.body,o.body FROM (
  SELECT concat_ws('/', CASE WHEN r.setdatabase=0 THEN '*' ELSE 'current database' END, CASE WHEN r.setrole=0 THEN '*' ELSE pg_get_userbyid(r.setrole) END) id, ARRAY(SELECT c FROM unnest(r.setconfig) c ORDER BY c COLLATE "C")::text body FROM pg_db_role_setting r WHERE r.setdatabase=0 OR r.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())

) o
UNION ALL SELECT 'sequences', o.id, o.body,o.body FROM (
  SELECT s.seqrelid::regclass::text id,jsonb_build_array(s.seqtypid::regtype,s.seqstart,s.seqincrement,s.seqmax,s.seqmin,s.seqcache,s.seqcycle)::text body FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN ns n ON n.oid=c.relnamespace

) o
UNION ALL SELECT 'rules', o.id, o.body,o.pretty FROM (
  SELECT concat_ws('/',r.ev_class::regclass,r.rulename) id,jsonb_build_array(r.ev_enabled,pg_get_ruledef(r.oid))::text body,jsonb_build_array(r.ev_enabled,pg_get_ruledef(r.oid,true))::text pretty FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class JOIN ns n ON n.oid=c.relnamespace

) o
UNION ALL SELECT 'inheritance', o.id, o.body,o.body FROM (
  SELECT concat_ws('/',i.inhrelid::regclass,i.inhparent::regclass) id,jsonb_build_array(i.inhseqno,i.inhdetachpending)::text body FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid JOIN ns n ON n.oid=c.relnamespace

) o
UNION ALL SELECT 'publications', o.id, o.body,o.body FROM (
  SELECT pubname id,jsonb_build_array(pg_get_userbyid(pubowner),puballtables,pubinsert,pubupdate,pubdelete,pubtruncate,pubviaroot)::text body FROM pg_publication

) o
UNION ALL SELECT 'languages', o.id, o.body,o.body FROM (
  SELECT lanname id, jsonb_build_array(pg_get_userbyid(lanowner),lanispl,lanpltrusted,lanplcallfoid::regprocedure,lanvalidator::regprocedure,laninline::regprocedure,ARRAY(SELECT acl::text FROM unnest(coalesce(lanacl,acldefault('l',lanowner))) acl ORDER BY acl::text COLLATE "C")::text)::text body FROM pg_language

) o
UNION ALL SELECT 'casts', o.id, o.body,o.body FROM (
  SELECT concat_ws('/',c.castsource::regtype,c.casttarget::regtype) id,jsonb_build_array(c.castfunc::regprocedure,c.castcontext,c.castmethod)::text body FROM pg_cast c JOIN pg_type s ON s.oid=c.castsource JOIN pg_type t ON t.oid=c.casttarget WHERE s.typnamespace IN (SELECT oid FROM ns) OR t.typnamespace IN (SELECT oid FROM ns) OR c.oid>=16384

) o
UNION ALL SELECT 'operators', o.id, o.body,o.body FROM (
  SELECT o.oid::regoperator::text id,jsonb_build_array(pg_get_userbyid(o.oprowner),o.oprcanmerge,o.oprcanhash,o.oprresult::regtype,o.oprcode::regprocedure,o.oprrest::regprocedure,o.oprjoin::regprocedure)::text body FROM pg_operator o JOIN ns n ON n.oid=o.oprnamespace

) o
UNION ALL SELECT 'opclasses', o.id, o.body,o.body FROM (
  SELECT concat_ws('/',m.amname,n.nspname,c.opcname) id,jsonb_build_array(pg_get_userbyid(c.opcowner),c.opcintype::regtype,c.opcdefault,c.opckeytype::regtype,f.opfname)::text body FROM pg_opclass c JOIN ns n ON n.oid=c.opcnamespace JOIN pg_am m ON m.oid=c.opcmethod JOIN pg_opfamily f ON f.oid=c.opcfamily

) o
UNION ALL SELECT 'acls', o.id, o.body,o.body FROM (
  SELECT concat_ws('/',i.type,i.identity,a.privtype) id, ARRAY(SELECT acl::text FROM unnest(a.initprivs) acl ORDER BY acl::text COLLATE "C")::text body FROM pg_init_privs a CROSS JOIN LATERAL pg_identify_object(a.classoid,a.objoid,a.objsubid) i WHERE i.schema IS NULL OR i.schema IN (SELECT nspname FROM ns)

) o
UNION ALL SELECT 'comments', o.id, o.body,o.body FROM (
  SELECT concat_ws('/',i.type,i.identity) id,d.description AS body FROM pg_description d CROSS JOIN LATERAL pg_identify_object(d.classoid,d.objoid,d.objsubid) i WHERE i.schema IN (SELECT nspname FROM ns) OR (i.type='schema' AND i.name IN (SELECT nspname FROM ns))
) o
UNION ALL SELECT 'shared_comments', o.id, o.body,o.body FROM (
  SELECT concat_ws('/',i.type,i.identity) id,s.description body FROM pg_shdescription s CROSS JOIN LATERAL pg_identify_object(s.classoid,s.objoid,0) i WHERE s.classoid<>'pg_database'::regclass
) o
UNION ALL SELECT 'aggregates', o.id, o.body,o.body FROM (
  SELECT p.oid::regprocedure::text id,jsonb_build_array(pg_get_userbyid(p.proowner),ARRAY(SELECT acl::text FROM unnest(coalesce(p.proacl,acldefault('f',p.proowner))) acl ORDER BY acl::text COLLATE "C")::text,a.aggkind,a.aggnumdirectargs,a.aggtransfn::regprocedure,a.aggfinalfn::regprocedure,a.aggcombinefn::regprocedure,a.aggserialfn::regprocedure,a.aggdeserialfn::regprocedure,a.aggmtransfn::regprocedure,a.aggminvtransfn::regprocedure,a.aggmfinalfn::regprocedure,a.aggfinalextra,a.aggmfinalextra,a.aggfinalmodify,a.aggmfinalmodify,a.aggsortop::regoperator,a.aggtranstype::regtype,a.aggtransspace,a.aggmtranstype::regtype,a.aggmtransspace,a.agginitval,a.aggminitval,p.proparallel,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),p.provolatile,p.proisstrict,p.prosecdef,p.proleakproof,p.procost,p.prorows,p.prosupport::regproc::text,p.proconfig::text)::text body FROM pg_aggregate a JOIN pg_proc p ON p.oid=a.aggfnoid JOIN ns n ON n.oid=p.pronamespace
) o
UNION ALL SELECT 'collations', o.id, o.body,o.body FROM (
  SELECT quote_ident(n.nspname)||'.'||quote_ident(c.collname) id,jsonb_build_array(pg_get_userbyid(c.collowner),c.collprovider,c.collisdeterministic,c.collencoding,c.collcollate,c.collctype,c.colllocale,c.collicurules,c.collversion)::text body FROM pg_collation c JOIN ns n ON n.oid=c.collnamespace
) o
UNION ALL SELECT 'text_search', o.id, o.body,o.body FROM (
  SELECT 'configuration/'||c.oid::regconfig::text id,jsonb_build_array(pg_get_userbyid(c.cfgowner),p.oid::regclass::text,p.prsname,(SELECT string_agg(m.maptokentype||':'||m.mapseqno||':'||m.mapdict::regdictionary::text,',' ORDER BY m.maptokentype,m.mapseqno) FROM pg_ts_config_map m WHERE m.mapcfg=c.oid))::text body FROM pg_ts_config c JOIN ns n ON n.oid=c.cfgnamespace JOIN pg_ts_parser p ON p.oid=c.cfgparser
  UNION ALL SELECT 'dictionary/'||d.oid::regdictionary::text,jsonb_build_array(pg_get_userbyid(d.dictowner),t.tmplname,d.dictinitoption)::text FROM pg_ts_dict d JOIN ns n ON n.oid=d.dictnamespace JOIN pg_ts_template t ON t.oid=d.dicttemplate
  UNION ALL SELECT 'parser/'||quote_ident(n.nspname)||'.'||quote_ident(p.prsname),jsonb_build_array(p.prsstart::regprocedure,p.prstoken::regprocedure,p.prsend::regprocedure,p.prsheadline::regprocedure,p.prslextype::regprocedure)::text FROM pg_ts_parser p JOIN ns n ON n.oid=p.prsnamespace
  UNION ALL SELECT 'template/'||quote_ident(n.nspname)||'.'||quote_ident(t.tmplname),jsonb_build_array(t.tmplinit::regprocedure,t.tmpllexize::regprocedure)::text FROM pg_ts_template t JOIN ns n ON n.oid=t.tmplnamespace
) o
UNION ALL SELECT 'conversions', o.id, o.body,o.body FROM (
  SELECT quote_ident(n.nspname)||'.'||quote_ident(c.conname) id,jsonb_build_array(pg_get_userbyid(c.conowner),c.conforencoding,c.contoencoding,c.conproc::regprocedure,c.condefault)::text body FROM pg_conversion c JOIN ns n ON n.oid=c.connamespace
) o
UNION ALL SELECT 'statistics', o.id, o.body,o.body FROM (
  SELECT quote_ident(n.nspname)||'.'||quote_ident(s.stxname) id,jsonb_build_array(pg_get_userbyid(s.stxowner),s.stxstattarget,pg_get_statisticsobjdef(s.oid))::text body FROM pg_statistic_ext s JOIN ns n ON n.oid=s.stxnamespace
) o
UNION ALL SELECT 'opfamilies', o.id, o.body,o.body FROM (
  SELECT concat_ws('/',m.amname,n.nspname,f.opfname) id,pg_get_userbyid(f.opfowner) body FROM pg_opfamily f JOIN ns n ON n.oid=f.opfnamespace JOIN pg_am m ON m.oid=f.opfmethod
  UNION ALL SELECT 'member/'||pg_describe_object('pg_amop'::regclass,a.oid,0),jsonb_build_array(a.amoppurpose,(SELECT m.amname FROM pg_am m WHERE m.oid=a.amopmethod))::text FROM pg_amop a JOIN pg_opfamily f ON f.oid=a.amopfamily JOIN ns n ON n.oid=f.opfnamespace
  UNION ALL SELECT 'member/'||pg_describe_object('pg_amproc'::regclass,a.oid,0),'' FROM pg_amproc a JOIN pg_opfamily f ON f.oid=a.amprocfamily JOIN ns n ON n.oid=f.opfnamespace
) o
UNION ALL SELECT 'transforms', o.id, o.body,o.body FROM (
  SELECT concat_ws('/',t.trftype::regtype,l.lanname) id,jsonb_build_array(t.trffromsql::regprocedure,t.trftosql::regprocedure)::text body FROM pg_transform t JOIN pg_language l ON l.oid=t.trflang
) o
UNION ALL SELECT 'access_methods', o.id, o.body,o.body FROM (
  SELECT amname id,jsonb_build_array(amtype,amhandler::regproc)::text body FROM pg_am
) o
UNION ALL SELECT 'foreign', o.id, o.body,o.body FROM (
  SELECT 'wrapper/'||w.fdwname id,jsonb_build_array(pg_get_userbyid(w.fdwowner),w.fdwhandler::regproc,w.fdwvalidator::regproc,ARRAY(SELECT acl::text FROM unnest(w.fdwacl) acl ORDER BY acl::text COLLATE "C")::text,ARRAY(SELECT split_part(x,'=',1) FROM unnest(w.fdwoptions) x ORDER BY 1)::text)::text body FROM pg_foreign_data_wrapper w
  UNION ALL SELECT 'server/'||s.srvname,jsonb_build_array(pg_get_userbyid(s.srvowner),w.fdwname,s.srvtype,s.srvversion,ARRAY(SELECT acl::text FROM unnest(s.srvacl) acl ORDER BY acl::text COLLATE "C")::text,ARRAY(SELECT split_part(x,'=',1) FROM unnest(s.srvoptions) x ORDER BY 1)::text)::text FROM pg_foreign_server s JOIN pg_foreign_data_wrapper w ON w.oid=s.srvfdw
  UNION ALL SELECT 'user mapping/'||m.srvname||'/'||m.usename,'' FROM pg_user_mappings m
) o
UNION ALL SELECT 'subscriptions', o.id, o.body,o.body FROM (
  SELECT s.subname id,jsonb_build_array(pg_get_userbyid(s.subowner),s.subenabled,s.subpublications::text)::text body FROM pg_subscription s WHERE s.subdbid=(SELECT oid FROM pg_database WHERE datname=current_database())
) o
UNION ALL SELECT 'security_labels', o.id, o.body,o.body FROM (
  SELECT concat_ws('/',l.provider,i.type,i.identity) id,l.label body FROM pg_seclabel l CROSS JOIN LATERAL pg_identify_object(l.classoid,l.objoid,l.objsubid) i
  UNION ALL SELECT concat_ws('/',l.provider,i.type,i.identity),l.label FROM pg_shseclabel l CROSS JOIN LATERAL pg_identify_object(l.classoid,l.objoid,0) i WHERE l.classoid<>'pg_database'::regclass
) o
UNION ALL SELECT 'parameter_acls', o.id, o.body,o.body FROM (
  SELECT parname id,ARRAY(SELECT acl::text FROM unnest(paracl) acl ORDER BY acl::text COLLATE "C")::text body FROM pg_parameter_acl
) o
UNION ALL SELECT 'catalog_permissions', o.id, o.body,o.body FROM (
  SELECT 'schema/'||n.nspname id,jsonb_build_array(pg_get_userbyid(n.nspowner),ARRAY(SELECT acl::text FROM unnest(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl ORDER BY acl::text COLLATE "C")::text)::text body FROM catalog_ns n
  UNION ALL SELECT 'relation/'||c.oid::regclass::text,ARRAY(SELECT acl::text FROM unnest(c.relacl) acl ORDER BY acl::text COLLATE "C")::text FROM pg_class c JOIN catalog_ns n ON n.oid=c.relnamespace WHERE c.relacl IS NOT NULL
  UNION ALL SELECT 'column/'||c.oid::regclass::text||'/'||a.attname,ARRAY(SELECT acl::text FROM unnest(a.attacl) acl ORDER BY acl::text COLLATE "C")::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN catalog_ns n ON n.oid=c.relnamespace WHERE a.attacl IS NOT NULL
  UNION ALL SELECT 'function/'||p.oid::regprocedure::text,ARRAY(SELECT acl::text FROM unnest(p.proacl) acl ORDER BY acl::text COLLATE "C")::text FROM pg_proc p JOIN catalog_ns n ON n.oid=p.pronamespace WHERE p.proacl IS NOT NULL
  UNION ALL SELECT 'type/'||t.oid::regtype::text,ARRAY(SELECT acl::text FROM unnest(t.typacl) acl ORDER BY acl::text COLLATE "C")::text FROM pg_type t JOIN catalog_ns n ON n.oid=t.typnamespace WHERE t.typacl IS NOT NULL
  UNION ALL SELECT 'language/'||l.lanname,ARRAY(SELECT acl::text FROM unnest(l.lanacl) acl ORDER BY acl::text COLLATE "C")::text FROM pg_language l WHERE l.lanacl IS NOT NULL AND l.lanname IN ('internal','c','sql')
  UNION ALL SELECT 'schema/pg_toast',jsonb_build_array(pg_get_userbyid(n.nspowner),ARRAY(SELECT acl::text FROM unnest(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl ORDER BY acl::text COLLATE "C")::text)::text FROM pg_namespace n WHERE n.nspname='pg_toast'
  UNION ALL SELECT 'relation/'||c.oid::regclass::text,ARRAY(SELECT acl::text FROM unnest(c.relacl) acl ORDER BY acl::text COLLATE "C")::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pg_toast' AND c.relacl IS NOT NULL
) o
-- Objects created after initdb in the system schemas, in pg_toast or in another schema named pg_..., outside any
-- extension. TOAST tables and the indexes on them are left out as objects: PostgreSQL makes them (a TOAST table's own
-- index, and the _ccnew and _ccold copies REINDEX CONCURRENTLY makes and an interrupted run leaves), pg_dump writes no
-- CREATE for them, and CREATE INDEX and ADD CONSTRAINT refuse a TOAST table even with allow_system_table_mods. A TOAST
-- table's storage settings, which pg_dump writes on the table that owns it, are read with that table in relations.
UNION ALL SELECT 'catalog_objects', o.id, o.body,o.body FROM (
  SELECT 'function/'||p.oid::regprocedure::text id,jsonb_build_array(pg_get_userbyid(p.proowner),p.prokind,CASE WHEN p.prokind<>'a' THEN pg_get_functiondef(p.oid) END)::text body FROM pg_proc p JOIN created_ns n ON n.oid=p.pronamespace WHERE p.oid>=16384 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
  UNION ALL SELECT 'relation/'||c.oid::regclass::text,jsonb_build_array(pg_get_userbyid(c.relowner),c.relkind,CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid) WHEN c.relkind='i' THEN pg_get_indexdef(c.oid) END)::text FROM pg_class c JOIN created_ns n ON n.oid=c.relnamespace WHERE c.oid>=16384 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
    AND NOT (n.nspname='pg_toast' AND (c.relkind='t' OR EXISTS (SELECT 1 FROM pg_index i JOIN pg_class s ON s.oid=i.indrelid WHERE i.indexrelid=c.oid AND s.relkind='t')))
  UNION ALL SELECT 'type/'||t.oid::regtype::text,jsonb_build_array(pg_get_userbyid(t.typowner),t.typtype)::text FROM pg_type t JOIN created_ns n ON n.oid=t.typnamespace WHERE t.oid>=16384 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_type'::regclass AND d.objid=t.oid AND d.deptype='e')
  UNION ALL SELECT 'operator/'||o.oid::regoperator::text,jsonb_build_array(pg_get_userbyid(o.oprowner),o.oprcode::regprocedure::text)::text FROM pg_operator o JOIN created_ns n ON n.oid=o.oprnamespace WHERE o.oid>=16384 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_operator'::regclass AND d.objid=o.oid AND d.deptype='e')
  UNION ALL SELECT 'collation/'||quote_ident(n.nspname)||'.'||quote_ident(x.collname),jsonb_build_array(pg_get_userbyid(x.collowner),x.collprovider,x.collisdeterministic,x.collencoding,x.collcollate,x.collctype,x.colllocale,x.collicurules)::text FROM pg_collation x JOIN created_ns n ON n.oid=x.collnamespace WHERE x.oid>=16384 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_collation'::regclass AND d.objid=x.oid AND d.deptype='e')
  UNION ALL SELECT 'operator family/'||pg_describe_object('pg_opfamily'::regclass,x.oid,0),pg_get_userbyid(x.opfowner) FROM pg_opfamily x JOIN created_ns n ON n.oid=x.opfnamespace WHERE x.oid>=16384 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_opfamily'::regclass AND d.objid=x.oid AND d.deptype='e')
  UNION ALL SELECT 'operator class/'||pg_describe_object('pg_opclass'::regclass,x.oid,0),pg_get_userbyid(x.opcowner) FROM pg_opclass x JOIN created_ns n ON n.oid=x.opcnamespace WHERE x.oid>=16384 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_opclass'::regclass AND d.objid=x.oid AND d.deptype='e')
  UNION ALL SELECT 'member/'||pg_describe_object('pg_amop'::regclass,a.oid,0),'' FROM pg_amop a JOIN pg_opfamily f ON f.oid=a.amopfamily JOIN created_ns n ON n.oid=f.opfnamespace WHERE a.oid>=16384
  UNION ALL SELECT 'member/'||pg_describe_object('pg_amproc'::regclass,a.oid,0),'' FROM pg_amproc a JOIN pg_opfamily f ON f.oid=a.amprocfamily JOIN created_ns n ON n.oid=f.opfnamespace WHERE a.oid>=16384
  UNION ALL SELECT 'conversion/'||quote_ident(n.nspname)||'.'||quote_ident(x.conname),jsonb_build_array(pg_get_userbyid(x.conowner),x.conforencoding,x.contoencoding,x.conproc::regprocedure::text,x.condefault)::text FROM pg_conversion x JOIN created_ns n ON n.oid=x.connamespace WHERE x.oid>=16384 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_conversion'::regclass AND d.objid=x.oid AND d.deptype='e')
  UNION ALL SELECT 'text search configuration/'||x.oid::regconfig::text,jsonb_build_array(pg_get_userbyid(x.cfgowner),(SELECT string_agg(m.maptokentype||':'||m.mapseqno||':'||m.mapdict::regdictionary::text,',' ORDER BY m.maptokentype,m.mapseqno) FROM pg_ts_config_map m WHERE m.mapcfg=x.oid))::text FROM pg_ts_config x JOIN created_ns n ON n.oid=x.cfgnamespace WHERE x.oid>=16384 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_ts_config'::regclass AND d.objid=x.oid AND d.deptype='e')
  UNION ALL SELECT 'text search dictionary/'||x.oid::regdictionary::text,jsonb_build_array(pg_get_userbyid(x.dictowner),x.dictinitoption)::text FROM pg_ts_dict x JOIN created_ns n ON n.oid=x.dictnamespace WHERE x.oid>=16384 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_ts_dict'::regclass AND d.objid=x.oid AND d.deptype='e')
  UNION ALL SELECT 'text search parser/'||quote_ident(n.nspname)||'.'||quote_ident(x.prsname),'' FROM pg_ts_parser x JOIN created_ns n ON n.oid=x.prsnamespace WHERE x.oid>=16384 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_ts_parser'::regclass AND d.objid=x.oid AND d.deptype='e')
  UNION ALL SELECT 'text search template/'||quote_ident(n.nspname)||'.'||quote_ident(x.tmplname),'' FROM pg_ts_template x JOIN created_ns n ON n.oid=x.tmplnamespace WHERE x.oid>=16384 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_ts_template'::regclass AND d.objid=x.oid AND d.deptype='e')
  UNION ALL SELECT 'statistics/'||quote_ident(n.nspname)||'.'||quote_ident(x.stxname),pg_get_statisticsobjdef(x.oid) FROM pg_statistic_ext x JOIN created_ns n ON n.oid=x.stxnamespace
  UNION ALL SELECT 'constraint/'||concat_ws('/',CASE WHEN c.contypid<>0 THEN 'domain '||c.contypid::regtype::text ELSE c.conrelid::regclass::text END,c.conname),pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN created_ns n ON n.oid=c.connamespace WHERE c.oid>=16384
  UNION ALL SELECT 'trigger/'||t.tgrelid::regclass::text||'/'||t.tgname,jsonb_build_array(t.tgenabled,pg_get_triggerdef(t.oid))::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN created_ns n ON n.oid=c.relnamespace
  UNION ALL SELECT 'policy/'||p.polrelid::regclass::text||'/'||p.polname,jsonb_build_array(p.polcmd,p.polpermissive,p.polroles::regrole[]::text,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))::text FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN created_ns n ON n.oid=c.relnamespace
  UNION ALL SELECT 'rule/'||r.ev_class::regclass::text||'/'||r.rulename,pg_get_ruledef(r.oid) FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class JOIN created_ns n ON n.oid=c.relnamespace WHERE r.oid>=16384
  UNION ALL SELECT 'schema/'||n.nspname,pg_get_userbyid(n.nspowner) FROM pg_namespace n WHERE n.nspname~'^pg_' AND n.nspname NOT IN ('pg_catalog','pg_toast') AND n.nspname!~'^pg_(toast_)?temp_[0-9]+$'
) o
-- What initdb created in the system schemas (every object there below the first ordinary object id), by name: the full
-- definition of each function, procedure and aggregate (for an aggregate, its arguments, result, volatility,
-- strictness, security, leakproofness, cost, rows, support function, settings, language and source as well as its
-- aggregate definition), view and index, the columns, access method, tablespace,
-- replica identity and row-security settings of each relation and the clustering, replica identity and validity of
-- each index, the rules on system views other than a view's own, the collations built into PostgreSQL, the settings
-- of each range type, and each type, operator, cast, constraint, operator family and class with its members,
-- conversion and text-search object. A replaced or dropped built-in, a changed attribute (volatility, strictness,
-- parallel safety, security, settings, cost) or a changed mapping differs. Not read: the collations initdb imports
-- from ICU and the operating system's locales and the version of the built-in ICU collation (both differ between
-- images), comments, initial privileges, the statistics settings of system columns, and server settings. Grants on
-- system objects are in catalog_permissions.
UNION ALL SELECT 'builtins', o.id, o.body,o.body FROM (
  SELECT 'function/'||p.oid::regprocedure::text id,md5(jsonb_build_array(pg_get_userbyid(p.proowner),p.prokind,p.proparallel,
    CASE WHEN p.prokind<>'a' THEN pg_get_functiondef(p.oid) ELSE jsonb_build_array(pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),p.provolatile,p.proisstrict,p.prosecdef,p.proleakproof,p.procost,p.prorows,p.prosupport::regproc::text,p.proconfig::text,(SELECT l.lanname FROM pg_language l WHERE l.oid=p.prolang),p.prosrc)::text END,
    (SELECT jsonb_build_array(a.aggkind,a.aggnumdirectargs,a.aggtransfn::regprocedure::text,a.aggfinalfn::regprocedure::text,a.aggcombinefn::regprocedure::text,a.aggserialfn::regprocedure::text,a.aggdeserialfn::regprocedure::text,a.aggmtransfn::regprocedure::text,a.aggminvtransfn::regprocedure::text,a.aggmfinalfn::regprocedure::text,a.aggfinalextra,a.aggmfinalextra,a.aggfinalmodify,a.aggmfinalmodify,a.aggsortop::regoperator::text,a.aggtranstype::regtype::text,a.aggtransspace,a.aggmtranstype::regtype::text,a.aggmtransspace,a.agginitval,a.aggminitval) FROM pg_aggregate a WHERE a.aggfnoid=p.oid))::text) body FROM pg_proc p JOIN catalog_ns n ON n.oid=p.pronamespace WHERE p.oid<16384
  UNION ALL SELECT 'relation/'||c.oid::regclass::text,md5(jsonb_build_array(pg_get_userbyid(c.relowner),c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.reloptions::text,CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid) WHEN c.relkind='i' THEN pg_get_indexdef(c.oid) END,
    (SELECT m.amname FROM pg_am m WHERE m.oid=c.relam),(SELECT s.spcname FROM pg_tablespace s WHERE s.oid=c.reltablespace),c.relreplident,c.relispartition,c.reloftype::regtype::text,
    (SELECT jsonb_build_array(i.indisclustered,i.indisreplident,i.indisvalid) FROM pg_index i WHERE i.indexrelid=c.oid))::text) FROM pg_class c JOIN catalog_ns n ON n.oid=c.relnamespace WHERE c.oid<16384
  UNION ALL SELECT 'column/'||c.oid::regclass::text||'/'||a.attname,jsonb_build_array(a.attnum,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid),a.attidentity,a.attgenerated,a.attcollation::regcollation::text,a.attstorage,a.attcompression)::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN catalog_ns n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE c.oid<16384 AND a.attnum>0 AND NOT a.attisdropped
  UNION ALL SELECT 'type/'||t.oid::regtype::text,jsonb_build_array(pg_get_userbyid(t.typowner),t.typlen,t.typbyval,t.typtype,t.typcategory,t.typispreferred,t.typisdefined,t.typdelim,t.typrelid::regclass::text,t.typsubscript::regproc::text,t.typelem::regtype::text,t.typarray::regtype::text,t.typinput::regproc::text,t.typoutput::regproc::text,t.typreceive::regproc::text,t.typsend::regproc::text,t.typmodin::regproc::text,t.typmodout::regproc::text,t.typanalyze::regproc::text,t.typalign,t.typstorage,t.typnotnull,t.typbasetype::regtype::text,t.typtypmod,t.typndims,t.typcollation::regcollation::text,t.typdefault)::text FROM pg_type t JOIN catalog_ns n ON n.oid=t.typnamespace WHERE t.oid<16384
  UNION ALL SELECT 'operator/'||o.oid::regoperator::text,jsonb_build_array(pg_get_userbyid(o.oprowner),o.oprkind,o.oprcanmerge,o.oprcanhash,o.oprresult::regtype::text,o.oprcom::regoperator::text,o.oprnegate::regoperator::text,o.oprcode::regprocedure::text,o.oprrest::regprocedure::text,o.oprjoin::regprocedure::text)::text FROM pg_operator o JOIN catalog_ns n ON n.oid=o.oprnamespace WHERE o.oid<16384
  UNION ALL SELECT 'cast/'||concat_ws('/',c.castsource::regtype,c.casttarget::regtype),jsonb_build_array(c.castfunc::regprocedure::text,c.castcontext,c.castmethod)::text FROM pg_cast c WHERE c.oid<16384
  UNION ALL SELECT 'constraint/'||concat_ws('/',CASE WHEN c.contypid<>0 THEN 'domain '||c.contypid::regtype::text ELSE c.conrelid::regclass::text END,c.conname),jsonb_build_array(c.contype,c.convalidated,c.condeferrable,c.condeferred,pg_get_constraintdef(c.oid))::text FROM pg_constraint c JOIN catalog_ns n ON n.oid=c.connamespace WHERE c.oid<16384
  UNION ALL SELECT 'operator family/'||pg_describe_object('pg_opfamily'::regclass,f.oid,0),pg_get_userbyid(f.opfowner) FROM pg_opfamily f JOIN catalog_ns n ON n.oid=f.opfnamespace WHERE f.oid<16384
  UNION ALL SELECT 'operator class/'||pg_describe_object('pg_opclass'::regclass,c.oid,0),jsonb_build_array(pg_get_userbyid(c.opcowner),c.opcintype::regtype::text,c.opcdefault,c.opckeytype::regtype::text,pg_describe_object('pg_opfamily'::regclass,c.opcfamily,0))::text FROM pg_opclass c JOIN catalog_ns n ON n.oid=c.opcnamespace WHERE c.oid<16384
  UNION ALL SELECT 'member/'||pg_describe_object('pg_amop'::regclass,a.oid,0),jsonb_build_array(a.amoppurpose,CASE WHEN a.amopsortfamily<>0 THEN pg_describe_object('pg_opfamily'::regclass,a.amopsortfamily,0) END)::text FROM pg_amop a JOIN pg_opfamily f ON f.oid=a.amopfamily JOIN catalog_ns n ON n.oid=f.opfnamespace WHERE a.oid<16384
  UNION ALL SELECT 'member/'||pg_describe_object('pg_amproc'::regclass,a.oid,0),'' FROM pg_amproc a JOIN pg_opfamily f ON f.oid=a.amprocfamily JOIN catalog_ns n ON n.oid=f.opfnamespace WHERE a.oid<16384
  UNION ALL SELECT 'conversion/'||quote_ident(n.nspname)||'.'||quote_ident(x.conname),jsonb_build_array(pg_get_userbyid(x.conowner),x.conforencoding,x.contoencoding,x.conproc::regprocedure::text,x.condefault)::text FROM pg_conversion x JOIN catalog_ns n ON n.oid=x.connamespace WHERE x.oid<16384
  UNION ALL SELECT 'text search configuration/'||x.oid::regconfig::text,jsonb_build_array(pg_get_userbyid(x.cfgowner),p.prsname,(SELECT string_agg(m.maptokentype||':'||m.mapseqno||':'||m.mapdict::regdictionary::text,',' ORDER BY m.maptokentype,m.mapseqno) FROM pg_ts_config_map m WHERE m.mapcfg=x.oid))::text FROM pg_ts_config x JOIN catalog_ns n ON n.oid=x.cfgnamespace JOIN pg_ts_parser p ON p.oid=x.cfgparser WHERE x.oid<16384
  UNION ALL SELECT 'text search dictionary/'||x.oid::regdictionary::text,jsonb_build_array(pg_get_userbyid(x.dictowner),t.tmplname,x.dictinitoption)::text FROM pg_ts_dict x JOIN catalog_ns n ON n.oid=x.dictnamespace JOIN pg_ts_template t ON t.oid=x.dicttemplate WHERE x.oid<16384
  UNION ALL SELECT 'text search parser/'||quote_ident(n.nspname)||'.'||quote_ident(x.prsname),jsonb_build_array(x.prsstart::regprocedure::text,x.prstoken::regprocedure::text,x.prsend::regprocedure::text,x.prsheadline::regprocedure::text,x.prslextype::regprocedure::text)::text FROM pg_ts_parser x JOIN catalog_ns n ON n.oid=x.prsnamespace WHERE x.oid<16384
  UNION ALL SELECT 'text search template/'||quote_ident(n.nspname)||'.'||quote_ident(x.tmplname),jsonb_build_array(x.tmplinit::regprocedure::text,x.tmpllexize::regprocedure::text)::text FROM pg_ts_template x JOIN catalog_ns n ON n.oid=x.tmplnamespace WHERE x.oid<16384
  UNION ALL SELECT 'rule/'||r.ev_class::regclass::text||'/'||r.rulename,jsonb_build_array(r.ev_enabled,pg_get_ruledef(r.oid))::text FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class JOIN catalog_ns n ON n.oid=c.relnamespace WHERE r.oid<16384 AND r.rulename<>'_RETURN'
  UNION ALL SELECT 'collation/'||quote_ident(n.nspname)||'.'||quote_ident(x.collname),jsonb_build_array(pg_get_userbyid(x.collowner),x.collprovider,x.collisdeterministic,x.collencoding,x.collcollate,x.collctype,x.colllocale,x.collicurules)::text FROM pg_collation x JOIN catalog_ns n ON n.oid=x.collnamespace WHERE x.oid<12000
  UNION ALL SELECT 'range/'||r.rngtypid::regtype::text,jsonb_build_array(r.rngsubtype::regtype::text,r.rngmultitypid::regtype::text,CASE WHEN r.rngcollation<>0 THEN r.rngcollation::regcollation::text END,pg_describe_object('pg_opclass'::regclass,r.rngsubopc,0),r.rngcanonical::regproc::text,r.rngsubdiff::regproc::text)::text FROM pg_range r JOIN pg_type t ON t.oid=r.rngtypid JOIN catalog_ns n ON n.oid=t.typnamespace WHERE t.oid<16384
) o
UNION ALL SELECT 'sequence_ownership', o.id, o.body,o.body FROM (
  SELECT d.objid::regclass::text id,concat_ws('/',d.refobjid::regclass::text,a.attname,d.deptype) body FROM pg_depend d JOIN pg_class s ON d.classid='pg_class'::regclass AND s.oid=d.objid AND s.relkind='S' JOIN ns n ON n.oid=s.relnamespace JOIN pg_attribute a ON d.refclassid='pg_class'::regclass AND a.attrelid=d.refobjid AND a.attnum=d.refobjsubid WHERE d.deptype IN ('a','i')
) o
UNION ALL SELECT 'tablespaces', o.id, o.body,o.body FROM (
  SELECT spcname id,jsonb_build_array(pg_get_userbyid(spcowner),ARRAY(SELECT acl::text FROM unnest(spcacl) acl ORDER BY acl::text COLLATE "C")::text,spcoptions::text)::text body FROM pg_tablespace
) o
UNION ALL SELECT 'large_objects', o.id, o.body,o.body FROM (
  SELECT pg_get_userbyid(m.lomowner)||'/'||coalesce(ARRAY(SELECT acl::text FROM unnest(m.lomacl) acl ORDER BY acl::text COLLATE "C")::text,'') id,count(*)::text body FROM pg_largeobject_metadata m GROUP BY 1
) o)
-- "loose" is the same digest over each definition printed the way PostgreSQL prints it for people (pretty), which
-- leaves out only the parentheses that operator precedence makes redundant. A dump and restore parses stored
-- expressions again, and PostgreSQL flattens nested AND and OR chains (a BETWEEN followed by AND, for example) when it
-- does, so a restored copy prints some definitions with fewer parentheses than the source that created them. Printed
-- this way, a flattened chain and the nested one it came from read the same, while any regrouping of AND and OR, or of
-- arithmetic, still differs. Only the families that hold parsed expressions have a printing of their own (columns,
-- constraints, indexes, views, triggers, policies, rules); for every other family it is the definition itself.
SELECT jsonb_build_object('format','agentflow-schema-fingerprint/3',
  'captured_at',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'client',jsonb_build_object('application_name',current_setting('application_name'),'session_user',session_user::text),
  'families',coalesce(jsonb_agg(to_jsonb(section) ORDER BY kind),'[]'::jsonb)) AS schema_fingerprint FROM (
  SELECT kind,count(*) AS objects,
    encode(sha256(convert_to(string_agg(
      encode(sha256(convert_to(jsonb_build_array(id,body)::text,'UTF8')),'hex'),
      '' ORDER BY id COLLATE "C",body COLLATE "C"),'UTF8')),'hex') AS sha256,
    encode(sha256(convert_to(string_agg(
      encode(sha256(convert_to(jsonb_build_array(id,pretty)::text,'UTF8')),'hex'),
      '' ORDER BY id COLLATE "C",pretty COLLATE "C"),'UTF8')),'hex') AS loose
  FROM objects GROUP BY kind
) section;
COMMIT;
