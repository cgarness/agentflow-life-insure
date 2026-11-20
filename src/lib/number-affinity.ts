import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
const mode = z.enum(["off", "shadow", "enforced", "guard_only"]);
export const senderSchema = z.object({ id: z.string().uuid().nullable(), number: z.string().nullable(), readiness: z.string(), provisional: z.boolean(), state: z.string().optional(), version: z.number().optional() });
export const affinitySchema = z.object({ voice_mode: mode, sms_mode: mode, generation: z.number(), history: z.enum(["new", "reconciled", "needs_review"]), voice: senderSchema, sms: senderSchema, reply: senderSchema.nullable().optional() });
export type ContactNumberAffinity = z.infer<typeof affinitySchema>;
export type SenderChoice = z.infer<typeof senderSchema>;
export type ContactNumberType = "lead" | "client" | "recruit";
export const readinessLabels: Record<string, string> = {
 ready: "Ready · checked again when sending", agency_approval_required: "Agency approval required", texting_paused: "Texting paused",
 setup_required: "Texting setup required", setting_up_texting: "Setting up texting", setup_needs_attention: "Texting setup needs attention",
 unavailable: "Number unavailable", group_conflict: "Outside this campaign’s number group", daily_limit: "Daily call limit reached",
};
export function numberError(error: unknown): Error {
 const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
 const cases: [string,string][] = [
  ["affinity_send_unresolved", "An earlier text is still unresolved. Check its status before changing numbers."],
  ["affinity_admin_resolution", "An administrator needs to resolve this shared number."],
  ["affinity_history_review", "This contact’s number history needs review."],
  ["affinity_sender_changed", "The sender changed. Refresh and review before sending."],
  ["affinity_sender_un", "This number is unavailable. Review its setup or choose an explicit alternate."],
  ["affinity_scope", "Contact access or phone changed. Refresh the contact."],
  ["affinity_campaign", "Campaign access or calling context changed. Refresh the campaign."],
  ["affinity_guard_only", "Texting requires an established contact number."],
  ["affinity_stale", "Number settings changed. Refresh and review again."],
 ];
 return new Error(cases.find(([code]) => message.includes(code))?.[1] ?? "Contact numbers could not be verified. Refresh before continuing.");
}
export async function previewContactNumbers(id: string, type: ContactNumberType, campaign?: string) {
 const { data, error } = await supabase.rpc("preview_contact_numbers", { p_contact:id, p_type:type, p_campaign:campaign ?? null });
 if (error) throw numberError(error); return affinitySchema.parse(data);
}
export async function contactNumberOptions(id: string,type: ContactNumberType) {
 const { data,error }=await supabase.rpc("contact_number_options",{p_contact:id,p_type:type});
 if(error)throw numberError(error);return z.array(senderSchema.extend({voice_readiness:z.string()})).parse(data);
}
export async function changeContactNumber(id:string,type:ContactNumberType,channel:string,number:string|null,generation:number,reason:string) {
 const {data,error}=await supabase.rpc("change_contact_number",{p_contact:id,p_type:type,p_channel:channel,p_number:number,p_generation:generation,p_reason:reason});
 if(error)throw numberError(error);return affinitySchema.parse(data);
}
export async function authorizeContactCall(args: { attemptId:string; contactId:string|null; type:string|null; phone:string; candidate:string; campaignId?:string|null; memberId?:string|null; overrideId?:string|null }) {
 const {data,error}=await supabase.rpc("authorize_contact_call",{p_call:args.attemptId,p_contact:args.contactId,p_type:args.type,p_phone:args.phone,p_candidate:args.candidate,p_campaign:args.campaignId??null,p_member:args.memberId??null,p_override:args.overrideId??null,p_unsaved:!args.contactId});
 if(error)throw numberError(error);
 const result=z.object({enabled:z.boolean().optional(),number:z.string().optional(),blocked:z.string().optional()}).parse(data);
 if(result.blocked)throw new Error("Call evidence is being reconciled. Refresh before calling.");
 if(result.enabled && !result.number)throw new Error("The call number could not be verified.");return result;
}
