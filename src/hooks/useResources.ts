import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Script, AgencyResource, AgencyResourceCategory, ProductType } from "@/types/resources";
import { toast } from "@/hooks/use-toast";

export function useResources() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  // Fetch categories
  const categoriesQuery = useQuery({
    queryKey: ["agency_resource_categories", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<AgencyResourceCategory[]> => {
      const { data, error } = await supabase
        .from("agency_resource_categories" as any)
        .select("*")
        .eq("organization_id", organizationId as string)
        .order("name", { ascending: true });

      if (error) {
        if (error.code === '42P01') return [];
        throw error;
      }
      return data ?? [];
    },
  });

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
    mutationFn: async ({ doc, file }: { doc: Partial<AgencyResource>, file?: File }) => {
      let content_url = doc.content_url;

      if (file) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const filePath = `${organizationId}/${fileName}`;

        const { error: uploadError, data } = await supabase.storage
          .from('agency_materials')
          .upload(filePath, file);

        if (uploadError) {
          throw uploadError;
        }

        const { data: { publicUrl } } = supabase.storage
          .from('agency_materials')
          .getPublicUrl(filePath);

        content_url = publicUrl;
      }

      const { data, error } = await supabase
        .from("agency_resources" as any)
        .insert([{ ...doc, content_url, organization_id: organizationId }])
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

  // Add Category
  const addCategory = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase
        .from("agency_resource_categories" as any)
        .insert([{ name, organization_id: organizationId }])
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agency_resource_categories"] });
      toast({ title: "Category added" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to add category", description: error.message, variant: "destructive" });
    }
  });

  // Remove Category
  const removeCategory = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase
        .from("agency_resource_categories" as any)
        .delete()
        .eq("name", name)
        .eq("organization_id", organizationId as string);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agency_resource_categories"] });
      queryClient.invalidateQueries({ queryKey: ["agency_resources"] });
      toast({ title: "Category removed" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to remove category", description: error.message, variant: "destructive" });
    }
  });

  return {
    scripts: scriptsQuery.data ?? [],
    documents: documentsQuery.data ?? [],
    categories: categoriesQuery.data ?? [],
    isLoading: scriptsQuery.isLoading || documentsQuery.isLoading || categoriesQuery.isLoading,
    addDocument,
    deleteDocument,
    addCategory,
    removeCategory,
  };
}
