import * as DialogPrimitive from "@radix-ui/react-dialog";
import { PhoneIncoming } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTelnyx } from "@/contexts/TelnyxContext";
import { cn } from "@/lib/utils";

/**
 * Global incoming-call surface: pinned bottom-right, non-modal (no full-screen overlay).
 * Stacks above FloatingDialer (z-1000) and FloatingChat (z-10000).
 */
const IncomingCallModal = () => {
  const {
    callState,
    incomingCallerNumber,
    incomingCallerName,
    crmContactName,
    currentCall,
    answerIncomingCall,
    rejectIncomingCall,
    incomingCallAlerts,
    enableIncomingCallAlerts,
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

  /** CRM name wins; else Telnyx caller ID; else label for empty ID. */
  const displayName =
    (crmContactName || incomingCallerName || "").trim() || "Unknown Caller";

  return (
    <DialogPrimitive.Root open={open} modal={false}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className={cn(
            "fixed bottom-6 right-6 z-[10101] grid w-96 max-w-[calc(100vw-2rem)] gap-4 border bg-background p-6 shadow-lg duration-300 sm:rounded-lg",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=open]:slide-in-from-bottom-8 data-[state=closed]:slide-out-to-bottom-8",
          )}
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <div className="flex flex-col space-y-1.5 text-center sm:text-left">
            <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 sm:mx-0">
              <PhoneIncoming className="h-7 w-7 text-primary animate-pulse" aria-hidden />
            </div>
            <DialogPrimitive.Title className="text-lg font-semibold leading-none tracking-tight text-center">
              Incoming call
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-center text-base text-foreground sm:text-center">
              <span
                className={cn(
                  "font-semibold block",
                  crmContactName.trim() ? "text-xl text-foreground" : "text-base",
                )}
              >
                {displayName}
              </span>
              <span className="text-muted-foreground text-sm mt-1 block">
                {incomingCallerNumber || "Unknown number"}
              </span>
            </DialogPrimitive.Description>
          </div>
          {!incomingCallAlerts.optIn && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full text-xs"
              onClick={() => void enableIncomingCallAlerts()}
            >
              Enable ringtone &amp; desktop alert (recommended)
            </Button>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
            <Button type="button" variant="outline" className="flex-1" onClick={handleReject}>
              Reject
            </Button>
            <Button type="button" className="flex-1" onClick={handleAnswer}>
              Answer
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default IncomingCallModal;
