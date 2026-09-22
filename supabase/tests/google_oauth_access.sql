-- Read-only privilege assertions; exercised against a disposable DB by test:google.
DO $$
BEGIN
  IF has_column_privilege('authenticated','public.user_email_connections','access_token_encrypted','SELECT')
    OR has_column_privilege('authenticated','public.user_email_connections','refresh_token_encrypted','UPDATE')
    OR has_column_privilege('authenticated','public.calendar_integrations','access_token','SELECT')
    OR has_column_privilege('anon','public.user_email_connections','refresh_token_encrypted','SELECT')
    OR has_table_privilege('authenticated','public.email_oauth_states','SELECT')
    OR has_table_privilege('anon','public.email_sync_cursors','TRUNCATE') THEN RAISE EXCEPTION 'credential privileges remain exposed'; END IF;
  IF NOT has_column_privilege('authenticated','public.user_email_connections','status','SELECT') THEN RAISE EXCEPTION 'safe metadata is unavailable'; END IF;
  IF has_function_privilege('authenticated','public.disconnect_google_oauth(uuid,text,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.complete_google_oauth(uuid,text,text,text,text,text,timestamptz,text)','EXECUTE') THEN RAISE EXCEPTION 'server RPC is exposed'; END IF;
END $$;
