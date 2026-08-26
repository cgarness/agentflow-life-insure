import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { needsAppOnboardingWizard } from "@/lib/onboarding-wizard";

/**
 * Gate for every protected CRM route.
 *
 * `needsAppOnboardingWizard()` is the ONE onboarding gate: a user who still owes the
 * canonical `/onboarding` wizard is redirected there, and everyone else goes straight
 * into the CRM. There is deliberately no second, downstream profile-completeness
 * prompt — the retired profile-setup modal re-opened for users who had already
 * finished onboarding whenever an optional profile field (phone, resident state) was
 * blank, and again every three days after a skip. Those fields are edited in My
 * Profile; they are not an onboarding blocker. Do not reintroduce a wizard here.
 *
 * Extracted from `App.tsx` unchanged apart from that removal, so the gate can be
 * tested without mounting the whole route tree (`protectedRouteOnboarding.test.tsx`).
 */
export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading, isBuildingOrganization, user } = useAuth();
  const location = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const bypassAuth = import.meta.env.DEV && searchParams.get('bypass_auth') === 'true';

  if (bypassAuth) return <>{children}</>;
  if (isLoading || isBuildingOrganization) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user && needsAppOnboardingWizard(user)) {
    return <Navigate to="/onboarding" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
};
