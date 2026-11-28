-- Reproduces the source's extension ownership (extension-ownership.sql) on the restored database: restore-full.sh
-- loads the reading into agentflow_extension_ownership(doc) in the same transaction, as the restoring superuser, after
-- restoring every archive entry except the privileges (ACL and DEFAULT ACL) and before restoring those, so each GRANT
-- and REVOKE pg_dump wrote lands on the owner and the privileges it was computed from.
-- - Each extension and member gets the source's owner (ALTER ... OWNER TO; an extension's own owner has no command). An
--   object whose owner follows another one is left to it: a relation's row type (not a standalone composite type's),
--   an array type, a multirange type, and a sequence a table column owns (serial or identity).
-- - The initial privileges extension scripts recorded (pg_init_privs, privtype 'e') become exactly the source's.
-- - An object outside any extension that has such initial privileges (on production the schemas graphql and
--   graphql_public, which pg_graphql's removal left behind) gets them as its privileges: pg_dump writes an object's
--   privileges as a change from its initial privileges, so the archive holds no grant for such an object.
-- - The shared dependencies PostgreSQL 17 keeps for these (pg_shdepend: an extension's owner, and each role an initial
--   privilege names) are rewritten to match, and checked against the source's own reading of them.
-- Any object the reading names that the restore does not hold, or that cannot be given its owner or privileges, stops
-- the restore, naming it. Nothing is changed where no fingerprint family reads: an initial privilege or a member's
-- owner in pg_catalog, information_schema, pg_toast or another pg_ schema must already be the source's. The restored
-- database is compared with the independent receipt afterwards.
-- It is meant to run once, between the two restore passes. Run again on a finished copy, it would set the privileges of
-- an object outside any extension back to its initial privileges, undoing the archive's grants and revokes on it.
-- Known gaps, each of which stops the run rather than passing a copy unlike the source (production has none of them):
-- a statistics object an extension script created on a member table keeps the restoring superuser as owner (it is not
-- a member, and pg_dump skips it), and a privilege outside any extension that a role other than the owner granted and
-- later revoked comes back, because pg_dump writes that REVOKE without its grantor, so the comparison differs; and a
-- member foreign-data wrapper cannot be given an owner that is not a superuser, so its ALTER fails here.
SET LOCAL search_path=pg_catalog;
ALTER TABLE agentflow_extension_ownership ADD COLUMN extensions integer, ADD COLUMN members integer,
  ADD COLUMN initial_privileges integer, ADD COLUMN privileges_set integer, ADD COLUMN shared_dependencies integer;
-- The restore's own extension members by the address the reading records. A prefix operator's address has a single
-- argument, which pg_get_object_address cannot resolve, so members are matched by address rather than resolved.
CREATE TEMP TABLE agentflow_restored_members ON COMMIT DROP AS
  SELECT a.type, a.object_names, a.object_args, d.classid, d.objid
  FROM pg_depend d CROSS JOIN LATERAL pg_identify_object_as_address(d.classid,d.objid,0) a
  WHERE d.refclassid='pg_extension'::regclass AND d.deptype='e';
CREATE TEMP TABLE agentflow_initial_privileges(classid oid, objid oid, objsubid integer, initprivs aclitem[]) ON COMMIT DROP;
CREATE FUNCTION pg_temp.agentflow_owner(classid oid, objid oid) RETURNS oid LANGUAGE sql STABLE AS $owner$
  SELECT CASE classid
    WHEN 'pg_proc'::regclass THEN (SELECT x.proowner FROM pg_proc x WHERE x.oid=objid)
    WHEN 'pg_class'::regclass THEN (SELECT x.relowner FROM pg_class x WHERE x.oid=objid)
    WHEN 'pg_type'::regclass THEN (SELECT x.typowner FROM pg_type x WHERE x.oid=objid)
    WHEN 'pg_namespace'::regclass THEN (SELECT x.nspowner FROM pg_namespace x WHERE x.oid=objid)
    WHEN 'pg_operator'::regclass THEN (SELECT x.oprowner FROM pg_operator x WHERE x.oid=objid)
    WHEN 'pg_opclass'::regclass THEN (SELECT x.opcowner FROM pg_opclass x WHERE x.oid=objid)
    WHEN 'pg_opfamily'::regclass THEN (SELECT x.opfowner FROM pg_opfamily x WHERE x.oid=objid)
    WHEN 'pg_collation'::regclass THEN (SELECT x.collowner FROM pg_collation x WHERE x.oid=objid)
    WHEN 'pg_conversion'::regclass THEN (SELECT x.conowner FROM pg_conversion x WHERE x.oid=objid)
    WHEN 'pg_ts_config'::regclass THEN (SELECT x.cfgowner FROM pg_ts_config x WHERE x.oid=objid)
    WHEN 'pg_ts_dict'::regclass THEN (SELECT x.dictowner FROM pg_ts_dict x WHERE x.oid=objid)
    WHEN 'pg_event_trigger'::regclass THEN (SELECT x.evtowner FROM pg_event_trigger x WHERE x.oid=objid)
    WHEN 'pg_language'::regclass THEN (SELECT x.lanowner FROM pg_language x WHERE x.oid=objid)
    WHEN 'pg_foreign_data_wrapper'::regclass THEN (SELECT x.fdwowner FROM pg_foreign_data_wrapper x WHERE x.oid=objid)
    WHEN 'pg_foreign_server'::regclass THEN (SELECT x.srvowner FROM pg_foreign_server x WHERE x.oid=objid)
    WHEN 'pg_statistic_ext'::regclass THEN (SELECT x.stxowner FROM pg_statistic_ext x WHERE x.oid=objid) END
$owner$;
-- An object's privileges as the fingerprint reads them: the owner's defaults where none were granted.
CREATE FUNCTION pg_temp.agentflow_acl(classid oid, objid oid, objsubid integer) RETURNS aclitem[] LANGUAGE sql STABLE AS $acl$
  SELECT CASE WHEN objsubid<>0 THEN (SELECT coalesce(a.attacl,'{}') FROM pg_attribute a WHERE a.attrelid=objid AND a.attnum=objsubid)
    WHEN classid='pg_namespace'::regclass THEN (SELECT coalesce(x.nspacl,acldefault('n',x.nspowner)) FROM pg_namespace x WHERE x.oid=objid)
    WHEN classid='pg_class'::regclass THEN (SELECT coalesce(x.relacl,acldefault(CASE WHEN x.relkind='S' THEN 's' ELSE 'r' END::"char",x.relowner))
      FROM pg_class x WHERE x.oid=objid)
    WHEN classid='pg_proc'::regclass THEN (SELECT coalesce(x.proacl,acldefault('f',x.proowner)) FROM pg_proc x WHERE x.oid=objid)
    WHEN classid='pg_type'::regclass THEN (SELECT coalesce(x.typacl,acldefault('T',x.typowner)) FROM pg_type x WHERE x.oid=objid) END
$acl$;
DO $restore$
DECLARE
  doc jsonb := (SELECT o.doc FROM agentflow_extension_ownership o);
  db oid := (SELECT d.oid FROM pg_database d WHERE d.datname=current_database());
  item jsonb; target record; ident record; base record; privilege record; diff record;
  wanted oid; held oid; kind text; columns text; grantee text;
  changed_extensions integer := 0; changed_members integer := 0; recorded integer := 0; given_privileges integer := 0;
  dependencies integer := 0;
BEGIN
  IF doc->>'format' IS DISTINCT FROM 'agentflow-extension-ownership/2' THEN
    RAISE EXCEPTION 'The extension ownership reading is not format 2.';
  END IF;
  IF (SELECT array_agg(e.extname::text ORDER BY e.extname COLLATE "C") FROM pg_extension e)
      IS DISTINCT FROM (SELECT array_agg(x->>0 ORDER BY (x->>0) COLLATE "C") FROM jsonb_array_elements(doc->'extensions') x) THEN
    RAISE EXCEPTION 'The restored extensions are not the ones the source reading lists.';
  END IF;
  FOR item IN SELECT x FROM jsonb_array_elements(doc->'extensions') x LOOP
    wanted := (SELECT r.oid FROM pg_roles r WHERE r.rolname=item->>1);
    IF wanted IS NULL THEN RAISE EXCEPTION 'The owner of extension % is not a restored role.', item->>0; END IF;
    UPDATE pg_extension e SET extowner=wanted WHERE e.extname=item->>0 AND e.extowner<>wanted;
    IF FOUND THEN
      changed_extensions := changed_extensions+1;
      -- PostgreSQL records an extension's owner in pg_shdepend, unless the role is pinned (an OID below
      -- FirstUnpinnedObjectId, 12000, such as the bootstrap superuser supabase_admin, OID 10).
      DELETE FROM pg_shdepend s WHERE s.dbid=db AND s.classid='pg_extension'::regclass AND s.objsubid=0 AND s.deptype='o'
        AND s.objid=(SELECT e.oid FROM pg_extension e WHERE e.extname=item->>0);
      INSERT INTO pg_shdepend(dbid,classid,objid,objsubid,refclassid,refobjid,deptype)
        SELECT db,'pg_extension'::regclass,e.oid,0,'pg_authid'::regclass,wanted,'o' FROM pg_extension e
        WHERE e.extname=item->>0 AND wanted>=12000;
    END IF;
  END LOOP;
  FOR item IN SELECT x FROM jsonb_array_elements(doc->'members') x LOOP
    SELECT m.classid, m.objid INTO target FROM agentflow_restored_members m WHERE m.type=item->>0
      AND m.object_names=ARRAY(SELECT jsonb_array_elements_text(item->1)) AND m.object_args=ARRAY(SELECT jsonb_array_elements_text(item->2));
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A source extension member is not an extension member in the restore: % % %', item->>0, item->1, item->2;
    END IF;
    SELECT * INTO ident FROM pg_identify_object(target.classid,target.objid,0);
    wanted := (SELECT r.oid FROM pg_roles r WHERE r.rolname=item->>3);
    IF wanted IS NULL THEN
      RAISE EXCEPTION 'The owner of extension member % % is not a restored role.', ident.type, ident.identity;
    END IF;
    held := pg_temp.agentflow_owner(target.classid,target.objid);
    CONTINUE WHEN held=wanted;
    -- An object whose owner follows another one takes it from that object.
    CONTINUE WHEN target.classid='pg_type'::regclass AND EXISTS (SELECT 1 FROM pg_type t LEFT JOIN pg_class c ON c.oid=t.typrelid
      WHERE t.oid=target.objid AND ((t.typrelid<>0 AND c.relkind<>'c') OR (t.typcategory='A' AND t.typelem<>0)
        OR EXISTS (SELECT 1 FROM pg_range r WHERE r.rngmultitypid=t.oid)));
    CONTINUE WHEN target.classid='pg_class'::regclass AND EXISTS (SELECT 1 FROM pg_class s JOIN pg_depend d
        ON d.classid='pg_class'::regclass AND d.objid=s.oid AND d.refclassid='pg_class'::regclass AND d.refobjsubid<>0
          AND d.deptype IN ('a','i')
      WHERE s.oid=target.objid AND s.relkind='S');
    IF ident.schema ~ '^pg_' OR ident.schema='information_schema' THEN
      RAISE EXCEPTION 'The source reading gives extension member % % another owner (%), but no fingerprint family reads owners in schema %, so the restore cannot change it.',
        ident.type, ident.identity, item->>3, ident.schema;
    END IF;
    kind := CASE ident.type WHEN 'function' THEN 'FUNCTION' WHEN 'procedure' THEN 'PROCEDURE' WHEN 'aggregate' THEN 'AGGREGATE'
      WHEN 'table' THEN 'TABLE' WHEN 'view' THEN 'VIEW' WHEN 'materialized view' THEN 'MATERIALIZED VIEW'
      WHEN 'sequence' THEN 'SEQUENCE' WHEN 'foreign table' THEN 'FOREIGN TABLE' WHEN 'type' THEN 'TYPE'
      WHEN 'composite type' THEN 'TYPE' WHEN 'domain' THEN 'DOMAIN' WHEN 'schema' THEN 'SCHEMA' WHEN 'operator' THEN 'OPERATOR'
      WHEN 'operator class' THEN 'OPERATOR CLASS' WHEN 'operator family' THEN 'OPERATOR FAMILY' WHEN 'collation' THEN 'COLLATION'
      WHEN 'conversion' THEN 'CONVERSION' WHEN 'text search configuration' THEN 'TEXT SEARCH CONFIGURATION'
      WHEN 'text search dictionary' THEN 'TEXT SEARCH DICTIONARY' WHEN 'event trigger' THEN 'EVENT TRIGGER'
      WHEN 'language' THEN 'LANGUAGE' WHEN 'foreign-data wrapper' THEN 'FOREIGN DATA WRAPPER' WHEN 'server' THEN 'SERVER'
      WHEN 'statistics object' THEN 'STATISTICS' END;
    IF kind IS NULL THEN
      RAISE EXCEPTION 'Extension member % % cannot be given its source owner.', ident.type, ident.identity;
    END IF;
    EXECUTE format('ALTER %s %s OWNER TO %I',kind,ident.identity,item->>3);
    changed_members := changed_members+1;
  END LOOP;
  -- Every member now has its source owner, those that follow another object included.
  FOR item IN SELECT x FROM jsonb_array_elements(doc->'members') x LOOP
    SELECT m.classid, m.objid INTO target FROM agentflow_restored_members m WHERE m.type=item->>0
      AND m.object_names=ARRAY(SELECT jsonb_array_elements_text(item->1)) AND m.object_args=ARRAY(SELECT jsonb_array_elements_text(item->2));
    IF pg_get_userbyid(pg_temp.agentflow_owner(target.classid,target.objid)) IS DISTINCT FROM item->>3 THEN
      SELECT * INTO ident FROM pg_identify_object(target.classid,target.objid,0);
      RAISE EXCEPTION 'Extension member % % did not take its source owner (%).', ident.type, ident.identity, item->>3;
    END IF;
  END LOOP;
  -- The objects the source's initial privileges are on. These are never operators, so their addresses resolve.
  FOR item IN SELECT x FROM jsonb_array_elements(doc->'initial_privileges') x LOOP
    BEGIN
      SELECT * INTO target FROM pg_get_object_address(item->>0,
        ARRAY(SELECT jsonb_array_elements_text(item->1)),ARRAY(SELECT jsonb_array_elements_text(item->2)));
      INSERT INTO agentflow_initial_privileges VALUES (target.classid,target.objid,target.objsubid,(item->>3)::aclitem[]);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'The source reading records initial privileges on % % %, which the restore cannot hold: %',
        item->>0, item->1, item->2, SQLERRM;
    END;
  END LOOP;
  -- Where no fingerprint family reads initial privileges, the source's must already be the restore's own.
  SELECT i.type, i.identity INTO ident FROM (
      (SELECT w.classid, w.objid, w.objsubid, ARRAY(SELECT x::text FROM unnest(w.initprivs) x ORDER BY x::text COLLATE "C") acl
        FROM agentflow_initial_privileges w
       EXCEPT SELECT p.classoid, p.objoid, p.objsubid, ARRAY(SELECT x::text FROM unnest(p.initprivs) x ORDER BY x::text COLLATE "C")
        FROM pg_init_privs p WHERE p.privtype='e')
      UNION
      (SELECT p.classoid, p.objoid, p.objsubid, ARRAY(SELECT x::text FROM unnest(p.initprivs) x ORDER BY x::text COLLATE "C")
        FROM pg_init_privs p WHERE p.privtype='e'
       EXCEPT SELECT w.classid, w.objid, w.objsubid, ARRAY(SELECT x::text FROM unnest(w.initprivs) x ORDER BY x::text COLLATE "C")
        FROM agentflow_initial_privileges w)) d
    CROSS JOIN LATERAL pg_identify_object(d.classid,d.objid,d.objsubid) i
    WHERE i.schema ~ '^pg_' OR i.schema='information_schema'
    ORDER BY i.identity COLLATE "C" LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'The source reading''s initial privileges on % % differ from the restore''s, but no fingerprint family reads initial privileges in that schema, so the restore cannot change them.',
      ident.type, ident.identity;
  END IF;
  -- The initial privileges extension scripts recorded, exactly as the source holds them.
  DELETE FROM pg_init_privs p WHERE p.privtype='e';
  INSERT INTO pg_init_privs(objoid,classoid,objsubid,privtype,initprivs)
    SELECT w.objid,w.classid,w.objsubid,'e',w.initprivs FROM agentflow_initial_privileges w;
  GET DIAGNOSTICS recorded = ROW_COUNT;
  -- PostgreSQL 17 records each role an initial privilege names (grantee or grantor, the owner included; never PUBLIC or
  -- a pinned role) as an 'i' shared dependency of the object.
  DELETE FROM pg_shdepend s WHERE s.dbid=db AND s.deptype='i';
  INSERT INTO pg_shdepend(dbid,classid,objid,objsubid,refclassid,refobjid,deptype)
    SELECT DISTINCT db,p.classoid,p.objoid,p.objsubid,'pg_authid'::regclass,r.role,'i'::"char"
    FROM pg_init_privs p
    CROSS JOIN LATERAL (SELECT a.grantee FROM aclexplode(p.initprivs) a UNION SELECT a.grantor FROM aclexplode(p.initprivs) a) r(role)
    WHERE r.role<>0 AND r.role>=12000;
  -- An object outside any extension takes its initial privileges as its privileges, each granted by its own grantor
  -- (GRANTED BY names only the current role, so each is granted as that role), before the archive's privileges are
  -- restored on top. Objects in the schemas no family reads keep the privileges the restore's extension scripts gave them.
  FOR target IN SELECT w.classid, w.objid, w.objsubid, w.initprivs FROM agentflow_initial_privileges w
      WHERE NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid=w.classid AND d.objid=w.objid AND d.deptype='e')
      ORDER BY w.classid, w.objid, w.objsubid LOOP
    SELECT * INTO ident FROM pg_identify_object(target.classid,target.objid,target.objsubid);
    CONTINUE WHEN ident.schema ~ '^pg_' OR ident.schema='information_schema';
    SELECT * INTO base FROM pg_identify_object(target.classid,target.objid,0);
    kind := CASE base.type WHEN 'schema' THEN 'SCHEMA' WHEN 'table' THEN 'TABLE' WHEN 'view' THEN 'TABLE'
      WHEN 'materialized view' THEN 'TABLE' WHEN 'foreign table' THEN 'TABLE' WHEN 'sequence' THEN 'SEQUENCE'
      WHEN 'function' THEN 'ROUTINE' WHEN 'procedure' THEN 'ROUTINE' WHEN 'aggregate' THEN 'ROUTINE'
      WHEN 'type' THEN 'TYPE' WHEN 'domain' THEN 'DOMAIN' END;
    IF kind IS NULL OR (target.objsubid<>0 AND kind<>'TABLE') THEN
      RAISE EXCEPTION 'The source reading records initial privileges on % %, which is in no extension, and the restore cannot give a % those privileges.',
        ident.type, ident.identity, ident.type;
    END IF;
    columns := CASE WHEN target.objsubid<>0 THEN ' ('||quote_ident((SELECT a.attname FROM pg_attribute a
      WHERE a.attrelid=target.objid AND a.attnum=target.objsubid))||')' ELSE '' END;
    held := pg_temp.agentflow_owner(target.classid,target.objid);
    FOR privilege IN SELECT a.grantor, a.grantee, a.privilege_type, a.is_grantable FROM aclexplode(target.initprivs) WITH ORDINALITY a
        ORDER BY a.grantor<>held, a.ordinality LOOP
      grantee := CASE WHEN privilege.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(privilege.grantee)) END;
      EXECUTE format('SET LOCAL ROLE %I',pg_get_userbyid(privilege.grantor));
      EXECUTE format('GRANT %s%s ON %s %s TO %s%s GRANTED BY %I',privilege.privilege_type,columns,kind,base.identity,grantee,
        CASE WHEN privilege.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END,pg_get_userbyid(privilege.grantor));
      RESET ROLE;
    END LOOP;
    -- Anything held beyond them (an owner's default the source's initial privileges leave out, or a grant option) goes.
    FOR privilege IN SELECT a.grantor, a.grantee, a.privilege_type, a.is_grantable
        FROM aclexplode(pg_temp.agentflow_acl(target.classid,target.objid,target.objsubid)) a
        EXCEPT SELECT a.grantor, a.grantee, a.privilege_type, a.is_grantable FROM aclexplode(target.initprivs) a LOOP
      grantee := CASE WHEN privilege.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(privilege.grantee)) END;
      EXECUTE format('SET LOCAL ROLE %I',pg_get_userbyid(privilege.grantor));
      EXECUTE format('REVOKE %s%s%s ON %s %s FROM %s GRANTED BY %I CASCADE',
        CASE WHEN EXISTS (SELECT 1 FROM aclexplode(target.initprivs) a WHERE a.grantor=privilege.grantor
          AND a.grantee=privilege.grantee AND a.privilege_type=privilege.privilege_type) THEN 'GRANT OPTION FOR ' ELSE '' END,
        privilege.privilege_type,columns,kind,base.identity,grantee,pg_get_userbyid(privilege.grantor));
      RESET ROLE;
    END LOOP;
    IF ARRAY(SELECT x::text FROM unnest(pg_temp.agentflow_acl(target.classid,target.objid,target.objsubid)) x ORDER BY x::text COLLATE "C")
        IS DISTINCT FROM ARRAY(SELECT x::text FROM unnest(target.initprivs) x ORDER BY x::text COLLATE "C") THEN
      RAISE EXCEPTION 'The privileges on % %, which is in no extension, could not be made the source''s initial privileges %.',
        ident.type, ident.identity, target.initprivs::text;
    END IF;
    given_privileges := given_privileges+1;
  END LOOP;
  -- The shared dependencies written above, against the source's own reading of them.
  WITH restored_dependencies AS (SELECT jsonb_build_array(s.deptype::text,a.type,a.object_names,a.object_args,pg_get_userbyid(s.refobjid)::text) x
      FROM pg_shdepend s CROSS JOIN LATERAL pg_identify_object_as_address(s.classid,s.objid,s.objsubid) a
      WHERE s.dbid=db AND s.refclassid='pg_authid'::regclass
        AND (s.deptype='i' OR (s.deptype='o' AND s.classid='pg_extension'::regclass))),
    source_dependencies AS (SELECT x FROM jsonb_array_elements(doc->'shared_dependencies') x)
  SELECT d.place, d.x INTO diff FROM (
      SELECT 'only in the source reading' AS place, o.x FROM (SELECT x FROM source_dependencies EXCEPT ALL SELECT x FROM restored_dependencies) o
      UNION ALL SELECT 'only in the restore', o.x FROM (SELECT x FROM restored_dependencies EXCEPT ALL SELECT x FROM source_dependencies) o) d
    ORDER BY d.place, d.x::text COLLATE "C" LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'The restore''s shared dependencies on roles differ from the source reading: % % % % on role % is %.',
      CASE diff.x->>0 WHEN 'o' THEN 'the owner of' ELSE 'an initial privilege of' END, diff.x->>1, diff.x->2, diff.x->3,
      diff.x->>4, diff.place;
  END IF;
  dependencies := jsonb_array_length(doc->'shared_dependencies');
  UPDATE agentflow_extension_ownership SET extensions=changed_extensions,members=changed_members,initial_privileges=recorded,
    privileges_set=given_privileges,shared_dependencies=dependencies;
END $restore$;
SELECT format('Reproduced the source''s extension ownership: %s extensions and %s members given their source owner, %s initial privileges recorded as the source holds them (%s objects in no extension given them as their privileges), and %s shared dependencies on roles matching the source''s.',
  o.extensions,o.members,o.initial_privileges,o.privileges_set,o.shared_dependencies) FROM agentflow_extension_ownership o;
