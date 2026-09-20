/**
 * contactSavePolicy — the ONE shared contact-save / duplicate-detection policy.
 *
 * ## Why this module exists
 *
 * Two surfaces edit a whole contact record through `FullScreenContactView`: the Contacts page
 * (`src/pages/Contacts.tsx`) and the deep-link pages `/leads/:id`, `/clients/:id`, `/recruits/:id`
 * (`src/pages/ContactDeepLinkPage.tsx`). Before this module, the agency's duplicate-detection
 * settings were applied by a component-local `useCallback` inside `Contacts.tsx`, so the deep-link
 * surface enforced nothing at all and the Contacts surface enforced it for leads only. Copying that
 * logic into a second page would have produced two implementations of one agency rule that could
 * drift apart.
 *
 * So the POLICY lives here and returns a DECISION. It queries, it classifies, and it stops. It
 * renders no dialog and raises no toast — each surface translates `allow` / `block` / `confirm`
 * into its own existing UI. The duplicate QUERY itself is not reimplemented either: this module
 * calls the pre-existing `findDuplicates` / `describeDuplicate` from
 * `src/lib/contactDuplicateDetection.ts`, which is unchanged.
 *
 * CSV / import duplicate handling (`csvAction`) is deliberately NOT part of this module and is
 * unchanged — it is a different setting with a different contract.
 */

import {
  findDuplicates,
  describeDuplicate,
  type DuplicateRule,
  type DuplicateScope,
  type ManualAction,
  type DuplicateContactType,
} from "@/lib/contactDuplicateDetection";

export type ContactSaveContactType = "lead" | "client" | "recruit";

/** Canonical contact type → the table `findDuplicates` searches. */
export const DUPLICATE_TABLE_BY_CONTACT_TYPE: Record<ContactSaveContactType, DuplicateContactType> = {
  lead: "leads",
  client: "clients",
  recruit: "recruits",
};

/**
 * A save that was REFUSED before anything was written — NOT a save that failed.
 *
 * ## Why a distinct error type was introduced
 *
 * `FullScreenContactView.handleSave` treats a RESOLVED `onUpdate` promise as proof that the write
 * happened: it exits edit mode, clears the dirty flags, persists a "<Type> details updated by
 * <agent>" activity row and toasts success. A refusal that merely `return`ed — which is what
 * `Contacts.tsx` did — is therefore indistinguishable from a successful save, and the user was told
 * their edit had been saved when the database was never touched. A refusal has to REJECT.
 *
 * But a refusal is not a failure either. The surface that refused has usually already told the user
 * why (an agency-block toast, or the duplicate-warning dialog they just cancelled), so a catching UI
 * that toasts every rejection would report it twice. `reported` carries that distinction:
 *
 * - `reported: true`  (default) — the refusing surface already showed the reason. The catching UI
 *                                 must stay silent, but must still treat the save as NOT DONE.
 * - `reported: false`          — nobody has told the user yet; the catching UI should surface
 *                                 `message`.
 *
 * In BOTH cases the catching UI must keep edit mode open, keep the typed values and the dirty
 * state, write no activity row and show no success toast.
 *
 * Add / create flows keep their boolean allow-refuse contract and never see this error — only the
 * UPDATE surfaces translate a refusal into a rejection.
 */
export class ContactSaveRefusedError extends Error {
  /** True when the refusing surface has already shown the user why. */
  readonly reported: boolean;

  constructor(message: string, options?: { reported?: boolean }) {
    super(message);
    this.name = "ContactSaveRefusedError";
    // Default true: every refusal path shipped today reports before it throws.
    this.reported = options?.reported !== false;
  }
}

/**
 * Identify a refusal.
 *
 * Matches by `instanceof` OR by `name`, so a bundle that ends up with two copies of this module
 * (or a refusal that crossed a serialization boundary) is still recognised rather than being
 * mis-reported to the user as an unexpected failure.
 */
export function isContactSaveRefusedError(e: unknown): e is ContactSaveRefusedError {
  if (e instanceof ContactSaveRefusedError) return true;
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { name?: unknown }).name === "ContactSaveRefusedError"
  );
}

/** The message shown when the user cancels the duplicate warning rather than saving anyway. */
export const DUPLICATE_SAVE_CANCELLED_MESSAGE = "Save cancelled — possible duplicate contact.";

/**
 * Should this payload be duplicate-checked?
 *
 * Duplicate detection only ever matches on phone or email, so a payload carrying neither cannot
 * produce a match and must not cost a query. This reproduces the gate `Contacts.tsx` has always
 * applied on the lead update path (`data.phone !== undefined || data.email !== undefined`) — note
 * it is an `undefined` check, not a changed-value check: `FullScreenContactView` submits the whole
 * form so both keys are present on a full-record edit, while the partial `{ status }` payload the
 * status dropdown sends is correctly skipped.
 */
export function payloadTouchesPhoneOrEmail(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const d = data as { phone?: unknown; email?: unknown };
  return d.phone !== undefined || d.email !== undefined;
}

/** The subset of `contact_management_settings` this policy reads. */
export interface ContactDuplicateSettings {
  duplicateDetectionRule?: string | null;
  duplicateDetectionScope?: string | null;
  manualAction?: string | null;
}

/**
 * What the agency's settings say to do about this save. The caller owns the UI.
 *
 * - `allow`   — proceed silently.
 * - `block`   — refuse; `message` is the reason to show the user.
 * - `confirm` — ask; `label` / `description` populate the surface's existing confirm dialog.
 */
export type DuplicatePreSaveDecision =
  | { kind: "allow" }
  | { kind: "block"; message: string }
  | { kind: "confirm"; label: string; description: string };

export interface EvaluateContactDuplicatePreSaveOpts {
  contactType: ContactSaveContactType;
  organizationId: string;
  /** `contact_management_settings` for the org; `null` / missing keys fall back to the defaults. */
  settings?: ContactDuplicateSettings | null;
  phone?: string | null;
  email?: string | null;
  /** Only consulted when the agency scope is `assigned_only`. */
  assignedAgentId?: string | null;
  /** The record being edited — so a contact can never detect ITSELF as its own duplicate. */
  excludeId?: string | null;
}

/**
 * Run the canonical duplicate lookup and return the agency-configured decision.
 *
 * Fail-open on a lookup error is DELIBERATE and is the posture `Contacts.tsx` has always had: a
 * duplicate check is an advisory agency preference, and a transient PostgREST/RLS failure must not
 * stop an agent from saving a legitimate edit. The error is logged, never swallowed silently.
 */
export async function evaluateContactDuplicatePreSave(
  opts: EvaluateContactDuplicatePreSaveOpts,
): Promise<DuplicatePreSaveDecision> {
  const rule: DuplicateRule = (opts.settings?.duplicateDetectionRule ?? "phone_or_email") as DuplicateRule;
  const scope: DuplicateScope = (opts.settings?.duplicateDetectionScope ?? "all_agents") as DuplicateScope;
  const manualAction: ManualAction = (opts.settings?.manualAction ?? "warn") as ManualAction;

  let matches: Awaited<ReturnType<typeof findDuplicates>> = [];
  try {
    matches = await findDuplicates({
      table: DUPLICATE_TABLE_BY_CONTACT_TYPE[opts.contactType],
      organizationId: opts.organizationId,
      rule,
      scope,
      phone: opts.phone ?? null,
      email: opts.email ?? null,
      assignedAgentId: opts.assignedAgentId ?? null,
      excludeId: opts.excludeId ?? null,
    });
  } catch (e) {
    console.error("Duplicate detection failed:", e);
    // Don't block save on a detection lookup failure.
    return { kind: "allow" };
  }

  if (matches.length === 0 || manualAction === "allow") return { kind: "allow" };

  if (manualAction === "block") {
    return {
      kind: "block",
      message: `Duplicate contact found: ${describeDuplicate(matches[0])}. Save blocked by agency settings.`,
    };
  }

  return {
    kind: "confirm",
    label: `${matches.length} possible duplicate${matches.length === 1 ? "" : "s"} found`,
    description: matches.slice(0, 5).map(describeDuplicate).join("\n"),
  };
}
