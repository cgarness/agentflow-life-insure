import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { formatPhoneNumber } from "@/utils/phoneUtils";
import { reconcileGroupMembers } from "./numberGroupMutations";
import type { PhoneNumberRow } from "./NumberManagementSection";
import type { NumberGroupRow, NumberGroupMemberRow } from "./usePhoneSettingsController";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: NumberGroupRow;
  allNumbers: PhoneNumberRow[];
  groupMembers: NumberGroupMemberRow[];
  onSaved: () => void | Promise<void>;
};

export const NumberGroupMembersModal: React.FC<Props> = ({
  open,
  onOpenChange,
  group,
  allNumbers,
  groupMembers,
  onSaved,
}) => {
  const eligible = useMemo(
    () =>
      allNumbers.filter(
        (n) => n.status === "active" && n.is_direct_line !== true,
      ),
    [allNumbers],
  );

  const currentMemberIds = useMemo(
    () =>
      groupMembers
        .filter((m) => m.number_group_id === group.id)
        .map((m) => m.phone_number_id),
    [groupMembers, group.id],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setSelected(new Set(currentMemberIds));
  }, [open, currentMemberIds]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    const { error } = await reconcileGroupMembers(
      group.id,
      currentMemberIds,
      Array.from(selected),
    );
    setSaving(false);
    if (error) {
      toast.error(`Failed to update members: ${error}`);
      return;
    }
    toast.success("Group members updated");
    await onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(85vh,640px)] w-[calc(100vw-2rem)] max-w-md flex-col gap-0 p-0">
        <div className="border-b px-6 pb-4 pt-6 pr-14">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Numbers in “{group.name}”
            </DialogTitle>
            <DialogDescription>
              Direct-line numbers are excluded. A number can belong to multiple groups.
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {eligible.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No eligible numbers. Purchase active numbers or unmark direct lines first.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
              {eligible.map((n) => {
                const checked = selected.has(n.id);
                return (
                  <li
                    key={n.id}
                    className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
                    onClick={() => toggle(n.id)}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggle(n.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Toggle ${n.phone_number}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm text-foreground">
                        {formatPhoneNumber(n.phone_number)}
                      </p>
                      {n.friendly_name && (
                        <p className="truncate text-xs text-muted-foreground">{n.friendly_name}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save members
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
