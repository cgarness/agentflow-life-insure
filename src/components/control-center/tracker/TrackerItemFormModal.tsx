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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { itemFormSchema, type ItemFormValues } from "@/lib/control-center/trackerSchema";
import { useCreateTrackerItem, useUpdateTrackerItem } from "@/hooks/useControlCenterTracker";
import {
  TRACKER_MARKETABLE_LABELS,
  TRACKER_MARKETABLE_STATUSES,
  TRACKER_PRIORITIES,
  TRACKER_PRIORITY_LABELS,
  TRACKER_STATUSES,
  TRACKER_STATUS_LABELS,
  type TrackerItem,
  type TrackerSystem,
} from "@/lib/control-center/trackerTypes";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: TrackerItem | null;
  systems: TrackerSystem[];
  presetSystemId?: string | null;
}

const DEFAULTS: ItemFormValues = {
  system_id: "",
  item_key: "",
  title: "",
  description: "",
  status: "not_started",
  priority: "medium",
  marketable_status: "unknown",
  production_critical: false,
  mobile_visible: true,
  source_of_truth: "",
  next_action: "",
  notes: "",
  sort_order: 100,
};

const TrackerItemFormModal: React.FC<Props> = ({
  open,
  onOpenChange,
  item,
  systems,
  presetSystemId,
}) => {
  const createMut = useCreateTrackerItem();
  const updateMut = useUpdateTrackerItem();
  const isEdit = !!item;

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ItemFormValues>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: DEFAULTS,
  });

  useEffect(() => {
    if (open) {
      reset(
        item
          ? {
              system_id: item.system_id,
              item_key: item.item_key,
              title: item.title,
              description: item.description ?? "",
              status: item.status,
              priority: item.priority,
              marketable_status: item.marketable_status,
              production_critical: item.production_critical,
              mobile_visible: item.mobile_visible,
              source_of_truth: item.source_of_truth ?? "",
              next_action: item.next_action ?? "",
              notes: item.notes ?? "",
              sort_order: item.sort_order,
            }
          : { ...DEFAULTS, system_id: presetSystemId ?? "" },
      );
    }
  }, [open, item, presetSystemId, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (isEdit && item) {
        await updateMut.mutateAsync({ id: item.id, values });
        toast.success("Item updated");
      } else {
        await createMut.mutateAsync(values);
        toast.success("Item created");
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
          <DialogTitle>{isEdit ? "Edit item" : "Add item"}</DialogTitle>
          <DialogDescription className="text-slate-400">
            A concrete capability inside a system (what it does, in plain English).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>System</Label>
            <Controller
              control={control}
              name="system_id"
              render={({ field }) => (
                <Select value={field.value || undefined} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a system" />
                  </SelectTrigger>
                  <SelectContent>
                    {systems.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.system_id && (
              <p className="text-xs text-rose-400">{errors.system_id.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="item_key">Item key</Label>
              <Input id="item_key" autoComplete="off" {...register("item_key")} />
              {errors.item_key && (
                <p className="text-xs text-rose-400">{errors.item_key.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input id="title" autoComplete="off" {...register("title")} />
              {errors.title && <p className="text-xs text-rose-400">{errors.title.message}</p>}
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
            <Label htmlFor="description">Description (what it does)</Label>
            <Textarea id="description" rows={2} {...register("description")} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="source_of_truth">Source of truth</Label>
              <Input id="source_of_truth" autoComplete="off" {...register("source_of_truth")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="next_action">Next action</Label>
              <Input id="next_action" autoComplete="off" {...register("next_action")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={2} {...register("notes")} />
          </div>

          <div className="flex flex-wrap gap-6">
            <Controller
              control={control}
              name="production_critical"
              render={({ field }) => (
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                  Production critical
                </label>
              )}
            />
            <Controller
              control={control}
              name="mobile_visible"
              render={({ field }) => (
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                  Mobile visible
                </label>
              )}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isEdit ? "Save changes" : "Create item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default TrackerItemFormModal;
