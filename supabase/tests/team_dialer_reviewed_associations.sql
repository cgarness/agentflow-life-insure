-- Explicit SYNTHETIC manager-consent manifest, not a query-derived/guessed historical backfill.
INSERT INTO public.profiles(id,organization_id,role,status,hierarchy_path)
VALUES(team_test.id(22),team_test.id(2),'Admin','Active','foreign.admin');
SELECT team_test.assert((team_test.run(11,1,format('SELECT public.validate_team_queue_association(%L,%L,%L) AS v',team_test.id(301),team_test.id(31),team_test.id(101)),'Admin')->'rows'->0->>'v')::boolean,'explicit review Q301/L101');
SELECT team_test.assert((team_test.run(11,1,format('SELECT public.validate_team_queue_association(%L,%L,%L) AS v',team_test.id(302),team_test.id(31),team_test.id(102)),'Admin')->'rows'->0->>'v')::boolean,'explicit review Q302/L102');
SELECT team_test.assert((team_test.run(11,1,format('SELECT public.validate_team_queue_association(%L,%L,%L) AS v',team_test.id(303),team_test.id(31),team_test.id(103)),'Admin')->'rows'->0->>'v')::boolean,'explicit review Q303/L103');
SELECT team_test.assert((team_test.run(11,1,format('SELECT public.validate_team_queue_association(%L,%L,%L) AS v',team_test.id(304),team_test.id(32),team_test.id(102)),'Admin')->'rows'->0->>'v')::boolean,'explicit review Q304/L102');
SELECT team_test.assert((team_test.run(22,2,format('SELECT public.validate_team_queue_association(%L,%L,%L) AS v',team_test.id(401),team_test.id(34),team_test.id(201)),'Admin')->'rows'->0->>'v')::boolean,'explicit review foreign org Q401/L201');
