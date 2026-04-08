import React, { useState, useMemo } from "react";
import { 
  AlertTriangle, 
  Users, 
  ArrowRight, 
  CheckCircle2, 
  ShieldAlert,
  Loader2
} from "lucide-react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { User, UserProfile } from "@/lib/types";
import { Separator } from "@/components/ui/separator";

type UserWithProfile = User & { profile: UserProfile };

interface TransferLeadsModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (transferToUserId?: string) => Promise<void>;
  userToDelete: UserWithProfile | null;
  activeAgents: UserWithProfile[];
}

const TransferLeadsModal: React.FC<TransferLeadsModalProps> = ({
  open,
  onClose,
  onConfirm,
  userToDelete,
  activeAgents,
}) => {
  const [transferType, setTransferType] = useState<"none" | "agent">("none");
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableAgents = useMemo(() => 
    activeAgents.filter(a => a.id !== userToDelete?.id && a.status === "Active")
  , [activeAgents, userToDelete]);

  const handleConfirm = async () => {
    if (transferType === "agent" && !selectedAgentId) return;
    
    setIsSubmitting(true);
    try {
      await onConfirm(transferType === "agent" ? selectedAgentId : undefined);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!userToDelete) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !isSubmitting && onClose()}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <div className="flex items-center gap-2 text-destructive mb-2">
            <ShieldAlert className="w-5 h-5" />
            <DialogTitle>Delete Agent</DialogTitle>
          </div>
          <DialogDescription>
            You are about to delete <span className="font-semibold text-foreground">{userToDelete.firstName} {userToDelete.lastName}</span> from the system.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="bg-destructive/10 border border-destructive/20 p-4 rounded-lg flex gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-destructive">Critical Action</p>
              <p className="text-destructive/80">
                This will mark the agent as <Badge variant="outline" className="text-[10px] h-4 border-destructive text-destructive">Deleted</Badge>. 
                They will no longer be able to log in or be assigned new leads.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What should happen to their leads?</Label>
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={() => setTransferType("none")}
                  className={`flex flex-col items-start p-3 border rounded-lg text-left transition-all ${
                    transferType === "none" 
                      ? "border-primary bg-primary/5 ring-1 ring-primary" 
                      : "border-border hover:bg-accent hover:border-accent-foreground/20"
                  }`}
                >
                  <div className="flex items-center gap-2 font-medium">
                    <CheckCircle2 className={`w-4 h-4 ${transferType === "none" ? "text-primary" : "text-muted-foreground opacity-20"}`} />
                    <span>Keep as is / Unassign</span>
                  </div>
                  <span className="text-xs text-muted-foreground ml-6 mt-1">
                    Contacts will remain assigned to this deleted user ID (shown as "Unknown" in some areas).
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setTransferType("agent")}
                  className={`flex flex-col items-start p-3 border rounded-lg text-left transition-all ${
                    transferType === "agent" 
                      ? "border-primary bg-primary/5 ring-1 ring-primary" 
                      : "border-border hover:bg-accent hover:border-accent-foreground/20"
                  }`}
                >
                  <div className="flex items-center gap-2 font-medium">
                    <Users className={`w-4 h-4 ${transferType === "agent" ? "text-primary" : "text-muted-foreground opacity-20"}`} />
                    <span>Transfer to another Agent</span>
                  </div>
                  <span className="text-xs text-muted-foreground ml-6 mt-1">
                    All leads, clients, and recruits will be bulk-reassigned to a selected active agent.
                  </span>
                </button>
              </div>
            </div>

            {transferType === "agent" && (
              <div className="space-y-2 ml-6 animate-in fade-in slide-in-from-top-2 duration-200">
                <Label htmlFor="recipientAgent" className="text-xs">Recipient Agent</Label>
                <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                  <SelectTrigger id="recipientAgent" className="h-9">
                    <SelectValue placeholder="Select an active agent..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableAgents.map(agent => (
                      <SelectItem key={agent.id} value={agent.id}>
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">
                            {agent.firstName[0]}{agent.lastName[0]}
                          </div>
                          <span>{agent.firstName} {agent.lastName}</span>
                        </div>
                      </SelectItem>
                    ))}
                    {availableAgents.length === 0 && (
                      <div className="p-2 text-xs text-muted-foreground text-center italic">
                        No other active agents found
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button 
            variant="ghost" 
            onClick={onClose} 
            disabled={isSubmitting}
            className="text-xs"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isSubmitting || (transferType === "agent" && !selectedAgentId)}
            className="gap-2 h-9 px-4"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {transferType === "agent" ? "Transfer & Delete" : "Delete Agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TransferLeadsModal;
