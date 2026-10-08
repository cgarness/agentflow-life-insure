const FN = "[twilio-account-balance]";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export type BalanceUser = { id: string };

export interface TwilioBalanceDeps {
  getEnv(name: string): string | undefined;
  validateUser(jwt: string): Promise<BalanceUser | null>;
  getProfileSuper(userId: string): Promise<boolean | null>;
  fetchImpl(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  now(): Date;
  logger?: Pick<Console, "warn" | "error">;
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
  const header = req.headers.get("Authorization")?.trim() ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function normalizeTwilioBalance(
  payload: unknown,
): { balance: string; currency: string } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const row = payload as TwilioBalancePayload;

  let balance: string;
  if (typeof row.balance === "number") {
    if (!Number.isFinite(row.balance)) return null;
    balance = String(row.balance);
  } else if (typeof row.balance === "string") {
    balance = row.balance.trim();
    if (!balance || !Number.isFinite(Number(balance))) return null;
  } else {
    return null;
  }

  const currency = typeof row.currency === "string" ? row.currency.trim() : "";
  if (!currency) return null;

  return { balance, currency };
}

function safeProviderCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const code = (payload as TwilioBalancePayload).code;
  if (typeof code === "number" && Number.isFinite(code)) return String(code);
  if (typeof code === "string" && code.trim()) return code.trim().slice(0, 40);
  return null;
}

function parseJson(text: string): unknown | null {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createTwilioBalanceHandler(deps: TwilioBalanceDeps) {
  const logger = deps.logger ?? console;

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const jwt = getBearerToken(req);
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    let user: BalanceUser | null = null;
    try {
      user = await deps.validateUser(jwt);
    } catch {
      logger.error(`${FN} Supabase auth validation unavailable`);
      return json({ error: "Server configuration error" }, 500);
    }
    if (!user) return json({ error: "Unauthorized" }, 401);

    const claims = decodeJwtClaims(jwt);
    const claimSuper = claims?.is_super_admin === true;

    let profileSuper: boolean | null = null;
    try {
      profileSuper = await deps.getProfileSuper(user.id);
    } catch {
      logger.error(`${FN} Super Admin profile lookup failed`);
      return json({ error: "Server configuration error" }, 500);
    }

    if (!claimSuper || profileSuper !== true) {
      logger.warn(`${FN} forbidden user=${user.id} claim=${claimSuper} profile=${profileSuper === true}`);
      return json({ error: "Forbidden" }, 403);
    }

    const masterSid = (deps.getEnv("TWILIO_MASTER_ACCOUNT_SID") ?? "").trim();
    const masterToken = (deps.getEnv("TWILIO_MASTER_AUTH_TOKEN") ?? "").trim();
    if (!masterSid || !masterToken) {
      logger.error(`${FN} Missing required TWILIO_MASTER_* configuration`);
      return json({ error: "Balance unavailable" }, 500);
    }

    const url =
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(masterSid)}/Balance.json`;

    let response: Response;
    try {
      response = await deps.fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Basic ${btoa(`${masterSid}:${masterToken}`)}`,
          Accept: "application/json",
        },
      });
    } catch {
      logger.error(`${FN} Twilio balance request failed category=network`);
      return json({ error: "Balance unavailable" }, 502);
    }

    const text = await response.text();
    const payload = parseJson(text);

    if (!response.ok) {
      const code = safeProviderCode(payload);
      logger.warn(
        `${FN} Twilio balance request failed status=${response.status}${code ? ` code=${code}` : ""}`,
      );
      return json({ error: "Balance unavailable" }, 502);
    }

    const normalized = normalizeTwilioBalance(payload);
    if (!normalized) {
      logger.warn(`${FN} Twilio balance response was invalid`);
      return json({ error: "Balance unavailable" }, 502);
    }

    return json({
      balance: normalized.balance,
      currency: normalized.currency,
      updated_at: deps.now().toISOString(),
    });
  };
}
