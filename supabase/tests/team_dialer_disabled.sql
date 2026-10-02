SELECT team_test.assert(NOT has_function_privilege('authenticated','public.get_team_dialer_lead_details(uuid)','EXECUTE'),'display disabled');
SELECT team_test.assert(team_test.run(12,1,format('SELECT public.get_team_dialer_lead_details(%L)',team_test.id(301)))->>'state'='42501','disabled reader fails closed');
SELECT team_test.assert(NOT has_function_privilege('anon','public.claim_lead(uuid,uuid,uuid)','EXECUTE'),'recovery leaves anonymous claim sealed');
SELECT team_test.assert(NOT has_table_privilege('authenticated','public.campaign_leads','INSERT'),'recovery never restores forged association writes');
SELECT team_test.assert(NOT has_table_privilege('authenticated','public.dialer_lead_locks','TRUNCATE'),'recovery never restores queue truncate');
SELECT team_test.assert(team_test.run(12,1,format('SELECT public.claim_lead(%L,%L,%L)',team_test.id(301),team_test.id(106),team_test.id(31)))->>'state'='42501','recovery never restores takeover claim');
SELECT 'PASS fail-closed display disable, claim protections retained' AS result;
