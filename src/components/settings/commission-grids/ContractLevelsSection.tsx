import React, { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ratesAtLevel, type GridDraft } from "@/lib/commission/gridDraft";
import type { PendingConfirmation } from "./ConfirmActionDialog";

interface ContractLevelsSectionProps {
  draft: GridDraft;
  disabled: boolean;
  onAdd: (level: number) => void;
  onRemove: (level: number) => void;
  confirm: (confirmation: PendingConfirmation) => void;
}

/**
 * Distinct whole-number levels 1-999, always shown highest first. Removing a level that has rates asks
 * first and removes those rates with it (nothing is remapped to another level).
 */
const ContractLevelsSection: React.FC<ContractLevelsSectionProps> = ({ draft, disabled, onAdd, onRemove, confirm }) => {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const level = Number(text);
    if (!/^\d{1,3}$/.test(text) || level < 1) return setError("Enter a whole number from 1 to 999.");
    if (draft.levels.includes(level)) return setError(`Level ${level} is already on this grid.`);
    if (draft.levels.length >= 60) return setError("A grid can have at most 60 levels.");
    onAdd(level);
    setText("");
    setError(null);
  };

  const remove = (level: number) => {
    const count = ratesAtLevel(draft, level);
    if (count === 0) return onRemove(level);
    confirm({
      title: `Remove level ${level}?`,
      description: `${count} rate${count === 1 ? "" : "s"} at this level will be deleted when you save. Rates are never moved to another level.`,
      confirmLabel: "Remove level",
      destructive: true,
      onConfirm: () => onRemove(level),
    });
  };

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">Contract levels</h3>
      <div className="flex flex-wrap gap-1.5">
        {draft.levels.map((level) => (
          <span key={level} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs tabular-nums">
            {level}
            <button
              type="button"
              aria-label={`Remove level ${level}`}
              disabled={disabled}
              onClick={() => remove(level)}
              className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        ))}
      </div>
      <div className="flex max-w-xs items-start gap-2">
        <div className="flex-1">
          <Input
            aria-label="New contract level"
            inputMode="numeric"
            placeholder="Add a level, e.g. 150"
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          />
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>
        <Button type="button" variant="outline" size="sm" className="h-10" disabled={disabled || text === ""} onClick={add}>
          <Plus className="mr-1 h-4 w-4" aria-hidden /> Add
        </Button>
      </div>
    </section>
  );
};

export default ContractLevelsSection;
