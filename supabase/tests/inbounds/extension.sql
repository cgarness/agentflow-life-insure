-- Test-only baseline extensions; never run this file on a hosted project.
ALTER TABLE public.organizations ADD twilio_subaccount_status text DEFAULT 'active';
ALTER TABLE public.phone_numbers ADD assignment_type text NOT NULL DEFAULT 'agency', ADD is_default boolean DEFAULT false, ADD status text DEFAULT 'active';
CREATE TABLE public.call_scripts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,name text,content text,active boolean DEFAULT true);
CREATE TABLE public.dispositions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,name text);
CREATE TABLE private.dialer_disposition_receipts(call_id uuid PRIMARY KEY,organization_id uuid NOT NULL,agent_id uuid NOT NULL);
-- The existing authoritative receipt is seeded by postgres in these room tests; no client grant.
-- Recent-outbound lookup is outside the room dispatch; stub its config so normal route regressions work.
CREATE TABLE private.recent_outbound_routing_orgs(organization_id uuid PRIMARY KEY,enabled boolean,did_allowlist text[],unanswered_eligible boolean);
