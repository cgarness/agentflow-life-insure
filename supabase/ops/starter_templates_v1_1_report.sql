-- READ-ONLY PRE/POST FLIGHT for starter templates V1.1. Do not run the seed from this file.
-- Scope: home agency only; only IDs, counts and MD5 row fingerprints are reported.
-- Run each SELECT individually if the client returns only the final result.

-- 1) Existing rows, their scope/type and aggregate counts.
SELECT scope, type, count(*) AS row_count
FROM public.message_templates
WHERE organization_id = 'a0000000-0000-0000-0000-000000000001'::uuid
GROUP BY scope, type ORDER BY scope, type;

-- 2) Per-row fingerprints: save before seed, compare all existing IDs after seed.
SELECT id, scope, type, md5(to_jsonb(t)::text) AS row_fingerprint
FROM public.message_templates AS t
WHERE organization_id = 'a0000000-0000-0000-0000-000000000001'::uuid
ORDER BY id;

-- 3) Name collisions and deterministic starter ID presence.
WITH starter(id, name, type) AS (
  VALUES
    ('a7cba3e3-988e-55d6-9c0e-f0da7b687b20'::uuid, 'New Lead Introduction', 'sms'),
    ('5e9ba44f-37c2-5d25-b6a8-78a5e4b72d66'::uuid, 'First Call Attempt', 'sms'),
    ('666697fa-2e3d-5c38-8028-77e76e7945c2'::uuid, 'Voicemail Follow-Up', 'sms'),
    ('b408a072-e148-5797-a11a-83193cdf864b'::uuid, 'Best Time to Call', 'sms'),
    ('c7f872ab-2c6f-53c7-b326-faa37de5162b'::uuid, 'Quote Follow-Up', 'sms'),
    ('2b1f4a43-f47b-5630-858c-cc811453685c'::uuid, 'Still Interested?', 'sms'),
    ('5845de1d-00d5-5b14-b019-efbd5a02044c'::uuid, 'Old Lead Re-engagement', 'sms'),
    ('a72b7c4a-143f-5047-97b7-55296628f9d7'::uuid, 'Appointment Confirmation', 'sms'),
    ('7ada9299-2b15-5c9c-a3fa-93d032cb163e'::uuid, 'Appointment Reminder', 'sms'),
    ('317b737d-acae-55a7-9542-5a54bdc97312'::uuid, 'Missed Appointment', 'sms'),
    ('3704da88-d196-5a03-b733-b22f9e347547'::uuid, 'Application Information Needed', 'sms'),
    ('01cd7bcb-7a0d-5d8f-b979-f34fcf109240'::uuid, 'Client Coverage Check-In', 'sms'),
    ('8e722a03-ed63-5ecb-9f31-66411c740513'::uuid, 'Meet Your Agent', 'email'),
    ('620043ee-c035-59eb-980b-4adba38ef996'::uuid, 'Appointment Confirmation', 'email'),
    ('9b338928-c1ff-553f-a6f6-3c6818f8f12e'::uuid, 'Quote Follow-Up', 'email'),
    ('2a2614bd-09f3-56de-acd4-5c94a51952ab'::uuid, 'Application Next Steps', 'email'),
    ('bfeb9f44-834a-5d01-ad12-40a9dbe51a6f'::uuid, 'Policy Welcome', 'email'),
    ('d4b904aa-18d4-5811-8b00-e00ae4f86009'::uuid, 'Referral Request', 'email')
)
SELECT s.id AS starter_id, s.type, s.name,
       EXISTS (
         SELECT 1 FROM public.message_templates t
         WHERE t.id = s.id
       ) AS starter_id_exists,
       (SELECT count(*) FROM public.message_templates t
        WHERE t.organization_id = 'a0000000-0000-0000-0000-000000000001'::uuid
          AND t.scope = 'agency'
          AND lower(trim(t.name)) = lower(trim(s.name))
          AND t.type = s.type) AS matching_agency_names
FROM starter s ORDER BY s.type, s.name;

-- 4) Fingerprint of all rows including the seed (for post-flight only).
SELECT count(*) AS total_rows,
       md5(coalesce(string_agg(id::text || ':' || md5(to_jsonb(t)::text), '|' ORDER BY id), '')) AS org_fingerprint
FROM public.message_templates t
WHERE organization_id = 'a0000000-0000-0000-0000-000000000001'::uuid;
