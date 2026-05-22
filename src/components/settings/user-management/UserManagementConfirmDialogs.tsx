import React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ConfirmDialogState } from "./userManagementTypes";

interface Props {
  state: ConfirmDialogState;
  onClose: () => void;
  onConfirm: () => void;
}

const UserManagementConfirmDialogs: React.FC<Props> = ({ state, onClose, onConfirm }) => (
  <Dialog open={state.open} onOpenChange={v => !v && onClose()}>
    <DialogContent className="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>{state.action === "deactivate" ? "Deactivate User" : "Reactivate User"}</DialogTitle>
        <DialogDescription>
          {state.action === "deactivate"
            ? `Are you sure you want to deactivate ${state.user?.firstName} ${state.user?.lastName}? They will lose access immediately.`
            : `Reactivate ${state.user?.firstName} ${state.user?.lastName}?`}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant={state.action === "deactivate" ? "destructive" : "default"} onClick={onConfirm}>
          {state.action === "deactivate" ? "Confirm Deactivate" : "Reactivate"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export default UserManagementConfirmDialogs;
