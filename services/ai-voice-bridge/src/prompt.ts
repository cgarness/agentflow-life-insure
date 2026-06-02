/** Lead context for AI Testing voice calls (mirrors supabase/functions/_shared/aiTestingPrompt.ts). */

export type LeadContext = {
  first_name?: string;
  last_name?: string;
  city?: string;
  state?: string;
  age?: string;
  lead_source?: string;
  product_interest?: string;
  notes?: string;
  agency_name?: string;
  agent_name?: string;
};

export function normalizeLeadContext(raw: unknown): LeadContext {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const str = (k: string) => {
    const v = o[k];
    return typeof v === "string" ? v.trim() : "";
  };
  return {
    first_name: str("first_name"),
    last_name: str("last_name"),
    city: str("city"),
    state: str("state"),
    age: str("age"),
    lead_source: str("lead_source"),
    product_interest: str("product_interest"),
    notes: str("notes"),
    agency_name: str("agency_name"),
    agent_name: str("agent_name"),
  };
}

export function leadDisplayName(lead: LeadContext): string {
  const parts = [lead.first_name, lead.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : "the prospect";
}

export function formatLeadContextBlock(lead: LeadContext): string {
  const lines: string[] = [];
  const name = leadDisplayName(lead);
  if (name !== "the prospect") lines.push(`Name: ${name}`);
  if (lead.age) lines.push(`Age: ${lead.age}`);
  if (lead.city || lead.state) {
    lines.push(`Location: ${[lead.city, lead.state].filter(Boolean).join(", ")}`);
  }
  if (lead.lead_source) lines.push(`Lead source: ${lead.lead_source}`);
  if (lead.product_interest) lines.push(`Product interest: ${lead.product_interest}`);
  if (lead.agency_name) lines.push(`Agency: ${lead.agency_name}`);
  if (lead.agent_name) lines.push(`Your name on the call: ${lead.agent_name}`);
  if (lead.notes) lines.push(`Notes from CRM/agent: ${lead.notes}`);
  if (!lines.length) return "(No lead details provided — use a friendly generic greeting.)";
  return lines.join("\n");
}

export function buildAgentPrompt(basePrompt: string, lead: LeadContext): string {
  const block = formatLeadContextBlock(lead);
  return `${basePrompt.trim()}

---

## Lead details (use naturally — do not read this list aloud)

${block}`;
}

export function welcomeGreetingFromLead(lead: LeadContext): string {
  const agent = lead.agent_name?.trim() || "Alex";
  const first = lead.first_name?.trim();
  if (first) {
    return `Hi ${first}, this is ${agent}. How are you doing today?`;
  }
  return `Hi, this is ${agent} calling. Do you have a quick moment?`;
}
