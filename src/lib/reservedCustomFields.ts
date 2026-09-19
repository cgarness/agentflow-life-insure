/**
 * reservedCustomFields — the keys AgentFlow OWNS inside the flat `custom_fields` namespace.
 *
 * `leads.custom_fields` / `clients.custom_fields` / `recruits.custom_fields` are flat JSONB objects
 * keyed by the custom field's canonical NAME (AGENT_RULES invariant #27). That namespace is shared:
 * anything an agency types in Settings > Contact Management, or maps a CSV column to, lands in the
 * same bag as AgentFlow's own structured metadata. Only ONE key is AgentFlow's today.
 *
 * ---------------------------------------------------------------------------------------------
 * THE INVARIANT (the defect this module exists to close)
 * ---------------------------------------------------------------------------------------------
 * `clients.custom_fields.additional_policies` is RESERVED, STRUCTURED, AGENTFLOW-OWNED metadata: an
 * ARRAY of `AdditionalPolicyPayload` objects written at conversion time by the ONE canonical writer
 * (`ConvertLeadModal` -> `conversionSupabaseApi.convertLeadToClient` ->
 * `mergeCustomFieldsOnConversion`, src/lib/supabase-conversion.ts:26-44). Since AGENT_RULES
 * invariant #34 it is also one of the two stores the whole book of business is computed from.
 *
 *   U1 (UI)            No code path may bind `customFields.additional_policies` to a generic
 *                      custom-field editor. `FullScreenContactView` used to render EVERY key of the
 *                      bag through `renderField`, whose default branch is a plain text <input>, so
 *                      the policy array appeared as an editable "[object Object]" box and one
 *                      keystroke replaced it with a string — which `handleSave` then persisted over
 *                      the entire column. A key that is never rendered cannot be corrupted.
 *
 *   U2 (pass-through)  A save that edits an unrelated field carries the bag through by structural
 *                      copy. The `additional_policies` value must come out IDENTICAL — never
 *                      normalized, stringified, flattened, reordered or re-parsed.
 *
 *   U3 (write)         `clientsSupabaseApi` refuses, with a thrown error and NO write, any
 *                      `custom_fields` payload in which `additional_policies` is present and is not
 *                      a JSON array. ABSENT is allowed: that is what a non-converted client, and
 *                      both Add/Edit-Client modal paths, legitimately look like.
 *
 * U3 is a TYPE guard, not a merge. It cannot detect a write that OMITS a key the stored row has —
 * that needs a read of the current row, and is tracked as a separate change. It is sufficient here
 * because every legitimate producer of this key writes an array, so a non-array arriving at the
 * boundary is corruption, decidable from the payload alone.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE CONSTANT LIVES HERE AND NOT IN ONE OF THE TWO FILES THAT ALREADY HOLD IT
 * ---------------------------------------------------------------------------------------------
 * The same literal is exported from `src/lib/profile/normalized-policy.ts` (the reader, held equal
 * to `supabase/tests/profile_book_stats_rpc.sql` by a standing maintenance obligation) and declared
 * privately in `src/lib/supabase-conversion.ts` (the canonical writer, deliberately out of bounds
 * for the corruption bugfix). This leaf module lets the UI and the write boundary share one
 * definition without editing either. The three are pinned equal by
 * `src/lib/__tests__/clientCustomFieldsWriteGuard.test.ts` rather than by convention.
 */

/** The reserved key. `clients.custom_fields.additional_policies` — an array, always. */
export const ADDITIONAL_POLICIES_KEY = "additional_policies";

/** Every AgentFlow-owned key in the flat custom-field namespace. Exactly one today. */
export const RESERVED_CUSTOM_FIELD_KEYS: readonly string[] = [ADDITIONAL_POLICIES_KEY];

/**
 * True when a custom-field key is AgentFlow-owned structured metadata and must therefore never be
 * rendered through, or enforced by, a generic custom-field path (U1).
 *
 * Exact match only. The flat namespace is keyed by canonical name and nothing normalizes it on the
 * way in, so a fuzzy match would hide unrelated agency fields — the opposite of the goal.
 */
export function isReservedCustomFieldKey(key: unknown): boolean {
  return typeof key === "string" && RESERVED_CUSTOM_FIELD_KEYS.includes(key);
}

/**
 * U3. Throw when a `custom_fields` write would replace the structured `additional_policies` array
 * with something that is not an array.
 *
 * Allowed, and each for a real reason:
 *   - `undefined`                      the caller is not writing the column at all (AddClientModal)
 *   - `null` / a non-object bag        "this contact has no custom fields"
 *   - a bag WITHOUT the key            every non-converted client; 6 of 6 in production today
 *   - the key holding an ARRAY         the canonical writer's shape, `[]` included
 *
 * Refused: the key holding a string, number, boolean, plain object or `null`. Those are exactly the
 * shapes the generic text input produced. Nothing is written, nothing is repaired, and nothing is
 * deleted — malformed data is surfaced, never silently normalized away.
 *
 * @param customFields the `customFields` value about to be written to `custom_fields`
 * @param context      the caller, quoted verbatim in the error so the failing path is obvious
 */
export function assertCustomFieldsWriteSafe(customFields: unknown, context: string): void {
  if (customFields === null || customFields === undefined) return;
  if (typeof customFields !== "object" || Array.isArray(customFields)) return;

  const bag = customFields as Record<string, unknown>;
  for (const key of RESERVED_CUSTOM_FIELD_KEYS) {
    if (!(key in bag)) continue;
    const value = bag[key];
    if (Array.isArray(value)) continue;
    throw new Error(
      `${context}: refusing to write custom_fields.${key} as ${describeJsonType(value)}. ` +
        `${key} is reserved AgentFlow metadata and must be a JSON array (AGENT_RULES invariant #35). ` +
        `Nothing was saved.`
    );
  }
}

/** A short, safe type name for the error message. Never interpolates the value itself. */
function describeJsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  const t = typeof value;
  if (t === "string") return "a string";
  if (t === "number") return "a number";
  if (t === "boolean") return "a boolean";
  if (t === "object") return "an object";
  return `a ${t}`;
}
