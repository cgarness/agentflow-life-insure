import { describe, expect, it } from "vitest";
import {
  PROVEN_NOT_SENT_CODES,
  PROVEN_NOT_SENT_LITERALS,
  classifySmsResponse,
  matchCanonicalRow,
  noResponse,
  notStarted,
} from "../smsSendResult";

const MESSAGE_ID = "6f2c1a8e-7d3b-4c5a-9e1f-0a2b3c4d5e6f";
const ORG = "11111111-1111-4111-8111-111111111111";
const ACTOR = "00000000-0000-4000-8000-000000000001";
const CONTACT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const json = (value: unknown) => JSON.stringify(value);
const coded = (code: string, error = "server text") => json({ success: false, code, error });

describe("a valid receipt is the only acceptance", () => {
  it("accepts a 200 receipt with a UUID message_id", () => {
    const outcome = classifySmsResponse(200, json({ success: true, message_id: MESSAGE_ID, provider_message_id: "SM123", status: "queued", replayed: true }));
    expect(outcome).toEqual({
      state: "accepted",
      receipt: { messageId: MESSAGE_ID, providerMessageId: "SM123", status: "queued", replayed: true },
    });
  });

  it.each([
    ["no message_id", { success: true, provider_message_id: "SM1", status: "queued" }, 200],
    ["a non-UUID message_id", { success: true, message_id: "provider-row", provider_message_id: "SM1", status: "queued" }, 200],
    ["the pre-dispatcher `id` field", { success: true, id: MESSAGE_ID, status: "queued" }, 200],
    ["an empty status", { success: true, message_id: MESSAGE_ID, provider_message_id: "SM1", status: "" }, 200],
    ["a success body on a non-200 status", { success: true, message_id: MESSAGE_ID, provider_message_id: "SM1", status: "queued" }, 202],
  ])("a malformed receipt (%s) is uncertain, never accepted", (_label, body, status) => {
    expect(classifySmsResponse(status, json(body))).toMatchObject({ state: "uncertain", reason: "malformed_receipt" });
  });

  it("SEND_ACCEPTED_REVIEW on 503 is accepted with history needing review", () => {
    expect(classifySmsResponse(503, coded("SEND_ACCEPTED_REVIEW", "Accepted; history needs review."))).toEqual({
      state: "accepted_review",
      code: "SEND_ACCEPTED_REVIEW",
      message: "Accepted; history needs review.",
    });
  });

  it("SEND_ACCEPTED_REVIEW on any other status is not trusted", () => {
    expect(classifySmsResponse(200, coded("SEND_ACCEPTED_REVIEW"))).toMatchObject({ state: "uncertain", reason: "unrecognized_response" });
  });
});

describe("only exact, inspected pre-send contracts prove non-sending", () => {
  it.each(Object.entries(PROVEN_NOT_SENT_CODES))("%s with status %i is not sent", (code, status) => {
    expect(classifySmsResponse(status, coded(code, "Refused."))).toEqual({ state: "not_sent", reason: "refused", code, message: "Refused." });
  });

  it.each(Object.entries(PROVEN_NOT_SENT_CODES))("%s with any other status is uncertain", (code, status) => {
    expect(classifySmsResponse(status === 409 ? 500 : 409, coded(code))).toMatchObject({ state: "uncertain", reason: "unrecognized_response", code });
  });

  it.each(PROVEN_NOT_SENT_LITERALS.map(([s, t]) => [s, t] as const))("uncoded %i %s is not sent", (status, error) => {
    expect(classifySmsResponse(status, json({ success: false, error }))).toEqual({ state: "not_sent", reason: "refused", code: null, message: error });
  });

  it("an uncoded literal on another status, or with different text, is uncertain", () => {
    expect(classifySmsResponse(500, json({ success: false, error: "Unauthorized" }))).toMatchObject({ state: "uncertain" });
    expect(classifySmsResponse(400, json({ success: false, error: "Invalid phone number format" }))).toMatchObject({ state: "uncertain" });
  });

  it("there are no families: an unknown look-alike code or any other 4xx is uncertain", () => {
    expect(classifySmsResponse(403, coded("SEND_SCOPE_V2"))).toMatchObject({ state: "uncertain", reason: "unrecognized_response" });
    expect(classifySmsResponse(400, json({ success: false, error: "carrier rejected" }))).toMatchObject({ state: "uncertain", reason: "unrecognized_response" });
    expect(classifySmsResponse(422, json({ success: false }))).toMatchObject({ state: "uncertain", reason: "unrecognized_response" });
  });
});

describe("everything after a possible provider call is uncertain", () => {
  it("PROVIDER_REJECTED is uncertain, including the provider-5xx case", () => {
    expect(classifySmsResponse(502, coded("PROVIDER_REJECTED", "Provider unavailable."))).toEqual({
      state: "uncertain", reason: "provider_rejected", code: "PROVIDER_REJECTED", message: "Provider unavailable.",
    });
    expect(classifySmsResponse(409, coded("PROVIDER_REJECTED"))).toMatchObject({ state: "uncertain", reason: "provider_rejected" });
  });

  it.each([
    ["SMS_SUPPRESSED", "provider_suppressed"],
    ["SEND_UNCERTAIN", "send_uncertain"],
    ["SEND_REVIEW", "attempt_exists"],
    ["SEND_IN_PROGRESS", "in_progress"],
    ["SMS_STATE", "state_unverified"],
  ])("%s stays distinct as %s", (code, reason) => {
    for (const status of [409, 503, 500]) {
      expect(classifySmsResponse(status, coded(code))).toMatchObject({ state: "uncertain", reason, code });
    }
  });

  it("unparseable, empty and gateway bodies are uncertain", () => {
    expect(classifySmsResponse(502, "<html>Bad gateway</html>")).toMatchObject({ state: "uncertain", reason: "unrecognized_response" });
    expect(classifySmsResponse(500, "")).toMatchObject({ state: "uncertain", reason: "unrecognized_response" });
    expect(classifySmsResponse(200, "null")).toMatchObject({ state: "uncertain", reason: "unrecognized_response" });
  });

  it("uses the server's text when present and a fallback otherwise", () => {
    expect(classifySmsResponse(503, json({ success: false, code: "SEND_UNCERTAIN" }))).toMatchObject({ message: "Delivery could not be confirmed." });
  });

  it("local outcomes are labelled by where they stopped", () => {
    expect(notStarted("session")).toMatchObject({ state: "not_sent", reason: "session", code: null });
    expect(notStarted("deadline")).toMatchObject({ state: "not_sent", reason: "deadline" });
    expect(noResponse("transport")).toMatchObject({ state: "uncertain", reason: "transport" });
    expect(noResponse("deadline")).toMatchObject({ state: "uncertain", reason: "deadline" });
  });
});

describe("the saved row is accepted only when it is exactly the receipt's row", () => {
  const row = {
    id: MESSAGE_ID, direction: "outbound", body: "hi", from_number: "+15550002222", to_number: "+15125550123",
    status: "queued", sent_at: "2026-10-14T15:00:00Z", created_at: "2026-10-14T15:00:00Z",
    contact_id: CONTACT, lead_id: null, contact_type: "lead", created_by: ACTOR, organization_id: ORG, provider_message_id: "SM1",
  };
  const expected = { messageId: MESSAGE_ID, organizationId: ORG, contactId: CONTACT, actorId: ACTOR };

  it("matches by id, organization, actor and contact (contact_id or lead_id)", () => {
    expect(matchCanonicalRow(row, expected)).toMatchObject({ id: MESSAGE_ID, from_number: "+15550002222" });
    expect(matchCanonicalRow({ ...row, contact_id: null, lead_id: CONTACT }, expected)).not.toBeNull();
  });

  it.each([
    ["another id", { id: "7f2c1a8e-7d3b-4c5a-9e1f-0a2b3c4d5e6f" }],
    ["another organization", { organization_id: "22222222-2222-4222-8222-222222222222" }],
    ["another actor", { created_by: "00000000-0000-4000-8000-000000000002" }],
    ["another contact", { contact_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
    ["an inbound row", { direction: "inbound" }],
    ["a malformed row", { id: 42 }],
  ])("rejects %s", (_label, change) => {
    expect(matchCanonicalRow({ ...row, ...change }, expected)).toBeNull();
  });
});
