import React from "react";
import { Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { usePermissions } from "@/hooks/usePermissions";
import { resolveSettingsPermissionSlug } from "@/config/settingsConfig";

interface SettingsSectionGateProps {
  sectionSlug: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

const SettingsSectionGate: React.FC<SettingsSectionGateProps> = ({
  sectionSlug,
  fallback,
  children,
}) => {
  const { hasSettingsSectionAccess, isLoading } = usePermissions();
  const navigate = useNavigate();
  const permSlug = resolveSettingsPermissionSlug(sectionSlug);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!hasSettingsSectionAccess(permSlug)) {
    if (fallback) return <>{fallback}</>;
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="text-center space-y-3">
          <Lock className="w-10 h-10 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            You don&apos;t have permission to view this settings section. Contact your admin if you think this is a mistake.
          </p>
          <button
            type="button"
            onClick={() => navigate("/settings?section=my-profile", { replace: true })}
            className="px-4 py-2 rounded-lg text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 transition-colors"
          >
            Go to My Profile
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default SettingsSectionGate;
