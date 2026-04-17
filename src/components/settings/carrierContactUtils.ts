export type LabeledContact = { label: string; value: string };

export function parseLabeledContacts(raw: unknown): LabeledContact[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw.map((item) => {
    const o = item as Record<string, unknown>;
    return {
      label: typeof o?.label === "string" ? o.label : "",
      value: typeof o?.value === "string" ? o.value : "",
    };
  });
}

/** Keep rows that have at least one non-empty field (trimmed). */
export function compactLabeledContacts(rows: LabeledContact[]): LabeledContact[] {
  return rows.filter((r) => r.label.trim() || r.value.trim());
}

export function isValidEmailValue(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

export function validateEmailRows(rows: LabeledContact[]): Record<number, boolean> {
  const errors: Record<number, boolean> = {};
  rows.forEach((r, i) => {
    if (r.value.trim() && !isValidEmailValue(r.value)) errors[i] = true;
  });
  return errors;
}
