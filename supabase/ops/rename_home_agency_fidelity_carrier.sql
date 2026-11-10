-- Separate exact production approval required. Configuration only; no policies or financial writes.
-- psql -X -v ON_ERROR_STOP=1 -v fidelity_action=rename -f this_file
-- Recovery requires separate approval: fidelity_action=restore. Missing/unknown action refuses.
\set ON_ERROR_STOP on
\if :{?fidelity_action}
\else
  DO $$ BEGIN RAISE EXCEPTION 'REFUSING: fidelity_action must be explicitly approved as rename or restore' USING ERRCODE = '22023'; END $$;
\endif
SELECT :'fidelity_action' = 'rename' AS rename, :'fidelity_action' = 'restore' AS restore \gset
\if :rename
  \set source_name 'Instabrain'
  \set target_name 'Fidelity'
\elif :restore
  \set source_name 'Fidelity'
  \set target_name 'Instabrain'
\else
  DO $$ BEGIN RAISE EXCEPTION 'REFUSING: unknown fidelity_action' USING ERRCODE = '22023'; END $$;
\endif
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';
-- Prevent concurrent inserts/renames between the collision check and update.
LOCK TABLE public.carriers IN SHARE ROW EXCLUSIVE MODE;
SELECT format($operation$
DO $rename$
DECLARE
  before_row public.carriers%%ROWTYPE;
  after_row public.carriers%%ROWTYPE;
  source_name text := %L;
  target_name text := %L;
  changed integer;
BEGIN
  SELECT * INTO before_row FROM public.carriers
   WHERE id = 'fad9151b-849b-46dc-b34d-d7e17670abbb'
     AND organization_id = 'a0000000-0000-0000-0000-000000000001' FOR UPDATE;
  IF NOT FOUND OR before_row.name NOT IN (source_name, target_name)
     OR md5((to_jsonb(before_row) - 'name' - 'updated_at')::text)
        IS DISTINCT FROM '3d6783e15df06b815d1b2823dc1345bb' THEN
    RAISE EXCEPTION 'Fidelity Settings target or preserved fields changed' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.carriers c WHERE c.organization_id = before_row.organization_id
             AND c.id <> before_row.id AND lower(btrim(c.name)) IN ('instabrain', 'fidelity', 'fidelity life')) THEN
    RAISE EXCEPTION 'Fidelity Settings alias collision' USING ERRCODE = '55000';
  END IF;
  IF before_row.name = target_name THEN
    RAISE NOTICE 'Fidelity Settings action already complete; verified no-op';
    RETURN;
  END IF;
  UPDATE public.carriers SET name = target_name
   WHERE id = before_row.id AND organization_id = before_row.organization_id AND name = source_name;
  GET DIAGNOSTICS changed = ROW_COUNT;
  SELECT * INTO after_row FROM public.carriers WHERE id = before_row.id AND organization_id = before_row.organization_id;
  IF changed <> 1 OR after_row.name IS DISTINCT FROM target_name
     OR (to_jsonb(after_row) - 'name' - 'updated_at') IS DISTINCT FROM (to_jsonb(before_row) - 'name' - 'updated_at') THEN
    RAISE EXCEPTION 'Fidelity Settings preservation check failed' USING ERRCODE = '55000';
  END IF;
END $rename$;
$operation$, :'source_name', :'target_name') \gexec
SELECT id, organization_id, name,
       md5((to_jsonb(c) - 'name' - 'updated_at')::text) AS preserved_fields_md5
  FROM public.carriers c WHERE id = 'fad9151b-849b-46dc-b34d-d7e17670abbb'
    AND organization_id = 'a0000000-0000-0000-0000-000000000001';
COMMIT;
