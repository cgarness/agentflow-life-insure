import { A2pError, type Credentials } from "./types.ts";
const HOSTS = new Set(["trusthub.twilio.com", "messaging.twilio.com", "api.twilio.com", "lookups.twilio.com"]);
export class TwilioA2p {
  constructor(public creds: Credentials, private request: typeof fetch = fetch, private deadline?: AbortSignal) {}
  async call(path: string, method = "GET", body?: Record<string, unknown>, form = false): Promise<Record<string, any>> {
    const url = new URL(path);
    if (url.protocol !== "https:" || !HOSTS.has(url.hostname) || url.username || url.password) {
      throw new A2pError("INVALID_PROVIDER_URL", "Invalid provider endpoint.", 500);
    }
    let response: Response;
    try {
      response = await this.request(url, {
        method,
        redirect: "error",
        signal: this.deadline
          ? AbortSignal.any([this.deadline, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000),
        headers: {
          Authorization: "Basic " + btoa(`${this.creds.accountSid}:${this.creds.authToken}`),
          "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json",
          "X-Twilio-Api-Version": "v1.2",
        },
        body: body
          ? (form
            ? new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString()
            : JSON.stringify(body))
          : undefined,
      });
    } catch {
      throw new A2pError(
        "PROVIDER_UNAVAILABLE",
        method === "GET"
          ? "Could not refresh provider status."
          : "Provider response was interrupted. Reconciliation is required before retrying.",
        503,
        method !== "GET",
      );
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new A2pError(
        "PROVIDER_" + response.status,
        response.status === 403
          ? "A2P embedded registration is not enabled or permitted for this account. Contact your administrator."
          : `Twilio could not complete this action${
            typeof data?.code === "number" ? ` (code ${data.code})` : ""
          }. Refresh status or contact support.`,
        response.status >= 500 ? 503 : 400,
        method !== "GET" && response.status >= 500,
      );
    }
    if (!data || typeof data !== "object") {
      throw new A2pError(
        "INVALID_PROVIDER_RESPONSE",
        "Provider returned an unreadable response.",
        502,
        method !== "GET",
      );
    }
    return data;
  }
  async list(url: string, key: string): Promise<Record<string, any>[]> {
    const rows: Record<string, any>[] = [];
    let next: string | null = url;
    for (let i = 0; next && i < 20; i++) {
      const p = await this.call(next);
      if (!Array.isArray(p[key])) {
        throw new A2pError("INVALID_PROVIDER_RESPONSE", "Provider collection is missing.", 502);
      }
      rows.push(...p[key]);
      const n = p.meta?.next_page_url ?? p.next_page_uri;
      next = n ? new URL(String(n), url).href : null;
    }
    if (next) {
      throw new A2pError("PROVIDER_PAGE_LIMIT", "Too many provider records. Contact support to reconcile.", 503);
    }
    return rows;
  }
  async number(sid: string) {
    if (!/^PN[0-9a-fA-F]{32}$/.test(sid)) throw new A2pError("NUMBER_INVALID", "Invalid phone number.", 400);
    const n = await this.call(
      `https://api.twilio.com/2010-04-01/Accounts/${this.creds.accountSid}/IncomingPhoneNumbers/${sid}.json`,
    );
    if (n.account_sid !== this.creds.accountSid || n.sid !== sid || n.capabilities?.sms !== true) {
      throw new A2pError("NUMBER_ACCOUNT", "Number is not an SMS-capable number in the registration account.");
    }
    return n;
  }
}
export function inquirySession(p: Record<string, any>, accountSid: string) {
  const id = String(p.id ?? "");
  const pattern = new RegExp(`^tri1\\.us1\\.account\\.${accountSid}\\.registration\\.(BU[0-9a-fA-F]{32})$`);
  const match = id.match(pattern);
  if (
    !match || typeof p.sessionId !== "string" || !p.sessionId.startsWith("inq_") ||
    typeof p.sessionToken !== "string" || !p.sessionToken
  ) {
    throw new A2pError(
      "INQUIRY_UNCONFIRMED",
      "Registration response needs reconciliation. Do not create it again.",
      502,
      true,
    );
  }
  return { id, bundle: match[1], sessionId: p.sessionId, sessionToken: p.sessionToken };
}
export function resumedSession(p: Record<string, any>) {
  if (
    typeof p.sessionId !== "string" || !p.sessionId.startsWith("inq_") || typeof p.sessionToken !== "string" ||
    !p.sessionToken
  ) throw new A2pError("SESSION_INVALID", "Could not open the secure registration form.", 502);
  return { sessionId: p.sessionId, sessionToken: p.sessionToken };
}
