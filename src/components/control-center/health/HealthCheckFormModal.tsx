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
  HEALTH_CHECK_TYPES,
  HEALTH_CHECK_TYPE_LABELS,
  HEALTH_STATUSES,
  HEALTH_STATUS_LABELS,
  ISSUE_SEVERITIES,
  ISSUE_SEVERITY_LABELS,
} from "@/lib/control-center/constants";
import {
  healthCheckFormSchema,
  type HealthCheckFormValues,
} from "@/lib/control-center/healthCheckSchema";
import {
  useCreateControlCenterHealthCheck,
  useUpdateControlCenterHealthCheck,
} from "@/hooks/useControlCenterHealthChecks";
import type { ControlCenterHealthCheck } from "@/lib/control-center/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  check: ControlCenterHealthCheck | null;
}

const DEFAULTS: HealthCheckFormValues = {
  check_key: "",
  name: "",
  category: "",
  check_type: "manual_check",
  description: "",
  target: "",
  expected_result: "",
  status: "unknown",
  severity: "medium",
  is_enabled: true,
};

const HealthCheckFormModal: React.FC<Props> = ({ open, onOpenChange, check }) => {
  const createMut = useCreateControlCenterHealthCheck();
  const updateMut = useUpdateControlCenterHealthCheck();
  const isEdit = !!check;

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<HealthCheckFormValues>({
    resolver: zodResolver(healthCheckFormSchema),
    defaultValues: DEFAULTS,
  });

  useEffect(() => {
    if (open) {
      reset(
        check
          ? {
              check_key: check.check_key,
              name: check.name,
              category: check.category,
              check_type: check.check_type,
              description: check.description ?? "",
              target: check.target ?? "",
              expected_result: check.expected_result ?? "",
              status: check.status,
              severity: check.severity,
              is_enabled: check.is_enabled,
            }
          : DEFAULTS,
      );
    }
  }, [open, check, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (isEdit && check) {
        await updateMut.mutateAsync({ id: check.id, values });
        toast.success("Health check updated");
      } else {
        await createMut.mutateAsync(values);
        toast.success("Health check created");
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
          <DialogTitle>{isEdit ? "Edit health check" : "Add health check"}</DialogTitle>
          <DialogDescription className="text-slate-400">
            Register a check. Live probes are not wired in v1; manual status only.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="check_key">Check key</Label>
              <Input id="check_key" autoComplete="off" {...register("check_key")} />
              {errors.check_key && (
                <p className="text-xs text-rose-400">{errors.check_key.message}</p>
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
              <Label>Check type</Label>
              <Controller
                control={control}
                name="check_type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HEALTH_CHECK_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {HEALTH_CHECK_TYPE_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
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
                      {HEALTH_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {HEALTH_STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Severity</Label>
              <Controller
                control={control}
                name="severity"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ISSUE_SEVERITIES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {ISSUE_SEVERITY_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="target">Target</Label>
              <Input id="target" autoComplete="off" {...register("target")} placeholder="URL, function name, etc." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expected_result">Expected result</Label>
              <Input id="expected_result" autoComplete="off" {...register("expected_result")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={3} {...register("description")} />
          </div>

          <Controller
            control={control}
            name="is_enabled"
            render={({ field }) => (
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <Switch checked={field.value} onCheckedChange={field.onChange} />
                Enabled
              </label>
            )}
          />

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isEdit ? "Save changes" : "Create health check"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default HealthCheckFormModal;
