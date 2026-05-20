/** Stable slug for overlay item_key segments. */
export function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function itemKey(section: string, label: string): string {
  return `${section}:${toSlug(label)}`;
}
