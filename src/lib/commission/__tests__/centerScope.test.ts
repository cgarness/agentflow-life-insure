import { describe, expect, it } from "vitest";
import { canonicalScopeKey, commissionScopeArgs, commissionScopeHref, normalizeCommissionSelection, parseCommissionScope,
  validateScopedResponse, writeCommissionScope } from "../centerScope";
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const parse = (value: string) => parseCommissionScope(new URLSearchParams(value));
describe("commission agent scope URL contract", () => {
  it("distinguishes absent defaults from invalid explicit selections", () => {
    expect(parse("period=last_month")).toEqual({ kind: "missing" });
    for (const invalid of ["agents=", "agents=unknown", "agents=selected", "agents=selected&agent_ids=", "agent_ids=" + A,
      "agents=me&agent_ids=", "agents=all&agent_ids=" + A, "agents=selected&agent_ids=null", "agents=selected&agent_ids=" + A + ",",
      "agents=me&agents=all", "agents=selected&agent_ids=" + A + "&agent_ids=" + B]) expect(parse(invalid)).toEqual({ kind: "invalid" });
  });
  it("canonicalizes duplicate/order/case without making selected self writable", () => {
    const selected = parse(`agents=selected&agent_ids=${B},${A},${B}`);
    expect(selected).toEqual({ kind: "valid", scope: { mode: "selected", agentIds: [A, B] } });
    expect(parse(`agents=selected&agent_ids=${A}`)).toMatchObject({ scope: { mode: "selected" } });
    expect(canonicalScopeKey({ mode: "selected", agentIds: [B, A, A] })).toBe(`selected:${A},${B}`);
  });
  it("normalizes only a UI self selection; All remains team even with only self", () => {
    expect(normalizeCommissionSelection({ mode: "selected", agentIds: [A] }, A, true)).toEqual({ mode: "me", agentIds: [] });
    expect(normalizeCommissionSelection({ mode: "selected", agentIds: [A] }, A, false).mode).toBe("selected");
    expect(normalizeCommissionSelection({ mode: "all", agentIds: [] }, A, true).mode).toBe("all");
    expect(commissionScopeArgs({ mode: "all", agentIds: [] })).toEqual({ p_agent_scope: "all", p_agent_ids: null });
  });
  it("preserves destination date filters separately and resets page atomically", () => {
    const params = writeCommissionScope(new URLSearchParams("dates=next_90&page=4&agents=all"), { mode: "selected", agentIds: [B, A] });
    expect(params.get("dates")).toBe("next_90"); expect(params.has("page")).toBe(false);
    expect(params.get("agent_ids")).toBe(`${A},${B}`);
    expect(commissionScopeHref("/commissions/payments?dates=any&status=date_needed#rows", { mode: "all", agentIds: [] }))
      .toBe("/commissions/payments?dates=any&status=date_needed&agents=all#rows");
  });
  it("requires authority metadata and credited identity on every scoped financial row", () => {
    const meta = { scope: "next_90", agent_scope: { mode: "selected", agent_ids: [A], revision: "r1" } };
    expect(() => validateScopedResponse({ meta, rows: [{ credited_agent_id: A, agent_name: "Synthetic A" }] })).not.toThrow();
    expect(() => validateScopedResponse({ meta, rows: [{ credited_agent_id: B, agent_name: "Synthetic B" }] })).toThrow();
    expect(() => validateScopedResponse({ meta, upcoming: { rows: [{}] } })).toThrow();
    expect(() => validateScopedResponse({ meta: { today: "2026-11-10" }, rows: [] })).toThrow();
  });
});
