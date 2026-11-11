import { z } from "zod";

const agentId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).transform((id) => id.toLowerCase());
export interface CommissionAgentScope { mode: "me" | "all" | "selected"; agentIds: string[] }
export const ME_SCOPE: CommissionAgentScope = { mode: "me", agentIds: [] };
export const commissionAgentScopeSchema = z.object({ mode: z.enum(["me", "all", "selected"]), agentIds: z.array(agentId) }).strict()
  .superRefine((value, ctx) => {
    if ((value.mode === "selected") !== (value.agentIds.length > 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose at least one agent; IDs are only valid for Selected." });
    }
  }).transform((value) => ({ ...value, agentIds: [...new Set(value.agentIds)].sort() }));

export type ParsedCommissionScope = { kind: "missing" } | { kind: "invalid" } | { kind: "valid"; scope: CommissionAgentScope };
export function parseCommissionScope(params: URLSearchParams): ParsedCommissionScope {
  if (!params.has("agents") && !params.has("agent_ids")) return { kind: "missing" };
  if (params.getAll("agents").length !== 1 || params.getAll("agent_ids").length > 1) return { kind: "invalid" };
  const mode = params.get("agents");
  if (mode !== "selected" && params.has("agent_ids")) return { kind: "invalid" };
  const parsed = commissionAgentScopeSchema.safeParse({ mode, agentIds: params.has("agent_ids") ? params.get("agent_ids")!.split(",") : [] });
  return parsed.success ? { kind: "valid", scope: parsed.data as CommissionAgentScope } : { kind: "invalid" };
}
export const canonicalScopeKey = (scope: CommissionAgentScope) => `${scope.mode}:${[...new Set(scope.agentIds)].sort().join(",")}`;
export const commissionScopeArgs = (scope: CommissionAgentScope) => ({
  p_agent_scope: scope.mode, p_agent_ids: scope.mode === "selected" ? scope.agentIds : null,
});
export function writeCommissionScope(params: URLSearchParams, value: CommissionAgentScope): URLSearchParams {
  const scope = commissionAgentScopeSchema.parse(value);
  const next = new URLSearchParams(params);
  next.set("agents", scope.mode);
  next.delete("agent_ids");
  next.delete("page");
  if (scope.mode === "selected") next.set("agent_ids", scope.agentIds.join(","));
  return next;
}
/** Only a UI Apply may normalize self to Me. Raw selected[self] URLs/API calls stay read-only. */
export function normalizeCommissionSelection(scope: CommissionAgentScope, actor: string, canViewOwn: boolean): CommissionAgentScope {
  const parsed = commissionAgentScopeSchema.parse(scope) as CommissionAgentScope;
  return canViewOwn && parsed.mode === "selected" && parsed.agentIds.length === 1 && parsed.agentIds[0] === actor.toLowerCase() ? ME_SCOPE : parsed;
}
export function commissionScopeHref(destination: string, scope: CommissionAgentScope): string {
  const url = new URL(destination, "https://agentflow.invalid");
  url.search = writeCommissionScope(url.searchParams, scope).toString();
  return `${url.pathname}${url.search}${url.hash}`;
}

export const commissionScopeMetaSchema = z.object({ mode: z.enum(["me", "all", "selected"]), agent_ids: z.array(agentId), revision: z.string().min(1) });
export type CommissionScopeMeta = z.infer<typeof commissionScopeMetaSchema>;
export const commissionRosterSearchSchema = z.string().max(200);
export const commissionAgentSchema = z.object({ agent_id: agentId, display_name: z.string(), status: z.string().nullable(), is_self: z.boolean() });
export type CommissionAgent = z.infer<typeof commissionAgentSchema>;
export const commissionAgentRosterSchema = z.object({
  agents: z.array(commissionAgentSchema), selected_agents: z.array(commissionAgentSchema),
  available_count: z.number().int().nonnegative(), total_count: z.number().int().nonnegative(),
  can_view_own: z.boolean(), can_select_others: z.boolean(), default_scope: z.enum(["me", "all"]).nullable(), scope_revision: z.string().min(1),
});
export type CommissionAgentRoster = z.infer<typeof commissionAgentRosterSchema>;

/** Scoped RPCs must carry both authority revision and credited identity; legacy response parsers stay compatible. */
export function validateScopedResponse(raw: unknown): void {
  const value = z.object({ meta: z.object({ agent_scope: commissionScopeMetaSchema }) }).passthrough().parse(raw);
  const ids = new Set(value.meta.agent_scope.agent_ids);
  const identity = z.object({ credited_agent_id: agentId, agent_name: z.string() });
  const envelope = raw as { rows?: unknown[]; upcoming?: { rows?: unknown[] }; policy?: unknown };
  for (const row of [...(envelope.rows ?? []), ...(envelope.upcoming?.rows ?? []), ...(envelope.policy ? [envelope.policy] : [])]) {
    const seller = identity.parse(row);
    if (!ids.has(seller.credited_agent_id)) throw new Error("Commission response is outside its applied scope");
  }
}
