import { useAuth } from "@/contexts/AuthContext";

export const useOrganization = () => {
  const { profile } = useAuth();
  return {
    organizationId: (profile as any)?.organization_id as string | null ?? null, // eslint-disable-line @typescript-eslint/no-explicit-any
    teamId: (profile as any)?.team_id as string | null ?? null, // eslint-disable-line @typescript-eslint/no-explicit-any
  };
};
