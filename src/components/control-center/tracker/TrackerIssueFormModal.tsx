import React, { useEffect, useMemo } from "react";
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
  issueFormSchema,
  ISSUE_LINK_NONE,
  type IssueFormValues,
} from "@/lib/control-center/trackerSchema";
import { useCreateTrackerIssue, useUpdateTrackerIssue } from "@/hooks/useControlCenterTracker";
import {
  TRACKER_ISSUE_SEVERITIES,
  TRACKER_ISSUE_SEVERITY_LABELS,
  TRACKER_ISSUE_STATUSES,
  TRACKER_ISSUE_STATUS_LABELS,
  type TrackerIssue,
  type TrackerItem,
  type TrackerSystem,
} from "@/lib/control-center/trackerTypes";

export interface IssuePreset {
  system_id?: string | null;
  item_id?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: TrackerIssue | null;
  systems: TrackerSystem[];
  items: TrackerItem[];
  preset?: IssuePreset | null;
}

const DEFAULTS: IssueFormValues = {
  issue_key: "",
  title: "",
  description: "",
  severity: "medium",
  status: "open",
  system_id: undefined,
  item_id: undefined,
  owner: "",
  next_action: "",
  notes: "",
};

const TrackerIssueFormModal: React.FC<Props> = ({
  open,
  onOpenChange,
  issue,
  systems,
  items,
  preset,
}) => {
  const createMut = useCreateTrackerIssue();
  const updateMut = useUpdateTrackerIssue();
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
              issue_key: issue.issue_key,
              title: issue.title,
              description: issue.description ?? "",
              severity: issue.severity,
              status: issue.status,
              system_id: issue.system_id ?? undefined,
              item_id: issue.item_id ?? undefined,
              owner: issue.owner ?? "",
              next_action: issue.next_action ?? "",
              notes: issue.notes ?? "",
            }
          : {
              ...DEFAULTS,
              system_id: preset?.system_id ?? undefined,
              item_id: preset?.item_id ?? undefined,
            },
      );
    }
  }, [open, issue, preset, reset]);

  const selectedSystem = watch("system_id");
  const linkableItems = useMemo(
    () => (selectedSystem ? items.filter((i) => i.system_id === selectedSystem) : items),
    [items, selectedSystem],
  );

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
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-slate-950 text-slate-100 border-slate-800 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit issue" : "Add issue"}</DialogTitle>
          <DialogDescription className="text-slate-400">
            Track a launch blocker or defect, optionally linked to a system and item.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="issue_key">Issue key</Label>
              <Input id="issue_key" autoComplete="off" {...register("issue_key")} />
              {errors.issue_key && (
                <p className="text-xs text-rose-400">{errors.issue_key.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input id="title" autoComplete="off" {...register("title")} />
              {errors.title && <p className="text-xs text-rose-400">{errors.title.message}</p>}
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
                      {TRACKER_ISSUE_SEVERITIES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {TRACKER_ISSUE_SEVERITY_LABELS[s]}
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
                      {TRACKER_ISSUE_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {TRACKER_ISSUE_STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>System (optional)</Label>
              <Controller
                control={control}
                name="system_id"
                render={({ field }) => (
                  <Select
                    value={field.value ?? ISSUE_LINK_NONE}
                    onValueChange={(v) => field.onChange(v === ISSUE_LINK_NONE ? undefined : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ISSUE_LINK_NONE}>None</SelectItem>
                      {systems.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Item (optional)</Label>
              <Controller
                control={control}
                name="item_id"
                render={({ field }) => (
                  <Select
                    value={field.value ?? ISSUE_LINK_NONE}
                    onValueChange={(v) => field.onChange(v === ISSUE_LINK_NONE ? undefined : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ISSUE_LINK_NONE}>None</SelectItem>
                      {linkableItems.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner">Owner</Label>
              <Input id="owner" autoComplete="off" {...register("owner")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="next_action">Next action</Label>
              <Input id="next_action" autoComplete="off" {...register("next_action")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={3} {...register("description")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={2} {...register("notes")} />
          </div>

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

export default TrackerIssueFormModal;
