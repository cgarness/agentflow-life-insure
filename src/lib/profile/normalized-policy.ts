/**
 * normalized-policy — the ONE definition of "a policy" in AgentFlow.
 *
 * There is no policies table. A policy is one of exactly two things:
 *
 *   1. A PRIMARY policy, stored as columns on a `clients` row
 *      (policy_type / carrier / policy_number / premium / face_amount / sold_date).
 *   2. An ADDITIONAL policy, stored as an object inside the
 *      `clients.custom_fields.additional_policies` JSON array.
 *
 * Every book-of-business number on the Agent and Team Profile — total policies, total premium,
 * carrier breakdown, policy-type mix, largest policy, best premium month — aggregates over the
 * union of those two. In production that aggregation runs SERVER-SIDE, in
 * `public.get_profile_book_stats`, because `clients` RLS returns nothing for a Team Leader's
 * downline. This module is the TypeScript statement of the same rules: it is what the unit suite
 * pins, and it is what any future client-side consumer must use rather than re-deriving.
 *
 * The SQL and this file are held equal by `src/lib/__tests__/normalizedPolicy.test.ts` and
 * `supabase/tests/profile_book_stats_rpc.sql`, which assert the same table of cases.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY EACH RULE EXISTS (every one is a real, observed case, not a defensive guess)
 * ---------------------------------------------------------------------------------------------
 *  * `additional_policies` HAS EXACTLY ONE WRITER AND, BEFORE THIS BUILD, ZERO READERS.
 *    `ConvertLeadModal` -> `conversionSupabaseApi.convertLeadToClient` ->
 *    `mergeCustomFieldsOnConversion` (src/lib/supabase-conversion.ts:26-44) is the only code that
 *    has ever written the key. Nothing has ever read it back. This module is the first reader, so
 *    it — not the absent production data — is the contract.
 *
 *  * ITS AMOUNTS ARE RAW, UNPARSED USER STRINGS. The writer parses the PRIMARY policy's amounts
 *    through `parseCurrencyToNumber` before writing the numeric `clients` columns, but writes the
 *    additional-policy array verbatim, so `"$150/mo"` is stored as that literal string
 *    (src/lib/supabase-conversion.ts:46-48, 84-86 vs. :37-38).
 *
 *  * ITS SALE DATE HAS A LEGACY KEY. The writer's own doc comment states it:
 *    "Rows written before the Sold Date build carry `issueDate` instead of `soldDate`; readers must
 *    tolerate both keys" (src/lib/supabase-conversion.ts:8-10). A reader that checks only
 *    `soldDate` silently drops the sale date of every pre-Sold-Date-build row.
 *
 *  * THE CONTAINER MAY NOT BE AN ARRAY. `FullScreenContactView.tsx:1116-1122` renders every
 *    `customFields` key that is not in the field layout through `renderField(key, …)`, whose
 *    default branch (`:833`) is a plain text `<input>`; `handleSave` (`:660`) then writes the whole
 *    `customFields` object back. One keystroke in that input replaces the policy array with a
 *    string, permanently. That is a live defect logged as its own BUGFIX follow-up — this module
 *    must survive it, count it, and never silently report the affected client as having no extra
 *    policies.
 *
 *  * `0` MEANS "NOT RECORDED", NOT "FREE". `clients.premium` and `clients.face_amount` both
 *    DEFAULT 0, and `supabase/functions/import-contacts` sets NO policy columns at all, so every
 *    CSV-imported client lands on those defaults. `formatCurrencyValue`
 *    (src/lib/supabase-clients.ts:181-188) already renders missing-or-zero as blank rather than a
 *    fabricated "$0"; the aggregate must agree with the display or a book of six blanks would
 *    report a total.
 *
 *  * PREMIUM IS MONTHLY, ALWAYS. `src/lib/policyPaymentFields.ts:5-9` states it: payment_frequency
 *    is schedule metadata only, and `clients.premium` stays MONTHLY dollars regardless. NOTHING
 *    here multiplies by 12.
 */

/** Where a normalized policy came from. */
export type PolicySource = "primary" | "additional";

/** One policy, from either store, with every value already coerced to its canonical form. */
export interface NormalizedPolicy {
  source: PolicySource;
  clientId: string;
  /** Trimmed; `null` when blank. `clients.policy_type` is NOT NULL DEFAULT 'Term'. */
  policyType: string | null;
  /** Trimmed; `null` when blank. `clients.carrier` DEFAULTs to '' — blank is the unset value. */
  carrier: string | null;
  policyNumber: string | null;
  /** MONTHLY dollars. `null` when not recorded. NEVER annualized. */
  premiumMonthly: number | null;
  /** `null` when not recorded. */
  faceAmount: number | null;
  /** `YYYY-MM-DD`, or `null` when the policy carries no usable sale date. */
  soldDate: string | null;
  effectiveDate: string | null;
}

/** What normalizing one client produced, including the data-quality signals. */
export interface NormalizedClientPolicies {
  policies: NormalizedPolicy[];
  /**
   * True when the client row itself carries no policy evidence at all (decision D-3b). Such a
   * client is still a CLIENT — it is only not a POLICY.
   */
  hasNoPolicyDetail: boolean;
  /**
   * Entries that could not be interpreted: an `additional_policies` value that is not an array
   * (the FullScreenContactView corruption) counts 1, plus one per non-object array element.
   * Surfaced in the UI as a data-quality note — NEVER folded into a silent zero.
   */
  malformedAdditionalPolicies: number;
}

/** The raw `clients` columns this module reads. Nothing else is needed, and nothing else is read. */
export interface ClientPolicyRow {
  id: string;
  policy_type?: string | null;
  carrier?: string | null;
  policy_number?: string | null;
  premium?: number | string | null;
  face_amount?: number | string | null;
  sold_date?: string | null;
  effective_date?: string | null;
  custom_fields?: unknown;
}

/** The key the writer uses. It lives in the FLAT custom-field namespace (AGENT_RULES invariant #27). */
export const ADDITIONAL_POLICIES_KEY = "additional_policies";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a currency-ish value the way `parseCurrencyToNumberOrNull`
 * (src/lib/supabase-clients.ts:189-196) does, and NOT the way `parseCurrencyToNumber`
 * (src/lib/supabase-conversion.ts:46-48) does.
 *
 * The repo carries both, with OPPOSITE blank semantics: one returns `null` for a blank, the other
 * returns `0`. Every aggregate here uses the `OrNull` semantics, so a blank premium can never
 * become a `0` that silently drags a book total down.
 */
export function parsePolicyAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;

  const cleaned = String(raw).replace(/[^0-9.-]+/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;

  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}

/** An amount that is present and greater than zero, else `null`. `0` means "not recorded". */
function positiveAmount(raw: unknown): number | null {
  const num = parsePolicyAmount(raw);
  return num !== null && num > 0 ? num : null;
}

function trimmedOrNull(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Accept only a strict `YYYY-MM-DD`, and reject a syntactically valid but impossible date.
 * `new Date("2026-02-31")` rolls forward to 2026-03-03; a policy dated to a day that does not exist
 * is missing a date, not dated to some other month.
 */
export function parsePolicyDate(raw: unknown): string | null {
  const trimmed = trimmedOrNull(raw);
  if (trimmed === null || !ISO_DATE_RE.test(trimmed)) return null;

  const [y, m, d] = trimmed.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null;
  }
  return trimmed;
}

/**
 * Decision D-3b — evidence-based primary-policy counting.
 *
 * `clients.policy_type` is NOT NULL DEFAULT 'Term' and the CSV importer sets no policy columns, so
 * counting every `clients` row as a policy would report a book of phantom Term policies worth $0
 * for any agency that imports its client list, and would let those phantoms dominate the policy-type
 * mix. A row counts as a primary policy only when it carries at least one real policy signal.
 */
export function hasPrimaryPolicyEvidence(row: ClientPolicyRow): boolean {
  return (
    trimmedOrNull(row.carrier) !== null ||
    trimmedOrNull(row.policy_number) !== null ||
    positiveAmount(row.premium) !== null ||
    positiveAmount(row.face_amount) !== null ||
    parsePolicyDate(row.sold_date) !== null
  );
}

/** Normalize one client row into its policies plus the data-quality signals. */
export function normalizeClientPolicies(row: ClientPolicyRow): NormalizedClientPolicies {
  const policies: NormalizedPolicy[] = [];
  let malformed = 0;

  const hasPrimary = hasPrimaryPolicyEvidence(row);
  if (hasPrimary) {
    policies.push({
      source: "primary",
      clientId: row.id,
      policyType: trimmedOrNull(row.policy_type),
      carrier: trimmedOrNull(row.carrier),
      policyNumber: trimmedOrNull(row.policy_number),
      premiumMonthly: positiveAmount(row.premium),
      faceAmount: positiveAmount(row.face_amount),
      soldDate: parsePolicyDate(row.sold_date),
      effectiveDate: parsePolicyDate(row.effective_date),
    });
  }

  const container = readAdditionalPoliciesContainer(row.custom_fields);

  if (container.kind === "corrupted") {
    // Present but not an array: the FullScreenContactView text-input corruption. One data-quality
    // signal for the whole client — we cannot know how many policies were lost.
    malformed += 1;
  } else if (container.kind === "array") {
    for (const entry of container.entries) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        malformed += 1;
        continue;
      }
      const e = entry as Record<string, unknown>;
      policies.push({
        source: "additional",
        clientId: row.id,
        policyType: trimmedOrNull(e.policyType),
        carrier: trimmedOrNull(e.carrier),
        policyNumber: trimmedOrNull(e.policyNumber),
        premiumMonthly: positiveAmount(e.premiumAmount),
        faceAmount: positiveAmount(e.faceAmount),
        // The documented legacy key. `soldDate` wins when both are present.
        soldDate: parsePolicyDate(e.soldDate) ?? parsePolicyDate(e.issueDate),
        effectiveDate: parsePolicyDate(e.effectiveDate),
      });
    }
  }

  return {
    policies,
    hasNoPolicyDetail: !hasPrimary,
    malformedAdditionalPolicies: malformed,
  };
}

type AdditionalPoliciesContainer =
  | { kind: "absent" }
  | { kind: "array"; entries: unknown[] }
  | { kind: "corrupted" };

/**
 * Read the container without trusting its shape.
 *
 * `custom_fields` is a FLAT object keyed by canonical custom-field name (AGENT_RULES invariant #27),
 * so `additional_policies` shares a namespace with anything an agency names. Requiring an array of
 * objects before interpreting anything is what keeps a user-created field of the same name from
 * being read as policy data.
 */
function readAdditionalPoliciesContainer(customFields: unknown): AdditionalPoliciesContainer {
  if (typeof customFields !== "object" || customFields === null || Array.isArray(customFields)) {
    return { kind: "absent" };
  }
  const bag = customFields as Record<string, unknown>;
  if (!(ADDITIONAL_POLICIES_KEY in bag)) return { kind: "absent" };

  const raw = bag[ADDITIONAL_POLICIES_KEY];
  if (raw === null || raw === undefined) return { kind: "absent" };
  if (Array.isArray(raw)) return { kind: "array", entries: raw };
  return { kind: "corrupted" };
}

/** Normalize a set of client rows. Ordering is preserved; nothing is deduplicated. */
export function normalizeClientsToPolicies(rows: ClientPolicyRow[]): NormalizedClientPolicies {
  const policies: NormalizedPolicy[] = [];
  let noDetail = 0;
  let malformed = 0;

  for (const row of rows) {
    const result = normalizeClientPolicies(row);
    policies.push(...result.policies);
    if (result.hasNoPolicyDetail) noDetail += 1;
    malformed += result.malformedAdditionalPolicies;
  }

  return {
    policies,
    // On a set, the flag is meaningless; the count is what matters and is exposed separately.
    hasNoPolicyDetail: noDetail > 0,
    malformedAdditionalPolicies: malformed,
  };
}

/** The `YYYY-MM` bucket a policy belongs to, or `null` when it has no usable sale date. */
export function policyMonthBucket(policy: NormalizedPolicy): string | null {
  return policy.soldDate ? policy.soldDate.slice(0, 7) : null;
}
