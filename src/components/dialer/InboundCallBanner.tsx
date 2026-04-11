import React from "react";
import { Phone, PhoneOff } from "lucide-react";
import { useTelnyx } from "@/contexts/TelnyxContext";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const formatPhone = (raw: string | null): string => {
  if (!raw) return "Unknown";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
};

const InboundCallBanner: React.FC = () => {
  const { inboundCall, acceptInboundCall, declineInboundCall } = useTelnyx();
  const navigate = useNavigate();

  if (!inboundCall) return null;

  const displayPhone = formatPhone(inboundCall.callerNumber);
  const displayName = inboundCall.displayName || "Unknown Caller";

  const handleAccept = () => {
    acceptInboundCall();
    if (inboundCall.leadId) {
      navigate(`/contacts/${inboundCall.leadId}`);
    }
  };

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-[420px] max-w-[90vw]">
      <div className="rounded-2xl border border-primary/40 bg-background shadow-2xl ring-2 ring-primary/20 animate-in slide-in-from-top-5 fade-in duration-300">
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
              <div className="relative w-12 h-12 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
                <Phone className="w-5 h-5 text-primary" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Incoming Call
              </p>
              <p className="text-lg font-semibold text-foreground truncate">{displayName}</p>
              <p className="text-sm text-muted-foreground">{displayPhone}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={declineInboundCall}
              variant="outline"
              size="lg"
              className="flex-1 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <PhoneOff className="w-4 h-4 mr-2" />
              Decline
            </Button>
            <Button
              onClick={handleAccept}
              size="lg"
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            >
              <Phone className="w-4 h-4 mr-2" />
              Accept
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InboundCallBanner;
