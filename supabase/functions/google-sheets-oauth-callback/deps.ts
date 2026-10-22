import { serviceClient } from "../_shared/googleSheets/auth.ts";
import type { CallbackDeps } from "./index.ts";

export function realDeps(): CallbackDeps {
  const svc = serviceClient();
  return {
    fetchFn: fetch,
    async consume(hash) {
      const { data, error } = await svc.rpc("google_sheets_consume_oauth_state", { p_state_hash: hash });
      if (error) throw new Error(error.message);
      return (data ?? [])[0] ?? null;
    },
    async store(s, sub, email, scopes, refreshToken) {
      const { data, error } = await svc.rpc("google_sheets_store_connection", {
        p_user: s.user_id, p_org: s.organization_id, p_expected_generation: s.auth_generation,
        p_google_sub: sub, p_google_email: email, p_scopes: scopes, p_refresh_token: refreshToken,
      });
      if (error) return error.message.includes("not_permitted") ? "not_permitted" : "error";
      return (data ?? [])[0]?.outcome ?? "error";
    },
  };
}
