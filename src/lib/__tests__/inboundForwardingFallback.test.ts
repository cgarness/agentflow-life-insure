import { describe, expect, it, vi } from "vitest";
import { type AttemptView, voicemailCallbackQuery } from "../../../supabase/functions/twilio-voice-inbound/planner";
import { runInitialV2Request } from "../../../supabase/functions/twilio-voice-inbound/request";
import { createRequestDeadline, REQUEST_DEADLINE_MS } from "../../../supabase/functions/twilio-voice-inbound/settings";
import {
  type RpcResult,
  type StageDeps,
  handleInitialV2,
  handleOwnerBrowserReturn,
} from "../../../supabase/functions/twilio-voice-inbound/stages";

const OWNER = "aaaaaaaa-0000-0000-0000-000000000001";
const OTHER = "aaaaaaaa-0000-0000-0000-000000000002";
const ORG = "bbbbbbbb-0000-0000-0000-000000000001";
const CALL = "cccccccc-0000-0000-0000-000000000001";
const ATTEMPT = "dddddddd-0000-0000-0000-000000000001";
const MOBILE = "+15555550101";
const ctx = { callRowId: CALL, orgId: ORG, attemptId: ATTEMPT, agentId: OWNER, fromNumber: "+15555550102", parentCallSid: `CA${"1".repeat(32)}` };
const initialArgs = { ...ctx, ownerAgentId: OWNER, ownerSource: "contact" as const, groupIds: [OTHER] };
const committed = { updated: true, forward: true, stage: "owner_mobile", mobile: MOBILE, owner: OWNER };

function fixture(options: {
  persisted?: boolean;
  identities?: string[];
  attempt?: Partial<AttemptView>;
  advance?: RpcResult | (() => RpcResult | Promise<RpcResult>);
} = {}) {
  const attempt: AttemptView = {
    id: ATTEMPT, stage: "owner_browser", mode: "owner", owner_agent_id: OWNER,
    reserved_agent_ids: [OWNER], browser_ring_timeout_sent: 20, mobile_number_dialed: null,
    voicemail_kind: null, voicemail_agent_id: null, voicemail_group_ids: [], terminal: false,
    ...options.attempt,
  };
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const deps: StageDeps = {
    rpc: vi.fn(async (name, args) => {
      calls.push({ name, args });
      if (name === "plan_inbound_route") return { data: { created: true, attempt }, error: null };
      if (name === "advance_to_owner_mobile") {
        return typeof options.advance === "function" ? options.advance() : options.advance ?? { data: committed, error: null };
      }
      return { data: { updated: true }, error: null };
    }),
    loadAttempt: vi.fn(async () => attempt),
    persistRoutedAgents: vi.fn(async () => options.persisted ?? false),
    resolveIdentities: vi.fn(async (ids) => ids.filter((id) => (options.identities ?? [OWNER]).includes(id)).map((agentId) => ({ agentId, identity: `agent_${agentId}` }))),
    loadAgentGreeting: vi.fn(async () => ({ text: "Owner greeting", url: null })),
    urls: {
      stage: (query) => `https://example.test/inbound?${new URLSearchParams(query)}`,
      recordingStatus: (query) => `https://example.test/recording?${new URLSearchParams(query)}`,
      claimCallbackBase: "https://example.test/claim",
    },
    settings: { browserRingSeconds: 20, mobileRingSeconds: 20, recordingEnabled: true, greetingText: "Group greeting", greetingUrl: "" },
    log: vi.fn(),
    sleep: async () => {},
  };
  return { deps, calls, attempt };
}

function xml(twiml: string) {
  return new DOMParser().parseFromString(twiml, "text/xml");
}

function assertOwnerVoicemail(twiml: string) {
  const doc = xml(twiml);
  expect(doc.querySelector("Number, Client")).toBeNull();
  const record = doc.querySelector("Record");
  expect(record).not.toBeNull();
  const query = new URL(record!.getAttribute("recordingStatusCallback")!).searchParams;
  expect(Object.fromEntries(query)).toEqual({ source: "voicemail", mailbox: "agent", mailbox_agent_id: OWNER, call_row_id: CALL, org_id: ORG, attempt_id: ATTEMPT });
  expect(twiml).not.toContain("agent%3A");
  expect(doc.querySelector("Say")?.textContent).toBe("Owner greeting");
}

describe("suppressed owner browser wave uses the authoritative mobile transition", () => {
  it.each([
    { label: "routed-agent persistence refused", persisted: false, identities: [OWNER] },
    { label: "no usable browser identity", persisted: true, identities: [] },
  ])("$label: forwards only the committed snapshot with original callback binding", async (options) => {
    const { deps, calls } = fixture(options);
    const response = await handleInitialV2(deps, initialArgs);
    const doc = xml(response.twiml);
    expect(doc.querySelector("Client, Record")).toBeNull();
    expect(doc.querySelector("Number")?.textContent).toBe(MOBILE);
    expect(doc.querySelector("Dial")?.getAttribute("timeout")).toBe("20");
    expect(doc.querySelector("Dial")?.hasAttribute("record")).toBe(false);
    expect(doc.querySelector("Dial")?.hasAttribute("callerId")).toBe(false);
    for (const [selector, attr, stage] of [["Dial", "action", "owner_mobile"], ["Number", "url", "mobile_whisper"], ["Number", "statusCallback", "mobile_leg_status"]]) {
      const query = new URL(doc.querySelector(selector)!.getAttribute(attr)!).searchParams;
      expect(Object.fromEntries(query)).toEqual({ stage, call_row_id: CALL, org_id: ORG, attempt_id: ATTEMPT, agent_id: OWNER });
    }
    expect(calls.map(({ name }) => name)).toEqual(["plan_inbound_route", "advance_to_owner_mobile", "append_inbound_provider_outcome", "converge_inbound_notifications"]);
    expect(calls[1].args).toEqual({ p_attempt_id: ATTEMPT, p_org_id: ORG, p_call_row_id: CALL });
    expect(calls[2].args.p_entry).toEqual({ event: "wave_suppressed", stage: "owner_browser", persisted: options.persisted, identities: 0, advance: "forward" });
    expect(deps.persistRoutedAgents).toHaveBeenCalledWith([OWNER]);
    expect(deps.resolveIdentities).toHaveBeenCalledTimes(options.persisted ? 1 : 0);
  });

  // These fixtures are exact live RPC result contracts, not simulations of SQL eligibility logic.
  // Both Break/DND return dnd, and disabled/missing-number settings both return no_mobile.
  it.each(["dnd", "busy", "no_mobile", "owner_ineligible"])("honors current SQL refusal %s without forcing a second transition or missed mark", async (reason) => {
    const { deps, calls } = fixture({ advance: { data: { updated: true, forward: false, reason, stage: "owner_voicemail", owner: OWNER }, error: null } });
    assertOwnerVoicemail((await handleInitialV2(deps, initialArgs)).twiml);
    expect(calls.map(({ name }) => name)).not.toContain("advance_inbound_route_stage");
    expect(calls.map(({ name }) => name)).not.toContain("mark_inbound_missed");
    expect(calls.find(({ name }) => name === "append_inbound_provider_outcome")?.args.p_entry).toMatchObject({ event: "wave_suppressed", advance: reason });
  });

  it("unknown commitment after bounded retries uses guarded voicemail and never a mobile Dial", async () => {
    const { deps, calls } = fixture({ advance: { data: null, error: { message: "connection lost" } } });
    assertOwnerVoicemail((await handleInitialV2(deps, initialArgs)).twiml);
    expect(calls.filter(({ name }) => name === "advance_to_owner_mobile")).toHaveLength(3);
    expect(calls.find(({ name }) => name === "mark_inbound_missed")?.args).toEqual({ p_call_row_id: CALL, p_org_id: ORG, p_reason: "no_answer", p_recipient_ids: [OWNER], p_for_agent_id: OWNER });
    // Preserve the failure path's request budget: no extra telemetry RPC after failed retries.
    expect(calls.map(({ name }) => name)).not.toContain("append_inbound_provider_outcome");
    expect(calls.map(({ name }) => name)).not.toContain("advance_inbound_route_stage");
  });

  it("a stalled suppressed-wave advance respects the request deadline and ignores its late forward reply", async () => {
    vi.useFakeTimers();
    try {
      const deadline = createRequestDeadline(REQUEST_DEADLINE_MS);
      let resolveAdvance!: (result: RpcResult) => void;
      const { deps, calls } = fixture({ advance: () => new Promise((resolve) => { resolveAdvance = resolve; }) });
      const abandon = vi.fn(async () => {});
      const start = Date.now();
      let respondedAt = 0;
      const response = runInitialV2Request(deps, initialArgs, deadline, {
        abandon, sorryTwiml: "<Response><Say>sorry</Say><Hangup/></Response>", log: () => {},
      }).then((value) => { respondedAt = Date.now(); return value; });
      await vi.advanceTimersByTimeAsync(REQUEST_DEADLINE_MS);
      const value = await response;
      expect(respondedAt - start).toBeLessThanOrEqual(REQUEST_DEADLINE_MS);
      expect(value.twiml).toContain("sorry");
      expect(xml(value.twiml).querySelector("Number, Client, Record")).toBeNull();
      expect(deadline.abandoned).toContain("rpc:advance_to_owner_mobile");
      expect(abandon).toHaveBeenCalledTimes(1);
      const settledCalls = [...calls];
      resolveAdvance({ data: committed, error: null });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(calls).toEqual(settledCalls);
      expect(calls.map(({ name }) => name)).toEqual(["plan_inbound_route", "advance_to_owner_mobile"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { label: "attempt absent", result: { updated: false, reason: "attempt_not_found" } },
    { label: "caller already ended", result: { updated: false, forward: false, reason: "call_terminal", stage: "owner_browser", terminal: false } },
    { label: "stage conflict", result: { updated: false, forward: false, reason: "stage_conflict", stage: "owner_browser", terminal: false } },
    { label: "already in voicemail", result: { updated: false, reason: "stage_mismatch", stage: "owner_voicemail", terminal: false, mobile: null } },
  ])("$label: preserves canonical voicemail fail-safe with no new routing writes", async ({ result }) => {
    const { deps, calls } = fixture({ advance: { data: result, error: null } });
    assertOwnerVoicemail((await handleInitialV2(deps, initialArgs)).twiml);
    expect(calls.map(({ name }) => name)).not.toContain("advance_inbound_route_stage");
    expect(calls.map(({ name }) => name)).not.toContain("mark_inbound_missed");
  });

  it.each([
    { label: "browser claim won", result: { updated: false, forward: false, reason: "call_not_forwardable", stage: "owner_browser", terminal: false } },
    { label: "attempt already done", result: { updated: false, reason: "stage_mismatch", stage: "done", terminal: true, mobile: MOBILE } },
  ])("$label: never rings or records", async ({ result }) => {
    const { deps, calls } = fixture({ advance: { data: result, error: null } });
    expect(xml((await handleInitialV2(deps, initialArgs)).twiml).querySelector("Response")?.children).toHaveLength(0);
    expect(calls.find(({ name }) => name === "finalize_inbound_call_terminal")?.args).toMatchObject({ p_status: "completed", p_mark_missed: false, p_external_answer: false });
    expect(calls.map(({ name }) => name)).not.toContain("advance_inbound_route_stage");
  });

  it("retry after an acknowledged-lost commit re-emits only the persisted mobile snapshot", async () => {
    let requests = 0;
    const { deps, calls } = fixture({ advance: () => ++requests === 1
      ? { data: null, error: { message: "response lost" } }
      : { data: { updated: false, reason: "stage_mismatch", stage: "owner_mobile", terminal: false, mobile: MOBILE }, error: null } });
    expect(xml((await handleInitialV2(deps, initialArgs)).twiml).querySelector("Number")?.textContent).toBe(MOBILE);
    expect(requests).toBe(2);
    expect(calls.map(({ name }) => name)).not.toContain("advance_inbound_route_stage");
    expect(calls.map(({ name }) => name)).not.toContain("mark_inbound_missed");
  });

  it("a successful browser wave retains 20-second ring and never advances early", async () => {
    const { deps, calls } = fixture({ persisted: true });
    const doc = xml((await handleInitialV2(deps, initialArgs)).twiml);
    expect(doc.querySelector("Client Identity")?.textContent).toBe(`agent_${OWNER}`);
    expect(doc.querySelector("Dial")?.getAttribute("timeout")).toBe("20");
    expect(doc.querySelector("Number")).toBeNull();
    expect(calls.map(({ name }) => name)).toEqual(["plan_inbound_route"]);
  });

  it("offline owner continues directly from the planner's committed mobile snapshot", async () => {
    const { deps, calls } = fixture({ attempt: { stage: "owner_mobile", mobile_number_dialed: MOBILE } });
    expect(xml((await handleInitialV2(deps, initialArgs)).twiml).querySelector("Number")?.textContent).toBe(MOBILE);
    expect(calls.map(({ name }) => name)).toEqual(["plan_inbound_route", "converge_inbound_notifications"]);
    expect(deps.persistRoutedAgents).not.toHaveBeenCalled();
  });

  it("a suppressed group wave still uses group voicemail without trying members' phones", async () => {
    const { deps, calls } = fixture({ attempt: { mode: "group", stage: "group_browser", owner_agent_id: null, reserved_agent_ids: [OTHER] } });
    const doc = xml((await handleInitialV2(deps, { ...initialArgs, ownerAgentId: null, ownerSource: null })).twiml);
    expect(doc.querySelector("Number, Client")).toBeNull();
    expect(new URL(doc.querySelector("Record")!.getAttribute("recordingStatusCallback")!).searchParams.get("mailbox")).toBe("group");
    expect(calls.map(({ name }) => name)).not.toContain("advance_to_owner_mobile");
    expect(calls.find(({ name }) => name === "advance_inbound_route_stage")?.args).toMatchObject({ p_from_stage: "group_browser", p_to_stage: "group_voicemail" });
    expect(calls.find(({ name }) => name === "mark_inbound_missed")?.args).toMatchObject({ p_recipient_ids: [OTHER], p_for_agent_id: null });
  });

  it("an actual browser Dial return keeps its provider evidence and shares the guarded transition", async () => {
    const { deps, calls } = fixture();
    const sid = `CA${"2".repeat(32)}`;
    expect(xml((await handleOwnerBrowserReturn(deps, ctx, { DialCallStatus: "no-answer", DialCallSid: sid })).twiml).querySelector("Number")?.textContent).toBe(MOBILE);
    expect(calls.find(({ name }) => name === "append_inbound_provider_outcome")?.args.p_entry).toEqual({ event: "dial_action", stage: "owner_browser", dial_call_status: "no-answer", dial_call_sid: sid, advance: "forward" });
  });

  it("an answered browser Dial return never enters the mobile transition", async () => {
    const { deps, calls } = fixture();
    expect(xml((await handleOwnerBrowserReturn(deps, ctx, { DialCallStatus: "completed" })).twiml).querySelector("Number, Client, Record")).toBeNull();
    expect(calls.map(({ name }) => name)).toEqual(["advance_inbound_route_stage", "finalize_inbound_call_terminal"]);
  });
});

describe("preserved live voicemail callback repair", () => {
  it("agent mailbox values need no percent encoding; group callbacks stay unchanged", () => {
    const agent = voicemailCallbackQuery(`agent:${OWNER}`);
    expect(agent).toEqual({ valid: true, query: { source: "voicemail", mailbox: "agent", mailbox_agent_id: OWNER } });
    expect(new URLSearchParams(agent.query).toString()).not.toContain("%");
    expect(voicemailCallbackQuery("group")).toEqual({ valid: true, query: { source: "voicemail", mailbox: "group" } });
  });

  it("invalid agent mailbox fails closed without falling back to the group", () => {
    expect(voicemailCallbackQuery("agent:invalid")).toEqual({ valid: false, query: { source: "voicemail", mailbox: "agent" } });
  });
});
