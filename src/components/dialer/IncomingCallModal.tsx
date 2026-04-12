import * as DialogPrimitive from "@radix-ui/react-dialog";
import { PhoneIncoming } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTelnyx } from "@/contexts/TelnyxContext";
import { cn } from "@/lib/utils";

/**
 * Global incoming-call surface: must stack **above** FloatingDialer (z-1000) and FloatingChat (z-10000).
 * Uses Radix primitives so overlay + content share a high z-index (shadcn Dialog defaults to z-50).
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
    <DialogPrimitive.Root open={open} modal>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-[10100] bg-black/80",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-[50%] top-[50%] z-[10101] grid w-full max-w-md translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 sm:rounded-lg",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
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
              {incomingCallerName ? (
                <>
                  <span className="font-semibold block">{incomingCallerName}</span>
                  <span className="text-muted-foreground text-sm">
                    {incomingCallerNumber || "Unknown number"}
                  </span>
                </>
              ) : (
                <span className="font-medium">{incomingCallerNumber || "Unknown caller"}</span>
              )}
            </DialogPrimitive.Description>
          </div>
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
