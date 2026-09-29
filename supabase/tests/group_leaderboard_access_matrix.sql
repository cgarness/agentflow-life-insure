-- =====================================================================================================
-- Group leaderboard ACCESS DIFFERENTIAL (runner step 6). Prints one "MATRIX" line per caller/period scenario:
-- the outcome and a fingerprint of every column EXCEPT appointments_set. The runner runs it on the PRE-repair
-- function (with conflict_mode=use_column, the reading the membership check always intended — without it every
-- call is 42702) and on the REPAIRED function (with conflict_mode=error, production) and requires IDENTICAL output:
-- the 42702 fix changes no membership decision, roster, period, call, talk-time, policy or ordering result.
-- Needs group_leaderboard_seed.sql loaded. Disposable LOCAL PostgreSQL only (AGENT_RULES #28).
-- =====================================================================================================
\set ON_ERROR_STOP 1
SET plpgsql.variable_conflict = :conflict_mode;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated","app_metadata":{"organization_id":"10000000-0000-4000-8000-000000000001"}}', false) \gset
SELECT gt.probe('A member today', 'today') \gset
SELECT gt.probe('A member week', 'week') \gset
SELECT gt.probe('A member month', 'month') \gset
SELECT gt.probe('A member quarter', 'quarter') \gset
SELECT gt.probe('A member year', 'year') \gset
SELECT gt.probe('A member unknown period', 'fortnight') \gset
SELECT gt.probe('A member NULL period', NULL) \gset
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000c","role":"authenticated","app_metadata":{"organization_id":"10000000-0000-4000-8000-000000000002"}}', false) \gset
SELECT gt.probe('C second member org', 'month') \gset
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000d","role":"authenticated","app_metadata":{"organization_id":"10000000-0000-4000-8000-000000000003"}}', false) \gset
SELECT gt.probe('X invited org', 'month') \gset
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000010","role":"authenticated","app_metadata":{"organization_id":"10000000-0000-4000-8000-000000000004"}}', false) \gset
SELECT gt.probe('D other group', 'month') \gset
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000011","role":"authenticated","app_metadata":{"organization_id":"10000000-0000-4000-8000-000000000005"}}', false) \gset
SELECT gt.probe('E status Active', 'month') \gset
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', false) \gset
SELECT gt.probe('A profile fallback', 'month') \gset
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated","app_metadata":{"organization_id":"10000000-0000-4000-8000-000000000009"}}', false) \gset
SELECT gt.probe('A forged unknown org claim', 'month') \gset
RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false) \gset
SELECT gt.probe('anon', 'month') \gset
RESET ROLE;
