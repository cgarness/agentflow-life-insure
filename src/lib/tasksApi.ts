import { supabase } from "@/integrations/supabase/client";

export interface TaskPayload {
  organization_id: string;
  contact_id: string;
  contact_type: 'lead' | 'client' | 'recruit';
  assigned_to: string;
  title: string;
  task_type: string;
  due_date: string;
  notes?: string;
}

export const tasksApi = {
  getTasks: async (contactId: string, organizationId: string) => {
    const { data, error } = await (supabase as any)
      .from('tasks')
      .select(`
        *,
        assignee:profiles!tasks_assigned_to_fkey(first_name, last_name)
      `)
      .eq('contact_id', contactId)
      .eq('organization_id', organizationId)
      .order('due_date', { ascending: true });

    if (error) throw error;
    return data;
  },

  createTask: async (payload: TaskPayload) => {
    const { data, error } = await (supabase as any)
      .from('tasks')
      .insert({
        ...payload,
        created_by: (await supabase.auth.getUser()).data.user?.id
      })
      .select()
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  completeTask: async (taskId: string, organizationId: string) => {
    const { data, error } = await (supabase as any)
      .from('tasks')
      .update({ completed_at: new Date().toISOString() })
      .eq('id', taskId)
      .eq('organization_id', organizationId)
      .select()
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  deleteTask: async (taskId: string, organizationId: string) => {
    const { error } = await (supabase as any)
      .from('tasks')
      .delete()
      .eq('id', taskId)
      .eq('organization_id', organizationId);

    if (error) throw error;
    return true;
  }
};
