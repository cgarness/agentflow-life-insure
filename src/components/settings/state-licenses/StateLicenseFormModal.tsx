import React, { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { US_STATES } from "@/lib/us-states";
import {
  stateLicenseFormSchema,
  type StateLicenseFormValues,
  type AgentRow,
} from "./stateLicenseSchema";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  agents: AgentRow[];
  presetAgentId?: string | null;
  onSaved: () => void;
};

export const StateLicenseFormModal: React.FC<Props> = ({
  open,
  onOpenChange,
  organizationId,
  agents,
  presetAgentId,
  onSaved,
}) => {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<StateLicenseFormValues>({
    resolver: zodResolver(stateLicenseFormSchema),
    defaultValues: {
      agent_id: presetAgentId ?? "",
      state: "",
      license_number: "",
      expiration_date: "",
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        agent_id: presetAgentId ?? "",
        state: "",
        license_number: "",
        expiration_date: "",
      });
    }
  }, [open, presetAgentId, reset]);

  const agentId = watch("agent_id");
  const state = watch("state");

  const onSubmit = async (values: StateLicenseFormValues) => {
    const { error } = await supabase.from("agent_state_licenses").insert({
      organization_id: organizationId,
      agent_id: values.agent_id,
      state: values.state,
      license_number: values.license_number?.trim() || null,
      expiration_date: values.expiration_date || null,
    });
    if (error) {
      if (error.code === "23505") {
        toast.error("This agent already has a license for that state.");
      } else {
        toast.error(`Could not add license: ${error.message}`);
      }
      return;
    }
    toast.success("License added");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add State License</DialogTitle>
          <DialogDescription>
            Record a state license for an agent. License number and expiration are optional but recommended for compliance.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="license-agent">Agent *</Label>
            <Select value={agentId} onValueChange={(v) => setValue("agent_id", v, { shouldValidate: true })}>
              <SelectTrigger id="license-agent">
                <SelectValue placeholder="Select an agent..." />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.first_name} {a.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.agent_id && (
              <p className="mt-1 text-xs text-destructive">{errors.agent_id.message}</p>
            )}
          </div>

          <div>
            <Label htmlFor="license-state">State *</Label>
            <Select value={state} onValueChange={(v) => setValue("state", v, { shouldValidate: true })}>
              <SelectTrigger id="license-state">
                <SelectValue placeholder="Select a state..." />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {US_STATES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.state && (
              <p className="mt-1 text-xs text-destructive">{errors.state.message}</p>
            )}
          </div>

          <div>
            <Label htmlFor="license-number">License Number</Label>
            <Input id="license-number" placeholder="Optional" {...register("license_number")} />
            {errors.license_number && (
              <p className="mt-1 text-xs text-destructive">{errors.license_number.message}</p>
            )}
          </div>

          <div>
            <Label htmlFor="license-expiration">Expiration Date</Label>
            <Input id="license-expiration" type="date" {...register("expiration_date")} />
            {errors.expiration_date && (
              <p className="mt-1 text-xs text-destructive">{errors.expiration_date.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Add License"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
