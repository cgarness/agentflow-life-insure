import React, { useCallback, useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { CircleDollarSign, Lock } from "lucide-react";
import { AmountsToggle, AmountsVisibilityProvider } from "@/components/commission/ui/AmountsVisibility";
import { IconTile, StatePanel } from "@/components/commission/ui/CommissionSurface";
import CalculatorTab from "@/components/commissions/CalculatorTab";
import { CommissionDrawer, type DrawerTarget, type OpenPolicy } from "@/components/commissions/CommissionDrawer";
import { CommissionScopeProvider } from "@/components/commissions/CommissionScopeProvider";
import { CommissionScopeBoundary } from "@/components/commissions/CommissionScopeBoundary";
import { useCommissionScope } from "@/components/commissions/commissionScopeContext";
import { CommissionsTabs } from "@/components/commissions/CommissionsTabs";
import { OverviewTab } from "@/components/commissions/overview/OverviewTab";
import { PaymentsTab } from "@/components/commissions/payments/PaymentsTab";
import { PoliciesTab } from "@/components/commissions/policies/PoliciesTab";
import { InfoTip } from "@/components/commissions/shared/Bits";
import { useCommissionsAccess } from "@/hooks/useCommissionsCenter";
import { COMMISSION_TABS, COMMISSIONS_PATH, type CommissionTab } from "@/lib/commission/centerFilters";

/** The actual session owns the page, Calculator and Hide amounts; only scoped reporting remounts. */
const CommissionsPage: React.FC = () => {
  const { tab: raw } = useParams<{ tab?: string }>();
  const access = useCommissionsAccess();
  const tab = (raw === undefined ? "overview" : COMMISSION_TABS.find((t) => t !== "overview" && t === raw.toLowerCase())) as CommissionTab | undefined;
  if (!tab) return <Navigate to={COMMISSIONS_PATH} replace />;

  let body: React.ReactNode;
  if (access.isImpersonating || (!access.permissionsLoading && !access.permitted)) {
    body = <StatePanel icon={Lock} title="Commissions aren't available" role="status"
      body={access.isImpersonating ? "Commissions aren't available while viewing as another user." : "Your role doesn't include viewing commissions."} />;
  } else if (!access.enabled) {
    body = <StatePanel icon={CircleDollarSign} title="Loading…" role="status" />;
  } else {
    body = <CommissionScopeProvider key={`${access.userId}:${access.orgId}`}><Center tab={tab} /></CommissionScopeProvider>;
  }
  const identity = access.enabled ? `${access.userId}:${access.orgId}` : "none";
  return (
    <AmountsVisibilityProvider key={identity} userId={access.enabled ? access.userId : null} organizationId={access.enabled ? access.orgId : null}>
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex items-center gap-3">
          <IconTile icon={CircleDollarSign} className="h-9 w-9 rounded-xl bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400" />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Commissions</h1>
          <InfoTip label="About these figures">
            AgentFlow estimates and payments you recorded. Not carrier-verified. Expected dates assume payment 1–3 business days after each
            premium date.
          </InfoTip>
          {access.enabled && <AmountsToggle />}
        </div>
        {body}
      </div>
    </AmountsVisibilityProvider>
  );
};

function Center({ tab }: { tab: CommissionTab }) {
  const scope = useCommissionScope();
  const [calculatorOpened, setCalculatorOpened] = useState(tab === "calculator");
  useEffect(() => { if (tab === "calculator") setCalculatorOpened(true); }, [tab]);
  return <>
    <CommissionsTabs active={tab} />
    {tab !== "calculator" && <CommissionScopeBoundary><FinancialContent tab={tab} /></CommissionScopeBoundary>}
    {tab === "calculator" && !scope.canViewOwn && <StatePanel icon={Lock} title="Commissions aren't available" role="status"
      body="Your role doesn't include the personal Calculator." />}
    {calculatorOpened && scope.canViewOwn && <div hidden={tab !== "calculator"}><CalculatorTab /></div>}
  </>;
}

function FinancialContent({ tab }: { tab: CommissionTab }) {
  const [target, setTarget] = useState<DrawerTarget | null>(null);
  const open = useCallback<OpenPolicy>((policyId, intent) => setTarget({ policyId, payment: intent?.payment, opened: Date.now() }), []);
  return <>
    {tab === "overview" && <OverviewTab onOpen={open} />}
    {tab === "payments" && <PaymentsTab onOpen={open} />}
    {tab === "policies" && <PoliciesTab onOpen={open} />}
    <CommissionDrawer target={target} onClose={() => setTarget(null)} />
  </>;
}

export default CommissionsPage;
