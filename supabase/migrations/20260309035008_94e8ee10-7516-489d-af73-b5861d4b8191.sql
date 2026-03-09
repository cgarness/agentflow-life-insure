
-- Add "Sold" disposition
INSERT INTO dispositions (id, name, color, sort_order, is_default, require_notes, callback_scheduler, automation_trigger, min_note_chars, usage_count)
VALUES ('aaaaaaaa-0001-0001-0001-000000000001', 'Sold', '#22C55E', 10, false, true, false, false, 10, 0)
ON CONFLICT DO NOTHING;

-- Add "No Answer" disposition
INSERT INTO dispositions (id, name, color, sort_order, is_default, require_notes, callback_scheduler, automation_trigger, min_note_chars, usage_count)
VALUES ('aaaaaaaa-0001-0001-0001-000000000002', 'No Answer', '#9CA3AF', 1, true, false, false, false, 0, 0)
ON CONFLICT DO NOTHING;

-- Add goals
INSERT INTO goals (metric, target_value, period) VALUES
  ('Policies', 10, 'Monthly'),
  ('Appointments', 20, 'Monthly')
ON CONFLICT DO NOTHING;

-- ============ CALLS FOR JUSTIFY (TOP - 15 today, 7-day streak) ============
INSERT INTO calls (agent_id, contact_name, contact_phone, direction, disposition_name, disposition_id, duration, started_at, ended_at) VALUES
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'John Smith', '5551001001', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 512, NOW() - interval '7 hours', NOW() - interval '6 hours 28 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Mary Jones', '5551001002', 'outbound', 'Interested', '5cc83b04-6cd6-41f4-be35-a807914cef98', 340, NOW() - interval '6 hours', NOW() - interval '5 hours 54 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Bob Wilson', '5551001003', 'outbound', 'Not Interested', '72c2fa48-9ad1-464e-a297-34050b9462a4', 120, NOW() - interval '5 hours', NOW() - interval '4 hours 58 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Alice Brown', '5551001004', 'outbound', 'Appointment Set', 'c6c34dd8-20d6-4e4e-8a57-729fc862870c', 290, NOW() - interval '4 hours 30 minutes', NOW() - interval '4 hours 25 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Tom Davis', '5551001005', 'outbound', 'No Answer', 'aaaaaaaa-0001-0001-0001-000000000002', 0, NOW() - interval '4 hours', NOW() - interval '4 hours'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Sue Clark', '5551001006', 'outbound', 'Call Back Later', '6808cfcb-0da8-4010-8855-d5a0fd3e7442', 180, NOW() - interval '3 hours 30 minutes', NOW() - interval '3 hours 27 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Jim White', '5551001007', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 620, NOW() - interval '3 hours', NOW() - interval '2 hours 50 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Pat Green', '5551001008', 'outbound', 'Left Voicemail', 'a2d83b31-9a56-4e2e-8fac-503b25e61d9f', 45, NOW() - interval '2 hours 30 minutes', NOW() - interval '2 hours 29 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Lou Adams', '5551001009', 'outbound', 'Interested', '5cc83b04-6cd6-41f4-be35-a807914cef98', 410, NOW() - interval '2 hours', NOW() - interval '1 hour 53 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Ann Baker', '5551001010', 'outbound', 'Not Interested', '72c2fa48-9ad1-464e-a297-34050b9462a4', 90, NOW() - interval '1 hour 30 minutes', NOW() - interval '1 hour 29 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Ray Hall', '5551001011', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 480, NOW() - interval '1 hour', NOW() - interval '52 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Kim Lee', '5551001012', 'outbound', 'No Answer', 'aaaaaaaa-0001-0001-0001-000000000002', 0, NOW() - interval '50 minutes', NOW() - interval '50 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Dan King', '5551001013', 'outbound', 'Appointment Set', 'c6c34dd8-20d6-4e4e-8a57-729fc862870c', 310, NOW() - interval '40 minutes', NOW() - interval '35 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Eva Ross', '5551001014', 'outbound', 'Interested', '5cc83b04-6cd6-41f4-be35-a807914cef98', 260, NOW() - interval '25 minutes', NOW() - interval '21 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Max Ford', '5551001015', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 540, NOW() - interval '15 minutes', NOW() - interval '6 minutes'),
-- Past 6 days (streak)
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'C1', '5551002001', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 450, NOW() - interval '1 day 3 hours', NOW() - interval '1 day 2 hours 52 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'C2', '5551002002', 'outbound', 'Interested', '5cc83b04-6cd6-41f4-be35-a807914cef98', 320, NOW() - interval '1 day 5 hours', NOW() - interval '1 day 4 hours 55 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'C3', '5551002003', 'outbound', 'No Answer', 'aaaaaaaa-0001-0001-0001-000000000002', 0, NOW() - interval '1 day 6 hours', NOW() - interval '1 day 6 hours'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'C4', '5551002004', 'outbound', 'Not Interested', '72c2fa48-9ad1-464e-a297-34050b9462a4', 150, NOW() - interval '1 day 7 hours', NOW() - interval '1 day 6 hours 57 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'C5', '5551002005', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 510, NOW() - interval '1 day 8 hours', NOW() - interval '1 day 7 hours 51 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'C6', '5551002006', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 600, NOW() - interval '2 days 5 hours', NOW() - interval '2 days 4 hours 50 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'C7', '5551002007', 'outbound', 'No Answer', 'aaaaaaaa-0001-0001-0001-000000000002', 0, NOW() - interval '2 days 6 hours', NOW() - interval '2 days 6 hours'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'C8', '5551002008', 'outbound', 'Call Back Later', '6808cfcb-0da8-4010-8855-d5a0fd3e7442', 200, NOW() - interval '2 days 7 hours', NOW() - interval '2 days 6 hours 57 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'C9', '5551002009', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 470, NOW() - interval '3 days 5 hours', NOW() - interval '3 days 4 hours 52 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'C10', '5551002010', 'outbound', 'Interested', '5cc83b04-6cd6-41f4-be35-a807914cef98', 290, NOW() - interval '4 days 3 hours', NOW() - interval '4 days 2 hours 55 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'C11', '5551002011', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 530, NOW() - interval '4 days 5 hours', NOW() - interval '4 days 4 hours 51 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'C12', '5551002012', 'outbound', 'Left Voicemail', 'a2d83b31-9a56-4e2e-8fac-503b25e61d9f', 40, NOW() - interval '5 days 3 hours', NOW() - interval '5 days 2 hours 59 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'C13', '5551002013', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 490, NOW() - interval '5 days 5 hours', NOW() - interval '5 days 4 hours 52 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'C14', '5551002014', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 550, NOW() - interval '6 days 5 hours', NOW() - interval '6 days 4 hours 51 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'O1', '5551003001', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 480, NOW() - interval '10 days', NOW() - interval '10 days' + interval '8 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'O2', '5551003002', 'outbound', 'Not Interested', '72c2fa48-9ad1-464e-a297-34050b9462a4', 90, NOW() - interval '14 days', NOW() - interval '14 days' + interval '2 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'O3', '5551003003', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 520, NOW() - interval '18 days', NOW() - interval '18 days' + interval '9 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'O4', '5551003004', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 600, NOW() - interval '22 days', NOW() - interval '22 days' + interval '10 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'O5', '5551003005', 'outbound', 'No Answer', 'aaaaaaaa-0001-0001-0001-000000000002', 0, NOW() - interval '25 days', NOW() - interval '25 days');

-- ============ CALLS FOR test testi (MID - 6 today) ============
INSERT INTO calls (agent_id, contact_name, contact_phone, direction, disposition_name, disposition_id, duration, started_at, ended_at) VALUES
('2e27f7ec-24d0-4295-901b-1dd9be416c74', 'Paula Reed', '5552001001', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 480, NOW() - interval '6 hours', NOW() - interval '5 hours 52 minutes'),
('2e27f7ec-24d0-4295-901b-1dd9be416c74', 'Carl Ward', '5552001002', 'outbound', 'Interested', '5cc83b04-6cd6-41f4-be35-a807914cef98', 310, NOW() - interval '5 hours', NOW() - interval '4 hours 55 minutes'),
('2e27f7ec-24d0-4295-901b-1dd9be416c74', 'Diane Fox', '5552001003', 'outbound', 'No Answer', 'aaaaaaaa-0001-0001-0001-000000000002', 0, NOW() - interval '4 hours', NOW() - interval '4 hours'),
('2e27f7ec-24d0-4295-901b-1dd9be416c74', 'Earl Hunt', '5552001004', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 550, NOW() - interval '3 hours', NOW() - interval '2 hours 51 minutes'),
('2e27f7ec-24d0-4295-901b-1dd9be416c74', 'Faye Cole', '5552001005', 'outbound', 'Not Interested', '72c2fa48-9ad1-464e-a297-34050b9462a4', 140, NOW() - interval '2 hours', NOW() - interval '1 hour 58 minutes'),
('2e27f7ec-24d0-4295-901b-1dd9be416c74', 'Glen Nash', '5552001006', 'outbound', 'Appointment Set', 'c6c34dd8-20d6-4e4e-8a57-729fc862870c', 280, NOW() - interval '1 hour', NOW() - interval '55 minutes'),
('2e27f7ec-24d0-4295-901b-1dd9be416c74', 'M1', '5552002001', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 500, NOW() - interval '1 day 4 hours', NOW() - interval '1 day 3 hours 52 minutes'),
('2e27f7ec-24d0-4295-901b-1dd9be416c74', 'M2', '5552002002', 'outbound', 'No Answer', 'aaaaaaaa-0001-0001-0001-000000000002', 0, NOW() - interval '2 days 3 hours', NOW() - interval '2 days 3 hours'),
('2e27f7ec-24d0-4295-901b-1dd9be416c74', 'M3', '5552002003', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 460, NOW() - interval '3 days 5 hours', NOW() - interval '3 days 4 hours 52 minutes'),
('2e27f7ec-24d0-4295-901b-1dd9be416c74', 'M4', '5552002004', 'outbound', 'Not Interested', '72c2fa48-9ad1-464e-a297-34050b9462a4', 130, NOW() - interval '5 days 4 hours', NOW() - interval '5 days 3 hours 58 minutes'),
('2e27f7ec-24d0-4295-901b-1dd9be416c74', 'M5', '5552002005', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 520, NOW() - interval '8 days', NOW() - interval '8 days' + interval '9 minutes'),
('2e27f7ec-24d0-4295-901b-1dd9be416c74', 'M6', '5552002006', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 490, NOW() - interval '14 days', NOW() - interval '14 days' + interval '8 minutes'),
('2e27f7ec-24d0-4295-901b-1dd9be416c74', 'M7', '5552002007', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 550, NOW() - interval '21 days', NOW() - interval '21 days' + interval '9 minutes');

-- ============ CALLS FOR unnamed agent (LOWER - 2 today) ============
INSERT INTO calls (agent_id, contact_name, contact_phone, direction, disposition_name, disposition_id, duration, started_at, ended_at) VALUES
('41dfbbcf-3d24-4ab4-81a3-b8988d28c21c', 'Uma Vega', '5553001001', 'outbound', 'No Answer', 'aaaaaaaa-0001-0001-0001-000000000002', 0, NOW() - interval '4 hours', NOW() - interval '4 hours'),
('41dfbbcf-3d24-4ab4-81a3-b8988d28c21c', 'Vic Webb', '5553001002', 'outbound', 'Interested', '5cc83b04-6cd6-41f4-be35-a807914cef98', 250, NOW() - interval '2 hours', NOW() - interval '1 hour 56 minutes'),
('41dfbbcf-3d24-4ab4-81a3-b8988d28c21c', 'D1', '5553002001', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 460, NOW() - interval '2 days 3 hours', NOW() - interval '2 days 2 hours 52 minutes'),
('41dfbbcf-3d24-4ab4-81a3-b8988d28c21c', 'D2', '5553002002', 'outbound', 'No Answer', 'aaaaaaaa-0001-0001-0001-000000000002', 0, NOW() - interval '5 days 5 hours', NOW() - interval '5 days 5 hours'),
('41dfbbcf-3d24-4ab4-81a3-b8988d28c21c', 'D3', '5553002003', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 500, NOW() - interval '10 days', NOW() - interval '10 days' + interval '8 minutes'),
('41dfbbcf-3d24-4ab4-81a3-b8988d28c21c', 'D4', '5553002004', 'outbound', 'Not Interested', '72c2fa48-9ad1-464e-a297-34050b9462a4', 90, NOW() - interval '15 days', NOW() - interval '15 days' + interval '2 minutes'),
('41dfbbcf-3d24-4ab4-81a3-b8988d28c21c', 'D5', '5553002005', 'outbound', 'Sold', 'aaaaaaaa-0001-0001-0001-000000000001', 470, NOW() - interval '20 days', NOW() - interval '20 days' + interval '8 minutes');

-- ============ WINS ============
INSERT INTO wins (agent_id, agent_name, contact_name, policy_type, celebrated, created_at) VALUES
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Justify Kotelnycky', 'John Smith', 'Term Life', false, NOW() - interval '7 hours'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Justify Kotelnycky', 'Jim White', 'Whole Life', false, NOW() - interval '3 hours'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Justify Kotelnycky', 'Ray Hall', 'Term Life', false, NOW() - interval '1 hour'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Justify Kotelnycky', 'Max Ford', 'IUL', false, NOW() - interval '15 minutes'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Justify Kotelnycky', 'C1', 'Term Life', false, NOW() - interval '1 day 3 hours'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Justify Kotelnycky', 'C5', 'Whole Life', false, NOW() - interval '1 day 8 hours'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Justify Kotelnycky', 'C6', 'Term Life', false, NOW() - interval '2 days 5 hours'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Justify Kotelnycky', 'C9', 'IUL', false, NOW() - interval '3 days 5 hours'),
('2e27f7ec-24d0-4295-901b-1dd9be416c74', 'test testi', 'Paula Reed', 'Term Life', false, NOW() - interval '6 hours'),
('2e27f7ec-24d0-4295-901b-1dd9be416c74', 'test testi', 'Earl Hunt', 'Whole Life', false, NOW() - interval '3 hours'),
('2e27f7ec-24d0-4295-901b-1dd9be416c74', 'test testi', 'M1', 'IUL', false, NOW() - interval '1 day 4 hours'),
('2e27f7ec-24d0-4295-901b-1dd9be416c74', 'test testi', 'M3', 'Term Life', false, NOW() - interval '3 days 5 hours'),
('41dfbbcf-3d24-4ab4-81a3-b8988d28c21c', 'Agent', 'D1', 'Term Life', false, NOW() - interval '2 days 3 hours'),
('41dfbbcf-3d24-4ab4-81a3-b8988d28c21c', 'Agent', 'D3', 'IUL', false, NOW() - interval '10 days');

-- ============ APPOINTMENTS ============
INSERT INTO appointments (user_id, title, contact_name, type, status, start_time, end_time, created_by) VALUES
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Policy Review - Alice Brown', 'Alice Brown', 'Sales Call', 'Scheduled', NOW() + interval '1 day 10 hours', NOW() + interval '1 day 11 hours', '9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Follow-up - Dan King', 'Dan King', 'Follow Up', 'Scheduled', NOW() + interval '2 days 14 hours', NOW() + interval '2 days 15 hours', '9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Presentation - C10', 'C10', 'Sales Call', 'Completed', NOW() - interval '1 day 10 hours', NOW() - interval '1 day 9 hours', '9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f'),
('2e27f7ec-24d0-4295-901b-1dd9be416c74', 'Needs Analysis - Glen Nash', 'Glen Nash', 'Sales Call', 'Scheduled', NOW() + interval '1 day 14 hours', NOW() + interval '1 day 15 hours', '2e27f7ec-24d0-4295-901b-1dd9be416c74'),
('2e27f7ec-24d0-4295-901b-1dd9be416c74', 'Follow-up - M7', 'M7', 'Follow Up', 'Completed', NOW() - interval '2 days 10 hours', NOW() - interval '2 days 9 hours', '2e27f7ec-24d0-4295-901b-1dd9be416c74'),
('41dfbbcf-3d24-4ab4-81a3-b8988d28c21c', 'Intro Call - Vic Webb', 'Vic Webb', 'Sales Call', 'Scheduled', NOW() + interval '1 day 11 hours', NOW() + interval '1 day 12 hours', '41dfbbcf-3d24-4ab4-81a3-b8988d28c21c');

-- ============ DIALER SESSIONS (Power and Predictive only) ============
INSERT INTO dialer_sessions (agent_id, campaign_name, mode, calls_made, calls_connected, policies_sold, total_talk_time, started_at, ended_at) VALUES
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Term Life Q1', 'Power', 15, 12, 4, 4657, NOW() - interval '8 hours', NOW() - interval '1 hour'),
('9cd39219-a0b9-4b0c-b8d1-4b5c7a39fc8f', 'Term Life Q1', 'Power', 10, 8, 3, 3200, NOW() - interval '1 day 8 hours', NOW() - interval '1 day 1 hour'),
('2e27f7ec-24d0-4295-901b-1dd9be416c74', 'Whole Life Push', 'Power', 6, 5, 2, 1760, NOW() - interval '7 hours', NOW() - interval '1 hour'),
('2e27f7ec-24d0-4295-901b-1dd9be416c74', 'Whole Life Push', 'Predictive', 4, 3, 1, 1100, NOW() - interval '1 day 7 hours', NOW() - interval '1 day 2 hours'),
('41dfbbcf-3d24-4ab4-81a3-b8988d28c21c', 'FE Campaign', 'Predictive', 2, 1, 0, 250, NOW() - interval '5 hours', NOW() - interval '2 hours');
