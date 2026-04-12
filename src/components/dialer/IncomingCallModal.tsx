import { PhoneIncoming } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTelnyx } from "@/contexts/TelnyxContext";

/**
 * Global incoming-call surface (MVP): rings when TelnyxContext sees an inbound session.
 * Answer / reject use the live SDK call on the context (claim + mic + answer, or hangup to decline).
 */
const IncomingCallModal = () => {
  const {
    callState,
    incomingCallerNumber,
    incomingCallerName,
    currentCall,
    answerIncomingCall,
    rejectIncomingCall,
  } = useTelnyx();

  const open = callState === "incoming";

  const handleReject = () => {
    const call = currentCall as { reject?: () => void; hangup?: () => void } | null;
    if (typeof call?.reject === "function") {
      call.reject();
      return;
    }
    rejectIncomingCall();
  };

  const handleAnswer = async () => {
    await answerIncomingCall();
  };

  return (
    <Dialog open={open} onOpenChange={() => { /* controlled by callState only */ }}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <PhoneIncoming className="h-7 w-7 text-primary animate-pulse" aria-hidden />
          </div>
          <DialogTitle className="text-center">Incoming call</DialogTitle>
          <DialogDescription className="text-center text-base text-foreground">
            {incomingCallerName ? (
              <>
                <span className="font-semibold block">{incomingCallerName}</span>
                <span className="text-muted-foreground text-sm">{incomingCallerNumber || "Unknown number"}</span>
              </>
            ) : (
              <span className="font-medium">{incomingCallerNumber || "Unknown caller"}</span>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row gap-2 sm:justify-center">
          <Button type="button" variant="outline" className="flex-1" onClick={handleReject}>
            Reject
          </Button>
          <Button type="button" className="flex-1" onClick={handleAnswer}>
            Answer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default IncomingCallModal;
