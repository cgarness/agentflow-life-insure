// deno-lint-ignore-file no-import-prefix -- Edge bundles use explicit URLs; pin the reviewed SDK version.
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { loadOutboundTwilioCreds } from "../twilioOutboundCreds.ts";
import { loadSubaccountCreds } from "../twilioSubaccountCreds.ts";
import {
  ACCOUNT_SID,
  type Actor,
  type Credentials,
  NumberError,
  type Scope,
} from "./contracts.ts";

export type NumberDependencies = {
  db: SupabaseClient;
  userForToken: (token: string) => Promise<{ id: string } | null>;
  masterCredentials: () => Credentials;
  localCredentials: (organizationId: string) => Promise<Credentials>;
  fetchImpl: typeof fetch;
  supabaseUrl: string;
  now: () => number;
};

export function credentials(value: Credentials): Credentials {
  if (
    !ACCOUNT_SID.test(value.accountSid) || !value.authToken ||
    value.authToken.length > 4096
  ) {
    throw new NumberError(
      "TELEPHONY_MISCONFIGURED",
      "Telephony is not configured correctly.",
      503,
    );
  }
  return value;
}

export async function authorize(
  req: Request,
  scope: Scope,
  deps: NumberDependencies,
): Promise<Actor> {
  const token = req.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)
    ?.[1];
  if (!token || token.length > 8192) {
    throw new NumberError(
      "UNAUTHORIZED",
      "Sign in to manage phone numbers.",
      401,
    );
  }
  let user: { id: string } | null;
  try {
    user = await deps.userForToken(token);
  } catch {
    throw new NumberError(
      "UNAUTHORIZED",
      "Sign in to manage phone numbers.",
      401,
    );
  }
  if (!user) {
    throw new NumberError(
      "UNAUTHORIZED",
      "Sign in to manage phone numbers.",
      401,
    );
  }
  const { data: profile, error } = await deps.db.from("profiles")
    .select("id, organization_id, role, status").eq("id", user.id)
    .maybeSingle();
  if (error) {
    throw new NumberError(
      "AUTH_LOOKUP_FAILED",
      "Agency permissions could not be verified.",
      503,
    );
  }
  if (
    !profile?.organization_id || profile.id !== user.id ||
    profile.status !== "Active" ||
    !["Admin", "Super Admin"].includes(profile.role)
  ) {
    throw new NumberError(
      "FORBIDDEN",
      "An active agency administrator is required.",
      403,
    );
  }
  if (
    (scope.actor_id !== undefined && scope.actor_id !== profile.id) ||
    (scope.organization_id !== undefined &&
      scope.organization_id !== profile.organization_id) ||
    (scope.view_as !== undefined && scope.view_as !== false)
  ) {
    throw new NumberError(
      "SCOPE_CHANGED",
      "Your agency context changed. Refresh and try again.",
      403,
    );
  }
  const { data: org, error: orgError } = await deps.db.from("organizations")
    .select("twilio_subaccount_sid, twilio_subaccount_status").eq(
      "id",
      profile.organization_id,
    ).maybeSingle();
  if (orgError) {
    throw new NumberError(
      "ORG_LOOKUP_FAILED",
      "Agency telephony could not be verified.",
      503,
    );
  }
  if (!org) {
    throw new NumberError(
      "ORG_NOT_FOUND",
      "Agency telephony was not found.",
      403,
    );
  }
  const status = org.twilio_subaccount_status;
  if (status === "pending") {
    throw new NumberError(
      "PROVISIONING_PENDING",
      "Telephony is still being provisioned. Please try again shortly.",
      503,
    );
  }
  if (status === "pending_manual") {
    throw new NumberError(
      "PROVISIONING_FAILED",
      "Telephony provisioning needs support review.",
      503,
    );
  }
  if (status === "suspended" || status === "closed") {
    throw new NumberError(
      "TELEPHONY_SUSPENDED",
      "Agency telephony is suspended.",
      403,
    );
  }
  if (
    status !== "active" || typeof org.twilio_subaccount_sid !== "string" ||
    !ACCOUNT_SID.test(org.twilio_subaccount_sid)
  ) {
    throw new NumberError(
      "TELEPHONY_MISCONFIGURED",
      "Agency telephony is not configured correctly.",
      503,
    );
  }
  return { id: profile.id, organizationId: profile.organization_id };
}

export function runtimeDependencies(): NumberDependencies {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !serviceKey || !anonKey) {
    throw new NumberError(
      "SERVER_CONFIGURATION",
      "Phone number service is not configured.",
      503,
    );
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const db = createClient(supabaseUrl, serviceKey, options);
  const auth = createClient(supabaseUrl, anonKey, options);
  return {
    db,
    supabaseUrl,
    fetchImpl: fetch,
    now: Date.now,
    userForToken: async (token) => {
      const { data: { user }, error } = await auth.auth.getUser(token);
      return error || !user ? null : { id: user.id };
    },
    masterCredentials: () => {
      const result = loadOutboundTwilioCreds();
      if (!result.ok) {
        throw new NumberError(result.code, result.error, result.status);
      }
      return credentials(result.creds);
    },
    localCredentials: async (org) => {
      const result = await loadSubaccountCreds(db, org);
      if (!result.ok) {
        throw new NumberError(result.code, result.error, result.status);
      }
      return credentials(result.creds);
    },
  };
}
