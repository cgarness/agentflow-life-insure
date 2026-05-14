import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

async function callFn(fnName: string, body: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token ?? "";
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* ignore */ }
  return { ok: res.ok, status: res.status, data };
}

export const agencyGroupApi = {
  invite: (group_id: string, invite_email: string) =>
    callFn("invite-to-agency-group", { group_id, invite_email }),
  accept: (token: string) =>
    callFn("accept-agency-group-invite", { token, action: "accept" }),
  decline: (token: string) =>
    callFn("accept-agency-group-invite", { token, action: "decline" }),
  preview: async (token: string) => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/accept-agency-group-invite?token=${encodeURIComponent(token)}`);
    let data: any = null;
    try { data = await res.json(); } catch { /* ignore */ }
    return { ok: res.ok, status: res.status, data };
  },
  leave: (group_id: string) => callFn("leave-agency-group", { group_id }),
  remove: (group_id: string, member_id: string) =>
    callFn("remove-from-agency-group", { group_id, member_id }),
};
