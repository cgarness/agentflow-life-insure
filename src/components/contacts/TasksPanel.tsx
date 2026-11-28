import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '@/lib/tasksApi';
import { Button } from '@/components/ui/button';
import { Plus, CheckCircle2 } from 'lucide-react';
import { AddTaskModal } from './AddTaskModal';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useBranding } from '@/contexts/BrandingContext';
import { FOLLOW_UPS_REFETCH_INTERVAL_MS, NOW_TICK_MS } from '@/hooks/useContactFollowUps';
import { getTaskDueStatus, isTimedTask, type TaskDueStatus } from '@/lib/taskDates';
import TaskRow, { type TaskListItem } from './TaskRow';

interface TasksPanelProps {
  contactId: string;
  contactType: 'lead' | 'client' | 'recruit';
  organizationId: string;
  agents: { id: string; firstName: string; lastName: string }[];
}

const SECTIONS: { status: TaskDueStatus; title: string }[] = [
  { status: 'overdue', title: 'Overdue' },
  { status: 'today', title: 'Due Today' },
  { status: 'upcoming', title: 'Upcoming' },
  { status: 'completed', title: 'Completed' },
];

export function TasksPanel({ contactId, contactType, organizationId, agents }: TasksPanelProps) {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const { toast } = useToast();
  const { formatDateTime } = useBranding();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // A timed task moves from Upcoming to Due Today to Overdue as the clock passes it, as on the Follow-ups card.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), NOW_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const { data: tasks, isLoading } = useQuery<TaskListItem[]>({
    queryKey: ['tasks', contactId],
    queryFn: () => tasksApi.getTasks(contactId, organizationId),
    enabled: !!contactId && !!organizationId,
    // Tasks an automation creates while the contact is open appear on the same schedule as the Follow-ups card.
    refetchInterval: FOLLOW_UPS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const completeMutation = useMutation({
    mutationFn: (taskId: string) => tasksApi.completeTask(taskId, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', contactId] });
      toast({ title: 'Task marked as complete' });
    },
    onError: () => {
      toast({ title: 'Task was not marked complete', description: 'Nothing changed. Try again.', variant: 'destructive' });
    },
  });

  if (isLoading) {
    return <div className="p-4 flex justify-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div></div>;
  }

  // Shared with the Follow-ups card so both surfaces always agree. Only an automation task carries a time of day.
  const statusOf = (task: TaskListItem) => getTaskDueStatus(task.due_date, task.completed_at, now, !isTimedTask(task));
  // Row security lets only the assignee or the creator update a task. An automation task has no creator.
  const canComplete = (task: TaskListItem) => !!user && (task.assigned_to === user.id || task.created_by === user.id);

  return (
    <div className="flex flex-col h-full bg-card rounded-xl border">
      <div className="p-4 border-b flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center">
          <CheckCircle2 className="w-4 h-4 mr-2 text-primary" />
          Follow-Up Tasks
        </h3>
        <Button size="sm" onClick={() => setIsAddModalOpen(true)} className="h-7 text-xs">
          <Plus className="w-3 h-3 mr-1" /> Add Task
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 bg-muted/20">
        {!tasks?.length ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
              <CheckCircle2 className="w-6 h-6 opacity-50" />
            </div>
            <p className="text-sm font-medium">No tasks yet</p>
          </div>
        ) : SECTIONS.map(({ status, title }) => {
          const listed = tasks.filter(task => statusOf(task) === status);
          if (!listed.length) return null;
          return (
            <div key={status} className="mb-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{title}</h4>
              <div>
                {listed.map(task => <TaskRow key={task.id} task={task} status={status} busy={completeMutation.isPending} canComplete={canComplete(task)}
                  formatDateTime={formatDateTime} onComplete={id => completeMutation.mutate(id)} />)}
              </div>
            </div>
          );
        })}
      </div>

      <AddTaskModal
        open={isAddModalOpen}
        onOpenChange={setIsAddModalOpen}
        contactId={contactId}
        contactType={contactType}
        agents={agents}
      />
    </div>
  );
}
