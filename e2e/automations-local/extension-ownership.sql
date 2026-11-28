-- What a schema-only dump cannot carry for the source's extensions: who owns each extension and each of its members,
-- the initial privileges extension scripts recorded (pg_init_privs, privtype 'e'), and the shared dependencies
-- PostgreSQL 17 keeps for them (pg_shdepend: each extension's owner row, and every initial-privilege row of the
-- database). A restore creates every extension afresh, owned by the restoring superuser with a fresh install's initial
-- privileges; restore-full.sh then reproduces this reading, and the restored database is compared with the independent
-- receipt in every family. Object addresses, role names and privileges only: no rows. Read in the same read-only
-- window as the dump.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='250ms'; SET LOCAL search_path=pg_catalog;
SET LOCAL TimeZone='UTC'; SET LOCAL standard_conforming_strings=on;
SELECT jsonb_build_object('format','agentflow-extension-ownership/2',
  'captured_at',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'client',jsonb_build_object('application_name',current_setting('application_name'),'session_user',session_user::text),
  'extensions',coalesce((SELECT jsonb_agg(jsonb_build_array(e.extname,pg_get_userbyid(e.extowner)) ORDER BY e.extname COLLATE "C")
    FROM pg_extension e),'[]'::jsonb),
  'members',coalesce((SELECT jsonb_agg(jsonb_build_array(a.type,a.object_names,a.object_args,pg_get_userbyid(m.owner))
      ORDER BY a.type COLLATE "C",a.object_names::text COLLATE "C",a.object_args::text COLLATE "C")
    FROM pg_depend d
    CROSS JOIN LATERAL (SELECT CASE d.classid
        WHEN 'pg_proc'::regclass THEN (SELECT x.proowner FROM pg_proc x WHERE x.oid=d.objid)
        WHEN 'pg_class'::regclass THEN (SELECT x.relowner FROM pg_class x WHERE x.oid=d.objid)
        WHEN 'pg_type'::regclass THEN (SELECT x.typowner FROM pg_type x WHERE x.oid=d.objid)
        WHEN 'pg_namespace'::regclass THEN (SELECT x.nspowner FROM pg_namespace x WHERE x.oid=d.objid)
        WHEN 'pg_operator'::regclass THEN (SELECT x.oprowner FROM pg_operator x WHERE x.oid=d.objid)
        WHEN 'pg_opclass'::regclass THEN (SELECT x.opcowner FROM pg_opclass x WHERE x.oid=d.objid)
        WHEN 'pg_opfamily'::regclass THEN (SELECT x.opfowner FROM pg_opfamily x WHERE x.oid=d.objid)
        WHEN 'pg_collation'::regclass THEN (SELECT x.collowner FROM pg_collation x WHERE x.oid=d.objid)
        WHEN 'pg_conversion'::regclass THEN (SELECT x.conowner FROM pg_conversion x WHERE x.oid=d.objid)
        WHEN 'pg_ts_config'::regclass THEN (SELECT x.cfgowner FROM pg_ts_config x WHERE x.oid=d.objid)
        WHEN 'pg_ts_dict'::regclass THEN (SELECT x.dictowner FROM pg_ts_dict x WHERE x.oid=d.objid)
        WHEN 'pg_event_trigger'::regclass THEN (SELECT x.evtowner FROM pg_event_trigger x WHERE x.oid=d.objid)
        WHEN 'pg_language'::regclass THEN (SELECT x.lanowner FROM pg_language x WHERE x.oid=d.objid)
        WHEN 'pg_foreign_data_wrapper'::regclass THEN (SELECT x.fdwowner FROM pg_foreign_data_wrapper x WHERE x.oid=d.objid)
        WHEN 'pg_foreign_server'::regclass THEN (SELECT x.srvowner FROM pg_foreign_server x WHERE x.oid=d.objid)
        WHEN 'pg_statistic_ext'::regclass THEN (SELECT x.stxowner FROM pg_statistic_ext x WHERE x.oid=d.objid) END AS owner) m
    CROSS JOIN LATERAL pg_identify_object_as_address(d.classid,d.objid,0) a
    WHERE d.refclassid='pg_extension'::regclass AND d.deptype='e' AND m.owner IS NOT NULL),'[]'::jsonb),
  'initial_privileges',coalesce((SELECT jsonb_agg(jsonb_build_array(a.type,a.object_names,a.object_args,p.initprivs::text)
      ORDER BY a.type COLLATE "C",a.object_names::text COLLATE "C",a.object_args::text COLLATE "C")
    FROM pg_init_privs p CROSS JOIN LATERAL pg_identify_object_as_address(p.classoid,p.objoid,p.objsubid) a
    WHERE p.privtype='e'),'[]'::jsonb),
  -- Each row: the dependency type ('o' an extension's owner, 'i' a role named in an initial privilege), the object's
  -- address and the role. PostgreSQL keeps no row for a pinned role (the bootstrap superuser) or for PUBLIC.
  'shared_dependencies',coalesce((SELECT jsonb_agg(jsonb_build_array(s.deptype::text,a.type,a.object_names,a.object_args,
        pg_get_userbyid(s.refobjid)::text)
      ORDER BY s.deptype::text COLLATE "C",a.type COLLATE "C",a.object_names::text COLLATE "C",a.object_args::text COLLATE "C",
        pg_get_userbyid(s.refobjid)::text COLLATE "C")
    FROM pg_shdepend s CROSS JOIN LATERAL pg_identify_object_as_address(s.classid,s.objid,s.objsubid) a
    WHERE s.dbid=(SELECT x.oid FROM pg_database x WHERE x.datname=current_database()) AND s.refclassid='pg_authid'::regclass
      AND (s.deptype='i' OR (s.deptype='o' AND s.classid='pg_extension'::regclass))),'[]'::jsonb)) AS extension_ownership;
COMMIT;
