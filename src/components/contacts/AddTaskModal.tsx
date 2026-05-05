import React from 'react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuth } from '@/contexts/AuthContext';
import { tasksApi } from '@/lib/tasksApi';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { usersSupabaseApi } from '@/lib/supabase-users';

const taskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  task_type: z.enum(['Send Quote', 'Follow Up', 'Check Application', 'Policy Review', 'General'], {
    required_error: 'Task type is required'
  }),
  due_date: z.string().refine((val) => {
    const date = new Date(val);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date >= today;
  }, 'Due date must be today or in the future'),
  assigned_to: z.string().min(1, 'Assignee is required'),
  notes: z.string().optional()
});

interface AddTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactType: 'lead' | 'client' | 'recruit';
}

export function AddTaskModal({ open, onOpenChange, contactId, contactType }: AddTaskModalProps) {
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: agents } = useQuery({
    queryKey: ['org-agents', organizationId],
    queryFn: () => usersSupabaseApi.getAll({ organizationId: organizationId! }),
    enabled: !!organizationId
  });

  const form = useForm<z.infer<typeof taskSchema>>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: '',
      task_type: 'Follow Up',
      due_date: new Date().toISOString().split('T')[0],
      assigned_to: user?.id || '',
      notes: ''
    }
  });

  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof taskSchema>) => {
      return tasksApi.createTask({
        ...values,
        organization_id: organizationId!,
        contact_id: contactId,
        contact_type: contactType
      });
    },
    onSuccess: () => {
      toast({ title: 'Task created successfully' });
      queryClient.invalidateQueries({ queryKey: ['tasks', contactId] });
      form.reset();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: 'Error creating task', description: err.message, variant: 'destructive' });
    }
  });

  const onSubmit = (values: z.infer<typeof taskSchema>) => {
    mutation.mutate(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Follow-Up Task</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl><Input {...field} placeholder="Send final quote..." /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="task_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Task Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="Send Quote">Send Quote</SelectItem>
                        <SelectItem value="Follow Up">Follow Up</SelectItem>
                        <SelectItem value="Check Application">Check Application</SelectItem>
                        <SelectItem value="Policy Review">Policy Review</SelectItem>
                        <SelectItem value="General">General</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="due_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Due Date</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="assigned_to"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assign To</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {agents?.map(agent => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.firstName} {agent.lastName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (Optional)</FormLabel>
                  <FormControl><Textarea {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end pt-4">
              <Button type="button" variant="outline" className="mr-2" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={mutation.isPending}>Save Task</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
