// Synthetic provider boundary only. The actual dialog, hook and response validators run unchanged.
type Body = Record<string, string>;
declare global { interface Window { phoneFixtureEvents: { name: string; body: Body }[] } }
window.phoneFixtureEvents = [];
let statusChecks = 0;
const scenario = new URLSearchParams(location.search).get("scenario");
const numbers = [
  { phone_number: "+18005550100", number_type: "toll_free", friendly_name: "(800) 555-0100", locality: null, region: null, postal_code: null, country: "US", monthly_price: "2.15", currency: "USD" },
  { phone_number: "+18885550100", number_type: "toll_free", friendly_name: "(888) 555-0100", locality: null, region: null, postal_code: null, country: "US", monthly_price: "2.15", currency: "USD" },
  { phone_number: "+12135550100", number_type: "local", friendly_name: "(213) 555-0100", locality: "Los Angeles", region: "CA", postal_code: "90001", country: "US", monthly_price: "1.15", currency: "USD" },
];
const reply = (value: object) => ({ data: { protocol_version: 1, ...value }, error: null });
export const supabase = { functions: { async invoke(name: string, { body }: { body: Body }) {
  window.phoneFixtureEvents.push({ name, body: structuredClone(body) });
  await new Promise((resolve) => setTimeout(resolve, 30));
  if (name === "twilio-search-numbers" && body.action === "search") {
    if (scenario === "old") return { data: { numbers: [] }, error: null };
    return reply({ numbers: numbers.filter((n) => n.number_type === body.number_type &&
      (body.number_type === "local" || body.prefix === "prefer_800" || n.phone_number.startsWith(`+1${body.prefix}`))) });
  }
  if (name === "twilio-search-numbers" && body.action === "quote") {
    const number = numbers.find((n) => n.phone_number === body.phone_number)!;
    const quote = { ...number, id: crypto.randomUUID(), inbound_per_minute: "0.022",
      expires_at: new Date(Date.now() + 300_000).toISOString() };
    sessionStorage.setItem(`synthetic-quote:${quote.id}`, JSON.stringify(quote));
    return reply({ quote });
  }
  if (name === "twilio-buy-number" && ["purchase", "status"].includes(body.action)) {
    if ("phone_number" in body) throw new Error("The legacy purchase payload must never be sent.");
    if (scenario === "timeout" && (body.action === "purchase" || ++statusChecks === 1)) {
      return { data: null, error: new Error("Synthetic lost response") };
    }
    const quote = JSON.parse(sessionStorage.getItem(`synthetic-quote:${body.quote_id}`) || "null");
    return reply({ operation: { id: body.quote_id, phone_number: quote.phone_number,
      state: "completed", phone_number_id: crypto.randomUUID() } });
  }
  throw new Error(`Unexpected fixture call ${name}/${body.action}`);
} } };
