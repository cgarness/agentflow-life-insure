import React from "react";
import { usePermissions } from "@/hooks/usePermissions";

interface PermissionGateProps {
  feature: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export const PermissionGate: React.FC<PermissionGateProps> = ({
  feature,
  fallback = null,
  children,
}) => {
  const { hasFeatureAccess, isLoading } = usePermissions();

  if (isLoading) return null;
  if (!hasFeatureAccess(feature)) return <>{fallback}</>;
  return <>{children}</>;
};

interface CommissionGateProps {
  metric: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export const CommissionGate: React.FC<CommissionGateProps> = ({
  metric,
  fallback = null,
  children,
}) => {
  const { canSeeCommission, isLoading } = usePermissions();

  if (isLoading) return null;
  if (!canSeeCommission(metric)) return <>{fallback}</>;
  return <>{children}</>;
};
