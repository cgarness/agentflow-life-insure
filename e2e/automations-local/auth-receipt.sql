-- The Auth migration ledger as a receipt reading: how many version IDs, the SHA-256 of the sorted IDs each followed by
-- LF (the same bytes auth-versions.sql writes), and when it was read. Read-only; no other Auth data is read.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='5s';
SELECT json_build_object('version_count',count(*),
  'versions_sha256',encode(sha256(convert_to(string_agg(version||chr(10),'' ORDER BY version COLLATE "C"),'UTF8')),'hex'),
  'observed_at',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')) AS auth_reading
FROM auth.schema_migrations;
COMMIT;
