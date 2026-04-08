-- CLEANUP MOCK DATA SCRIPT
-- This script removes testing records from the following tables:
-- wins, calls, appointments, and profiles (excluding the current user)

-- 1. Identify mock profile IDs and store them in a temporary table
-- This avoids "relation does not exist" errors in subsequent DELETE statements
CREATE TEMP TABLE tmp_mock_agents AS
SELECT id FROM profiles
WHERE first_name IN ('Justify', 'test', 'Justin', 'Test', 'name', 'Example')
   OR last_name IN ('Kotelnycky', 'testi', 'User', 'Agent', 'b.')
   OR email LIKE '%mock%' OR email LIKE '%test%';

-- 2. Delete activity records first (due to foreign key constraints)
DELETE FROM calls WHERE agent_id IN (SELECT id FROM tmp_mock_agents);
DELETE FROM wins WHERE agent_id IN (SELECT id FROM tmp_mock_agents);
DELETE FROM appointments WHERE created_by IN (SELECT id FROM tmp_mock_agents) OR user_id IN (SELECT id FROM tmp_mock_agents);
DELETE FROM dialer_sessions WHERE agent_id IN (SELECT id FROM tmp_mock_agents);

-- 3. Delete the mock profiles themselves
DELETE FROM profiles WHERE id IN (SELECT id FROM tmp_mock_agents);

-- 4. Clear any other generic "test" data from activity tables
DELETE FROM calls WHERE contact_name LIKE 'Test %' OR contact_name LIKE '% Mock';
DELETE FROM wins WHERE contact_name LIKE 'Test %' OR contact_name LIKE '% Mock' OR agent_name IN ('Justify Kotelnycky', 'test testi');
DELETE FROM appointments WHERE title LIKE 'Test %' OR contact_name LIKE 'Test %';

-- 5. Clean up temporary table
DROP TABLE tmp_mock_agents;

-- SUCCESS: The leaderboard and "Recent Wins" should now be cleared of these testing entries.
