import { useState } from "react";
import { Progress } from "@/components/ui/progress";
import { HIDDEN_AMOUNT, useAmounts } from "@/components/commission/ui/amountsContext";
import { useCommissionGoal, useCommissionGoalMutation } from "@/hooks/useCommissionsCenter";
import { CommissionCenterError } from "@/lib/commission/centerApi";
import { formatMonth } from "@/lib/commission/installments";
import { goalProgress } from "@/lib/commission/insights";
import { GoalEditor } from "./GoalEditor";

const link = "text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The optional goal under Received, for one whole calendar month only (`month` is null otherwise). Progress is that
 * month's Received (manual receipts by received date, from the same snapshot as the card) over the target: the bar
 * stops at 100 %, the figure does not. Editing needs amounts shown; nothing is created by viewing.
 */
export function GoalProgress({ month, receivedCents }: { month: string | null; receivedCents: number }) {
  const { hidden, money } = useAmounts();
  const query = useCommissionGoal(month);
  const mutation = useCommissionGoalMutation(month);
  const [editing, setEditing] = useState(false);
  if (!month) return null;
  const label = formatMonth(month);
  if (!query.data) {
    return query.isError
      ? <button type="button" className={link} onClick={() => void query.refetch()}>Goal unavailable · Try again</button> : null;
  }
  const target = query.data.target_cents;
  const run = (cents: number | null) => mutation.mutate(cents, { onSuccess: () => setEditing(false) });
  const error = mutation.isError
    ? (mutation.error instanceof CommissionCenterError && mutation.error.kind === "invalid" ? mutation.error.message : "Couldn't save the goal. Try again.")
    : null;
  const masked = <p className="text-xs text-muted-foreground">{label} goal {HIDDEN_AMOUNT}</p>;
  if (editing) {
    // Hiding amounts mid-edit keeps the draft (not rendered) until Show amounts.
    return (
      <>
        {hidden && masked}
        <div hidden={hidden}>
          <GoalEditor monthLabel={label} initialCents={target} saving={mutation.isPending} error={error}
            onSave={run} onClear={() => run(null)} onCancel={() => { mutation.reset(); setEditing(false); }} />
        </div>
      </>
    );
  }
  if (hidden) return target === null ? null : masked;
  if (target === null) {
    return <button type="button" className={link} onClick={() => { mutation.reset(); setEditing(true); }}>Set goal</button>;
  }
  const { percent, bar } = goalProgress(receivedCents, target);
  return (
    <div className="space-y-1">
      <Progress value={bar} aria-valuenow={bar} aria-valuetext={`${percent}%`} aria-label={`${label} goal progress`} className="h-1.5 bg-emerald-500/15 [&>div]:bg-emerald-500" />
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="tabular-nums text-muted-foreground"><span className="font-medium text-foreground">{percent}%</span> of {money(target)} goal</span>
        <button type="button" className={link} onClick={() => { mutation.reset(); setEditing(true); }}>Edit goal</button>
      </div>
    </div>
  );
}
