import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useCommissionCalculatorAccess, useCommissionCalculatorContext } from "@/hooks/useCommissionCalculator";
import CalculatorNotice, { type CalculatorNoticeKind } from "@/components/commission/calculator/CalculatorNotice";
import CalculatorWorkspace from "@/components/commission/calculator/CalculatorWorkspace";

/**
 * Commissions › Calculator: the hypothetical estimate tool, unchanged. Guards itself (the page and navigation are only
 * conveniences): the role must hold "View Own Commission Percentage" (D3) and the session must not be "View As" (the
 * layout refuses that route too, and no query is issued under it). The data comes from one server snapshot of the
 * agency's ACTIVE, eligible, selected grid; there is no fallback grid of any kind. Only this tab needs a grid: it is
 * mounted the first time the tab opens, and the reporting tabs never wait for it. Nothing here writes or changes
 * saved commissions or reporting totals.
 */
const CalculatorTab: React.FC = () => {
  const { user, profile } = useAuth();
  // The tab reads the full snapshot, so it skips the separate status query.
  const access = useCommissionCalculatorAccess({ enabled: false });
  const context = useCommissionCalculatorContext(access.permitted && !access.isImpersonating);

  let notice: CalculatorNoticeKind | null = null;
  if (access.isImpersonating) notice = "no_access";
  else if (access.permissionsLoading) notice = "loading";
  else if (!access.permitted) notice = "no_permission";
  else if (context.isError) notice = "error";
  else if (!context.data) notice = "loading";
  else if (context.data.status !== "ready") notice = context.data.status;

  return notice || context.data?.status !== "ready" ? (
    <CalculatorNotice kind={notice ?? "loading"} onRetry={() => void context.refetch()} />
  ) : (
    <CalculatorWorkspace key={`${user?.id}:${profile?.organization_id}:${context.data.grid.id}`} context={context.data} />
  );
};

export default CalculatorTab;
