# Phase 3a + 3b: Agent State Licenses + Inbound Fallback Chain

**Branch:** `claude/add-agent-licenses-schema-f0mD1`
**Scope:** Schema foundation for state-licensed agent routing and configurable inbound fallback waterfall.

## Inventory

### New tables (1)
- `public.agent_state_licenses`
  - `id uuid PK default gen_random_uuid()`
  - `agent_id uuid NOT NULL` → `auth.users(id) ON DELETE CASCADE`
  - `organization_id uuid NOT NULL` → `public.organizations(id) ON DELETE CASCADE`
  - `state text NOT NULL` (full US state name; matches `area_code_mapping.state`)
  - `license_number text`
  - `expiration_date date`
  - `created_at timestamptz NOT NULL DEFAULT now()`

### New columns (1)
- `public.inbound_routing_settings.inbound_fallback_chain jsonb NOT NULL DEFAULT '["last_agent","campaign_agents","all_available"]'::jsonb`

### Unique constraints (1)
- `agent_state_licenses_agent_state_unique` on `(agent_id, state)`

### Indexes (3)
- `idx_agent_state_licenses_agent_id`
- `idx_agent_state_licenses_organization_id`
- `idx_agent_state_licenses_state`

### RLS policies (4) — all on `agent_state_licenses`
- `agent_state_licenses_select` — org members + super admin
- `agent_state_licenses_insert` — Admin/Team Leader within org, or super admin
- `agent_state_licenses_update` — same as insert
- `agent_state_licenses_delete` — same as insert

### Comments (2)
- Table comment on `agent_state_licenses`
- Column comment on `inbound_routing_settings.inbound_fallback_chain`

### Other
- `ENABLE ROW LEVEL SECURITY` on new table
- Final `NOTIFY pgrst, 'reload schema';`
