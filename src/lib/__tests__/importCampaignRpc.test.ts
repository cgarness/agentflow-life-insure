import { describe, it, expect, beforeEach, vi } from "vitest";

const { calls, rpcResults } = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: any }>,
  rpcResults: {} as Record<string, { data: unknown; error: unknown }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: any) => {
      calls.push({ name, args });
      return Promise.resolve(rpcResults[name] ?? { data: null, error: null });
    },
  },
}));

import {
  createImportCampaign,
  retryImportCampaignAttachment,
  canDialCampaign,
  isRetryableImportStatus,
  describeImportCompletion,
} from "@/lib/supabase-import-campaign";

const CAMP = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const AGENT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const IMPORT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ORG = "dddddddd-dddd-dddd-dddd-dddddddddddd";

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(rpcResults)) delete rpcResults[k];
});

describe("createImportCampaign", () => {
  it("calls create_import_campaign with the owner and participants, never a raw table insert", async () => {
    rpcResults["create_import_campaign"] = {
      data: {
        id: CAMP, type: "Personal", user_id: AGENT, created_by: ORG,
        assigned_agent_ids: [AGENT], organization_id: ORG,
      },
      error: null,
    };
    const res = await createImportCampaign({
      name: "Q3 FEX",
      type: "Personal",
      description: "",
      ownerId: AGENT,
      participantIds: [AGENT],
      strategy: "specific_agent",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("create_import_campaign");
    expect(calls[0].args).toEqual({
      p_name: "Q3 FEX",
      p_type: "Personal",
      p_description: "",
      p_owner_id: AGENT,
      p_participant_ids: [AGENT],
      p_assignment_strategy: "specific_agent",
    });
    expect(res?.id).toBe(CAMP);
    expect(res?.user_id).toBe(AGENT);
  });

  it("rejects a malformed response envelope rather than returning a half-built campaign", async () => {
    rpcResults["create_import_campaign"] = {
      data: { id: "not-a-uuid", type: "Personal", user_id: AGENT, assigned_agent_ids: [], organization_id: ORG },
      error: null,
    };
    await expect(
      createImportCampaign({ name: "x", type: "Personal", description: "", ownerId: AGENT, participantIds: [AGENT], strategy: "specific_agent" }),
    ).rejects.toThrow(/unexpected campaign payload/i);
  });

  it("validates the OUTBOUND payload before it leaves the browser", async () => {
    await expect(
      createImportCampaign({ name: "x", type: "Personal", description: "", ownerId: "nope", participantIds: [], strategy: "specific_agent" }),
    ).rejects.toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("propagates a server rejection (e.g. Round Robin + Personal) instead of swallowing it", async () => {
    rpcResults["create_import_campaign"] = { data: null, error: { message: "round robin imports cannot use a Personal campaign" } };
    await expect(
      createImportCampaign({ name: "x", type: "Personal", description: "", ownerId: null, participantIds: [AGENT], strategy: "round_robin" }),
    ).rejects.toThrow(/Personal/i);
  });
});

describe("retryImportCampaignAttachment", () => {
  it("sends ONLY the import id — never client-supplied lead ids", async () => {
    rpcResults["retry_import_campaign_attachment"] = {
      data: { ok: true, status: "completed", imported_count: 106, attached_count: 106, newly_attached: 106, already_present: 0, ineligible_count: 0, remaining_count: 0 },
      error: null,
    };
    const res = await retryImportCampaignAttachment(IMPORT);
    expect(calls[0].name).toBe("retry_import_campaign_attachment");
    expect(calls[0].args).toEqual({ p_import_id: IMPORT });
    expect(Object.keys(calls[0].args)).not.toContain("p_lead_ids");
    expect(res.status).toBe("completed");
    expect(res.newly_attached).toBe(106);
  });

  it("returns a structured refusal rather than throwing on an authorization reason", async () => {
    rpcResults["retry_import_campaign_attachment"] = { data: { ok: false, reason: "not_authorized" }, error: null };
    const res = await retryImportCampaignAttachment(IMPORT);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("not_authorized");
  });

  it("propagates a transport error", async () => {
    rpcResults["retry_import_campaign_attachment"] = { data: null, error: { message: "boom" } };
    await expect(retryImportCampaignAttachment(IMPORT)).rejects.toBeTruthy();
  });

  it("rejects a malformed envelope rather than rendering bogus counts", async () => {
    rpcResults["retry_import_campaign_attachment"] = { data: { ok: true, attached_count: -5 }, error: null };
    await expect(retryImportCampaignAttachment(IMPORT)).rejects.toThrow(/unexpected retry result/i);
  });
});

describe("canDialCampaign", () => {
  it("calls can_dial_campaign with the campaign id and returns the server's boolean", async () => {
    rpcResults["can_dial_campaign"] = { data: true, error: null };
    await expect(canDialCampaign(CAMP)).resolves.toBe(true);
    expect(calls[0]).toEqual({ name: "can_dial_campaign", args: { p_campaign_id: CAMP } });
  });

  it("fails CLOSED when the server errors", async () => {
    rpcResults["can_dial_campaign"] = { data: null, error: { message: "nope" } };
    await expect(canDialCampaign(CAMP)).resolves.toBe(false);
  });

  it("fails CLOSED on a null/absent answer", async () => {
    rpcResults["can_dial_campaign"] = { data: null, error: null };
    await expect(canDialCampaign(CAMP)).resolves.toBe(false);
  });

  it("fails CLOSED on a truthy NON-boolean answer", async () => {
    for (const v of ["true", 1, {}, []]) {
      rpcResults["can_dial_campaign"] = { data: v, error: null };
      await expect(canDialCampaign(CAMP)).resolves.toBe(false);
    }
  });

  it("fails CLOSED for an empty campaign id without calling the server", async () => {
    await expect(canDialCampaign("")).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("isRetryableImportStatus", () => {
  it("treats an incomplete attachment as retryable", () => {
    expect(isRetryableImportStatus("campaign_failed")).toBe(true);
    expect(isRetryableImportStatus("campaign_partial")).toBe(true);
    expect(isRetryableImportStatus("pending_campaign")).toBe(true);
    // Legacy rows mis-stamped by the old finalize arithmetic must stay recoverable.
    expect(isRetryableImportStatus("completed_with_skips")).toBe(true);
  });

  it("does not offer retry for a genuinely complete import", () => {
    expect(isRetryableImportStatus("completed")).toBe(false);
  });

  it("does not offer retry when there is no campaign at all", () => {
    expect(isRetryableImportStatus(null)).toBe(false);
  });
});

describe("describeImportCompletion — truthful, never a false success", () => {
  it("never reports success for a zero-attachment import", () => {
    const d = describeImportCompletion("campaign_failed");
    expect(d.tone).not.toBe("success");
    expect(d.title.toLowerCase()).not.toContain("import complete");
  });

  it("does not report success for a partial attachment", () => {
    expect(describeImportCompletion("campaign_partial").tone).not.toBe("success");
  });

  it("reports success only for a fully completed import", () => {
    expect(describeImportCompletion("completed").tone).toBe("success");
  });

  it("treats an unknown/absent status as unconfirmed, not success", () => {
    expect(describeImportCompletion(null).tone).not.toBe("success");
  });

  it("marks completed_with_skips as finished-but-not-clean", () => {
    const d = describeImportCompletion("completed_with_skips");
    expect(d.tone).toBe("warning");
  });
});
