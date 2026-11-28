import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  title: string;
  description: string;
  /** Names the action itself, never a bare "OK". */
  confirm: string;
  cancel: string;
  /** The action cannot be undone from this screen. */
  destructive?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

/** One question before an action the author cannot take back. Cancel is the safe default. */
export default function ConfirmDialog({open, title, description, confirm, cancel, destructive, onConfirm, onOpenChange}: Props) {
  return <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel className="h-11 md:h-10">{cancel}</AlertDialogCancel>
        <AlertDialogAction className={cn("h-11 md:h-10", destructive && buttonVariants({variant: "destructive"}))}
          onClick={onConfirm}>{confirm}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
