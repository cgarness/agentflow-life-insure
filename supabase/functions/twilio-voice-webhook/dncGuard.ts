export interface OutboundAdmissionParams {
  CallRowId?: string;
  From?: string;
  To?: string;
  CallerId?: string;
  CallSid?: string;
}
export interface AdmissionRpcArgs {
  p_call_id: string;
  p_identity: string;
  p_to: string;
  p_caller_id: string;
  p_parent_sid: string;
}

/** Invoke only AFTER validating Twilio HMAC. OrgId is intentionally never consumed. */
export async function verifyOutboundDncAdmission(
  params: OutboundAdmissionParams,
  admit: (args: AdmissionRpcArgs) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<boolean> {
  const id = params.CallRowId ?? "";
  const from = params.From ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      || !from.startsWith("client:") || !params.To || !params.CallerId || !params.CallSid) return false;
  try {
    const { data, error } = await admit({
      p_call_id: id,
      p_identity: from.slice("client:".length),
      p_to: params.To,
      p_caller_id: params.CallerId,
      p_parent_sid: params.CallSid,
    });
    return !error && typeof data === "object" && data !== null && "admitted" in data && data.admitted === true;
  } catch {
    return false;
  }
}
