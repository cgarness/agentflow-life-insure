import WebSocket from "ws";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Server-side client — REST only; Realtime needs ws transport on Node below 22. */
export function createBridgeSupabase(
  url: string,
  serviceRoleKey: string,
): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      transport: WebSocket as unknown as typeof globalThis.WebSocket,
    },
  });
}
