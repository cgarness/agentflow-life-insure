import { NavLink } from "react-router-dom";
import { useLocation } from "react-router-dom";
import { useCommissionScope } from "./commissionScopeContext";
import { cn } from "@/lib/utils";
import { COMMISSION_TABS, TAB_LABELS, tabPath, type CommissionTab } from "@/lib/commission/centerFilters";

/** Four compact tabs; each is its own address, so back and forward move between them. */
export function CommissionsTabs({ active }: { active: CommissionTab }) {
  const scope = useCommissionScope();
  const { search } = useLocation();
  // Preserve agent params even while the discovery request is still pending.
  const agentParams = new URLSearchParams();
  const current = new URLSearchParams(search);
  for (const name of ["agents", "agent_ids"]) for (const value of current.getAll(name)) agentParams.append(name, value);
  const target = (tab: CommissionTab) => scope.scope ? scope.withScopeHref(tabPath(tab))
    : `${tabPath(tab)}${agentParams.size ? `?${agentParams}` : ""}`;
  return (
    <nav aria-label="Commissions" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border px-1">
        {COMMISSION_TABS.filter((tab) => tab !== "calculator" || scope.canViewOwn).map((tab) => (
          <li key={tab}>
            <NavLink to={target(tab)} end aria-current={tab === active ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tab === active ? "border-emerald-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}>
              {TAB_LABELS[tab]}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
