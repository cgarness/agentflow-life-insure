import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useIsPlatformAdmin } from "@/hooks/useIsPlatformAdmin";

/**
 * Guards Control Center routes. Only profiles with platform_role='platform_admin'
 * may render children; everyone else is sent back to the agency CRM.
 */
const PlatformAdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading, isBuildingOrganization } = useAuth();
  const isPlatformAdmin = useIsPlatformAdmin();

  if (isLoading || isBuildingOrganization) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-200" />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isPlatformAdmin) return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
};

export default PlatformAdminRoute;
