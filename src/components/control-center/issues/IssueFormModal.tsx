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
import {
  ISSUE_SEVERITIES,
  ISSUE_SEVERITY_LABELS,
  ISSUE_SOURCES,
  ISSUE_SOURCE_LABELS,
  ISSUE_STATUSES,
  ISSUE_STATUS_LABELS,
} from "@/lib/control-center/constants";
import { issueFormSchema, type IssueFormValues } from "@/lib/control-center/issueSchema";
import {
  useCreateControlCenterIssue,
  useUpdateControlCenterIssue,
} from "@/hooks/useControlCenterIssues";
import type { ControlCenterFeature, ControlCenterIssue } from "@/lib/control-center/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: ControlCenterIssue | null;
  features: ControlCenterFeature[];
}

const DEFAULTS: IssueFormValues = {
  title: "",
  description: "",
  severity: "medium",
  status: "open",
  source: "manual",
  feature_id: null,
  resolution_notes: "",
};

const NO_FEATURE_VALUE = "__none__";

const IssueFormModal: React.FC<Props> = ({ open, onOpenChange, issue, features }) => {
  const createMut = useCreateControlCenterIssue();
  const updateMut = useUpdateControlCenterIssue();
  const isEdit = !!issue;

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<IssueFormValues>({
    resolver: zodResolver(issueFormSchema),
    defaultValues: DEFAULTS,
  });

  useEffect(() => {
    if (open) {
      reset(
        issue
          ? {
              title: issue.title,
              description: issue.description ?? "",
              severity: issue.severity,
              status: issue.status,
              source: issue.source,
              feature_id: issue.feature_id,
              resolution_notes: issue.resolution_notes ?? "",
            }
          : DEFAULTS,
      );
    }
  }, [open, issue, reset]);

  const status = watch("status");

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (isEdit && issue) {
        await updateMut.mutateAsync({ id: issue.id, values });
        toast.success("Issue updated");
      } else {
        await createMut.mutateAsync(values);
        toast.success("Issue created");
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
          <DialogTitle>{isEdit ? "Edit issue" : "Add issue"}</DialogTitle>
          <DialogDescription className="text-slate-400">
            Track broken areas, blockers, and risks across the platform.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" autoComplete="off" {...register("title")} />
            {errors.title && <p className="text-xs text-rose-400">{errors.title.message}</p>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                      {ISSUE_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {ISSUE_STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Controller
                control={control}
                name="source"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ISSUE_SOURCES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {ISSUE_SOURCE_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Linked feature (optional)</Label>
            <Controller
              control={control}
              name="feature_id"
              render={({ field }) => (
                <Select
                  value={field.value ?? NO_FEATURE_VALUE}
                  onValueChange={(v) => field.onChange(v === NO_FEATURE_VALUE ? null : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_FEATURE_VALUE}>None</SelectItem>
                    {features.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={4} {...register("description")} />
          </div>

          {status === "resolved" && (
            <div className="space-y-1.5">
              <Label htmlFor="resolution_notes">Resolution notes</Label>
              <Textarea
                id="resolution_notes"
                rows={2}
                {...register("resolution_notes")}
                placeholder="How was it fixed?"
              />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isEdit ? "Save changes" : "Create issue"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default IssueFormModal;
