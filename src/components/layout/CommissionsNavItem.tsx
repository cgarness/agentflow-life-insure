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
 */
const CommissionsNavItem: React.FC<CommissionsNavItemProps> = ({ collapsed, onClick }) => {
  const location = useLocation();
  const { permitted, isImpersonating } = useCommissionsAccess();
  if (!permitted || isImpersonating) return null;
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
