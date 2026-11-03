import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { roomSchema, sessionSchema, localDayBounds } from "./contracts";
type RpcName =
  | "inbounds_room_state"
  | "inbounds_room_session"
  | "set_inbounds_number"
  | "inbounds_room_call_state"
  | "inbounds_room_add_contact";
const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: RpcName,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
export async function roomState() {
  const d = localDayBounds();
  const r = await rpc("inbounds_room_state", {
    p_start: d.start,
    p_end: d.end,
  });
  if (r.error) throw Error(r.error.message);
  return roomSchema.parse(r.data);
}
export async function roomSession(
  id: string,
  action: "join" | "heartbeat" | "pause" | "resume" | "leave",
  ready = false,
) {
  const r = await rpc("inbounds_room_session", {
    p_session: id,
    p_action: action,
    p_ready: ready,
  });
  if (r.error) throw Error(r.error.message);
  return sessionSchema.parse(r.data);
}
export async function setRoomNumber(id: string, enabled: boolean) {
  const r = await rpc("set_inbounds_number", {
    p_number: id,
    p_enabled: enabled,
  });
  if (r.error) throw Error(r.error.message);
  if (r.data !== true) throw Error("Number routing was not confirmed");
}
export async function roomToken(sessionId: string) {
  const { data, error } = await supabase.functions.invoke("twilio-token", {
    body: { room_session_id: sessionId },
  });
  if (error) throw Error("Could not connect the room phone. Retry joining.");
  const result = z
    .object({ token: z.string().min(1), identity: z.string() })
    .parse(data);
  if (result.identity !== `ir_${sessionId.replace(/-/g, "")}`)
    throw Error("Room phone identity did not match this tab.");
  return result;
}

const proofSchema = z.object({
  agent_id: z.string().uuid().nullable(),
  ended_at: z.string().nullable(),
  dispositioned: z.boolean(),
});
export async function roomCallState(callId: string) {
  const r = await rpc("inbounds_room_call_state", { p_call: callId });
  if (r.error) throw Error(r.error.message);
  return proofSchema.parse(r.data);
}
export async function roomAddContact(
  callId: string,
  first: string,
  last: string,
) {
  const r = await rpc("inbounds_room_add_contact", {
    p_call: callId,
    p_first: first,
    p_last: last,
  });
  if (r.error) throw Error(r.error.message);
  return z.string().uuid().parse(r.data);
}
