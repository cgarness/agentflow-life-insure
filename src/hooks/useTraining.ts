import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { TrainingResource, TrainingCategory, ResourceType } from "@/types/training";
import { toast } from "@/hooks/use-toast";

export function useTraining() {
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Fetch Categories
  const categoriesQuery = useQuery({
    queryKey: ["training_categories", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<TrainingCategory[]> => {
      const { data, error } = await supabase
        .from("training_categories" as any)
        .select("*")
        .eq("organization_id", organizationId as string)
        .order("name", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch Resources (joined with categories and user progress)
  const resourcesQuery = useQuery({
    queryKey: ["training_resources", organizationId, user?.id],
    enabled: !!organizationId && !!user?.id,
    queryFn: async (): Promise<TrainingResource[]> => {
      const { data: resources, error: resError } = await supabase
        .from("training_resources" as any)
        .select(`
          *,
          category:training_categories(name)
        `)
        .eq("organization_id", organizationId as string)
        .order("created_at", { ascending: false });

      if (resError) throw resError;

      const { data: progress, error: progError } = await supabase
        .from("training_progress" as any)
        .select("resource_id, completed")
        .eq("user_id", user?.id as string);

      if (progError) throw progError;

      const progressMap = new Map(progress?.map(p => [p.resource_id, p.completed]));

      return (resources ?? []).map((r: any) => ({
        ...r,
        category_name: r.category?.name,
        is_completed: progressMap.get(r.id) ?? false
      }));
    },
  });

  // Mutations
  const addResource = useMutation({
    mutationFn: async (resource: Partial<TrainingResource>) => {
      const { data, error } = await supabase
        .from("training_resources" as any)
        .insert([{ ...resource, organization_id: organizationId }])
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training_resources"] });
      toast({ title: "Resource added successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to add resource", description: error.message, variant: "destructive" });
    }
  });

  const deleteResource = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("training_resources" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training_resources"] });
      toast({ title: "Resource deleted" });
    }
  });

  const toggleComplete = useMutation({
    mutationFn: async ({ id, completed }: { id: string, completed: boolean }) => {
      const { error } = await supabase
        .from("training_progress" as any)
        .upsert({
          user_id: user?.id as string,
          resource_id: id,
          organization_id: organizationId as string,
          completed,
          completed_at: completed ? new Date().toISOString() : null
        }, { onConflict: "user_id, resource_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training_resources"] });
    }
  });

  const addCategory = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase
        .from("training_categories" as any)
        .insert([{ name, organization_id: organizationId }])
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training_categories"] });
      toast({ title: "Category added" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to add category", description: error.message, variant: "destructive" });
    }
  });

  const removeCategory = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase
        .from("training_categories" as any)
        .delete()
        .eq("name", name)
        .eq("organization_id", organizationId as string);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training_categories"] });
      queryClient.invalidateQueries({ queryKey: ["training_resources"] });
      toast({ title: "Category removed" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to remove category", description: error.message, variant: "destructive" });
    }
  });

  return {
    categories: categoriesQuery.data ?? [],
    resources: resourcesQuery.data ?? [],
    isLoading: categoriesQuery.isLoading || resourcesQuery.isLoading,
    addResource,
    deleteResource,
    toggleComplete,
    addCategory,
    removeCategory
  };
}
