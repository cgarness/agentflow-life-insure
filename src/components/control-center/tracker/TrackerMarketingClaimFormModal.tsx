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
  marketingClaimFormSchema,
  ISSUE_LINK_NONE,
  type MarketingClaimFormValues,
} from "@/lib/control-center/trackerSchema";
import { useCreateTrackerClaim, useUpdateTrackerClaim } from "@/hooks/useControlCenterTracker";
import {
  TRACKER_ACTION_NEEDED_LABELS,
  TRACKER_ACTIONS_NEEDED,
  TRACKER_PRIORITIES,
  TRACKER_PRIORITY_LABELS,
  TRACKER_REALITY_STATUS_LABELS,
  TRACKER_REALITY_STATUSES,
  type TrackerMarketingClaim,
  type TrackerSystem,
} from "@/lib/control-center/trackerTypes";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claim: TrackerMarketingClaim | null;
  systems: TrackerSystem[];
}

const DEFAULTS: MarketingClaimFormValues = {
  claim_key: "",
  feature_claim: "",
  marketed_location: "",
  reality_status: "accurate",
  actual_status: "",
  action_needed: "keep",
  priority: "medium",
  system_id: undefined,
  notes: "",
};

const TrackerMarketingClaimFormModal: React.FC<Props> = ({
  open,
  onOpenChange,
  claim,
  systems,
}) => {
  const createMut = useCreateTrackerClaim();
  const updateMut = useUpdateTrackerClaim();
  const isEdit = !!claim;

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<MarketingClaimFormValues>({
    resolver: zodResolver(marketingClaimFormSchema),
    defaultValues: DEFAULTS,
  });

  useEffect(() => {
    if (open) {
      reset(
        claim
          ? {
              claim_key: claim.claim_key,
              feature_claim: claim.feature_claim,
              marketed_location: claim.marketed_location ?? "",
              reality_status: claim.reality_status,
              actual_status: claim.actual_status ?? "",
              action_needed: claim.action_needed,
              priority: claim.priority,
              system_id: claim.system_id ?? undefined,
              notes: claim.notes ?? "",
            }
          : DEFAULTS,
      );
    }
  }, [open, claim, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (isEdit && claim) {
        await updateMut.mutateAsync({ id: claim.id, values });
        toast.success("Claim updated");
      } else {
        await createMut.mutateAsync(values);
        toast.success("Claim created");
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
          <DialogTitle>{isEdit ? "Edit marketing claim" : "Add marketing claim"}</DialogTitle>
          <DialogDescription className="text-slate-400">
            What we market vs. what actually ships, and what to do about the gap.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="claim_key">Claim key</Label>
              <Input id="claim_key" autoComplete="off" {...register("claim_key")} />
              {errors.claim_key && (
                <p className="text-xs text-rose-400">{errors.claim_key.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="marketed_location">Marketed location</Label>
              <Input
                id="marketed_location"
                autoComplete="off"
                {...register("marketed_location")}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="feature_claim">Feature claim</Label>
            <Textarea id="feature_claim" rows={2} {...register("feature_claim")} />
            {errors.feature_claim && (
              <p className="text-xs text-rose-400">{errors.feature_claim.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Reality status</Label>
              <Controller
                control={control}
                name="reality_status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRACKER_REALITY_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {TRACKER_REALITY_STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Action needed</Label>
              <Controller
                control={control}
                name="action_needed"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRACKER_ACTIONS_NEEDED.map((a) => (
                        <SelectItem key={a} value={a}>
                          {TRACKER_ACTION_NEEDED_LABELS[a]}
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
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="actual_status">Actual status (reality)</Label>
            <Textarea id="actual_status" rows={2} {...register("actual_status")} />
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
              {isEdit ? "Save changes" : "Create claim"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default TrackerMarketingClaimFormModal;
