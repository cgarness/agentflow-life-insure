import React from "react";
import { useLocation } from "react-router-dom";
import { Calculator } from "lucide-react";
import { useCommissionCalculatorAccess } from "@/hooks/useCommissionCalculator";
import { MainNavItem } from "./NavItems";

export const COMMISSION_CALCULATOR_PATH = "/commission-calculator";
export const COMMISSION_CALCULATOR_LABEL = "Commission Calculator";

interface CommissionCalculatorNavItemProps {
  collapsed: boolean;
  /** Query-level gate from the sidebar (`!isImpersonating`): nothing is fetched when false. */
  enabled: boolean;
  onClick?: () => void;
}

/**
 * Main-navigation entry directly below Resources. Shown only when the role may "View Own Commission
 * Percentage" (D3) and the agency has an active, eligible calculator grid; never under "View As".
 */
const CommissionCalculatorNavItem: React.FC<CommissionCalculatorNavItemProps> = ({ collapsed, enabled, onClick }) => {
  const location = useLocation();
  const { visible } = useCommissionCalculatorAccess({ enabled });
  if (!visible) return null;
  return (
    <MainNavItem
      icon={Calculator}
      label={COMMISSION_CALCULATOR_LABEL}
      path={COMMISSION_CALCULATOR_PATH}
      collapsed={collapsed}
      isActive={location.pathname === COMMISSION_CALCULATOR_PATH}
      onClick={onClick}
    />
  );
};

export default CommissionCalculatorNavItem;
