// T28 + T8 — pinning tests. These are GREEN by design before and after the inbound fix and exist to
// prove the outbound dial path, the outbound browser-recording path, and the contact_id-keyed
// history contract are byte-identical through this change. Any drift in the pinned fragments is a
// scope violation of the inbound-only task.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const twilioCtx = readFileSync(
  resolve(__dirname, "../../contexts/TwilioContext.tsx"),
  "utf8",
);
const dialerApi = readFileSync(resolve(__dirname, "../dialer-api.ts"), "utf8");

describe("T28 — outbound makeCall call-row creation is pinned", () => {
  const pinned = [
    "contact_id: isValidUUID(opts?.contactId) ? opts!.contactId : null,",
    "organization_id: organizationId,",
    "campaign_id: opts?.campaignId || null,",
    "campaign_lead_id: opts?.campaignLeadId || null,",
    "contact_name: sanitizeContactName(opts?.contactName) || null,",
    "contact_phone: opts?.contactPhone || destinationNumber,",
    "contact_type: opts?.contactType || null,",
    "status: 'ringing',",
    "direction: 'outbound',",
    "caller_id_used: callerIdUsed,",
    "started_at: new Date().toISOString(),",
  ];

  for (const fragment of pinned) {
    it(`keeps ${JSON.stringify(fragment.slice(0, 42))}…`, () => {
      expect(twilioCtx.includes(fragment)).toBe(true);
    });
  }

  it("still dials via twilioMakeCall with the row id and org", () => {
    expect(twilioCtx.includes("callRowId: callRecord.id,")).toBe(true);
    expect(twilioCtx.includes("orgId: organizationId as string,")).toBe(true);
  });

  it("still marks remote-answered only from the Voice.js accept event", () => {
    expect(twilioCtx.includes("outboundRemoteAnsweredRef.current = true;")).toBe(true);
  });
});

describe("T28 — outbound browser-recording path is pinned (browser-side only, by design)", () => {
  it("keeps the phone_settings recording_enabled policy gate", () => {
    expect(twilioCtx.includes('.select("recording_enabled")')).toBe(true);
    expect(twilioCtx.includes("isCallRecordingEnabledDb(ps?.recording_enabled")).toBe(true);
  });

  it("keeps the startBrowserCallRecording invocation shape", () => {
    expect(twilioCtx.includes("await startBrowserCallRecording(rowId, orgForRec, {")).toBe(true);
    expect(twilioCtx.includes("agentMicStream: micSnap,")).toBe(true);
    expect(twilioCtx.includes("remoteStream,")).toBe(true);
  });

  it("keeps the stop-and-upload teardown path", () => {
    expect(twilioCtx.includes("stopAndUploadBrowserRecording(callId, orgForUpload, \"hangup\")")).toBe(
      true,
    );
    expect(
      twilioCtx.includes("stopAndUploadBrowserRecording(recordingCallId, orgForUpload, \"finalizeEnded\")"),
    ).toBe(true);
  });
});

describe("T8 — history stays contact_id-keyed and picks up newly linked inbound calls", () => {
  it("getLeadHistory keys calls by contact_id", () => {
    expect(dialerApi.includes('callsQuery = callsQuery.eq("contact_id", leadId);')).toBe(true);
  });

  it("campaign-lead expansion also stays id-keyed", () => {
    expect(
      dialerApi.includes("`contact_id.eq.${leadId},campaign_lead_id.eq.${campaignLeadId}`"),
    ).toBe(true);
  });

  it("history never resolves calls by phone probing", () => {
    const start = dialerApi.indexOf("export async function getLeadHistory");
    const body = dialerApi.slice(start, start + 4000);
    expect(body.includes("ilike")).toBe(false);
  });
});
