import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { usePermissions } from "@/hooks/usePermissions";
import { supabase } from "@/integrations/supabase/client";
import { parseLabeledContacts } from "@/components/settings/carrierContactUtils";
import { carrierResourceLinksSchema, type CarrierDirectoryItem } from "@/lib/carrierResources";

export const CARRIER_DIRECTORY_QUERY_KEY = ["carrier-directory"] as const;

/** A private, fresh read session on every identity/access change or page mount. */
export function useCarrierDirectory() {
  const { user, profile, isImpersonating, isBuildingOrganization } = useAuth();
  const { organizationId } = useOrganization();
  const permissions = usePermissions();
  const instance = useId();
  const fullAccess = profile?.role === "Admin" || profile?.is_super_admin === true;
  const knownRole = fullAccess || profile?.role === "Agent" || profile?.role === "Team Leader";
  const identityReady = !!user?.id && profile?.id === user.id && !!organizationId && profile?.organization_id === organizationId;
  const permitted = identityReady && knownRole && !isImpersonating && !isBuildingOrganization
    && (fullAccess || (!permissions.isLoading && !permissions.error && permissions.hasPageAccess("Carriers") === true));
  const scope = permitted ? `${user.id}|${organizationId}|${profile.role}|${fullAccess}` : null;
  const [session, setSession] = useState({ scope, generation: 0 });
  let current = session;
  if (session.scope !== scope) {
    current = { scope, generation: session.generation + 1 };
    setSession(current);
  }
  const scopeKey = `${instance}|${scope ?? "unavailable"}|${current.generation}`;
  const query = useQuery({
    queryKey: [...CARRIER_DIRECTORY_QUERY_KEY, scopeKey],
    enabled: permitted,
    staleTime: 30_000,
    gcTime: 0,
    retry: false,
    queryFn: async (): Promise<CarrierDirectoryItem[]> => {
      const { data, error } = await supabase.from("carriers")
        .select("id,name,portal_url,logo_url,contact_phones,contact_emails,resource_links")
        .eq("organization_id", organizationId!)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((carrier) => ({
        ...carrier,
        contact_phones: parseLabeledContacts(carrier.contact_phones),
        contact_emails: parseLabeledContacts(carrier.contact_emails),
        resource_links: carrierResourceLinksSchema.parse(carrier.resource_links),
      }));
    },
  });
  const status = !permitted ? "unavailable" : query.isError ? "error" : query.isPending ? "loading" : "ready";
  return {
    status,
    carriers: status === "ready" ? query.data ?? [] : [],
    scopeKey,
    retry: () => { if (permitted) void query.refetch(); },
  };
}
