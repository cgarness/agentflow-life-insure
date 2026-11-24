-- The Auth migration version IDs, one per line in C order. Read-only; no other Auth data is read.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='5s';
DO $$
BEGIN
  IF EXISTS (SELECT FROM auth.schema_migrations WHERE version IS NULL OR version !~ '^(00|[0-9]{14})$')
     OR (SELECT count(*) <> count(DISTINCT version) OR count(*)=0 FROM auth.schema_migrations) THEN
    RAISE EXCEPTION 'Unexpected Auth migration version format or duplicates';
  END IF;
END $$;
SELECT version FROM auth.schema_migrations ORDER BY version COLLATE "C";
COMMIT;
