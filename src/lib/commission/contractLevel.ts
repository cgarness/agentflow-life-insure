/**
 * Strict normalization of the existing profiles.commission_level text (read-only; never written back).
 *
 * Accepted: a whole number with optional surrounding whitespace and ONE trailing "%" ("120%" -> 120,
 * " 100 " -> 100). Rejected: missing values, fractions ("87.5"), partial parses ("120abc", "120 %"),
 * signs and anything else. Nothing is ever defaulted, rounded, nearest-matched or raised to a minimum.
 */
export type ContractLevelResult =
  | { kind: "valid"; level: number }
  | { kind: "missing" }
  | { kind: "malformed" };

const LEVEL_TEXT = /^\s*(\d{1,9})%?\s*$/;

export function parseContractLevel(raw: string | null | undefined): ContractLevelResult {
  if (raw == null || raw.trim() === "") return { kind: "missing" };
  const match = LEVEL_TEXT.exec(raw);
  if (!match) return { kind: "malformed" };
  return { kind: "valid", level: Number(match[1]) };
}

export const LEVEL_NOT_ON_GRID_MESSAGE = "Your contract level isn't on your agency's comp grid. Ask your admin.";
export const LEVEL_MISSING_MESSAGE =
  "Your contract level hasn't been set up yet, so there's nothing to estimate. Ask your admin to add it to your profile.";
export const LEVEL_MALFORMED_MESSAGE =
  "Your contract level on file isn't a whole number, so there's nothing to estimate. Ask your admin to correct it.";
