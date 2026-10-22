import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { COMMISSION_TABS, TAB_LABELS, tabPath, type CommissionTab } from "@/lib/commission/centerFilters";

/** Four compact tabs; each is its own address, so back and forward move between them. */
export function CommissionsTabs({ active }: { active: CommissionTab }) {
  return (
    <nav aria-label="Commissions" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border px-1">
        {COMMISSION_TABS.map((tab) => (
          <li key={tab}>
            <NavLink to={tabPath(tab)} end aria-current={tab === active ? "page" : undefined}
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
