import React from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Script } from "./callScriptTypes";

interface DeleteCallScriptDialogProps {
  target: Script | null;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export const DeleteCallScriptDialog: React.FC<DeleteCallScriptDialogProps> = ({
  target,
  saving,
  onOpenChange,
  onConfirm,
}) => {
  return (
    <AlertDialog open={!!target} onOpenChange={(o) => (!o && !saving) && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Script</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <span className="font-semibold text-foreground">"{target?.name}"</span>? This action cannot be undone and will remove the script from all agent views.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); onConfirm(); }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={saving}
          >
            Delete Script
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
