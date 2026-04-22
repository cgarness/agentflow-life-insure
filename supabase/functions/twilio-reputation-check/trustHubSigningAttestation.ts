/**
 * Twilio does not put SHAKEN/STIR signing level in Voice Insights reports.
 * Signing tier follows Trust Hub: approved SHAKEN/STIR Trust Product + optional
 * phone assignment to that product (A vs B). See Twilio SHAKEN/STIR onboarding docs.
 */

/** Policy SID from Twilio SHAKEN/STIR Trust Product examples (do not change when creating products). */
const SHAKEN_STIR_POLICY_SIDS = new Set([
  "RN7a97559effdf62d00f4298208492a5ea",
]);

function basicAuth(accountSid: string, authToken: string): string {
  return "Basic " + btoa(`${accountSid}:${authToken}`);
}

function normStatus(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/_/g, "-").trim();
}

function isTwilioApprovedShakenProduct(status: unknown): boolean {
  const n = normStatus(status);
  return n === "twilio-approved";
}

function isShakenTrustProduct(row: Record<string, unknown>): boolean {
  const pol = String(row.policy_sid ?? row.policySid ?? "").trim();
  if (SHAKEN_STIR_POLICY_SIDS.has(pol)) return true;
  const fn = String(row.friendly_name ?? row.friendlyName ?? "").toLowerCase();
  if ((fn.includes("shaken") || fn.includes("stir")) && pol.startsWith("RN")) return true;
  return false;
}

function firstArray(
  o: Record<string, unknown>,
  keys: string[],
): unknown[] {
  for (const k of keys) {
    const v = o[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

/**
 * Returns Twilio signing tier for outbound calls from this number:
 * - **A** — number (PN…) is assigned to an approved SHAKEN/STIR Trust Product.
 * - **B** — account has an approved SHAKEN/STIR Trust Product but this PN is not
 *   assigned to it (Twilio still signs account-level B for Twilio-owned numbers).
 * - **null** — could not determine (API error, no SHAKEN product, or not approved yet).
 */
export async function fetchTrustHubSigningAttestation(
  accountSid: string,
  authToken: string,
  opts: {
    phoneNumberSid: string | null | undefined;
  },
): Promise<"A" | "B" | null> {
  const pn = String(opts.phoneNumberSid ?? "").trim();

  const auth = basicAuth(accountSid, authToken);
  const listUrl = "https://trusthub.twilio.com/v1/TrustProducts?PageSize=100";
  const listRes = await fetch(listUrl, {
    headers: { Authorization: auth, Accept: "application/json" },
  });
  if (!listRes.ok) {
    console.warn(
      "[trustHubSigningAttestation] TrustProducts list HTTP",
      listRes.status,
    );
    return null;
  }

  let listJson: Record<string, unknown>;
  try {
    listJson = (await listRes.json()) as Record<string, unknown>;
  } catch {
    return null;
  }

  const products = firstArray(listJson, [
    "trust_products",
    "results",
    "trustProducts",
  ]);
  if (products.length === 0) return null;

  const shakenProducts = products
    .map((p) => p as Record<string, unknown>)
    .filter(isShakenTrustProduct);

  const approved = shakenProducts.filter((p) => isTwilioApprovedShakenProduct(p.status));
  if (approved.length === 0) return null;

  if (pn.startsWith("PN")) {
    for (const prod of approved) {
      const bu = String(prod.sid ?? "").trim();
      if (!bu.startsWith("BU")) continue;
      const assignUrl =
        `https://trusthub.twilio.com/v1/TrustProducts/${encodeURIComponent(bu)}/ChannelEndpointAssignments?ChannelEndpointSid=${
          encodeURIComponent(pn)
        }&PageSize=20`;
      const ar = await fetch(assignUrl, {
        headers: { Authorization: auth, Accept: "application/json" },
      });
      if (!ar.ok) continue;
      let aj: Record<string, unknown>;
      try {
        aj = (await ar.json()) as Record<string, unknown>;
      } catch {
        continue;
      }
      const rows = firstArray(aj, [
        "channel_endpoint_assignments",
        "channel_endpoint_assignment",
        "results",
      ]);
      if (rows.length > 0) return "A";
    }
  }

  return "B";
}
