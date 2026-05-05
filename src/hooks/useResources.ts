import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Script, AgencyResource, ProductType } from "@/types/resources";
import { toast } from "@/hooks/use-toast";

export function useResources() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  // Fetch active scripts
  const scriptsQuery = useQuery({
    queryKey: ["active_call_scripts", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<Script[]> => {
      const { data, error } = await supabase
        .from("call_scripts" as any)
        .select("*")
        .eq("organization_id", organizationId as string)
        .eq("active", true)
        .order("name", { ascending: true });

      if (error) throw error;
      return (data || []).map((d: any) => ({
        id: d.id,
        name: d.name,
        productType: (d.product_type as ProductType) || "Custom",
        active: d.active,
        content: d.content || "",
        updatedAt: new Date(d.updated_at),
      }));
    },
  });

  // Fetch agency resources
  const documentsQuery = useQuery({
    queryKey: ["agency_resources", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<AgencyResource[]> => {
      const { data, error } = await supabase
        .from("agency_resources" as any)
        .select("*")
        .eq("organization_id", organizationId as string)
        .order("created_at", { ascending: false });

      if (error) {
        // Handle case where table doesn't exist yet gracefully
        if (error.code === '42P01') return [];
        throw error;
      }
      return data ?? [];
    },
  });

  // Add agency document
  const addDocument = useMutation({
    mutationFn: async (doc: Partial<AgencyResource>) => {
      const { data, error } = await supabase
        .from("agency_resources" as any)
        .insert([{ ...doc, organization_id: organizationId }])
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agency_resources"] });
      toast({ title: "Resource added successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to add resource", description: error.message, variant: "destructive" });
    }
  });

  const deleteDocument = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("agency_resources" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agency_resources"] });
      toast({ title: "Resource deleted" });
    }
  });

  return {
    scripts: scriptsQuery.data ?? [],
    documents: documentsQuery.data ?? [],
    isLoading: scriptsQuery.isLoading || documentsQuery.isLoading,
    addDocument,
    deleteDocument,
  };
}
