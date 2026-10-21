import { createContext, useCallback, useContext } from "react";
import { formatCents } from "@/lib/commission/installments";

/**
 * "Hide amounts" state shared by the Commissions Center (provider: AmountsVisibility.tsx). Outside the provider (e.g.
 * the contact view) amounts are always shown, so the reused commission components behave as before.
 */
export const HIDDEN_AMOUNT = "••••";

export interface AmountsState { hidden: boolean; setHidden: (hidden: boolean) => void }
export const AmountsContext = createContext<AmountsState>({ hidden: false, setHidden: () => {} });

/** `money(cents)` is the formatted amount, or the one placeholder while amounts are hidden. */
export function useAmounts() {
  const { hidden, setHidden } = useContext(AmountsContext);
  const money = useCallback((cents: number) => (hidden ? HIDDEN_AMOUNT : formatCents(cents)), [hidden]);
  return { hidden, setHidden, money };
}
