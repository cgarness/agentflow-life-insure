import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useCommissionCalculatorAccess, useCommissionCalculatorContext } from "@/hooks/useCommissionCalculator";
import CalculatorNotice, { type CalculatorNoticeKind } from "@/components/commission/calculator/CalculatorNotice";
import CalculatorWorkspace from "@/components/commission/calculator/CalculatorWorkspace";

/**
 * /commission-calculator. Guards direct entry itself (the navigation item is only a convenience): the
 * role must hold "View Own Commission Percentage" (D3) and the session must not be "View As" (the layout
 * refuses that route too, and no query is issued under it). The data comes from one server snapshot of
 * the agency's ACTIVE, eligible, selected grid; there is no fallback grid of any kind.
 */
const CommissionCalculatorPage: React.FC = () => {
  const { user, profile } = useAuth();
  // The page reads the full snapshot, so it skips the separate status query the navigation uses.
  const access = useCommissionCalculatorAccess({ enabled: false });
  const context = useCommissionCalculatorContext(access.permitted && !access.isImpersonating);

  let notice: CalculatorNoticeKind | null = null;
  if (access.isImpersonating) notice = "no_access";
  else if (access.permissionsLoading) notice = "loading";
  else if (!access.permitted) notice = "no_permission";
  else if (context.isError) notice = "error";
  else if (!context.data) notice = "loading";
  else if (context.data.status !== "ready") notice = context.data.status;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Commission Calculator</h1>
      <div className="rounded-xl border bg-card p-6">
        {notice || context.data?.status !== "ready" ? (
          <CalculatorNotice kind={notice ?? "loading"} onRetry={() => void context.refetch()} />
        ) : (
          <CalculatorWorkspace
            key={`${user?.id}:${profile?.organization_id}:${context.data.grid.id}`}
            context={context.data}
          />
        )}
      </div>
    </div>
  );
};

export default CommissionCalculatorPage;
