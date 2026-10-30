-- AgentFlow starter templates v1.1 — DRAFT / REVIEW ONLY, NOT EXECUTED.
-- Insert-only; home organization only; no existing rows overwritten or deleted.
-- Requires explicit production approval by Chris before execution.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('agentflow_starter_templates_v1_home_org'));
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = 'a0000000-0000-0000-0000-000000000001'::uuid) THEN
    RAISE EXCEPTION 'Target organization not found. Nothing seeded.';
  END IF;
END
$check$;
WITH starter (id, name, type, subject, content, category, sms_purpose) AS (
  VALUES
    ('a7cba3e3-988e-55d6-9c0e-f0da7b687b20'::uuid, 'New Lead Introduction', 'sms', NULL, 'Hi {{contact_first_name}}, this is {{agent_first_name}} with {{agency_name}}. I received your request for life insurance information and can help you review your options. Is now a good time for a quick call? Reply STOP to opt out.', 'Prospecting', 'marketing'),
    ('5e9ba44f-37c2-5d25-b6a8-78a5e4b72d66'::uuid, 'First Call Attempt', 'sms', NULL, 'Hi {{contact_first_name}}, {{agent_first_name}} with {{agency_name}} here. I just tried calling about the life insurance information you requested. Is later today or tomorrow better to connect? Reply STOP to opt out.', 'Follow-Up', 'marketing'),
    ('666697fa-2e3d-5c38-8028-77e76e7945c2'::uuid, 'Voicemail Follow-Up', 'sms', NULL, 'Hi {{contact_first_name}}, this is {{agent_first_name}} with {{agency_name}}. I left you a voicemail about your life insurance request. You can reply here with a good time to talk. Reply STOP to opt out.', 'Follow-Up', 'marketing'),
    ('b408a072-e148-5797-a11a-83193cdf864b'::uuid, 'Best Time to Call', 'sms', NULL, 'Hi {{contact_first_name}}, this is {{agent_first_name}} with {{agency_name}}. What''s the best time for a brief call about the life insurance options you asked about? Reply STOP to opt out.', 'Prospecting', 'marketing'),
    ('c7f872ab-2c6f-53c7-b326-faa37de5162b'::uuid, 'Quote Follow-Up', 'sms', NULL, 'Hi {{contact_first_name}}, it''s {{agent_first_name}} with {{agency_name}}. Following up on the life insurance options we discussed. Would you like to review the quote together or ask any questions? Reply STOP to opt out.', 'Follow-Up', 'marketing'),
    ('2b1f4a43-f47b-5630-858c-cc811453685c'::uuid, 'Still Interested?', 'sms', NULL, 'Hi {{contact_first_name}}, {{agent_first_name}} with {{agency_name}} checking in. Are you still interested in reviewing life insurance options, or would you prefer I close out my follow-up? Reply STOP to opt out.', 'Follow-Up', 'marketing'),
    ('5845de1d-00d5-5b14-b019-efbd5a02044c'::uuid, 'Old Lead Re-engagement', 'sms', NULL, 'Hi {{contact_first_name}}, this is {{agent_first_name}} with {{agency_name}}. We spoke previously about life insurance options. If you''d like to revisit coverage, would a short call be useful? Reply STOP to opt out.', 'Re-Engagement', 'marketing'),
    ('a72b7c4a-143f-5047-97b7-55296628f9d7'::uuid, 'Appointment Confirmation', 'sms', NULL, 'Hi {{contact_first_name}}, it''s {{agent_first_name}} with {{agency_name}}. Confirming our scheduled life insurance call. Please reply to confirm or let me know if you need to reschedule.', 'Appointment', 'informational'),
    ('7ada9299-2b15-5c9c-a3fa-93d032cb163e'::uuid, 'Appointment Reminder', 'sms', NULL, 'Hi {{contact_first_name}}, {{agent_first_name}} with {{agency_name}} here. Just a reminder about our scheduled life insurance call. Looking forward to speaking with you!', 'Appointment', 'informational'),
    ('317b737d-acae-55a7-9542-5a54bdc97312'::uuid, 'Missed Appointment', 'sms', NULL, 'Hi {{contact_first_name}}, it''s {{agent_first_name}} with {{agency_name}}. Looks like we missed each other for our scheduled call. Would you like to reschedule for later today or another day?', 'Appointment', 'informational'),
    ('3704da88-d196-5a03-b733-b22f9e347547'::uuid, 'Application Information Needed', 'sms', NULL, 'Hi {{contact_first_name}}, this is {{agent_first_name}} with {{agency_name}}. I have a question about the application we discussed. When would be a good time to call? No sensitive details needed by text.', 'Closing', 'informational'),
    ('01cd7bcb-7a0d-5d8f-b979-f34fcf109240'::uuid, 'Client Coverage Check-In', 'sms', NULL, 'Hi {{contact_first_name}}, {{agent_first_name}} with {{agency_name}} here. Just checking in about your existing life insurance policy. Any coverage or policy questions I can help with?', 'Follow-Up', 'informational'),
    ('8e722a03-ed63-5ecb-9f31-66411c740513'::uuid, 'Meet Your Agent', 'email', 'Your life insurance request — meet your agent', 'Hi {{contact_first_name}},

Thank you for requesting information about life insurance. I''m {{agent_first_name}} {{agent_last_name}} with {{agency_name}}, and I''ll be your point of contact.

My goal is to help you understand available coverage options, answer your questions, and find an option that fits your needs and budget.

When would be a convenient time for a brief phone call? You can reply to this email or call me directly.

Best,
{{agent_first_name}} {{agent_last_name}}
{{agency_name}}
{{agent_phone}}
{{agent_email}}', 'Prospecting', NULL),
    ('620043ee-c035-59eb-980b-4adba38ef996'::uuid, 'Appointment Confirmation', 'email', 'Confirming your scheduled life insurance call', 'Hi {{contact_first_name}},

I''m confirming our upcoming scheduled call to discuss your life insurance options.

We''ll review your goals, discuss coverage options, and answer your questions. If you need a reminder of the date or time, or you need to reschedule, please reply to this email.

Talk soon,
{{agent_first_name}} {{agent_last_name}}
{{agency_name}}
{{agent_phone}}', 'Appointment', NULL),
    ('9b338928-c1ff-553f-a6f6-3c6818f8f12e'::uuid, 'Quote Follow-Up', 'email', 'Questions about your life insurance options?', 'Hi {{contact_first_name}},

I wanted to follow up on the life insurance quote and coverage options we discussed.

Choosing coverage is an important decision, and I''m happy to walk through the benefits, premiums, and any questions before you decide. Final availability, rates, and policy terms depend on the insurer and its review.

Would you like to set up a quick call to go through the details?

Best,
{{agent_first_name}} {{agent_last_name}}
{{agency_name}}
{{agent_phone}}
{{agent_email}}', 'Follow-Up', NULL),
    ('2a2614bd-09f3-56de-acd4-5c94a51952ab'::uuid, 'Application Next Steps', 'email', 'Next steps for your life insurance application', 'Hi {{contact_first_name}},

Thank you for taking the time to complete the next steps in your life insurance application.

Depending on the carrier''s requirements, we may need to confirm additional information or complete another step before the insurer makes a decision. I''ll keep you informed as updates become available.

For your privacy, please don''t send Social Security numbers, payment details, or sensitive medical information in an ordinary email reply. We can use the carrier''s approved secure process if anything sensitive is needed.

Please let me know if you have any questions.

Best,
{{agent_first_name}} {{agent_last_name}}
{{agency_name}}
{{agent_phone}}
{{agent_email}}', 'Closing', NULL),
    ('bfeb9f44-834a-5d01-ad12-40a9dbe51a6f'::uuid, 'Policy Welcome', 'email', 'Welcome — important information about your policy', 'Hi {{contact_first_name}},

Thank you for trusting me to help with your life insurance coverage.

Please review the policy documents sent by your insurance carrier. Those documents are the official source for your coverage amount, premium, effective date, and any policy terms or conditions.

If you have trouble finding the documents or want to review anything together, please reply or call me. I''m happy to help.

Thank you again,
{{agent_first_name}} {{agent_last_name}}
{{agency_name}}
{{agent_phone}}
{{agent_email}}', 'Closing', NULL),
    ('d4b904aa-18d4-5811-8b00-e00ae4f86009'::uuid, 'Referral Request', 'email', 'Know someone who has life insurance questions?', 'Hi {{contact_first_name}},

I appreciate the opportunity to help you with your life insurance needs.

If a friend or family member is looking into life insurance and would like to speak with an agent, you''re welcome to share my contact information with them. They can reach out whenever they''re ready.

There''s no pressure, and I won''t contact anyone unless they ask to connect.

Thanks again,
{{agent_first_name}} {{agent_last_name}}
{{agency_name}}
{{agent_phone}}
{{agent_email}}', 'Follow-Up', NULL)
)
INSERT INTO public.message_templates
  (id, organization_id, name, type, subject, content, category, sms_purpose, scope, created_by, attachments)
SELECT
  s.id, 'a0000000-0000-0000-0000-000000000001'::uuid, s.name, s.type, s.subject, s.content, s.category, s.sms_purpose,
  'agency', NULL, '[]'::jsonb
FROM starter s
WHERE NOT EXISTS (
  SELECT 1 FROM public.message_templates existing
  WHERE existing.organization_id = 'a0000000-0000-0000-0000-000000000001'::uuid
    AND existing.scope = 'agency'
    AND lower(trim(existing.name)) = lower(trim(s.name))
    AND existing.type = s.type
)
ON CONFLICT (id) DO NOTHING;
COMMIT;