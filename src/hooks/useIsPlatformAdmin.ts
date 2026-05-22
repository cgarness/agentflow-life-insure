import { useAuth } from "@/contexts/AuthContext";

/** True iff the *real* (non-impersonated) profile has platform_role = 'platform_admin'. */
export function useIsPlatformAdmin(): boolean {
  const { realProfile } = useAuth();
  return realProfile?.platform_role === "platform_admin";
}
