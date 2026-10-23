import { z } from "zod";

/**
 * Carrier choices for the Record Policy and Add/Edit Client modals come only from the agency's Settings → Carriers
 * list. The one exception is the exact carrier already stored on the client being edited (`preserved`): it stays,
 * byte for byte, until the user picks a replacement. Nothing here normalizes or rewrites a stored value.
 */

const folded = (name: string) => name.trim().toLowerCase();

/** Trim, drop blanks, de-duplicate case-insensitively and sort alphabetically (case-insensitive). */
export function normalizeCarrierNames(names: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = String(raw ?? "").trim();
    if (!name || seen.has(folded(name))) continue;
    seen.add(folded(name));
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export interface PreservedCarrier {
  /** The exact stored value. */
  value: string;
  /** True when no configured carrier matches it (trimmed, case-insensitive). */
  notInSettings: boolean;
}

/**
 * The stored carrier to keep offering, or null when it is blank or exactly one of the configured names.
 * `configured` is null while the list is unavailable: the value is still kept, but not flagged as missing.
 */
export function preservedCarrierOption(configured: readonly string[] | null, preserved: string | null | undefined): PreservedCarrier | null {
  if (!preserved || !preserved.trim()) return null;
  if (configured?.includes(preserved)) return null;
  const notInSettings = configured !== null && !configured.some((name) => folded(name) === folded(preserved));
  return { value: preserved, notInSettings };
}

export const CARRIER_NOT_CONFIGURED = "Choose a carrier from Settings → Carriers";
export const CARRIER_LIST_UNAVAILABLE = "Carriers haven't loaded yet. Retry loading carriers, or keep the saved carrier.";

/**
 * Zod check for a carrier value. Blank passes here (callers' own schemas decide when a carrier is required).
 * The exact preserved value always passes; any other value must be one of the successfully loaded `configured`
 * names for the current agency (`null` = not loaded).
 */
export function carrierSelectionSchema(configured: readonly string[] | null, preserved?: string | null) {
  return z.string().superRefine((value, ctx) => {
    if (!value.trim() || (preserved && value === preserved)) return;
    if (configured === null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: CARRIER_LIST_UNAVAILABLE });
    else if (!configured.includes(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: CARRIER_NOT_CONFIGURED });
  });
}

/** The first `carrierSelectionSchema` issue for `value`, or null when it may be saved. */
export function carrierSelectionError(configured: readonly string[] | null, value: string | null | undefined, preserved?: string | null): string | null {
  const result = carrierSelectionSchema(configured, preserved).safeParse(value ?? "");
  return result.success ? null : result.error.issues[0].message;
}
