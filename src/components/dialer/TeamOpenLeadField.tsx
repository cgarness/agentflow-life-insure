import React from "react";
import { DateInput } from "@/components/shared/DateInput";
import { STATE_ABBR_TO_NAME } from "@/utils/stateUtils";
import type { ResolvedLeadField } from "@/lib/dialerLeadFields";

const STATE_CODES = Object.keys(STATE_ABBR_TO_NAME).sort();

const inputCls =
  "w-full bg-accent/50 border border-border rounded px-1.5 py-0.5 text-xs text-foreground mt-0.5 focus:ring-1 focus:ring-primary outline-none";

interface Props {
  field: ResolvedLeadField;
  isEditing: boolean;
  value: string;
  error?: string;
  disabled?: boolean;
  onChange: (id: string, value: string) => void;
}

/** One Team / Open Pool lead field: formatted read-only value, or a type-appropriate editor. */
export default function TeamOpenLeadField({ field, isEditing, value, error, disabled, onChange }: Props) {
  const wide = field.input === "textarea" || field.standardId === "notes";
  const inputId = `team-open-field-${field.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const set = (v: string) => onChange(field.id, v);

  const editor = () => {
    switch (field.input) {
      case "date":
        return (
          <div className="flex items-center gap-1">
            <DateInput value={value} onChange={set} className="mt-0.5 flex-1 [&_input]:h-7 [&_input]:text-xs" />
            {value && !disabled && (
              <button
                type="button"
                onClick={() => set("")}
                className="mt-0.5 text-[10px] text-muted-foreground hover:text-destructive shrink-0"
                aria-label={`Clear ${field.label}`}
              >
                Clear
              </button>
            )}
          </div>
        );
      case "textarea":
        return (
          <textarea id={inputId} rows={2} value={value} disabled={disabled} onChange={(e) => set(e.target.value)} className={`${inputCls} min-h-[48px]`} />
        );
      case "state": {
        const opts = value && !STATE_CODES.includes(value) ? [value, ...STATE_CODES] : STATE_CODES;
        return (
          <select id={inputId} value={value} disabled={disabled} onChange={(e) => set(e.target.value)} className={inputCls}>
            <option value="">—</option>
            {opts.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        );
      }
      case "select": {
        const base = field.options ?? [];
        const opts = value && !base.includes(value) ? [value, ...base] : base;
        return (
          <select id={inputId} value={value} disabled={disabled} onChange={(e) => set(e.target.value)} className={inputCls}>
            <option value="">—</option>
            {opts.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      }
      default:
        return (
          <input
            id={inputId}
            type={field.input === "email" ? "email" : "text"}
            inputMode={field.input === "number" ? "decimal" : field.input === "phone" ? "tel" : undefined}
            value={value}
            disabled={disabled}
            onChange={(e) => set(e.target.value)}
            className={inputCls}
          />
        );
    }
  };

  return (
    <div className={`min-w-0 ${wide ? "col-span-2" : ""}`} data-field-id={field.id}>
      <label htmlFor={inputId} className="block text-[10px] text-muted-foreground uppercase tracking-wide truncate">
        {field.label}
      </label>
      {isEditing && field.editable ? (
        <>
          {editor()}
          {error && <p className="text-[10px] text-destructive mt-0.5">{error}</p>}
        </>
      ) : (
        <div
          className={`text-xs font-semibold mt-0.5 break-words leading-tight ${wide ? "whitespace-pre-wrap" : "line-clamp-2"} ${isEditing ? "text-muted-foreground" : "text-foreground"}`}
          title={field.display ?? undefined}
        >
          {field.display ?? "—"}
        </div>
      )}
    </div>
  );
}
