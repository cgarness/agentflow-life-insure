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
import {
  FEATURE_PRIORITIES,
  FEATURE_PRIORITY_LABELS,
  FEATURE_STATUSES,
  FEATURE_STATUS_LABELS,
} from "@/lib/control-center/constants";
import {
  featureFormSchema,
  type FeatureFormValues,
} from "@/lib/control-center/featureSchema";
import {
  useCreateControlCenterFeature,
  useUpdateControlCenterFeature,
} from "@/hooks/useControlCenterFeatures";
import type { ControlCenterFeature } from "@/lib/control-center/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature: ControlCenterFeature | null;
}

const DEFAULTS: FeatureFormValues = {
  feature_key: "",
  name: "",
  category: "",
  description: "",
  status: "planned",
  priority: "medium",
  owner: "",
  is_customer_visible: false,
  is_internal_only: true,
  is_blocked: false,
  blocked_reason: "",
};

const FeatureFormModal: React.FC<Props> = ({ open, onOpenChange, feature }) => {
  const createMut = useCreateControlCenterFeature();
  const updateMut = useUpdateControlCenterFeature();
  const isEdit = !!feature;

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FeatureFormValues>({
    resolver: zodResolver(featureFormSchema),
    defaultValues: DEFAULTS,
  });

  useEffect(() => {
    if (open) {
      reset(
        feature
          ? {
              feature_key: feature.feature_key,
              name: feature.name,
              category: feature.category,
              description: feature.description ?? "",
              status: feature.status,
              priority: feature.priority,
              owner: feature.owner ?? "",
              is_customer_visible: feature.is_customer_visible,
              is_internal_only: feature.is_internal_only,
              is_blocked: feature.is_blocked,
              blocked_reason: feature.blocked_reason ?? "",
            }
          : DEFAULTS,
      );
    }
  }, [open, feature, reset]);

  const isBlocked = watch("is_blocked");

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (isEdit && feature) {
        await updateMut.mutateAsync({ id: feature.id, values });
        toast.success("Feature updated");
      } else {
        await createMut.mutateAsync(values);
        toast.success("Feature created");
      }
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast.error(msg);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-slate-950 text-slate-100 border-slate-800">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit feature" : "Add feature"}</DialogTitle>
          <DialogDescription className="text-slate-400">
            Track build status and ownership for any AgentFlow capability.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="feature_key">Feature key</Label>
              <Input id="feature_key" autoComplete="off" {...register("feature_key")} />
              {errors.feature_key && (
                <p className="text-xs text-rose-400">{errors.feature_key.message}</p>
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
                      {FEATURE_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {FEATURE_STATUS_LABELS[s]}
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
                      {FEATURE_PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {FEATURE_PRIORITY_LABELS[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={3} {...register("description")} />
          </div>

          <div className="flex flex-wrap gap-6">
            <Controller
              control={control}
              name="is_customer_visible"
              render={({ field }) => (
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                  Customer visible
                </label>
              )}
            />
            <Controller
              control={control}
              name="is_internal_only"
              render={({ field }) => (
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                  Internal only
                </label>
              )}
            />
            <Controller
              control={control}
              name="is_blocked"
              render={({ field }) => (
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                  Blocked
                </label>
              )}
            />
          </div>

          {isBlocked && (
            <div className="space-y-1.5">
              <Label htmlFor="blocked_reason">Blocked reason</Label>
              <Textarea id="blocked_reason" rows={2} {...register("blocked_reason")} />
              {errors.blocked_reason && (
                <p className="text-xs text-rose-400">{errors.blocked_reason.message}</p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isEdit ? "Save changes" : "Create feature"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default FeatureFormModal;
