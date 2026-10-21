import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { goalFormSchema } from "@/lib/commission/insights";

/**
 * Set or edit one month's goal in dollars (validated to whole cents, $0.01–$1,000,000.00, as on the server). Clearing
 * is its own explicit button. A failure leaves the typed amount in place.
 */
export function GoalEditor({ monthLabel, initialCents, saving, error, onSave, onClear, onCancel }: {
  monthLabel: string;
  initialCents: number | null;
  saving: boolean;
  error: string | null;
  onSave: (cents: number) => void;
  onClear: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [amount, setAmount] = useState(initialCents === null ? "" : (initialCents / 100).toFixed(2));
  const [invalid, setInvalid] = useState<string | null>(null);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = goalFormSchema.safeParse({ amount });
    if (!parsed.success) { setInvalid(parsed.error.issues[0]?.message ?? "Enter a goal."); return; }
    setInvalid(null);
    onSave(parsed.data.amount);
  };
  const message = invalid ?? error;
  return (
    <form onSubmit={submit} className="space-y-2" aria-label={`${monthLabel} goal`}>
      <label htmlFor={`${id}-goal`} className="block text-xs font-medium text-muted-foreground">{monthLabel} goal (received)</label>
      <div className="flex flex-wrap items-center gap-2">
        <input id={`${id}-goal`} inputMode="decimal" autoComplete="off" value={amount} placeholder="0.00" disabled={saving}
          aria-invalid={!!invalid} aria-describedby={message ? `${id}-error` : undefined}
          onChange={(event) => setAmount(event.target.value)}
          className="h-8 w-32 rounded-md border border-input bg-background px-2.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" />
        <Button type="submit" size="sm" className="h-8" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        <Button type="button" size="sm" variant="ghost" className="h-8" disabled={saving} onClick={onCancel}>Cancel</Button>
        {initialCents !== null && (
          <Button type="button" size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive" disabled={saving} onClick={onClear}>
            Clear goal
          </Button>
        )}
      </div>
      {message && <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{message}</p>}
    </form>
  );
}
