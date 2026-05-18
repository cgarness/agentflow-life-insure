import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2";

export const aiTestingCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function aiTestingJson(
  body: Record<string, unknown>,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...aiTestingCorsHeaders,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

export type AuthContext = {
  user: User;
  organizationId: string;
  isSuperAdmin: boolean;
  supabase: SupabaseClient;
};

export async function requireSuperAdminAuth(
  req: Request,
): Promise<{ ok: true; ctx: AuthContext } | { ok: false; response: Response }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return {
      ok: false,
      response: aiTestingJson({ success: false, error: "Server configuration error" }, 500),
    };
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, response: aiTestingJson({ success: false, error: "Unauthorized" }, 401) };
  }

  const jwt = authHeader.replace("Bearer ", "");
  const supabaseAuth = createClient(supabaseUrl, anonKey);
  const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(jwt);
  if (userError || !user) {
    return { ok: false, response: aiTestingJson({ success: false, error: "Unauthorized" }, 401) };
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("organization_id, is_super_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile?.organization_id) {
    return {
      ok: false,
      response: aiTestingJson({ success: false, error: "Profile not found" }, 403),
    };
  }

  if (profile.is_super_admin !== true) {
    return {
      ok: false,
      response: aiTestingJson({ success: false, error: "Super Admin access required" }, 403),
    };
  }

  return {
    ok: true,
    ctx: {
      user,
      organizationId: profile.organization_id,
      isSuperAdmin: true,
      supabase,
    },
  };
}
