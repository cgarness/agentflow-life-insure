// Server-side identity for user-facing Sheets endpoints: the REAL authenticated user (JWT validated in
// code, invariant #2) and that user's organization from public.profiles. View As never changes the JWT.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface Actor { userId: string; orgId: string; email: string | null }

export async function authenticate(req: Request, svc: SupabaseClient): Promise<Actor | null> {
  const header = req.headers.get("Authorization") ?? "";
  const jwt = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!jwt) return null;
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await anon.auth.getUser(jwt);
  if (error || !data?.user?.id) return null;
  const { data: profile } = await svc.from("profiles").select("organization_id, status")
    .eq("id", data.user.id).maybeSingle();
  if (!profile?.organization_id || profile.status !== "Active") return null;
  return { userId: data.user.id, orgId: profile.organization_id, email: data.user.email ?? null };
}
