import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ACTIVE_STATUSES = ["ringing", "connected", "in-progress"];
const SAFETY_WINDOW_HOURS = 4;

interface ActiveCallResponse {
  id: string;
  agent_name: string;
  contact_name: string;
  contact_phone: string;
  direction: string;
  status: string;
  created_at: string;
  started_at: string | null;
  duration: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      throw new Error("Invalid or expired user session.");
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const requestedOrgId = typeof body?.organization_id === "string" ? body.organization_id.trim() : "";
    if (!requestedOrgId) {
      throw new Error("Missing organization_id");
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile?.organization_id) {
      throw new Error("User has no organization");
    }

    if (profile.organization_id !== requestedOrgId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cutoffIso = new Date(Date.now() - SAFETY_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

    const { data: calls, error: callsError } = await supabase
      .from("calls")
      .select("id, agent_id, contact_name, contact_phone, direction, status, created_at, started_at, duration")
      .eq("organization_id", requestedOrgId)
      .in("status", ACTIVE_STATUSES)
      .gte("created_at", cutoffIso)
      .order("created_at", { ascending: false });

    if (callsError) {
      console.error("[get-active-calls] calls query error", callsError);
      throw new Error("Failed to load active calls");
    }

    const agentIds = Array.from(
      new Set((calls ?? []).map((c) => c.agent_id).filter((id): id is string => !!id)),
    );

    const agentNameById = new Map<string, string>();
    if (agentIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", agentIds);
      for (const p of profiles ?? []) {
        const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.email || "Unknown agent";
        agentNameById.set(p.id, name);
      }
    }

    const now = Date.now();
    const result: ActiveCallResponse[] = (calls ?? []).map((c) => {
      const startedMs = c.started_at ? new Date(c.started_at).getTime() : new Date(c.created_at ?? now).getTime();
      const duration = Math.max(0, Math.floor((now - startedMs) / 1000));
      return {
        id: c.id,
        agent_name: c.agent_id ? agentNameById.get(c.agent_id) ?? "Unknown agent" : "Unassigned",
        contact_name: c.contact_name ?? "Unknown",
        contact_phone: c.contact_phone ?? "",
        direction: c.direction ?? "outbound",
        status: c.status ?? "",
        created_at: c.created_at ?? new Date(now).toISOString(),
        started_at: c.started_at,
        duration,
      };
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[get-active-calls] error", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
