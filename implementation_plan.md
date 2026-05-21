# Phase 3c — State Licenses Management UI

**Branch:** `claude/state-licenses-management-ui-nyW5T`

## Placement decision

Mount as a new tab **"State Licenses"** in `src/components/settings/PhoneSystem.tsx`, between "Inbound Routing" and "Recording Settings".

**Rationale:**
- `UserManagement.tsx` is 1851 lines with deeply nested per-user modals; adding a multi-agent table view there would require restructuring.
- `InboundRoutingManager.tsx` is a 3-column grid (steps + business hours sidebar); the section doesn't fit visually.
- `PhoneSystem.tsx` has a clean `Tabs` structure — appending a tab is a 2-line edit.
- License data is consumed by the inbound routing state-based tier (Phase 3a+3b migration), so co-locating under Phone System is intuitive for admins configuring routing.

## Files

### New
- `src/lib/us-states.ts` — `US_STATES: { value: string; label: string }[]` (50 states + DC, full-name values matching `area_code_mapping.state`).
- `src/components/settings/state-licenses/stateLicenseSchema.ts` — Zod schema + form value type.
- `src/components/settings/state-licenses/StateLicensesSection.tsx` — top-level wrapper, data fetching, role gating, empty state. (<200 lines)
- `src/components/settings/state-licenses/StateLicenseTable.tsx` — agent-centric table (rows = agents, badges = states with expiration warnings). (<200 lines)
- `src/components/settings/state-licenses/StateLicenseFormModal.tsx` — add license modal (agent picker, state dropdown, license #, expiration date, Zod-validated). (<200 lines)

### Modified
- `src/components/settings/PhoneSystem.tsx` — add `"state-licenses"` tab.
- `WORK_LOG.md` — append entry.

## Zod schema

```ts
export const stateLicenseFormSchema = z.object({
  agent_id: z.string().uuid({ message: "Agent is required" }),
  state: z.string().min(1, "State is required"),
  license_number: z.string().trim().max(50).optional().or(z.literal("")),
  expiration_date: z.string().optional().or(z.literal("")),
});
```

## Data fetching

```ts
const { data: licenses } = await supabase
  .from("agent_state_licenses")
  .select("id, agent_id, state, license_number, expiration_date, created_at")
  .eq("organization_id", organizationId)
  .order("state");

const { data: agents } = await supabase
  .from("profiles")
  .select("id, first_name, last_name, status, role")
  .eq("organization_id", organizationId)
  .eq("status", "Active")
  .order("first_name");
```

Group licenses by `agent_id` client-side; render one row per agent.

## Expiration warning

30-day threshold:
- `expiration_date < today` → red ("Expired")
- `expiration_date <= today + 30d` → yellow ("Expires soon")
- otherwise → no indicator

## Role gating

`canManage = role === "Admin" || role === "Team Leader" || is_super_admin`. Add/Remove buttons hidden when `!canManage`. Same pattern as `NumberGroupsSection`.

## Data flow

```
PhoneSystem (new tab "state-licenses")
  └─ StateLicensesSection (fetches licenses + agents, role gate)
       ├─ StateLicenseTable (agent rows, badges, remove confirm)
       └─ StateLicenseFormModal (Zod form, INSERT agent_state_licenses)
```
