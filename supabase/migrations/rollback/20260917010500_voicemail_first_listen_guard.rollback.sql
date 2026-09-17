-- =====================================================================================================
-- ROLLBACK for M9 (20260917010500_voicemail_first_listen_guard.sql).
-- =====================================================================================================
-- Drops the trigger and its function, restoring M7 behaviour exactly: `listened_at` becomes
-- client-supplied again and can be backdated, future-dated, cleared or reset by any caller the existing
-- `voicemails_update_listened` policy already admits. That is the defect M9 corrects — roll back only
-- deliberately.
--
-- Timestamps already stamped by the trigger are ordinary column values and are LEFT AS THEY ARE: this
-- rollback reads nothing and rewrites nothing. No policy, grant or retention rule is touched, because
-- M9 never changed any of them.

DROP TRIGGER IF EXISTS voicemails_first_listen_guard ON public.voicemails;
DROP FUNCTION IF EXISTS public.voicemails_enforce_first_listen();

COMMENT ON COLUMN public.voicemails.listened_at IS NULL;
