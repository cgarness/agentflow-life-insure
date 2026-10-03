-- DISABLE ONLY. Separate exact production approval required before execution.
-- Retains captured history and never restores unsafe DNC/admission/voice code.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_setting('agentflow.approve_contact_history_disable',true) IS DISTINCT FROM 'yes' THEN
  RAISE EXCEPTION 'Set agentflow.approve_contact_history_disable=yes only after exact release approval';
 END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.get_contact_conversation_page(uuid,text,text,jsonb,integer),
 public.get_contact_activity_page(uuid,text,jsonb,integer),
 public.get_contact_history_page(uuid,text,text,text,jsonb,integer),
 public.contact_history_operational_page(uuid,uuid,text,timestamptz,timestamptz,text,integer) FROM authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['appointments','tasks','contact_notes','leads','clients','recruits','campaign_leads'] LOOP
  EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER contact_history_capture',t);
 END LOOP;
END $$;
COMMIT;
