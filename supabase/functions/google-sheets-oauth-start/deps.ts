import { authenticate, serviceClient } from "../_shared/googleSheets/auth.ts";
import type { StartDeps } from "./index.ts";

export function realDeps(): StartDeps {
  const svc = serviceClient();
  return {
    authenticate: (req) => authenticate(req, svc),
    async createState(userId, orgId, hash, verifierEnc, origin) {
      const { error } = await svc.rpc("google_sheets_create_oauth_state", {
        p_user: userId, p_org: orgId, p_state_hash: hash, p_verifier_enc: verifierEnc, p_return_origin: origin,
      });
      return error ? { error: error.message } : {};
    },
    async loginHint(userId, orgId) {
      const { data } = await svc.from("google_sheets_connections").select("google_email")
        .eq("user_id", userId).eq("organization_id", orgId).maybeSingle();
      return data?.google_email ?? null;
    },
  };
}
