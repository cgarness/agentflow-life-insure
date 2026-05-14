// Minimal merge-field renderer for workflow templates.
// Replaces {{field_name}} (or {{ field.path }}) with the matching contact
// column value. Unknown fields are replaced with an empty string. Whitespace
// inside braces is tolerated.

export function renderMergeFields(
  template: string,
  contact: Record<string, unknown> | null | undefined,
): string {
  if (!template) return "";
  const c = contact ?? {};
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, expr: string) => {
    const path = expr.split(".");
    let cur: unknown = c;
    for (const seg of path) {
      if (cur && typeof cur === "object" && seg in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[seg];
      } else {
        return "";
      }
    }
    if (cur === null || cur === undefined) return "";
    return String(cur);
  });
}
