-- Guard-only rollback. This file is NOT authorized for production execution.
-- Set the exact approved organization in this transaction before executing:
-- SELECT set_config('agentflow.sticky_release_org','<approved UUID>',true);
DO $$
DECLARE org uuid := nullif(current_setting('agentflow.sticky_release_org',true),'')::uuid;
BEGIN
 IF org IS NULL THEN RAISE EXCEPTION 'Exact approved organization is required';END IF;
 PERFORM public.set_contact_number_modes(org,'guard_only','guard_only');
 -- No deletion, restoration of legacy function bodies, pin clearing or send resubmission.
END $$;
