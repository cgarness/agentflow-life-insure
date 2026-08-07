import {
  canonicalNumberConfig,
  INCIDENT_WINDOW_END,
  INCIDENT_WINDOW_START,
  isAuthorizedInternalRequest,
  isAuthorizedServiceRole,
  numberConfigMatches,
  parseRepairRequest,
  sanitizeTwilioFailure,
  validateRepairTargets,
} from "./ownership.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}`);
  }
}

function assertThrows(fn: () => unknown): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error("Expected function to throw");
}

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const IDS = [
  "a09e38cf-72b6-4410-b122-5a969cd07347",
  "cc824168-7f84-4428-8375-6313fda8a4e2",
  "88b1f04d-a73c-46a2-af93-dcf5a141c55a",
  "aa0d413c-40d2-422b-8868-2d58e66e95c1",
  "767e423e-64b7-4ae2-8af1-5c1e20b7151e",
  "b56dffdd-3ac5-4894-85df-92fe2cfbc54c",
] as const;

function target(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    organization_id: ORG_ID,
    status: "active",
    twilio_sid: `PN${id.replace(/-/g, "").slice(0, 32)}`,
    created_at: "2026-08-06T22:18:00.000Z",
    ...overrides,
  };
}

Deno.test("parseRepairRequest accepts exactly the bounded incident targets", () => {
  assertEquals(
    parseRepairRequest({ organization_id: ORG_ID, phone_number_ids: [...IDS] }),
    { organizationId: ORG_ID, phoneNumberIds: [...IDS] },
  );
});

Deno.test("parseRepairRequest rejects malformed, empty, duplicated, or oversized target lists", () => {
  const invalid = [
    null,
    {},
    { organization_id: "not-a-uuid", phone_number_ids: [...IDS] },
    { organization_id: ORG_ID, phone_number_ids: [] },
    { organization_id: ORG_ID, phone_number_ids: [IDS[0], IDS[0]] },
    { organization_id: ORG_ID, phone_number_ids: ["not-a-uuid"] },
    {
      organization_id: ORG_ID,
      phone_number_ids: Array.from(
        { length: 21 },
        (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
      ),
    },
  ];

  for (const value of invalid) {
    assertThrows(() => parseRepairRequest(value));
  }
});

Deno.test("service-role authorization is exact and fail closed", () => {
  assertEquals(
    isAuthorizedServiceRole("Bearer service-secret", "service-secret"),
    true,
  );
  assertEquals(
    isAuthorizedServiceRole("bearer service-secret", "service-secret"),
    false,
  );
  assertEquals(
    isAuthorizedServiceRole("Bearer service-secret ", "service-secret"),
    false,
  );
  assertEquals(
    isAuthorizedServiceRole("Bearer wrong", "service-secret"),
    false,
  );
  assertEquals(isAuthorizedServiceRole(null, "service-secret"), false);
  assertEquals(isAuthorizedServiceRole("Bearer service-secret", ""), false);
});

Deno.test("internal authorization accepts the existing workflow secret and rejects empty or inexact values", () => {
  assertEquals(
    isAuthorizedInternalRequest(
      null,
      "service-secret",
      "workflow-secret",
      "workflow-secret",
    ),
    true,
  );
  assertEquals(
    isAuthorizedInternalRequest(
      "Bearer wrong",
      "service-secret",
      "workflow-secret",
      "workflow-secret",
    ),
    true,
  );
  assertEquals(
    isAuthorizedInternalRequest(
      null,
      "service-secret",
      "workflow-secret ",
      "workflow-secret",
    ),
    false,
  );
  assertEquals(
    isAuthorizedInternalRequest(null, "service-secret", "workflow-secret", ""),
    false,
  );
  assertEquals(
    isAuthorizedInternalRequest(
      null,
      "service-secret",
      null,
      "workflow-secret",
    ),
    false,
  );
});

Deno.test("validateRepairTargets returns request order and only incident-window rows", () => {
  const rows = IDS.map((id) => target(id)).reverse();
  assertEquals(
    validateRepairTargets(
      { organizationId: ORG_ID, phoneNumberIds: [...IDS] },
      rows,
    ).map((row) => row.id),
    [...IDS],
  );
  assertEquals(INCIDENT_WINDOW_START, "2026-08-06T22:15:00.000Z");
  assertEquals(INCIDENT_WINDOW_END, "2026-08-07T00:00:00.000Z");
});

Deno.test("validateRepairTargets rejects missing, cross-org, inactive, invalid-SID, and out-of-window rows", () => {
  const base = IDS.map((id) => target(id));
  const cases = [
    base.slice(1),
    base.map((row, i) =>
      i === 0
        ? target(row.id, {
          organization_id: "b0000000-0000-0000-0000-000000000002",
        })
        : row
    ),
    base.map((row, i) =>
      i === 0 ? target(row.id, { status: "released" }) : row
    ),
    base.map((row, i) =>
      i === 0 ? target(row.id, { twilio_sid: "not-a-pn" }) : row
    ),
    base.map((row, i) =>
      i === 0 ? target(row.id, { created_at: "2026-08-06T22:14:59.999Z" }) : row
    ),
    base.map((row, i) =>
      i === 0 ? target(row.id, { created_at: INCIDENT_WINDOW_END }) : row
    ),
  ];

  for (const rows of cases) {
    assertThrows(() =>
      validateRepairTargets({
        organizationId: ORG_ID,
        phoneNumberIds: [...IDS],
      }, rows)
    );
  }
});

Deno.test("canonical number configuration uses the production callback base", () => {
  assertEquals(canonicalNumberConfig("https://example.supabase.co/"), {
    voiceUrl: "https://example.supabase.co/functions/v1/twilio-voice-inbound",
    voiceMethod: "POST",
    smsUrl: "https://example.supabase.co/functions/v1/twilio-sms-webhook",
    smsMethod: "POST",
    statusCallback:
      "https://example.supabase.co/functions/v1/twilio-voice-status",
    statusCallbackMethod: "POST",
  });
});

Deno.test("numberConfigMatches requires master ownership and every callback field", () => {
  const expected = canonicalNumberConfig("https://example.supabase.co");
  const payload = {
    account_sid: "ACmaster",
    voice_url: expected.voiceUrl,
    voice_method: expected.voiceMethod,
    sms_url: expected.smsUrl,
    sms_method: expected.smsMethod,
    status_callback: expected.statusCallback,
    status_callback_method: expected.statusCallbackMethod,
  };
  assertEquals(numberConfigMatches(payload, "ACmaster", expected), true);
  assertEquals(
    numberConfigMatches(
      { ...payload, account_sid: "ACchild" },
      "ACmaster",
      expected,
    ),
    false,
  );
  assertEquals(
    numberConfigMatches(
      { ...payload, sms_url: "https://wrong.example" },
      "ACmaster",
      expected,
    ),
    false,
  );
});

Deno.test("sanitizeTwilioFailure returns only status, code, and a bounded message", () => {
  assertEquals(
    sanitizeTwilioFailure(400, {
      code: 13214,
      message: "Dial: Invalid callerId value",
      secret: "must-not-leak",
    }),
    { httpStatus: 400, code: "13214", message: "Dial: Invalid callerId value" },
  );
  const result = sanitizeTwilioFailure(502, "x".repeat(800));
  assertEquals(result.httpStatus, 502);
  assertEquals(result.code, "TWILIO_HTTP_502");
  assertEquals(result.message.length, 240);
});
