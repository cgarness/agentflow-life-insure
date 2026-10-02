SELECT team_test.assert((SELECT count(*)=0 FROM private.team_queue_associations),'no guessed legacy backfill');
SELECT team_test.assert(team_test.run(12,1,format('SELECT public.validate_team_queue_association(%L,%L,%L)',team_test.id(301),team_test.id(31),team_test.id(101)))->>'state'='42501','ordinary participant cannot validate legacy association');
SELECT team_test.assert(team_test.run(14,1,format('SELECT public.validate_team_queue_association(%L,%L,%L)',team_test.id(301),team_test.id(31),team_test.id(101)),'Admin')->>'state'='42501','JWT role spoof cannot validate');
SELECT team_test.assert(team_test.run(11,1,format('SELECT public.validate_team_queue_association(%L,%L,%L)',team_test.id(301),team_test.id(31),team_test.id(102)))->>'state'='42501','manager expected master binding refuses substitution');
SELECT team_test.assert(team_test.run(11,1,format('SELECT public.validate_team_queue_association(%L,%L,%L)',team_test.id(401),team_test.id(34),team_test.id(201)))->>'state'='42501','foreign association refused');
SELECT team_test.assert((team_test.run(11,1,format('SELECT public.validate_team_queue_association(%L,%L,%L) AS v',team_test.id(301),team_test.id(31),team_test.id(101)),'Admin')->'rows'->0->>'v')::boolean,'manager approves exact current association');
CREATE TABLE team_test.validation_preimage AS SELECT * FROM private.team_queue_associations;
SELECT team_test.assert((team_test.run(11,1,format('SELECT public.validate_team_queue_association(%L,%L,%L) AS v',team_test.id(301),team_test.id(31),team_test.id(101)),'Admin')->'rows'->0->>'v')::boolean,'validation idempotent');
SELECT team_test.assert(NOT EXISTS((SELECT * FROM private.team_queue_associations EXCEPT SELECT * FROM team_test.validation_preimage)
  UNION ALL (SELECT * FROM team_test.validation_preimage EXCEPT SELECT * FROM private.team_queue_associations)),'idempotence preserves metadata');
SELECT team_test.assert(team_test.run(12,1,'SELECT * FROM private.team_queue_associations')->>'state'='42501','ledger client-unreachable');
-- Trusted new attachment; counts/keys remain compatible with old clients.
SELECT team_test.assert((team_test.run(11,1,format('SELECT public.add_leads_to_campaign(%L,ARRAY[%L]::uuid[],NULL) AS v',team_test.id(31),team_test.id(105)),'Admin')->'rows'->0->'v'->>'added')::int=1,'manager attachment succeeds');
SELECT team_test.assert((SELECT count(*)=1 FROM private.team_queue_associations WHERE campaign_id=team_test.id(31) AND lead_id=team_test.id(105) AND validation_source='attachment'),'new authorized attachment stamps exact proof');
SELECT team_test.assert((team_test.run(12,1,format('SELECT public.add_leads_to_campaign(%L,ARRAY[%L]::uuid[],NULL) AS v',team_test.id(31),team_test.id(104)))->'rows'->0->'v'->>'added')::int=1,'Team agent attaches own readable lead');
SELECT team_test.assert((team_test.run(12,1,format('SELECT public.add_leads_to_campaign(%L,ARRAY[%L]::uuid[],NULL) AS v',team_test.id(31),team_test.id(103)))->'rows'->0->'v'->>'skipped_ineligible')::int=1,'Team participant cannot attach another private book');
SELECT team_test.assert(team_test.run(12,1,format('SELECT public.add_leads_to_campaign(%L,ARRAY[%L]::uuid[],NULL)',team_test.id(32),team_test.id(104)))->>'state'='42501','Open Pool attachment is not organization-wide write authority');
SELECT team_test.assert((team_test.run(11,1,format('SELECT public.add_leads_to_campaign(%L,ARRAY[%L]::uuid[],NULL) AS v',team_test.id(32),team_test.id(105)),'Admin')->'rows'->0->'v'->>'added')::int=1,'Open Pool manager attachment preserved');
SELECT team_test.assert((team_test.run(11,1,format('SELECT public.add_leads_to_campaign(%L,ARRAY[%L]::uuid[],NULL) AS v',team_test.id(31),team_test.id(102)),'Admin')->'rows'->0->'v'->>'skipped_already_present')::int=1,'already-present response preserved');
SELECT team_test.assert(NOT EXISTS(SELECT FROM private.team_queue_associations WHERE campaign_lead_id=team_test.id(302)),'ordinary retry does not auto-prove old association');
-- During P1B the old client identity policy still exists: every identity change invalidates proof.
INSERT INTO public.leads(id,organization_id,user_id,first_name) VALUES(team_test.id(106),team_test.id(1),team_test.id(11),'Synthetic Repoint');
SELECT team_test.assert((team_test.run(12,1,format('WITH x AS (UPDATE public.campaign_leads SET lead_id=%L WHERE id=%L RETURNING id) SELECT id FROM x',team_test.id(106),team_test.id(301)))->>'ok')::boolean,'P1B does not prematurely change old client UPDATE authority');
SELECT team_test.assert(NOT EXISTS(SELECT FROM private.team_queue_associations WHERE campaign_lead_id=team_test.id(301)),'repoint invalidates old proof atomically');
SELECT team_test.assert(team_test.run(11,1,format('SELECT public.validate_team_queue_association(%L,%L,%L)',team_test.id(301),team_test.id(31),team_test.id(101)),'Admin')->>'state'='42501','reviewed old binding cannot approve a repointed row');
UPDATE public.campaign_leads SET lead_id=team_test.id(101) WHERE id=team_test.id(301); -- synthetic fixture restore
SELECT team_test.assert(team_test.run(15,1,format('SELECT public.validate_team_queue_association(%L,%L,%L)',team_test.id(303),team_test.id(31),team_test.id(103)),'Team Leader')->>'state'='42501','Team Leader private source scope fails closed');
SELECT 'PASS association provenance, trusted writers and expected-ID manager consent' AS result;
