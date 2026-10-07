const FN = "[twilio-account-balance]";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

type AuthUser = { id: string };

export interface BalanceAuthClient {
  auth: {
    getUser(jwt: string): Promise<{
      data: { user: AuthUser | null };
      error: unknown;
    }>;
  };
}

export interface BalanceAdminClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<{
          data: { is_super_admin?: unknown } | null;
          error: unknown;
        }>;
      };
    };
  };
}

export interface BalanceDependencies {
  authClient: BalanceAuthClient;
  adminClient: BalanceAdminClient;
  masterAccountSid: string;
  masterAuthToken: string;
  fetcher?: typeof fetch;
  now?: () => Date;
  logger?: Pick<Console, "error" | "warn">;
}

type TwilioBalancePayload = {
  balance?: unknown;
  currency?: unknown;
  code?: unknown;
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function getBearerToken(req: Request): string | null {
  const authorization = req.headers.get("Authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const token = match?.[1]?.trim() ?? "";
  return token || null;
}

export function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function normalizeTwilioBalance(
  payload: TwilioBalancePayload,
): { balance: string; currency: string } | null {
  const rawBalance = payload.balance;
  const balance =
    typeof rawBalance === "string"
      ? rawBalance.trim()
      : typeof rawBalance === "number"
        ? String(rawBalance)
        : "";

  if (!balance || !Number.isFinite(Number(balance))) return null;

  const currency = typeof payload.currency === "string"
    ? payload.currency.trim().toUpperCase()
    : "";
  if (!/^[A-Z]{3}$/.test(currency)) return null;

  return { balance, currency };
}

function safeTwilioCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const code = (payload as { code?: unknown }).code;
  if (typeof code === "number" && Number.isFinite(code)) return String(code);
  if (typeof code === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(code)) return code;
  return null;
}

export async function handleTwilioAccountBalance(
  req: Request,
  deps: BalanceDependencies,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const jwt = getBearerToken(req);
  if (!jwt) return json({ error: "Unauthorized" }, 401);

  const { data: { user }, error: userError } = await deps.authClient.auth.getUser(jwt);
  if (userError || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const claims = decodeJwtClaims(jwt);
  const claimSuperAdmin = claims?.is_super_admin === true;

  const { data: profile, error: profileError } = await deps.adminClient
    .from("profiles")
    .select("is_super_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    deps.logger?.error(`${FN} caller profile lookup failed`);
    return json({ error: "Server configuration error" }, 500);
  }

  const profileSuperAdmin = profile?.is_super_admin === true;
  if (!claimSuperAdmin || !profileSuperAdmin) {
    deps.logger?.warn(`${FN} forbidden caller`);
    return json({ error: "Forbidden" }, 403);
  }

  const masterAccountSid = deps.masterAccountSid.trim();
  const masterAuthToken = deps.masterAuthToken.trim();
  if (!masterAccountSid || !masterAuthToken) {
    deps.logger?.error(`${FN} missing required master Twilio credentials`);
    return json({ error: "Balance unavailable" }, 503);
  }

  const fetcher = deps.fetcher ?? fetch;
  const endpoint =
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(masterAccountSid)}/Balance.json`;

  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Basic ${btoa(`${masterAccountSid}:${masterAuthToken}`)}`,
        Accept: "application/json",
      },
    });
  } catch {
    deps.logger?.error(`${FN} provider network request failed`);
    return json({ error: "Balance unavailable" }, 502);
  }

  let payload: TwilioBalancePayload;
  try {
    const parsed = await response.json();
    payload = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as TwilioBalancePayload
      : {};
  } catch {
    deps.logger?.error(`${FN} provider returned invalid JSON (status=${response.status})`);
    return json({ error: "Balance unavailable" }, 502);
  }

  if (!response.ok) {
    const code = safeTwilioCode(payload);
    deps.logger?.error(
      `${FN} provider request failed (status=${response.status}${code ? `, code=${code}` : ""})`,
    );
    return json({ error: "Balance unavailable" }, 502);
  }

  const normalized = normalizeTwilioBalance(payload);
  if (!normalized) {
    deps.logger?.error(`${FN} provider balance payload failed validation`);
    return json({ error: "Balance unavailable" }, 502);
  }

  return json({
    balance: normalized.balance,
    currency: normalized.currency,
    updated_at: (deps.now ?? (() => new Date()))().toISOString(),
  });
}
