

# Make Clients, Recruits, and Agents Tabs Fully Functional

## Current State
The Leads tab has full functionality: row selection with bulk actions, sortable columns, column visibility toggle, click-to-open contact modal, search/filter, add/edit/delete, and kanban view. The Clients, Recruits, and Agents tabs are basic static tables with no interactivity beyond rendering rows.

## Plan

### 1. Add selection, sorting, and row actions to Clients tab
- Add checkbox column with select-all/individual selection
- Add sortable column headers (Name, Phone, Policy Type, Carrier, Premium, Face Amount, Issue Date)
- Define column definitions similar to leads (`ClientColumnKey`, `CLIENT_COLUMNS`)
- Add column visibility toggle dropdown
- Add bulk actions toolbar (Delete, Assign Agent)
- Make rows clickable (for now, show a toast since ContactModal only supports Leads — see step 5)
- Add inline action menu (edit, delete) on the `MoreHorizontal` button
- Wire up `clientsApi.delete` and `clientsApi.update` for CRUD operations
- Add "Add Client" flow in the AddContactModal with client-specific fields (policy type, carrier, premium, face amount, issue date)

### 2. Add selection, sorting, and row actions to Recruits tab
- Same pattern: checkbox selection, sortable headers, column visibility
- Define `RecruitColumnKey` and `RECRUIT_COLUMNS` (Name, Phone, Email, Status, Agent)
- Add bulk actions toolbar (Delete, Change Status, Assign Agent)
- Recruit statuses: Prospect, Contacted, Interview, Licensed, Active
- Wire up `recruitsApi.delete` and `recruitsApi.update`
- Add "Add Recruit" flow with recruit-specific fields
- Kanban view already exists but make cards clickable

### 3. Add selection, sorting, and row actions to Agents tab
- Checkbox selection, sortable headers for all agent columns
- Define `AgentColumnKey` and `AGENT_COLUMNS` (Agent, Email, Licensed States, Commission, Role, Status)
- Column visibility toggle
- Bulk actions: Change Status (Active/Inactive)
- Agents are read from `mockUsers`/`mockProfiles` — no delete, but status toggle

### 4. Make search and filters tab-aware
- Search already filters across tabs via `searchQuery` in fetchData for leads/clients
- Add search filtering for recruits (currently `recruitsApi.getAll()` ignores search)
- Add tab-specific status filter options (client doesn't have status, recruits have their own statuses)
- Update the filter dropdown to show relevant options per active tab

### 5. Adapt the AddContactModal per tab
- When on Clients tab, show client-specific fields (policy type, carrier, premium, face amount, issue date) instead of lead fields
- When on Recruits tab, show recruit-specific fields (status dropdown with recruit statuses)
- Pass `contactType` prop to determine which fields to render
- The existing `contactType` prop is already defined but not used for field switching

### 6. Fix the existing build errors
- `FloatingDialer.tsx`: Fix missing `setDialerError` references and type errors
- `DialerPage.tsx`: Fix missing `setOnCall` and `setShowDisposition` references
- These are pre-existing errors unrelated to this feature but must be fixed for the build to succeed

## Technical Approach
- Keep everything in `src/pages/Contacts.tsx` following the existing pattern
- Add parallel state for client/recruit selection (`selectedClientIds`, `selectedRecruitIds`, `selectedAgentIds`)
- Add parallel sort state per tab or make existing sort state tab-aware (reset on tab switch)
- Add column definitions as constants alongside the existing `ALL_COLUMNS`
- Update `recruitsApi.getAll()` in mock-api to accept a search filter
- The `AddContactModal` will branch rendering based on `contactType` prop (already partially set up)

## Files to modify
- `src/pages/Contacts.tsx` — main changes: selection state, sort state, column defs, bulk actions, and table rendering for all 3 tabs
- `src/lib/mock-api.ts` — add search param to `recruitsApi.getAll()`
- `src/components/layout/FloatingDialer.tsx` — fix build errors
- `src/pages/DialerPage.tsx` — fix build errors

