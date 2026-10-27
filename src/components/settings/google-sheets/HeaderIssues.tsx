import React from "react";
import { AlertTriangle } from "lucide-react";
import { letterOf, type HeaderState } from "@/lib/google-sheets/headerState";

/** Every header problem of the current sheet, stated plainly: nothing is dropped without saying so. */
const HeaderIssues: React.FC<{ state: HeaderState }> = ({ state }) => {
  const blank = state.columns.filter((c) => c.status === "blank_data");
  const dup = [...new Set(state.columns.filter((c) => c.status === "duplicate").map((c) => c.header.trim()))];
  const items: string[] = [];
  if (state.missing.length) {
    items.push(`No longer in the sheet: ${state.missing.map((m) => `"${m.header}"`).join(", ")}. Choose another column for these fields or set them to Don't import.`);
  }
  if (state.duplicatedMapped.length) items.push(`Mapped columns appear more than once: ${state.duplicatedMapped.join(", ")}. Rename one copy in Google Sheets.`);
  if (dup.length) items.push(`Repeated headers can't be imported: ${dup.join(", ")}. Give each column a unique header in Google Sheets.`);
  if (blank.length) items.push(`Columns without a header have data: ${blank.map((c) => c.letter).join(", ")}. Add a header in Google Sheets to import them.`);
  // The real width, and what is past A–GR: headers, data without a header, or columns too far out to check.
  const b = state.beyondLimit;
  let emptyPast = false;
  if (b && b.width > 200) {
    const past = [...b.columns.filter((c) => c.header).map((c) => c.header), ...b.columns.filter((c) => !c.header && c.has_data).map((c) => `data in ${c.letter}`)];
    const parts = [`This tab is ${b.width} columns wide. Only A–GR (the first 200) can be imported.`];
    if (past.length) parts.push(`Past GR: ${past.slice(0, 5).join(", ")}${past.length > 5 ? ` and ${past.length - 5} more` : ""}. Move what you need into the first 200 columns.`);
    if (b.unchecked) parts.push(`Columns past ${letterOf(b.checked_through - 1)} weren't checked.`);
    if (past.length || b.unchecked) items.push(parts.join(" ")); else emptyPast = true;
  }
  if (!items.length) {
    return emptyPast ? <p className="text-xs text-muted-foreground">This tab is {b?.width} columns wide; the columns past GR are empty.</p> : null;
  }
  return (
    <div className="space-y-1 rounded-lg border border-amber-500/40 p-3 text-xs" role="status">
      {items.map((t) => (
        <p key={t} className="flex gap-2 text-amber-600 dark:text-amber-400"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{t}</p>
      ))}
    </div>
  );
};

export default HeaderIssues;
