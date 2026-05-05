import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '@/lib/tasksApi';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { formatDistanceToNow, isPast, isToday } from 'date-fns';
import { Plus, CheckCircle2, Clock } from 'lucide-react';
import { AddTaskModal } from './AddTaskModal';
import { useToast } from '@/components/ui/use-toast';

interface TasksPanelProps {
  contactId: string;
  contactType: 'lead' | 'client' | 'recruit';
  organizationId: string;
  agents: { id: string; firstName: string; lastName: string }[];
}

export function TasksPanel({ contactId, contactType, organizationId, agents }: TasksPanelProps) {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['tasks', contactId],
    queryFn: () => tasksApi.getTasks(contactId, organizationId),
    enabled: !!contactId && !!organizationId
  });

  const completeMutation = useMutation({
    mutationFn: (taskId: string) => tasksApi.completeTask(taskId, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', contactId] });
      toast({ title: 'Task marked as complete' });
    }
  });

  if (isLoading) {
    return <div className="p-4 flex justify-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div></div>;
  }

  const getTaskStatus = (task: any) => {
    if (task.completed_at) return 'completed';
    const dueDate = new Date(task.due_date);
    if (isPast(dueDate) && !isToday(dueDate)) return 'overdue';
    if (isToday(dueDate)) return 'today';
    return 'upcoming';
  };

  const overdueTasks = tasks?.filter((t: any) => getTaskStatus(t) === 'overdue') || [];
  const todayTasks = tasks?.filter((t: any) => getTaskStatus(t) === 'today') || [];
  const upcomingTasks = tasks?.filter((t: any) => getTaskStatus(t) === 'upcoming') || [];
  const completedTasks = tasks?.filter((t: any) => getTaskStatus(t) === 'completed') || [];

  const renderTask = (task: any, status: string) => {
    const isCompleted = status === 'completed';
    const isOverdue = status === 'overdue';
    
    return (
      <div key={task.id} className={`p-3 rounded-lg border mb-2 flex items-start gap-3 bg-card relative overflow-hidden group transition-all ${isCompleted ? 'opacity-60' : ''}`}>
        {isOverdue && <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" />}
        <div className="pt-1">
          <Checkbox 
            checked={isCompleted} 
            disabled={isCompleted || completeMutation.isPending}
            onCheckedChange={() => completeMutation.mutate(task.id)}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isCompleted ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}>
              {task.task_type}
            </span>
            <span className={`text-xs flex items-center ${isOverdue ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}>
              <Clock className="w-3 h-3 mr-1" />
              {isCompleted ? 'Completed' : formatDistanceToNow(new Date(task.due_date), { addSuffix: true })}
            </span>
          </div>
          <p className={`text-sm font-medium truncate ${isCompleted ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
            {task.title}
          </p>
          <div className="flex justify-between items-center mt-2">
            <p className="text-xs text-muted-foreground truncate">
              {task.notes || 'No notes'}
            </p>
            <p className="text-xs text-muted-foreground shrink-0 ml-2">
              {task.assignee?.first_name} {task.assignee?.last_name}
            </p>
          </div>
        </div>
      </div>
    );
  };

  const renderSection = (title: string, taskList: any[], status: string) => {
    if (taskList.length === 0) return null;
    return (
      <div className="mb-4">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{title}</h4>
        <div>{taskList.map((t: any) => renderTask(t, status))}</div>
      </div>
    );
  };

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
            <p className="text-xs mt-1">Add a follow-up task to keep track of next steps.</p>
          </div>
        ) : (
          <>
            {renderSection('Overdue', overdueTasks, 'overdue')}
            {renderSection('Due Today', todayTasks, 'today')}
            {renderSection('Upcoming', upcomingTasks, 'upcoming')}
            {renderSection('Completed', completedTasks, 'completed')}
          </>
        )}
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
