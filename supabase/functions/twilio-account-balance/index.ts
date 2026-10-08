import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createTwilioBalanceHandler } from "./logic.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const handler = createTwilioBalanceHandler({
  getEnv: (name) => Deno.env.get(name),
  validateUser: async (jwt) => {
    if (!supabaseUrl || !anonKey) throw new Error("Supabase auth configuration missing");
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error } = await authClient.auth.getUser(jwt);
    if (error || !user) return null;
    return { id: user.id };
  },
  getProfileSuper: async (userId) => {
    if (!supabaseUrl || !serviceKey) throw new Error("Supabase service configuration missing");
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await adminClient
      .from("profiles")
      .select("is_super_admin")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error("Profile lookup failed");
    return data?.is_super_admin === true ? true : data ? false : null;
  },
  fetchImpl: fetch,
  now: () => new Date(),
  logger: console,
});

Deno.serve(handler);
