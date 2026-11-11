import type { ReactNode } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingBlock, StatePanel } from "@/components/commission/ui/CommissionSurface";
import { CommissionAgentSelector } from "./CommissionAgentSelector";
import { useCommissionScope } from "./commissionScopeContext";

/** Only this subtree remounts on scope/revision changes. Calculator and amount preference stay outside. */
export function CommissionScopeBoundary({ children }: { children: ReactNode }) {
  const scope = useCommissionScope();
  if (scope.invalid || scope.error) return <div className="space-y-3">
    <StatePanel icon={Users} title="Agent selection unavailable" role="alert"
      body={scope.invalid ? "This link has an invalid agent selection." : "Refresh your selection to check your current access."} />
    <div className="flex flex-wrap gap-2">
      {!scope.invalid && <Button size="sm" variant="outline" onClick={scope.retry}>Refresh selection</Button>}
      <Button size="sm" variant="outline" onClick={() => scope.apply({ mode: scope.canViewOwn ? "me" : "all", agentIds: [] })}>
        {scope.canViewOwn ? "Back to Me" : "View all agents"}
      </Button>
    </div>
  </div>;
  if (scope.loading) return <LoadingBlock label="Loading agents…" rows={3} />;
  if (!scope.ready) return <StatePanel icon={Users} title="No agents available" role="status" />;
  return <div className="space-y-4">
    <CommissionAgentSelector />
    <div key={scope.financialKey}>{children}</div>
  </div>;
}
