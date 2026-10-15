import React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface UnsavedChangesDialogProps {
  open: boolean;
  onStay: () => void;
  onLeave: () => void;
}

/** Same wording as the Settings page's existing unsaved-changes dialog. */
const UnsavedChangesDialog: React.FC<UnsavedChangesDialogProps> = ({ open, onStay, onLeave }) => (
  <AlertDialog open={open} onOpenChange={(next) => !next && onStay()}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
        <AlertDialogDescription>You have unsaved changes. If you leave, your changes will be lost.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel onClick={onStay}>Stay</AlertDialogCancel>
        <AlertDialogAction onClick={onLeave} className="bg-destructive text-destructive-foreground">
          Leave
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export default UnsavedChangesDialog;
