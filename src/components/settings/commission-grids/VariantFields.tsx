import React, { useState } from "react";
import { StickyNote, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { DraftVariant } from "@/lib/commission/gridDraft";
import { cn } from "@/lib/utils";

interface VariantFieldsProps {
  variant: DraftVariant;
  disabled: boolean;
  messages: string[];
  onChange: (patch: Partial<Omit<DraftVariant, "ref" | "id" | "productRef">>) => void;
  onRemove: () => void;
}

/** An input whose short label stays visible inside it once a value is entered (placeholders vanish). */
const Prefixed: React.FC<React.ComponentProps<typeof Input> & { prefix: string }> = ({ prefix, className, ...props }) => (
  <div className={cn("relative", className)}>
    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{prefix}</span>
    <Input {...props} className="h-9 bg-background pl-12 tabular-nums" />
  </div>
);

/**
 * One variant: label, optional inclusive age bounds (blank = no limit), optional term lengths ("10, 20";
 * blank = not a term product) and the protected source/notes (agency admins only — agents never get them).
 */
const VariantFields: React.FC<VariantFieldsProps> = ({ variant, disabled, messages, onChange, onRemove }) => {
  const [showNotes, setShowNotes] = useState(variant.source !== "" || variant.notes !== "");
  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-2 ring-1 ring-inset ring-border/40">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(8rem,1fr)_7rem_7rem_minmax(9rem,1fr)_auto]">
        <Prefixed prefix="Label" aria-label="Variant label" placeholder="e.g. 0-70" value={variant.label} maxLength={120}
          disabled={disabled} className="col-span-2 sm:col-span-1" onChange={(e) => onChange({ label: e.target.value })} />
        <Prefixed prefix="Min" aria-label="Minimum age" placeholder="any" inputMode="numeric" value={variant.minAge}
          disabled={disabled} onChange={(e) => onChange({ minAge: e.target.value })} />
        <Prefixed prefix="Max" aria-label="Maximum age" placeholder="any" inputMode="numeric" value={variant.maxAge}
          disabled={disabled} onChange={(e) => onChange({ maxAge: e.target.value })} />
        <Prefixed prefix="Terms" aria-label="Term lengths" placeholder="e.g. 10, 20" value={variant.terms}
          disabled={disabled} className="col-span-2 sm:col-span-1" onChange={(e) => onChange({ terms: e.target.value })} />
        <div className="col-span-2 flex items-center justify-end gap-0.5 sm:col-span-1">
          <Button type="button" variant="ghost" size="icon" aria-label="Source and notes" aria-expanded={showNotes}
            className={cn("h-8 w-8 text-muted-foreground", (variant.source || variant.notes) && "text-primary")} onClick={() => setShowNotes((open) => !open)}>
            <StickyNote className="h-4 w-4" aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Delete variant" className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            disabled={disabled} onClick={onRemove}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
      {showNotes && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input aria-label="Source reference" placeholder="Source reference (admins only)" className="h-9 bg-background" value={variant.source}
            maxLength={2000} disabled={disabled} onChange={(e) => onChange({ source: e.target.value })} />
          <Textarea aria-label="Notes" placeholder="Notes (admins only)" rows={1} value={variant.notes} maxLength={4000}
            disabled={disabled} onChange={(e) => onChange({ notes: e.target.value })} className="min-h-[2.25rem] bg-background" />
        </div>
      )}
      {messages.map((message) => (
        <p key={message} className="text-xs text-destructive">{message}</p>
      ))}
    </div>
  );
};

export default VariantFields;
