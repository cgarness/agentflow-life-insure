/**
 * reports-queries — exact RPC contract and the failure contract: every failure THROWS a typed
 * ReportsQueryError; nothing is ever turned into a zero-shaped report.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportCampaigns, reportDispositions, reportLeadSources, reportScope, reportSummary, reportVolume } from "./reportsFixtures";

const h = vi.hoisted(() => ({
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  signals: [] as AbortSignal[],
  next: null as null | (() => Promise<{ data: unknown; error: unknown }>),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.calls.push({ fn, args });
      let signal: AbortSignal | undefined;
      const builder = {
        abortSignal: (s: AbortSignal) => { signal = s; h.signals.push(s); return builder; },
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
          const run = h.next ?? (() => Promise.resolve({ data: null, error: null }));
          // Mirror postgrest-js: an abort resolves with an error object whose code is "".
          const abortError = { data: null, error: { code: "", message: "AbortError" } };
          const aborted = new Promise<{ data: unknown; error: unknown }>((resolve) => {
            if (signal?.aborted) resolve(abortError);
            signal?.addEventListener("abort", () => resolve(abortError), { once: true });
          });
          return Promise.race([run(), aborted]).then(ok, ko);
        },
      };
      return builder;
    },
  },
}));

import {
  fetchReportCampaigns, fetchReportDispositions, fetchReportLeadSources, fetchReportScope, fetchReportSummary,
  fetchReportVolume, ReportsQueryError, REPORT_REQUEST_TIMEOUT_MS,
} from "@/lib/reports-queries";

const REQ = { startDate: "2026-07-01", endDate: "2026-07-31", agentId: null };
const respond = (data: unknown, error: unknown = null) => { h.next = () => Promise.resolve({ data, error }); };

async function expectKind(p: Promise<unknown>, kind: string) {
  const e = await p.then(() => null, (err) => err);
  expect(e).toBeInstanceOf(ReportsQueryError);
  expect((e as ReportsQueryError).kind).toBe(kind);
}

beforeEach(() => { h.calls = []; h.signals = []; h.next = null; });
afterEach(() => { vi.useRealTimers(); });

describe("RPC contract", () => {
  it("calls the secured RPCs with agency dates and an optional agent — never an organization or time zone", async () => {
    respond(reportScope()); await fetchReportScope();
    respond(reportSummary()); await fetchReportSummary({ ...REQ, agentId: "11000000-0000-0000-0000-0000000000c1" });
    respond(reportVolume()); await fetchReportVolume(REQ);
    respond(reportDispositions()); await fetchReportDispositions(REQ);
    respond(reportCampaigns()); await fetchReportCampaigns(REQ);
    respond(reportLeadSources()); await fetchReportLeadSources(REQ);
    expect(h.calls.map((c) => c.fn)).toEqual([
      "get_report_scope_v2", "get_report_call_summary_v2", "get_report_call_volume_v2",
      "get_report_disposition_breakdown_v2", "get_report_campaign_performance_v2", "get_report_lead_source_performance_v2",
    ]);
    expect(h.calls[0].args).toEqual({ p_requested_scope: null });
    expect(h.calls[1].args).toEqual({ p_start_date: "2026-07-01", p_end_date: "2026-07-31", p_agent_id: "11000000-0000-0000-0000-0000000000c1", p_requested_scope: null });
    expect(h.calls[2].args).toEqual({ p_start_date: "2026-07-01", p_end_date: "2026-07-31", p_agent_id: null, p_requested_scope: null });
    for (const c of h.calls) {
      expect(Object.keys(c.args)).not.toContain("p_org_id");
      expect(Object.keys(c.args).some((k) => /time_?zone/i.test(k))).toBe(false);
    }
    expect(h.calls.some((c) => c.fn.startsWith("rpc_report_"))).toBe(false);
  });

  it("returns the parsed payload on success", async () => {
    respond(reportSummary());
    const s = await fetchReportSummary(REQ);
    expect(s.totals.calls_made).toBe(19);
    expect(s.window.time_zone).toBe("America/Los_Angeles");
  });
});

describe("failure contract — never a zero report", () => {
  it("maps the RPCs' own 42501 authorization refusals to denied", async () => {
    respond(null, { code: "42501", message: "reports: agent is outside your report scope" });
    await expectKind(fetchReportSummary(REQ), "denied");
    respond(null, { code: "42501", message: "profile is not active" });
    await expectKind(fetchReportScope(), "denied");
  });
  it("maps a revoked-EXECUTE 42501 (the emergency-disable state) to unavailable, never to the viewer's denial", async () => {
    respond(null, { code: "42501", message: "permission denied for function get_report_scope" });
    await expectKind(fetchReportScope(), "unavailable");
    respond(null, { code: "42501", message: "permission denied for schema private" });
    await expectKind(fetchReportSummary(REQ), "unavailable");
  });
  it("maps 22023 to invalid", async () => {
    respond(null, { code: "22023", message: "reports: date range is longer than 366 days" });
    await expectKind(fetchReportVolume(REQ), "invalid");
  });
  it("maps 55000 (no valid agency time zone) to configuration — never a report in a guessed zone", async () => {
    respond(null, { code: "55000", message: "reports: the agency time zone is not configured" });
    await expectKind(fetchReportScope(), "configuration");
    respond(null, { code: "55000", message: "reports: the agency time zone setting is not a valid IANA zone" });
    await expectKind(fetchReportVolume(REQ), "configuration");
    const e = new ReportsQueryError("configuration");
    expect(e.message).toBe("The agency time zone must be configured before official Reports can be calculated.");
  });
  it("rejects a payload that claims a defaulted (unconfigured) time zone", async () => {
    respond(reportScope({ time_zone_source: "default" as never }));
    await expectKind(fetchReportScope(), "unavailable");
    const s = reportSummary();
    respond({ ...s, window: { ...s.window, time_zone_source: "default" } });
    await expectKind(fetchReportSummary(REQ), "unavailable");
  });
  it("maps a missing function / any other provider error to unavailable", async () => {
    respond(null, { code: "PGRST202", message: "Could not find the function" });
    await expectKind(fetchReportCampaigns(REQ), "unavailable");
  });
  it("treats null data as unavailable, not as an empty report", async () => {
    respond(null);
    await expectKind(fetchReportSummary(REQ), "unavailable");
  });
  it("rejects a mis-shaped payload (schema) instead of rendering it", async () => {
    const bad = reportSummary() as unknown as Record<string, unknown>;
    delete bad.totals;
    respond(bad);
    await expectKind(fetchReportSummary(REQ), "unavailable");
    const negative = reportSummary({ calls_made: -1 });
    respond(negative);
    await expectKind(fetchReportSummary(REQ), "unavailable");
  });
  it("rejects a lead-source payload that claims converted is available", async () => {
    respond({ ...reportLeadSources(), converted_available: true });
    await expectKind(fetchReportLeadSources(REQ), "unavailable");
  });
  it("maps a thrown network failure to unavailable", async () => {
    h.next = () => Promise.reject(new TypeError("Failed to fetch"));
    await expectKind(fetchReportDispositions(REQ), "unavailable");
  });
  it("refuses a malformed date before sending anything", async () => {
    await expectKind(fetchReportSummary({ startDate: "07/01/2026", endDate: "2026-07-31", agentId: null }), "invalid");
    expect(h.calls).toHaveLength(0);
  });
});

describe("request lifetime", () => {
  it("forwards cancellation: an aborted caller gets 'aborted', never data", async () => {
    h.next = () => new Promise(() => {}); // never answers
    const controller = new AbortController();
    const p = fetchReportSummary(REQ, controller.signal);
    expect(h.signals).toHaveLength(1);
    controller.abort();
    await expectKind(p, "aborted");
  });
  it("bounds a hung request with a timeout", async () => {
    vi.useFakeTimers();
    h.next = () => new Promise(() => {});
    const p = fetchReportVolume(REQ);
    const settled = p.then(() => null, (e) => e);
    await vi.advanceTimersByTimeAsync(REPORT_REQUEST_TIMEOUT_MS + 1);
    const e = await settled;
    expect((e as ReportsQueryError).kind).toBe("timeout");
  });
  it("user-facing messages never echo the provider error", async () => {
    respond(null, { code: "42501", message: "reports: agent is outside your report scope" });
    const e = (await fetchReportSummary(REQ).catch((x) => x)) as ReportsQueryError;
    expect(e.message).not.toMatch(/reports:/);
    expect(e.cause).toEqual({ code: "42501", message: "reports: agent is outside your report scope" });
  });
});
