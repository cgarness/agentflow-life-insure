import React from "react";
import { useLocation } from "react-router-dom";
import { CircleDollarSign } from "lucide-react";
import { useCommissionsAccess } from "@/hooks/useCommissionsCenter";
import { MainNavItem } from "./NavItems";

export const COMMISSIONS_NAV_PATH = "/commissions";
export const COMMISSIONS_NAV_LABEL = "Commissions";

interface CommissionsNavItemProps {
  collapsed: boolean;
  onClick?: () => void;
}

/**
 * Main-navigation entry directly below Resources (where Commission Calculator was). Shown only when the role may "View
 * Own Commission Percentage" (D3) and never under "View As". Reporting needs no calculator grid, so no grid status is
 * requested for the navigation.
 *
 * While a role's access is still loading (Admin and Super Admin never wait), it holds an inert slot with a nav row's box
 * (`px-3 py-2.5` around an `h-5` line, as MainNavItem), so the entries below do not move when the link appears. The
 * slot has no link, label, icon or focus stop: access stays fail-closed and nothing is revealed before it resolves.
 */
const CommissionsNavItem: React.FC<CommissionsNavItemProps> = ({ collapsed, onClick }) => {
  const location = useLocation();
  const { permitted, permissionsLoading, isImpersonating } = useCommissionsAccess();
  if (isImpersonating) return null;
  if (!permitted) {
    return permissionsLoading ? <div aria-hidden="true" className="px-3 py-2.5"><div className="h-5" /></div> : null;
  }
  const path = location.pathname.toLowerCase();
  return (
    <MainNavItem
      icon={CircleDollarSign}
      label={COMMISSIONS_NAV_LABEL}
      path={COMMISSIONS_NAV_PATH}
      collapsed={collapsed}
      isActive={path === COMMISSIONS_NAV_PATH || path.startsWith(`${COMMISSIONS_NAV_PATH}/`)}
      onClick={onClick}
    />
  );
};

export default CommissionsNavItem;
