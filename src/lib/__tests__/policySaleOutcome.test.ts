import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown]>,
  respond: (async () => ({ data: null, error: null })) as (name: string, args: unknown) => Promise<unknown>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      h.calls.push([name, args]);
      return h.respond(name, args);
    },
  },
}));

import {
  classifySaleError,
  commissionNotice,
  conflictMessage,
  freezeSale,
  newSaleAttempt,
  notSentError,
  parseCommissionOutcome,
  parseSaleResult,
  SaleRequestError,
  type PreparedSale,
} from "../policySaleOutcome";
import { readSaleOperationStatus, runPreparedSale, sendPreparedSale } from "../policySaleRecording";

const CLIENT = "00000000-0000-4000-8000-000000000001";
const WIN = "00000000-0000-4000-8000-000000000002";
const prepared = (overrides: Partial<PreparedSale> = {}): PreparedSale => ({
  kind: "convert",
  requestId: "00000000-0000-4000-8000-0000000000aa",
  leadId: "00000000-0000-4000-8000-0000000000bb",
  expectedClientId: null,
  saleArgs: { p_lead_id: "lead", p_expected_org: "org", p_client: { premium: 50, custom_fields: { additional_policies: [] } }, p_campaign_id: null },
  commission: { v: "policy-commission-v1", slots: [] },
  notify: true,
  ...overrides,
});
const ok = (extra: Record<string, unknown> = {}) => ({
  data: { client_id: CLIENT, win_ids: [WIN], idempotent: false, commission: { status: "evidence_recorded", slots: [] }, ...extra },
  error: null,
  status: 200,
});

beforeEach(() => {
  h.calls = [];
  h.respond = async () => ok();
});

describe("classifySaleError", () => {
  it("never treats an unsent request as anything but not sent", () => {
    expect(classifySaleError("PT409", false)).toBe("not_sent");
    expect(classifySaleError(null, false)).toBe("not_sent");
  });
  it("maps PT409 to a conflict and only confirmed rollbacks to rejections", () => {
    expect(classifySaleError("PT409", true)).toBe("conflict");
    for (const code of ["22023", "22P02", "22007", "22008", "23502", "23503", "23505", "23514", "42501", "P0002", "PT404",
      "40001", "40P01", "55P03", "57014", "PGRST100", "PGRST202", "PGRST301"]) {
      expect(classifySaleError(code, true)).toBe("rejected");
    }
  });
  it("keeps every other outcome unknown, including statement-completion and connection classes", () => {
    for (const code of [null, "", "40003", "08007", "08006", "57P01", "57P02", "57P03", "53100", "XX000", "XX001", "XX002",
      "PGRST000", "PGRST003", "P0001", "99999"]) {
      expect(classifySaleError(code, true)).toBe("unknown");
    }
  });
});

describe("parsing", () => {
  it("validates the sale independently of commission metadata", () => {
    expect(parseSaleResult({ client_id: CLIENT, win_ids: [WIN], idempotent: true }, null)).toMatchObject({ clientId: CLIENT, idempotent: true });
    expect(parseSaleResult({ client_id: "not-a-uuid", win_ids: [] }, null)).toBeNull();
    expect(parseSaleResult({ client_id: CLIENT, win_ids: [1] }, null)).toBeNull();
    expect(parseSaleResult({ client_id: CLIENT, win_ids: [] }, "00000000-0000-4000-8000-000000000009")).toBeNull();
    expect(parseSaleResult({ client_id: CLIENT, win_ids: [], client: { id: "other" } }, null)).toBeNull();
    expect(parseCommissionOutcome(undefined)).toEqual({ status: "malformed", slots: [] });
    expect(parseCommissionOutcome({ status: "evidence_recorded", slots: [{ slot: "primary", status: "weird" }] }).status).toBe("malformed");
    expect(parseCommissionOutcome({ status: "evidence_recorded", slots: [{ slot: "primary", status: "recorded", policy_id: WIN, code: null }] }))
      .toEqual({ status: "evidence_recorded", slots: [{ slot: "primary", policyId: WIN, status: "recorded", code: null }] });
  });
});

describe("freezeSale", () => {
  it("returns a deep-frozen private copy that later edits of the source cannot reach", () => {
    const source = prepared();
    const frozen = freezeSale(source);
    (source.saleArgs.p_client as { premium: number }).premium = 99;
    expect((frozen.saleArgs.p_client as { premium: number }).premium).toBe(50);
    expect(Object.isFrozen(frozen.saleArgs.p_client)).toBe(true);
    expect(() => { (frozen.saleArgs.p_client as { premium: number }).premium = 1; }).toThrow();
  });
});

describe("sendPreparedSale", () => {
  it("marks the attempt sent before the request and sends the companion with request id and commission", async () => {
    const attempt = newSaleAttempt();
    let sentAtCall = false;
    h.respond = async () => { sentAtCall = attempt.sent; return ok(); };
    const result = await sendPreparedSale(prepared(), attempt);
    expect(sentAtCall).toBe(true);
    expect(h.calls[0][0]).toBe("convert_lead_to_client_with_sales_handoff");
    expect(h.calls[0][1]).toMatchObject({ p_lead_id: "lead", p_request_id: prepared().requestId, p_commission: { v: "policy-commission-v1", slots: [] } });
    expect(result.winIds).toEqual([WIN]);
    expect(attempt.result).toBe(result);
    expect(h.calls.map(([name]) => name)).toContain("notify_win");
  });
  it("never celebrates a historical entry", async () => {
    await sendPreparedSale(prepared({ notify: false }), newSaleAttempt());
    expect(h.calls.map(([name]) => name)).not.toContain("notify_win");
  });
  it("classifies server errors and keeps the server message", async () => {
    h.respond = async (name) => name === "get_policy_sale_operation_status"
      ? { data: { state: "committed_by_another_user" }, error: null }
      : { data: null, error: { message: "This lead is already converted; refresh the client before editing", code: "PT409" }, status: 409 };
    await expect(sendPreparedSale(prepared(), newSaleAttempt()))
      .rejects.toMatchObject({ errorClass: "conflict", code: "PT409", status: 409, operation: { state: "committed_by_another_user" } });
    expect(h.calls.map(([name]) => name)).toEqual(["convert_lead_to_client_with_sales_handoff", "get_policy_sale_operation_status"]);
    h.respond = async () => ({ data: null, error: { message: "Invalid client payload", code: "22023" }, status: 400 });
    await expect(sendPreparedSale(prepared(), newSaleAttempt())).rejects.toMatchObject({ errorClass: "rejected", message: "Invalid client payload" });
    h.respond = async () => ({ data: null, error: { message: "TypeError: fetch failed", code: "" }, status: 0 });
    await expect(sendPreparedSale(prepared(), newSaleAttempt())).rejects.toMatchObject({ errorClass: "unknown" });
  });
  it("treats a thrown transport error and an unreadable success as unknown, never as failed", async () => {
    h.respond = async () => { throw new Error("socket hang up"); };
    await expect(sendPreparedSale(prepared(), newSaleAttempt())).rejects.toMatchObject({ errorClass: "unknown" });
    h.respond = async () => ({ data: { unexpected: true }, error: null, status: 200 });
    await expect(sendPreparedSale(prepared(), newSaleAttempt())).rejects.toMatchObject({ errorClass: "unknown" });
  });
  it("keeps a saved sale saved when only the commission metadata is malformed", async () => {
    h.respond = async () => ok({ commission: "garbage" });
    const result = await sendPreparedSale(prepared(), newSaleAttempt());
    expect(result.commission.status).toBe("malformed");
    expect(commissionNotice(result.commission, 1)).toMatch(/^Policy saved/);
  });
});

describe("runPreparedSale", () => {
  it("replays a frozen submission exactly and never rebuilds it", async () => {
    const frozen = freezeSale(prepared());
    const prepare = vi.fn(() => prepared({ requestId: "different" }));
    await runPreparedSale(newSaleAttempt(frozen), prepare);
    expect(prepare).not.toHaveBeenCalled();
    expect(h.calls[0][1]).toEqual({ ...frozen.saleArgs, p_request_id: frozen.requestId, p_commission: frozen.commission });
  });
  it("reports a failure to build the submission as not sent", async () => {
    const attempt = newSaleAttempt();
    await expect(runPreparedSale(attempt, () => { throw new Error("Enter a nonnegative monthly premium"); })).rejects.toMatchObject({ errorClass: "not_sent" });
    expect(attempt.sent).toBe(false);
    expect(h.calls).toHaveLength(0);
    await expect(runPreparedSale(newSaleAttempt(), () => { throw notSentError("No org"); })).rejects.toBeInstanceOf(SaleRequestError);
  });
});

describe("operation status and messages", () => {
  it("reads caller-scoped server truth with the recomputable sale arguments", async () => {
    h.respond = async () => ({ data: { state: "committed", same_payload: false, this_request: true }, error: null });
    expect(await readSaleOperationStatus(prepared())).toEqual({ state: "committed", samePayload: false, thisRequest: true });
    expect(h.calls[0]).toEqual(["get_policy_sale_operation_status", {
      p_kind: "convert", p_request_id: prepared().requestId, p_lead_id: prepared().leadId, p_sale_args: prepared().saleArgs,
    }]);
    h.respond = async () => ({ data: null, error: { message: "boom" } });
    expect(await readSaleOperationStatus(prepared())).toEqual({ state: "unreadable" });
    expect(conflictMessage({ state: "committed_by_another_user" })).toMatch(/Another user/);
  });
  it("words each commission result separately from the saved sale", () => {
    const slot = (status: string) => ({ status: "evidence_recorded" as const, slots: [{ slot: "primary", policyId: null, status: status as never, code: null }] });
    expect(commissionNotice(slot("recorded"), 1)).toBeNull();
    expect(commissionNotice(slot("needs_attention"), 1)).toMatch(/needs attention/);
    expect(commissionNotice(slot("awaiting_confirmation"), 1)).toMatch(/awaits confirmation/);
    // Superseded: an estimate was recorded later for the policy, so nothing is pending.
    expect(parseCommissionOutcome({ status: "evidence_recorded", slots: [{ slot: "primary", policy_id: null, status: "superseded", code: null }] }))
      .toEqual({ status: "evidence_recorded", slots: [{ slot: "primary", policyId: null, status: "superseded", code: null }] });
    expect(commissionNotice(slot("superseded"), 1)).toBeNull();
    expect(commissionNotice({ status: "not_recorded", slots: [] }, 1)).toMatch(/wasn't recorded/);
    expect(commissionNotice({ status: "not_recorded", slots: [] }, 0)).toBeNull();
  });
});
