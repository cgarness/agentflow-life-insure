import { useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { SavedMessage } from "@/lib/automation-api";

interface Props {
  /** The saved message waiting for an answer, or null while nothing is being asked. */
  message: SavedMessage | null;
  onReplace: (message: SavedMessage) => void;
  /** The dialog closed, whichever answer was given. */
  onClose: () => void;
  /** Where focus goes once the dialog has left the screen. */
  onClosed: () => void;
}

/** Asks before a saved message overwrites wording the author already has in the step. */
export default function ReplaceMessageDialog({message, onReplace, onClose, onClosed}: Props) {
  // The wording stays put while the dialog fades out.
  const [asked, setAsked] = useState(message);
  if (message && message !== asked) setAsked(message);
  return <AlertDialog open={!!message} onOpenChange={open => { if (!open) onClose(); }}>
    <AlertDialogContent onCloseAutoFocus={event => { event.preventDefault(); onClosed(); }}>
      <AlertDialogHeader>
        <AlertDialogTitle>Replace your message?</AlertDialogTitle>
        <AlertDialogDescription>
          {asked?.type === "email" ? "The subject and message in this step" : "The message in this step"} will be
          replaced with the saved message{asked ? " “" + asked.name + "”" : ""}. You can still edit the wording afterwards.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel className="h-11 md:h-10">Keep my message</AlertDialogCancel>
        <AlertDialogAction className="h-11 md:h-10" onClick={() => { if (message) onReplace(message); }}>Replace message</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
