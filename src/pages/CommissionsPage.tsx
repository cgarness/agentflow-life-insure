import React, { useCallback, useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { CircleDollarSign, Lock } from "lucide-react";
import { AmountsToggle, AmountsVisibilityProvider } from "@/components/commission/ui/AmountsVisibility";
import { IconTile, StatePanel } from "@/components/commission/ui/CommissionSurface";
import CalculatorTab from "@/components/commissions/CalculatorTab";
import { CommissionDrawer, type DrawerTarget, type OpenPolicy } from "@/components/commissions/CommissionDrawer";
import { CommissionsTabs } from "@/components/commissions/CommissionsTabs";
import { OverviewTab } from "@/components/commissions/overview/OverviewTab";
import { PaymentsTab } from "@/components/commissions/payments/PaymentsTab";
import { PoliciesTab } from "@/components/commissions/policies/PoliciesTab";
import { InfoTip } from "@/components/commissions/shared/Bits";
import { useCommissionsAccess } from "@/hooks/useCommissionsCenter";
import { COMMISSION_TABS, COMMISSIONS_PATH, type CommissionTab } from "@/lib/commission/centerFilters";

/**
 * /commissions/:tab? — My commissions (Overview, Payments, Policies) and the Calculator. Guards direct entry itself:
 * "View Own Commission Percentage" (D3) and never under "View As" (the layout refuses the route too). One route, one
 * page instance, so switching tabs never remounts it; everything is keyed by the signed-in user and organization so no
 * figure, drawer, calculator input or Hide amounts choice survives an identity change. The eye control hides amounts on
 * every tab, the drawer and dialogs (a display preference for screen sharing, kept in this browser per user and agency).
 */
const CommissionsPage: React.FC = () => {
  const { tab: raw } = useParams<{ tab?: string }>();
  const access = useCommissionsAccess();
  const tab = (raw === undefined ? "overview" : COMMISSION_TABS.find((t) => t !== "overview" && t === raw.toLowerCase())) as CommissionTab | undefined;
  if (!tab) return <Navigate to={COMMISSIONS_PATH} replace />;

  let body: React.ReactNode;
  if (access.isImpersonating || (!access.permissionsLoading && !access.permitted)) {
    body = <StatePanel icon={Lock} title="Commissions aren't available" role="status"
      body={access.isImpersonating ? "Commissions aren't available while viewing as another user." : "Your role doesn't include viewing your own commission."} />;
  } else if (!access.enabled) {
    body = <StatePanel icon={CircleDollarSign} title="Loading…" role="status" />;
  } else {
    body = <Center key={`${access.userId}:${access.orgId}`} tab={tab} />;
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
        <CommissionsTabs active={tab} />
        {body}
      </div>
    </AmountsVisibilityProvider>
  );
};

function Center({ tab }: { tab: CommissionTab }) {
  const [target, setTarget] = useState<DrawerTarget | null>(null);
  // The calculator stays mounted (hidden) once opened, so its inputs survive tab switches within this session.
  const [calculatorOpened, setCalculatorOpened] = useState(tab === "calculator");
  useEffect(() => { if (tab === "calculator") setCalculatorOpened(true); }, [tab]);
  const open = useCallback<OpenPolicy>((policyId, intent) => setTarget({ policyId, payment: intent?.payment, opened: Date.now() }), []);
  return (
    <>
      {tab === "overview" && <OverviewTab onOpen={open} />}
      {tab === "payments" && <PaymentsTab onOpen={open} />}
      {tab === "policies" && <PoliciesTab onOpen={open} />}
      {calculatorOpened && <div hidden={tab !== "calculator"}><CalculatorTab /></div>}
      <CommissionDrawer target={target} onClose={() => setTarget(null)} />
    </>
  );
}

export default CommissionsPage;
