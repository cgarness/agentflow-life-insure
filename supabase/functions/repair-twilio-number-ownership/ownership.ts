import {
  canonicalNumberConfig,
  type TwilioNumberConfig,
} from "../_shared/twilioNumberConfig.ts";

export { canonicalNumberConfig };

export const INCIDENT_WINDOW_START = "2026-08-06T22:15:00.000Z";
export const INCIDENT_WINDOW_END = "2026-08-07T00:00:00.000Z";

const MAX_TARGETS = 20;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE_NUMBER_SID_PATTERN = /^PN[0-9a-f]{32}$/i;

export type RepairRequest = {
  organizationId: string;
  phoneNumberIds: string[];
};

export type RepairTargetRow = {
  id: string;
  organization_id: string;
  status: string;
  twilio_sid: string;
  created_at: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRepairRequest(value: unknown): RepairRequest {
  if (!isRecord(value)) throw new Error("Request body must be an object");

  const organizationId = value.organization_id;
  const phoneNumberIds = value.phone_number_ids;
  if (
    typeof organizationId !== "string" || !UUID_PATTERN.test(organizationId)
  ) {
    throw new Error("organization_id must be a UUID");
  }
  if (
    !Array.isArray(phoneNumberIds) || phoneNumberIds.length === 0 ||
    phoneNumberIds.length > MAX_TARGETS
  ) {
    throw new Error(`phone_number_ids must contain 1-${MAX_TARGETS} UUIDs`);
  }
  if (
    !phoneNumberIds.every((id) =>
      typeof id === "string" && UUID_PATTERN.test(id)
    )
  ) {
    throw new Error("phone_number_ids must contain only UUIDs");
  }
  if (new Set(phoneNumberIds).size !== phoneNumberIds.length) {
    throw new Error("phone_number_ids must not contain duplicates");
  }

  return { organizationId, phoneNumberIds: [...phoneNumberIds] };
}

export function isAuthorizedServiceRole(
  authorization: string | null,
  serviceRoleKey: string,
): boolean {
  return serviceRoleKey.length > 0 &&
    authorization === `Bearer ${serviceRoleKey}`;
}

export function isAuthorizedInternalRequest(
  authorization: string | null,
  serviceRoleKey: string,
  workflowHeader: string | null,
  workflowSecret: string,
): boolean {
  return isAuthorizedServiceRole(authorization, serviceRoleKey) ||
    (workflowSecret.length > 0 && workflowHeader === workflowSecret);
}

export function validateRepairTargets(
  request: RepairRequest,
  rows: RepairTargetRow[],
): RepairTargetRow[] {
  if (rows.length !== request.phoneNumberIds.length) {
    throw new Error("Every requested number must exist");
  }

  const byId = new Map<string, RepairTargetRow>();
  for (const row of rows) {
    if (byId.has(row.id)) throw new Error("Duplicate phone number row");
    byId.set(row.id, row);
  }

  const start = Date.parse(INCIDENT_WINDOW_START);
  const end = Date.parse(INCIDENT_WINDOW_END);
  return request.phoneNumberIds.map((id) => {
    const row = byId.get(id);
    if (!row) throw new Error("Every requested number must exist");
    if (row.organization_id !== request.organizationId) {
      throw new Error("Cross-organization target rejected");
    }
    if (row.status.toLowerCase() !== "active") {
      throw new Error("Only active phone numbers can be repaired");
    }
    if (!PHONE_NUMBER_SID_PATTERN.test(row.twilio_sid)) {
      throw new Error("Target has an invalid Twilio SID");
    }
    const createdAt = Date.parse(row.created_at);
    if (!Number.isFinite(createdAt) || createdAt < start || createdAt >= end) {
      throw new Error("Target is outside the incident window");
    }
    return row;
  });
}

export function numberConfigMatches(
  payload: Record<string, unknown>,
  masterAccountSid: string,
  expected: TwilioNumberConfig,
): boolean {
  return payload.account_sid === masterAccountSid &&
    payload.voice_url === expected.voiceUrl &&
    payload.voice_method === expected.voiceMethod &&
    payload.sms_url === expected.smsUrl &&
    payload.sms_method === expected.smsMethod &&
    payload.status_callback === expected.statusCallback &&
    payload.status_callback_method === expected.statusCallbackMethod;
}

export type SanitizedTwilioFailure = {
  httpStatus: number;
  code: string;
  message: string;
};

export function sanitizeTwilioFailure(
  status: number,
  payload: unknown,
): SanitizedTwilioFailure {
  const record = isRecord(payload) ? payload : null;
  const codeValue = record?.code;
  const code = typeof codeValue === "string" || typeof codeValue === "number"
    ? String(codeValue)
    : `TWILIO_HTTP_${status}`;
  const rawMessage = typeof record?.message === "string"
    ? record.message
    : typeof payload === "string"
    ? payload
    : "Twilio request failed";

  return {
    httpStatus: status,
    code: code.slice(0, 80),
    message: rawMessage.slice(0, 240),
  };
}
