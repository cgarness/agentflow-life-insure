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

export interface PendingConfirmation {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}

interface ConfirmActionDialogProps {
  confirmation: PendingConfirmation | null;
  onClose: () => void;
}

/** One confirmation dialog for destructive or calculator-affecting grid actions. */
const ConfirmActionDialog: React.FC<ConfirmActionDialogProps> = ({ confirmation, onClose }) => (
  <AlertDialog open={!!confirmation} onOpenChange={(open) => !open && onClose()}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
        <AlertDialogDescription>{confirmation?.description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
        <AlertDialogAction
          className={confirmation?.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
          onClick={() => {
            confirmation?.onConfirm();
            onClose();
          }}
        >
          {confirmation?.confirmLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export default ConfirmActionDialog;
