import React, { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, ShieldCheck, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPhoneNumber } from "@/utils/phoneUtils";
import { useAuth } from "@/contexts/AuthContext";
import { logActivity } from "@/lib/activityLogger";
import { changePhoneNumberToAgency, changePhoneNumberToPersonal } from "./phoneNumberRoleMutations";
import type { PhoneNumberRow } from "./NumberManagementSection";
import type { Profile } from "./usePhoneSettingsController";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phoneNumber: PhoneNumberRow;
  agents: Profile[];
  organizationId: string;
  onUpdated: () => void | Promise<void>;
};

const UNASSIGNED = "__unassigned__";

const roleSchema = z
  .object({
    assignment_type: z.enum(["agency", "personal"]),
    assigned_to: z.string().nullable(),
  })
  .refine((v) => v.assignment_type !== "personal" || (!!v.assigned_to && v.assigned_to !== UNASSIGNED), {
    message: "Personal numbers must have an assigned owner.",
    path: ["assigned_to"],
  });

export const PhoneNumberRoleModal: React.FC<Props> = ({
  open,
  onOpenChange,
  phoneNumber,
  agents,
  organizationId,
  onUpdated,
}) => {
  const { user, profile } = useAuth();
  const currentRole: "agency" | "personal" =
    phoneNumber.assignment_type === "personal" ? "personal" : "agency";

  const [role, setRole] = useState<"agency" | "personal">(currentRole);
  const [ownerId, setOwnerId] = useState<string>(phoneNumber.assigned_to ?? UNASSIGNED);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRole(currentRole);
      setOwnerId(phoneNumber.assigned_to ?? UNASSIGNED);
      setValidationError(null);
    }
  }, [open, currentRole, phoneNumber.assigned_to]);

  const ownerName = useMemo(() => {
    const a = agents.find((x) => x.id === phoneNumber.assigned_to);
    return a ? `${a.first_name} ${a.last_name}` : null;
  }, [agents, phoneNumber.assigned_to]);

  const willClearDefault = role === "personal" && phoneNumber.is_default === true;
  const isNoChange = role === currentRole && (role !== "personal" || ownerId === (phoneNumber.assigned_to ?? UNASSIGNED));

  const handleSave = async () => {
    const parsed = roleSchema.safeParse({
      assignment_type: role,
      assigned_to: ownerId === UNASSIGNED ? null : ownerId,
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid selection.");
      return;
    }
    if (role === "personal" && !agents.some((a) => a.id === ownerId)) {
      setValidationError("That user is not in your organization.");
      return;
    }
    setValidationError(null);
    setSaving(true);
    try {
      const result =
        role === "personal"
          ? await changePhoneNumberToPersonal({
              phoneNumberId: phoneNumber.id,
              organizationId,
              ownerId,
            })
          : await changePhoneNumberToAgency({
              phoneNumberId: phoneNumber.id,
              organizationId,
            });
      if (result.error) {
        toast.error(`Could not change role: ${result.error}`);
        return;
      }
      toast.success(role === "personal" ? "Number set to Personal (owner-only)" : "Number set to Agency (shared pool)");
      void logActivity({
        action:
          role === "personal"
            ? `Set ${phoneNumber.phone_number} to Personal (owner-only)`
            : `Set ${phoneNumber.phone_number} to Agency (shared pool)`,
        category: "telephony",
        organizationId,
        userId: user?.id,
        userName: profile ? `${profile.first_name} ${profile.last_name}` : undefined,
      });
      await onUpdated();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Outbound role
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono text-foreground">{formatPhoneNumber(phoneNumber.phone_number)}</span>
            {" — "}controls how this number is used for outbound caller ID.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <RadioGroup value={role} onValueChange={(v) => setRole(v as "agency" | "personal")} className="gap-3">
            <label
              htmlFor="role-agency"
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-3 transition-colors hover:bg-muted/40 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5"
            >
              <RadioGroupItem value="agency" id="role-agency" className="mt-0.5" />
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-foreground">Agency — shared pool</p>
                <p className="text-xs text-muted-foreground">
                  Eligible for automatic local-presence and dialer rotation, and manual selection by any allowed user.
                </p>
              </div>
            </label>
            <label
              htmlFor="role-personal"
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-3 transition-colors hover:bg-muted/40 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5"
            >
              <RadioGroupItem value="personal" id="role-personal" className="mt-0.5" />
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-foreground">Personal — owner-only</p>
                <p className="text-xs text-muted-foreground">
                  Manually selectable only by its owner. Excluded from automatic rotation and from campaign number groups.
                </p>
              </div>
            </label>
          </RadioGroup>

          {role === "personal" && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                <User className="mr-1 inline h-3.5 w-3.5" />
                Owner (required)
              </Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select an owner" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED} disabled>
                    Select an owner…
                  </SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.first_name} {a.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {role === "personal" && currentRole !== "personal" && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
              This will make the number owner-only, remove it from automatic dialer/local-presence rotation, clear
              default status if set, and remove it from campaign number groups.
            </div>
          )}

          {willClearDefault && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive">
              This number is currently the default caller ID. Default status will be cleared.
            </div>
          )}

          {role === "agency" && currentRole === "personal" && (
            <div className="rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
              {ownerName ? `${ownerName} stays recorded as “assigned to”` : "Any existing assignment is kept"}, but on an
              Agency number that is administrative/display tracking only — it does not make the number owner-only. The
              number is not made default and is not added to any group automatically.
            </div>
          )}

          {validationError && <p className="text-xs text-destructive">{validationError}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || isNoChange}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
