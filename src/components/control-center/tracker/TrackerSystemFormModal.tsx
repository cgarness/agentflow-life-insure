import React, { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { systemFormSchema, type SystemFormValues } from "@/lib/control-center/trackerSchema";
import {
  useCreateTrackerSystem,
  useUpdateTrackerSystem,
} from "@/hooks/useControlCenterTracker";
import {
  TRACKER_MARKETABLE_LABELS,
  TRACKER_MARKETABLE_STATUSES,
  TRACKER_PRIORITIES,
  TRACKER_PRIORITY_LABELS,
  TRACKER_STATUSES,
  TRACKER_STATUS_LABELS,
  type TrackerSystem,
} from "@/lib/control-center/trackerTypes";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  system: TrackerSystem | null;
}

const DEFAULTS: SystemFormValues = {
  system_key: "",
  name: "",
  category: "",
  plain_english_summary: "",
  status: "not_started",
  priority: "medium",
  marketable_status: "unknown",
  owner: "",
  sort_order: 100,
  notes: "",
};

const TrackerSystemFormModal: React.FC<Props> = ({ open, onOpenChange, system }) => {
  const createMut = useCreateTrackerSystem();
  const updateMut = useUpdateTrackerSystem();
  const isEdit = !!system;

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SystemFormValues>({
    resolver: zodResolver(systemFormSchema),
    defaultValues: DEFAULTS,
  });

  useEffect(() => {
    if (open) {
      reset(
        system
          ? {
              system_key: system.system_key,
              name: system.name,
              category: system.category,
              plain_english_summary: system.plain_english_summary ?? "",
              status: system.status,
              priority: system.priority,
              marketable_status: system.marketable_status,
              owner: system.owner ?? "",
              sort_order: system.sort_order,
              notes: system.notes ?? "",
            }
          : DEFAULTS,
      );
    }
  }, [open, system, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (isEdit && system) {
        await updateMut.mutateAsync({ id: system.id, values });
        toast.success("System updated");
      } else {
        await createMut.mutateAsync(values);
        toast.success("System created");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-slate-950 text-slate-100 border-slate-800 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit system" : "Add system"}</DialogTitle>
          <DialogDescription className="text-slate-400">
            A system is a major area of AgentFlow (e.g. Dialer, Campaigns, Telephony).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="system_key">System key</Label>
              <Input id="system_key" autoComplete="off" {...register("system_key")} />
              {errors.system_key && (
                <p className="text-xs text-rose-400">{errors.system_key.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" autoComplete="off" {...register("name")} />
              {errors.name && <p className="text-xs text-rose-400">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <Input id="category" autoComplete="off" {...register("category")} />
              {errors.category && (
                <p className="text-xs text-rose-400">{errors.category.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner">Owner</Label>
              <Input id="owner" autoComplete="off" {...register("owner")} />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRACKER_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {TRACKER_STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Controller
                control={control}
                name="priority"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRACKER_PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {TRACKER_PRIORITY_LABELS[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Marketable</Label>
              <Controller
                control={control}
                name="marketable_status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRACKER_MARKETABLE_STATUSES.map((m) => (
                        <SelectItem key={m} value={m}>
                          {TRACKER_MARKETABLE_LABELS[m]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sort_order">Sort order</Label>
              <Input id="sort_order" type="number" {...register("sort_order")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plain_english_summary">Plain-English summary</Label>
            <Textarea
              id="plain_english_summary"
              rows={2}
              {...register("plain_english_summary")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={3} {...register("notes")} />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isEdit ? "Save changes" : "Create system"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default TrackerSystemFormModal;
