// Operational tool. Dry-run by default. Production execution needs separate approval.
// Never log credentials, keys, row data, raw errors or request bodies.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decodeToken, encodeToken, tokenContext } from "../supabase/functions/_shared/google-token.ts";

export async function migrateGoogleTokens(admin: SupabaseClient, apply: boolean) {
  if (Deno.env.get("GOOGLE_TOKEN_WRITE_FORMAT") === "legacy") throw new Error("Encrypted writes must be selected for conversion");
  const result = { scanned: 0, converted: 0, wouldConvert: 0, alreadyEncrypted: 0, concurrentChanges: 0, failed: 0 };
  for (const kind of ["email", "calendar"] as const) {
    const table = kind === "email" ? "user_email_connections" : "calendar_integrations";
    const accessColumn = kind === "email" ? "access_token_encrypted" : "access_token";
    const refreshColumn = kind === "email" ? "refresh_token_encrypted" : "refresh_token";
    let afterId: string | null = null;
    while (true) {
      let query = admin.from(table).select(`id,user_id,connection_generation,${accessColumn},${refreshColumn}`).eq("provider", "google").order("id").limit(100);
      if (afterId) query = query.gt("id", afterId);
      const { data, error } = await query;
      if (error) throw new Error("Unable to read credential migration batch");
      if (!data?.length) break;
      for (const row of data as unknown as Array<Record<string, string | null>>) {
        result.scanned += 1;
        try {
          const access = row[accessColumn]; const refresh = row[refreshColumn];
          const accessContext = tokenContext(kind, row.user_id!, "access"); const refreshContext = tokenContext(kind, row.user_id!, "refresh");
          const plainAccess = await decodeToken(access, accessContext);
          const plainRefresh = await decodeToken(refresh, refreshContext);
          if ((!access || access.startsWith("gct.v1.")) && (!refresh || refresh.startsWith("gct.v1."))) { result.alreadyEncrypted += 1; continue; }
          const newAccess = await encodeToken(plainAccess, accessContext); const newRefresh = await encodeToken(plainRefresh, refreshContext);
          if (await decodeToken(newAccess, accessContext) !== plainAccess || await decodeToken(newRefresh, refreshContext) !== plainRefresh) throw new Error("Conversion validation failed");
          if (!apply) { result.wouldConvert += 1; continue; }
          const { data: changed, error: writeError } = await admin.rpc("migrate_google_credential", {
            p_kind: kind, p_id: row.id, p_generation: row.connection_generation,
            p_old_access: access, p_old_refresh: refresh, p_new_access: newAccess, p_new_refresh: newRefresh,
          });
          if (writeError) throw new Error("Conversion write failed");
          if (changed === true) result.converted += 1; else result.concurrentChanges += 1;
        } catch { result.failed += 1; }
      }
      afterId = String(data[data.length - 1].id);
    }
  }
  return result;
}

if (import.meta.main) {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const expectedHost = Deno.env.get("GOOGLE_TOKEN_MIGRATION_APPROVED_HOST");
    if (!url || !secret || !expectedHost || new URL(url).hostname !== expectedHost) throw new Error("Approved migration target is not configured");
    const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await migrateGoogleTokens(admin, Deno.args.includes("--apply"));
    console.log(JSON.stringify(result));
    if (result.failed || result.concurrentChanges) Deno.exitCode = 1;
  } catch {
    console.error("Google token migration stopped. Check the approved target and secure configuration; no credentials are printed.");
    Deno.exitCode = 1;
  }
}
