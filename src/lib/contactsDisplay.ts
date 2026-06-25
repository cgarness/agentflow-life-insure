/**
 * Contacts display helpers — Contacts Build 6 (extracted from Contacts.tsx).
 *
 * Pure, presentation-only string helpers for the Contacts surface. No data
 * access, no React. Kept tiny and dependency-free so it can be unit-tested
 * directly and reused across the table/Kanban renderers.
 */

/**
 * Normalize a status label for display. Tolerates the legacy misspelled
 * recruit stage values ("APPPINTMENT SET" / "AP PINTMENT") that exist in some
 * orgs' pipeline config, rendering them as "Appointment …". Blank → "".
 */
export const normalizeStatusDisplay = (status: string): string => {
  if (!status) return "";
  return status.replace(/AP+PINTMENT/i, "Appointment");
};
