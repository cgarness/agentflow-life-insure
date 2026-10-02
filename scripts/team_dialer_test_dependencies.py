#!/usr/bin/env python3
"""Extract actual table/function/policy contracts for an isolated synthetic database, never hosted."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = (ROOT / "supabase/migrations/20260806000000_baseline_production_schema.sql").read_text()
ATTACH = (ROOT / "supabase/migrations/20260811200920_campaign_leads_membership_uniqueness_and_attachment_core.sql").read_text()
SESSION = (ROOT / "supabase/migrations/20260811201250_import_campaign_creation_and_retry.sql").read_text()
RECENT = (ROOT / "supabase/migrations/20260925183605_guard_shared_campaign_recent_calls.sql").read_text()


def block(src, header):
    start = src.index(header)
    match = re.search(r"\bAS (\$[^$]*\$)[\s\S]*?\1;", src[start:], re.I)
    if not match:
        raise ValueError(f"missing function terminator: {header}")
    return src[start:start + match.end()]


def build():
    parts = ["""-- Verbatim production-shaped contracts; only auth.uid/JWT transport is a harness shim.
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE EXTENSION ltree;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
$$;
"""]
    tables = ["profiles", "role_permissions", "campaigns", "leads", "campaign_leads", "dialer_lead_locks",
              "calls", "dispositions", "pipeline_stages", "agent_state_licenses", "campaign_lead_agent_suppressions"]
    for table in tables:
        found = re.search(r'CREATE TABLE IF NOT EXISTS "public"\."' + table + r'" \([\s\S]*?\n\);', BASE)
        if not found:
            raise ValueError(f"missing actual table: {table}")
        parts += [found[0], f"ALTER TABLE public.{table} ADD PRIMARY KEY(id);"]
    parts += ["""
CREATE UNIQUE INDEX campaign_leads_campaign_lead_unique ON public.campaign_leads(campaign_id,lead_id) WHERE lead_id IS NOT NULL;
ALTER TABLE public.campaign_leads ADD FOREIGN KEY(lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;
ALTER TABLE public.dialer_lead_locks ADD UNIQUE(campaign_lead_id);
ALTER TABLE public.dialer_lead_locks ADD FOREIGN KEY(campaign_lead_id) REFERENCES public.campaign_leads(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX suppression_unique ON public.campaign_lead_agent_suppressions(organization_id,campaign_lead_id,agent_id,reason);
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
GRANT SELECT ON public.profiles,public.role_permissions TO authenticated;
GRANT ALL ON public.campaigns,public.leads,public.campaign_leads,public.dialer_lead_locks TO anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.calls,public.campaign_lead_agent_suppressions TO authenticated;
"""]
    for name in ["get_org_id", "get_user_role", "is_super_admin", "super_admin_own_org", "is_ancestor_of",
                 "_contacts_permission_default", "has_contacts_permission", "normalize_us_state", "claim_lead",
                 "release_lead_lock", "release_all_agent_locks", "renew_lead_lock", "advance_campaign_lead",
                 "sync_campaign_total_leads", "sync_campaign_leads_called"]:
        parts.append(block(BASE, f'CREATE OR REPLACE FUNCTION "public"."{name}"('))
    for name in ["campaign_actor", "can_administer_campaign", "attach_leads_to_campaign_core"]:
        parts += [block(ATTACH, f"CREATE OR REPLACE FUNCTION private.{name}("),
                  f"REVOKE ALL ON FUNCTION private.{name}({'uuid,uuid[],uuid' if name == 'attach_leads_to_campaign_core' else 'uuid' if name == 'can_administer_campaign' else ''}) FROM PUBLIC,anon,authenticated;"]
    # The public wrapper's non-import path is unchanged; import dependencies are not invoked by this suite.
    parts += [block(ATTACH, "CREATE OR REPLACE FUNCTION public.add_leads_to_campaign("),
              block(SESSION, "CREATE OR REPLACE FUNCTION public.can_dial_campaign("),
              block(RECENT, 'CREATE OR REPLACE FUNCTION "public"."get_next_queue_lead"(')]
    for table, names in {
        "leads": ["Leads Hierarchical Access", "leads_select_unassigned_pool", "leads_select_view_all_pool"],
        "campaign_leads": ["campaign_leads_insert", "campaign_leads_select", "campaign_leads_update", "campaign_leads_delete"],
        "dialer_lead_locks": ["dialer_lead_locks_insert", "dialer_lead_locks_select", "dialer_lead_locks_delete"],
    }.items():
        parts.append(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;")
        for name in names:
            policy = re.search(r'CREATE POLICY "' + name + r'"[\s\S]*?;', BASE)
            if not policy:
                raise ValueError(f"missing actual policy {name}")
            parts.append(policy[0])
    parts += ["""
CREATE TRIGGER trg_sync_campaign_total_leads AFTER INSERT OR DELETE OR UPDATE ON public.campaign_leads
  FOR EACH ROW EXECUTE FUNCTION public.sync_campaign_total_leads();
CREATE TRIGGER trg_sync_campaign_leads_called AFTER INSERT OR DELETE OR UPDATE OF call_attempts,campaign_id ON public.campaign_leads
  FOR EACH ROW EXECUTE FUNCTION public.sync_campaign_leads_called();
REVOKE ALL ON FUNCTION public.get_next_queue_lead(uuid,jsonb),public.can_dial_campaign(uuid),public.add_leads_to_campaign(uuid,uuid[],uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_next_queue_lead(uuid,jsonb),public.can_dial_campaign(uuid),public.add_leads_to_campaign(uuid,uuid[],uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_lead(uuid,uuid,uuid),public.renew_lead_lock(uuid),public.release_lead_lock(uuid),public.release_all_agent_locks(uuid) TO anon,authenticated,service_role;
"""]
    return "\n\n".join(parts) + "\n"


if __name__ == "__main__":
    Path(sys.argv[1]).write_text(build())
