// Minimal PostgREST client with the subset of the supabase-js surface the Sheets Edge actions use
// (`rpc`, `from().select().eq()...maybeSingle()` / awaited lists). LOCAL TESTS ONLY: it lets the real
// google-sheets-api action code run against the candidate migration through the same HTTP path as production.

export interface Result { data: any; error: { message: string; code?: string } | null }

export function postgrestClient(base: string, token: string) {
  if (!base.startsWith("http://127.0.0.1:")) throw new Error("REFUSING: local PostgREST only");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const parse = async (res: Response): Promise<Result> => {
    const text = await res.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) return { data: null, error: { message: String(body?.message ?? text), code: body?.code } };
    return { data: body, error: null };
  };
  return {
    rpc: async (fn: string, args: Record<string, unknown>): Promise<Result> =>
      parse(await fetch(`${base}/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args) })),
    from(table: string) {
      let cols = "*";
      const filters: string[] = [];
      const run = async () => parse(await fetch(`${base}/${table}?select=${encodeURIComponent(cols)}${filters.map((f) => `&${f}`).join("")}`, { headers }));
      const q = {
        select(c: string) { cols = c; return q; },
        eq(k: string, v: unknown) { filters.push(`${k}=eq.${encodeURIComponent(String(v))}`); return q; },
        async maybeSingle(): Promise<Result> { const r = await run(); return r.error ? r : { data: (r.data ?? [])[0] ?? null, error: null }; },
        then(resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) { return run().then(resolve, reject); },
      };
      return q;
    },
    /** Test-only scheduling nudges (service role has table grants on public.google_sheets_*). */
    async patch(table: string, filter: string, body: Record<string, unknown>): Promise<Result> {
      return parse(await fetch(`${base}/${table}?${filter}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(body) }));
    },
  };
}

export async function signHs256(secret: string, claims: Record<string, unknown>): Promise<string> {
  const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const enc = (o: unknown) => b64(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ alg: "HS256", typ: "JWT" });
  const body = enc({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64(sig)}`;
}
