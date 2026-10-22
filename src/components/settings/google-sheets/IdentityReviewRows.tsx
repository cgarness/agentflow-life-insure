import React from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import type { IdentityDecision, IdentityHint, IdentityReviewRow } from "@/lib/google-sheets/schema";

const HINTS: Record<NonNullable<IdentityHint>, string> = {
  same_row: "Same spot and details as a row that was left out",
  content: "Same name, phone and email as a row that was left out",
  position: "In the spot where a left-out row used to be",
};
const REASONS: Record<string, string> = {
  missing_id: "No Lead ID", duplicate_id: "Lead ID used by rows with different values", missing_phone: "Missing phone",
  missing_name: "Missing first or last name", invalid_dob: "Date of birth not recognized",
};

interface Props { rows: IdentityReviewRow[]; choices: Record<string, IdentityDecision>; onChange: (key: string, d: IdentityDecision) => void }

/** One explicit choice per row; hints explain why a row is listed but never decide for the agent. */
const IdentityReviewRows: React.FC<Props> = ({ rows, choices, onChange }) => (
  <ul className="max-h-72 overflow-auto rounded-lg border divide-y">
    {rows.map((r) => {
      const name = [r.first_name, r.last_name].filter(Boolean).join(" ") || "—";
      const blank = r.lead_id === null;
      const id = `gs-id-${r.key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
      return (
        <li key={r.key} className="p-2 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-medium text-foreground">Row {r.row}</span>
            <span className="text-muted-foreground">{blank ? "No Lead ID" : `Lead ID ${r.lead_id}`}{r.rows > 1 ? ` · ${r.rows} rows` : ""}</span>
            <span className="truncate max-w-[12rem]">{name}</span>
            {r.phone && <span className="text-muted-foreground">{r.phone}</span>}
          </div>
          <p className="text-xs text-muted-foreground">
            {r.hint ? HINTS[r.hint] : "Could be a left-out row that was edited"}
            {!blank && r.reason ? ` · ${REASONS[r.reason] ?? "Needs fixes"}` : ""}
          </p>
          <RadioGroup value={choices[r.key] ?? ""} onValueChange={(v) => onChange(r.key, v as IdentityDecision)}
            className="flex flex-wrap gap-4" aria-label={`Row ${r.row}`}>
            {(blank ? [["exclude", "Keep out"], ["import", "New row (imports once it has a Lead ID)"]]
                    : [["import", "Import"], ["exclude", "Keep out"]]).map(([v, label]) => (
              <div key={v} className="flex items-center gap-2">
                <RadioGroupItem value={v} id={`${id}-${v}`} /><Label htmlFor={`${id}-${v}`} className="text-xs">{label}</Label>
              </div>
            ))}
          </RadioGroup>
        </li>
      );
    })}
  </ul>
);

export default IdentityReviewRows;
