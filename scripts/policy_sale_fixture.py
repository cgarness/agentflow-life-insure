"""Build a disposable SQL fixture with verbatim production table/function definitions.
No production URL is accepted. Used by both PostgreSQL CI and the embedded local fallback.
"""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
base = (root / 'supabase/migrations/20260806000000_baseline_production_schema.sql').read_text()

def block(source, header, terminator):
    start = source.index(header)
    end = source.index(terminator, start) + len(terminator)
    return source[start:end]

print('''CREATE EXTENSION ltree;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth,public TO authenticated,anon,service_role;
''')
for table in ['profiles','organizations','clients','leads','wins','campaigns','campaign_leads','contact_notes',
              'contact_activities','appointments','tasks','calls','messages','contact_emails','workflow_executions']:
    print(block(base, f'CREATE TABLE IF NOT EXISTS "public"."{table}" (', '\n);'))
    print(f'ALTER TABLE public.{table} ADD PRIMARY KEY (id);')
for fn in ['get_org_id','is_ancestor_of']:
    print(block(base, f'CREATE OR REPLACE FUNCTION "public"."{fn}"(', '\n$$;'))
sold = (root/'supabase/migrations/20260812042319_client_policy_sold_draft_payment_fields.sql').read_text()
print(sold[:sold.index('-- -----------------------------------------------------------------------------------------------------')])
print(block(sold, 'CREATE OR REPLACE FUNCTION "public"."convert_lead_to_client_atomic"(', '\n$$;'))
actor=(root/'supabase/migrations/20260811200920_campaign_leads_membership_uniqueness_and_attachment_core.sql').read_text()
print(block(actor, 'CREATE OR REPLACE FUNCTION private.campaign_actor()', '\n$$;'))
print('''REVOKE ALL ON FUNCTION private.campaign_actor() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.convert_lead_to_client_atomic(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.convert_lead_to_client_atomic(uuid,jsonb) TO authenticated,service_role;
CREATE UNIQUE INDEX clients_lead_lineage ON public.clients(lead_id) WHERE lead_id IS NOT NULL;
CREATE UNIQUE INDEX wins_idempotency ON public.wins(idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE public.campaign_leads ADD FOREIGN KEY(lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;
CREATE FUNCTION public.test_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION public.test_assert(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',message; END IF; END $$;
CREATE FUNCTION public.test_actor(n integer, org integer DEFAULT 1) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN
 PERFORM set_config('request.jwt.claim.sub',public.test_id(n)::text,false);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',public.test_id(n),'app_metadata',jsonb_build_object('organization_id',public.test_id(org)))::text,false);
 END $$;
-- Read/write grants are intentionally absent: secdef entrypoints must authorize every mutation.
''')
# Restore the exact existing leaderboard through its original migration and guarded upgrades.
for f in ['migrations_archive/pre_baseline/20260805090000_get_org_leaderboard_stats_rpc.sql',
          'migrations/20260923224254_emergency_pause_org_leaderboard_20260923.sql',
          'migrations/20260926060304_leaderboard_request_guard.sql',
          'migrations/20260926163224_leaderboard_repause_latency_gate.sql',
          'migrations/20260926233422_leaderboard_payload_prepare.sql',
          'migrations/20260926233524_leaderboard_payload_reopen.sql']:
    print((root/'supabase'/f).read_text())
print('''SELECT public.test_assert(md5(pg_get_functiondef('public.convert_lead_to_client_atomic(uuid,jsonb)'::regprocedure))='641ba66c96ca4a76f80c9c85eb9caa42','production converter preimage');
SELECT public.test_assert(md5(pg_get_functiondef('public.get_org_leaderboard_stats(timestamptz,timestamptz)'::regprocedure))='c8b1f9d0c7cf5f8dfb7e437577029278','production leaderboard preimage');''')
