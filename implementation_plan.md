# Phase 3d+3e–3i — Inbound Fallback Chain UI + Webhook Routing Rewrite

**Branch:** `claude/sweet-bohr-Jxyx5`
**Model:** Opus 4.7
**Scope:** Frontend (InboundRoutingManager + new FallbackChainSection) + Edge Function (twilio-voice-inbound v23)

---

## A. Fallback Chain Configuration UI

### Placement

Add a new section "Inbound Fallback Chain" to `src/components/settings/InboundRoutingManager.tsx`, in the **left column (`lg:col-span-8`)** between STEP 1 (Routing Strategy) and STEP 2 (Unanswered / Fallback). The existing fallback action picker stays — it controls the **terminal** behavior when the chain is exhausted.

`InboundRoutingManager.tsx` is currently 479 lines (already over the 200-line guideline). Extract the new section into a **child component**:

- **New file:** `src/components/settings/inbound-routing/FallbackChainSection.tsx` (< 200 lines)

Props:
```ts
interface FallbackChainSectionProps {
  value: string[];                // ordered list of enabled tier names
  onChange: (next: string[]) => void;
  hasStateLicenses?: boolean;     // drives the helper note for state_licensed
}
```

### Tier catalogue (constant inside the component)

```ts
type TierKey = "last_agent" | "campaign_agents" | "state_licensed" | "all_available";

const TIERS: Array<{ key: TierKey; label: string; description: string }> = [
  { key: "last_agent",      label: "Last Agent",            description: "Ring the agent who last spoke with this caller." },
  { key: "campaign_agents", label: "Campaign Agents",       description: "Ring agents assigned to the campaign that uses this phone number's group." },
  { key: "state_licensed",  label: "State-Licensed Agents", description: "Ring agents licensed in the caller's state." },
  { key: "all_available",   label: "All Available Agents",  description: "Ring any available agent in the organization." },
];
```

### Interaction model — arrow buttons (no DnD library)

No drag-and-drop library currently exists in `package.json`. The task instruction is explicit: do **not** add one for a 4-item list. Use up/down arrow buttons.

Persisted shape: ordered array of **enabled** tier names in `inbound_routing_settings.inbound_fallback_chain` (JSONB). Default after Phase 3a+3b migration: `["last_agent", "campaign_agents", "all_available"]` — state_licensed intentionally absent.

UI rendering derived from `value`:
- A tier is **enabled** if its key appears in `value`; **disabled** otherwise.
- Enabled tiers render first in their saved order; disabled tiers render below, greyed.
- Up/Down arrows reorder within the enabled list. Arrows are hidden/disabled at edges.
- Toggle switch:
  - Enabling appends the key to the end of `value` (lowest priority).
  - Disabling removes the key, preserving order of the rest.

Save: `inbound_fallback_chain` is included in the parent's existing update payload — no extra save button.

### Helper note for state_licensed

If the org has zero `agent_state_licenses` rows, show a muted note next to the State-Licensed Agents row: *"No state licenses configured yet. Add licenses in the State Licenses tab."* The toggle still functions; the note is purely informational.

`InboundRoutingManager.fetchData` adds a lightweight count query:
```ts
const { count } = await supabase
  .from("agent_state_licenses")
  .select("id", { count: "exact", head: true })
  .eq("organization_id", organizationId);
```

### Changes to `InboundRoutingManager.tsx`

1. Extend `RoutingSettings` interface with `inbound_fallback_chain: string[]`.
2. `defaultRoutingSettings` gets `inbound_fallback_chain: ["last_agent", "campaign_agents", "all_available"]`.
3. `fetchData` reads `inbound_fallback_chain` from the row and coerces to `string[]`; non-array values fall back to default.
4. `fetchData` queries the licenses count → `hasStateLicenses` local state.
5. `handleSave` payload (`rtPayload`) adds `inbound_fallback_chain: routing.inbound_fallback_chain`.
6. Render `<FallbackChainSection value={routing.inbound_fallback_chain} onChange={(next) => setRouting(r => ({ ...r, inbound_fallback_chain: next }))} hasStateLicenses={hasStateLicenses} />` between STEP 1 and STEP 2.

---

## B. Webhook Routing Decision Tree Rewrite

### Current state

File: `supabase/functions/twilio-voice-inbound/index.ts` (967 lines, deployed v22). Existing helpers we keep: `digitsOnly`, `normalizeE164`, `buildPhoneCandidates`, `resolvePhoneNumberRow`, `resolveInboundContact`, `checkBusinessHours`, `sendAfterHoursSms`, `loadPhoneSettings`, `resolveAssignedIdentity`, `resolveAllOrgIdentities`, `resolveRoundRobinAgent`, `buildDialTwiml`, `buildVoicemailTwiml`, `buildForwardTwiml`, `buildHangupTwiml`, `handleFallback`.

### New helpers

1. **`loadFallbackChain(supabase, organizationId)`** — small SELECT on `inbound_routing_settings.inbound_fallback_chain`. Returns `string[]`, defaulting to `["last_agent","campaign_agents","all_available"]` if missing or malformed.

2. **`resolveLastAgentIdentities(supabase, organizationId, fromNumber): Promise<string[]>`** — multi-format phone search on `calls`:
   ```ts
   const candidates = buildPhoneCandidates(fromNumber);
   if (candidates.length === 0) return [];
   const orClauses = candidates.flatMap(c => [
     `contact_phone.eq.${c}`,
     `caller_id_used.eq.${c}`,
   ]).join(",");
   const { data } = await supabase
     .from("calls")
     .select("agent_id")
     .eq("organization_id", organizationId)
     .in("direction", ["outbound", "outgoing"])
     .or(orClauses)
     .not("agent_id", "is", null)
     .order("created_at", { ascending: false })
     .limit(1)
     .maybeSingle();
   if (!data?.agent_id) return [];
   const { data: p } = await supabase
     .from("profiles")
     .select("twilio_client_identity")
     .eq("id", data.agent_id)
     .eq("status", "Active")
     .not("twilio_client_identity", "is", null)
     .maybeSingle();
   return p?.twilio_client_identity ? [p.twilio_client_identity] : [];
   ```

3. **`resolveCampaignAgentIdentities(supabase, organizationId, phoneNumberId): Promise<string[]>`** —
   ```ts
   const { data: members } = await supabase
     .from("number_group_members")
     .select("number_group_id")
     .eq("phone_number_id", phoneNumberId);
   const groupIds = (members ?? []).map(m => m.number_group_id);
   if (groupIds.length === 0) return [];
   
   const { data: campaigns } = await supabase
     .from("campaigns")
     .select("assigned_agent_ids")
     .in("number_group_id", groupIds)
     .eq("status", "Active")
     .eq("organization_id", organizationId);
   
   const agentIds = new Set<string>();
   for (const c of (campaigns ?? [])) {
     const arr = Array.isArray(c.assigned_agent_ids) ? c.assigned_agent_ids : [];
     for (const id of arr) if (typeof id === "string") agentIds.add(id);
   }
   if (agentIds.size === 0) return [];
   
   const { data: profiles } = await supabase
     .from("profiles")
     .select("twilio_client_identity")
     .in("id", [...agentIds])
     .eq("status", "Active")
     .not("twilio_client_identity", "is", null);
   return (profiles ?? []).map(p => p.twilio_client_identity).filter(Boolean);
   ```

4. **`resolveStateLicensedIdentities(supabase, organizationId, fromNumber): Promise<string[]>`** —
   ```ts
   const digits = digitsOnly(fromNumber);
   const last10 = digits.length >= 10 ? digits.slice(-10) : "";
   const areaCode = last10.slice(0, 3);
   if (!areaCode) return [];
   
   const { data: ac } = await supabase
     .from("area_code_mapping")
     .select("state")
     .eq("area_code", areaCode)
     .maybeSingle();
   const state = ac?.state;
   if (!state) return [];
   
   const today = new Date().toISOString().slice(0, 10);
   const { data: licenses } = await supabase
     .from("agent_state_licenses")
     .select("agent_id, expiration_date")
     .eq("organization_id", organizationId)
     .eq("state", state);
   const validIds = (licenses ?? [])
     .filter(l => !l.expiration_date || l.expiration_date >= today)
     .map(l => l.agent_id);
   if (validIds.length === 0) return [];
   
   const { data: profiles } = await supabase
     .from("profiles")
     .select("twilio_client_identity")
     .in("id", validIds)
     .eq("status", "Active")
     .not("twilio_client_identity", "is", null);
   return (profiles ?? []).map(p => p.twilio_client_identity).filter(Boolean);
   ```

5. **`resolveAllAvailableIdentities(supabase, organizationId): Promise<string[]>`** — like existing `resolveAllOrgIdentities` but adds `.eq("status", "Active")` for tier consistency.

6. **`resolveTier(tierKey, ctx): Promise<string[]>`** — dispatch:
   ```ts
   switch (tierKey) {
     case "last_agent":      return resolveLastAgentIdentities(ctx.supabase, ctx.organizationId, ctx.fromNumber);
     case "campaign_agents": return resolveCampaignAgentIdentities(ctx.supabase, ctx.organizationId, ctx.phoneNumberId);
     case "state_licensed":  return resolveStateLicensedIdentities(ctx.supabase, ctx.organizationId, ctx.fromNumber);
     case "all_available":   return resolveAllAvailableIdentities(ctx.supabase, ctx.organizationId);
     default: return [];
   }
   ```

7. **`emitTerminalFallback(supabase, callRowId, orgId, phoneNumberId): Promise<Response>`** — consolidates the three duplicated terminal-emit blocks in the current file (closed-hours, zero-identities, chain-exhausted). Marks `is_missed`, notifies, then returns voicemail/forward/hangup TwiML per `settings.fallback_action`. Loads settings internally.

### Decision tree (numbered flow)

```
INITIAL INBOUND  (no `fallback` query param)
─────────────────────────────────────────────
1. parseFormBody → params (From, To, CallSid, …)
2. resolvePhoneNumberRow(To) → phoneRow
   ↳ null/no org → UNCONFIGURED_TWIML
3. loadPhoneSettings(orgId, phoneRow.id) → settings
4. INSERT calls row (direction=inbound, status=ringing) → callRowId
5. resolveInboundContact + auto_create_lead path (existing) → enrich calls row
6. checkBusinessHours(orgId)
   ↳ closed: optional after-hours SMS + mark missed + emitTerminalFallback. DONE.
7. DIRECT LINE CHECK — if phoneRow.is_direct_line:
   - identities = [resolveAssignedIdentity(phoneRow.assigned_to)] (filter empty)
   - If identities found: Dial Client with action URL
     ?fallback=voicemail&… (legacy terminal handler — bypasses chain).
   - Else: emitTerminalFallback. DONE.
8. PRIMARY ROUTING (existing strategies, unchanged logic):
   - "all-ring"    → identities = resolveAllOrgIdentities(orgId)
   - "round_robin" → identities = [resolveRoundRobinAgent(orgId).identity]
   - "assigned"    → identities = [resolveAssignedIdentity(phoneRow.assigned_to)]
9. If identities.length > 0: emit buildDialTwiml with action URL:
   ?fallback=chain&chain_step=0&call_row_id=…&org_id=…&phone_number_id=…
   DONE.
10. If identities.length === 0: enter chain immediately:
    return await handleChainStep(req, supabase, url, params)
    where url.searchParams has fallback=chain & chain_step=0 (constructed in-process).

CHAIN STEP  (fallback=chain, chain_step=N)
──────────────────────────────────────────
1. DialCallStatus check:
   "completed" | "answered"  → EMPTY_TWIML (call was handled). DONE.
   else (no-answer, busy, failed, canceled, missing) → continue.
2. Read call_row_id, org_id, phone_number_id, chain_step from query; From from params.
3. settings = loadPhoneSettings(orgId, phone_number_id)
   chain    = loadFallbackChain(orgId)
4. While chain_step < chain.length:
   a. tierKey   = chain[chain_step]
   b. identities = resolveTier(tierKey, ctx)
   c. If identities.length > 0:
      - actionUrl = self?fallback=chain&chain_step=(N+1)&…
      - return buildDialTwiml(identities, actionUrl, settings.recording_enabled, recordingStatusUrl())
   d. Else: chain_step++; continue loop.
5. Chain exhausted → emitTerminalFallback. DONE.

LEGACY fallback=voicemail (preserved — direct-line path + post-forward catch)
────────────────────────────────────────────────────────────────────────────
Existing handleFallback handles voicemail/forward(once)/hangup terminal flows.

fallback=hangup
───────────────
Unchanged ack after <Record> action.
```

### Routing block in `handleInitialInbound`

Replaces lines ~832–913. Direct-line branch keeps `?fallback=voicemail&…` action URL. Primary routing's Dial uses `?fallback=chain&chain_step=0&…`. Zero-identities branch synthesizes a chain entry in-process by mutating `url.searchParams` (cloning the URL) and calling `handleChainStep`.

### `handleChainStep` skeleton

```ts
async function handleChainStep(
  req: Request,
  supabase: SupabaseClient,
  url: URL,
  params: Record<string, string>,
): Promise<Response> {
  const dialStatus = params["DialCallStatus"] || "";
  if (dialStatus === "completed" || dialStatus === "answered") {
    return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
  }
  
  const callRowId    = url.searchParams.get("call_row_id") || "";
  const orgId        = url.searchParams.get("org_id") || "";
  const phoneNumberId = url.searchParams.get("phone_number_id") || "";
  const fromNumber   = params["From"] || "";
  let chainStep = parseInt(url.searchParams.get("chain_step") || "0", 10);
  if (!Number.isFinite(chainStep) || chainStep < 0) chainStep = 0;
  
  if (!orgId) {
    return await emitTerminalFallback(supabase, callRowId, orgId, phoneNumberId);
  }
  
  const settings = await loadPhoneSettings(supabase, orgId, phoneNumberId);
  const chain    = await loadFallbackChain(supabase, orgId);
  
  while (chainStep < chain.length) {
    const tierKey = chain[chainStep];
    const identities = await resolveTier(tierKey, {
      supabase, organizationId: orgId, phoneNumberId, fromNumber,
    });
    if (identities.length > 0) {
      const actionUrl = selfUrl({
        fallback: "chain",
        chain_step: String(chainStep + 1),
        ...(callRowId ? { call_row_id: callRowId } : {}),
        org_id: orgId,
        phone_number_id: phoneNumberId,
      });
      const twiml = buildDialTwiml(
        identities, actionUrl, settings.recording_enabled, recordingStatusUrl()
      );
      return new Response(twiml, { status: 200, headers: twimlHeaders });
    }
    chainStep++;
  }
  
  return await emitTerminalFallback(supabase, callRowId, orgId, phoneNumberId);
}
```

`emitTerminalFallback` uses existing builders + `insertMissedCallNotifications`. The `forward` branch retains `?fallback=voicemail&forwarded=1&…` so a no-answer at the forwarded number lands in `handleFallback` for voicemail catch.

### Top-level dispatch

In `Deno.serve`, add:
```ts
if (fallback === "chain") {
  return await handleChainStep(req, supabase, url, params);
}
```
Place before the existing `fallback === "voicemail"` and `fallback === "hangup"` branches.

### Edge cases

- **Empty chain array**: `chainStep < chain.length` false → terminal fallback immediately.
- **Tier yields no identities**: loop skips to next tier within the same HTTP response.
- **DialCallStatus = "completed"/"answered"**: chain stops.
- **Missing `From`**: `last_agent` and `state_licensed` resolvers return `[]` and we move on.
- **Phone not in any group**: `campaign_agents` returns `[]`.
- **Area code with no state mapping**: `state_licensed` returns `[]`.
- **All licenses expired**: `state_licensed` returns `[]`.
- **Direct line**: bypasses chain entirely.
- **`assigned_agent_ids` non-array**: coerced; non-string entries ignored.
- **Inactive agents**: every tier filters `status = 'Active'` on `profiles`.

---

## C. File inventory

### New
- `src/components/settings/inbound-routing/FallbackChainSection.tsx` (~180 lines)

### Modified
- `src/components/settings/InboundRoutingManager.tsx` — `RoutingSettings` extension, fetch chain + licenses count, save chain, mount section
- `supabase/functions/twilio-voice-inbound/index.ts` — resolver helpers, `handleChainStep`, `emitTerminalFallback`, primary Dial action URL change, top-level dispatch
- `WORK_LOG.md` — append entry

### Verify
- `npx tsc --noEmit`
- Edge Function deploys to v23 (was v22)

---

## D. WORK_LOG.md entry (appended after deploy)

```
2026-05-21 | [DONE] Phase 3d+3e-3i: Inbound fallback chain UI + webhook routing rewrite.
What: (1) Created FallbackChainSection component with ordered tier list, up/down reorder
arrows, enable/disable toggles per tier. Saves to inbound_routing_settings.inbound_fallback_chain
as ordered JSON array of enabled tier names. (2) Rewrote twilio-voice-inbound routing to
implement stateful fallback waterfall via chain_step query parameter on action URLs.
Tiers: last_agent (outbound call history lookup with multi-format phone search),
campaign_agents (number group → campaign → assigned agents, ring-all),
state_licensed (area code → state → licensed active agents, filters expired),
all_available (all org agents). Chain only continues on no-answer/busy/failed DialCallStatus.
Exhausted chain falls through to existing voicemail/forward/hangup. Direct line check
preserved (bypasses chain entirely). Deploy: twilio-voice-inbound v23.
```
