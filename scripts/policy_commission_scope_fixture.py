"""Overlay CURRENT hierarchy/read-policy definitions on the disposable commission fixture.

Only emits SQL; the loopback-only runner owns execution. No production access. The
old sale fixture is retained for migration replay tests; this overlay installs the
current hierarchy primitive verbatim and checks its live-inspected digest.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = (ROOT / 'supabase/migrations/20260806000000_baseline_production_schema.sql').read_text()
HIERARCHY = (ROOT / 'supabase/migrations/20261023210027_hierarchy_authorization_boundaries.sql').read_text()
SHAPE = json.loads((ROOT / 'supabase/tests/fixtures/policy_commission/scoped_hierarchy.json').read_text())


def block(source, header, end):
    start = source.index(header)
    return source[start:source.index(end, start) + len(end)]


print('-- Synthetic local fixture; current hierarchy primitive from immutable M1.')
print(block(HIERARCHY, 'CREATE OR REPLACE FUNCTION public.is_ancestor_of(', '\n$$;'))
print('REVOKE EXECUTE ON FUNCTION public.is_ancestor_of(uuid,uuid) FROM PUBLIC,anon;')
print('GRANT EXECUTE ON FUNCTION public.is_ancestor_of(uuid,uuid) TO authenticated,service_role;')
# The isolated token issuer must read the next synthetic actor independent of the previous actor's profiles RLS.
# This is test authentication setup only, never a commission authority helper or production migration object.
print('ALTER FUNCTION public.pc_login(integer) SECURITY DEFINER SET search_path=public,pg_temp;')
print('ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;')
for name in ('profiles_select_hierarchical', 'profiles_select_org', 'company_settings_write'):
    print(block(BASE, f'CREATE POLICY "{name}"', ';'))
# Existing indexes only, from the refreshed hosted catalog (all have immutable source).
for name in ('idx_profiles_hierarchy_path', 'idx_profiles_role', 'idx_profiles_organization_id',
             'idx_profiles_team_id', 'idx_profiles_platform_role', 'idx_profiles_upline_id',
             'idx_wins_agent_id', 'idx_wins_created_at', 'idx_wins_org', 'idx_clients_assigned_agent_id', 'idx_clients_org'):
    marker = f'CREATE INDEX "{name}"'
    if marker in BASE:
        print(block(BASE, marker, ';').replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS ', 1))
for path in ('20261005161634_performance_reader_indexes.sql','20261017043757_performance_wins_sold_date_index.sql'):
    source=(ROOT / 'supabase/migrations' / path).read_text()
    for line in source.splitlines():
        if line.startswith('CREATE INDEX performance_wins_'):
            print(line.replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS ', 1))
print("SELECT test_assert(md5(pg_get_functiondef('public.is_ancestor_of(uuid,uuid)'::regprocedure)) = "
      "'c6d121db50b7ea2e37ce4a620cc855af', 'current M1 hierarchy preimage');")
for fn, digest in SHAPE['function_pins'].items():
    print(f"SELECT test_assert(md5(pg_get_functiondef('{fn}'::regprocedure)) = '{digest}', 'live {fn} pin');")
if '--schema-only' not in sys.argv:
    print("UPDATE profiles SET upline_id=test_id(14) WHERE id IN (test_id(11),test_id(16),test_id(17),test_id(18));")
    for p in SHAPE['profiles']:
        # Fixed synthetic JSON, never user/customer input.
        print("INSERT INTO profiles(id,organization_id,first_name,last_name,email,role,status,commission_level,is_super_admin,hierarchy_path,upline_id) "
              f"VALUES(test_id({p['id']}),test_id({p['org']}),'{p['name']}','Synthetic','scope{p['id']}@example.test',"
              f"'{p['role']}','Active','100',false,'{p['path']}',test_id({p['upline']}));")
    print("INSERT INTO role_permissions(organization_id,role,permissions) VALUES(test_id(1),'Team Leader',"
          "'{\"c\":[{\"name\":\"View Own Commission Percentage\",\"teamLeader\":true},"
          "{\"name\":\"View Others'' Commission Percentage\",\"teamLeader\":true}]}');")
    print((ROOT / 'supabase/tests/policy_commission_scoped_harness.sql').read_text())
    
# Full read-policy parity against a fresh live catalog. JSON literal is generated from reviewed repository fixture.
expected = json.dumps(SHAPE['read_policies'], separators=(',', ':')).replace("'", "''")
print("SELECT test_assert((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname) FROM pg_policies p "
      "WHERE p.schemaname='public' AND (p.tablename IN ('profiles','clients','wins','company_settings') "
      "OR p.tablename LIKE 'policy_commission_%') AND p.cmd IN ('SELECT','ALL') AND p.policyname NOT LIKE '%writer%') "
      "= (SELECT jsonb_agg(x ORDER BY x->>'tablename',x->>'policyname') FROM jsonb_array_elements('" + expected + "'::jsonb) x), "
      "'current live read-policy definitions, roles, modes and checks');")

# Read authority and table security are compared separately from deliberately narrower ancillary write grants.
for t in SHAPE['read_table_security']:
    print("SELECT test_assert((SELECT relrowsecurity=" + str(t['rls']).lower()
          + " AND relforcerowsecurity=" + str(t['force_rls']).lower()
          + " AND pg_get_userbyid(relowner)='" + t['owner'] + "' FROM pg_class WHERE oid='public."
          + t['name'] + "'::regclass) AND has_table_privilege('authenticated','public." + t['name']
          + "','SELECT')=" + str(t['authenticated_select']).lower() + ", 'live table read security " + t['name'] + "');")
