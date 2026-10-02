-- Synthetic old tabs explicitly release their own unproven locks. NO production cleanup/clamp.
SELECT team_test.assert((team_test.run(13,1,format('SELECT public.release_lead_lock(%L)',team_test.id(302)))->>'ok')::boolean,'old B release payload');
SELECT team_test.assert((team_test.run(12,1,format('SELECT public.release_lead_lock(%L)',team_test.id(304)))->>'ok')::boolean,'old A release payload');
SELECT team_test.assert(NOT EXISTS(SELECT FROM public.dialer_lead_locks WHERE queue_issued_at IS NULL),'synthetic observation window reached zero naturally');
