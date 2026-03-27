import React, { useState } from "react";
import { X, ArrowRight, Shield, Check, Loader2, UserPlus, Calendar } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lead } from "@/lib/types";
import { conversionSupabaseApi } from "@/lib/supabase-conversion";
import { toast } from "sonner";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";

interface ConvertLeadModalProps {
  open: boolean;
  onClose: () => void;
  lead: Lead | null;
  onSuccess: (clientId: string) => void;
}

const POLICY_TYPES = ["Term", "Whole Life", "IUL", "Final Expense"];

const ConvertLeadModal: React.FC<ConvertLeadModalProps> = ({ open, onClose, lead, onSuccess }) => {
  const { organizationId } = useOrganization();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    policyType: "Term",
    carrier: "",
    policyNumber: "",
    faceAmount: "",
    premiumAmount: "",
    issueDate: "",
    effectiveDate: "",
    beneficiaryName: "",
    beneficiaryRelationship: "",
    beneficiaryPhone: "",
    notes: "",
  });

  if (!lead) return null;

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleConvert = async () => {
    if (!formData.carrier.trim()) {
      toast.error("Carrier is required");
      return;
    }
    
    setLoading(true);
    try {
      const clientId = await conversionSupabaseApi.convertLeadToClient(lead, formData as any, organizationId);
      
      // Trigger celebration
      window.dispatchEvent(new CustomEvent("win-celebration", {
        detail: {
          id: clientId,
          agent_name: profile ? `${profile.first_name} ${profile.last_name}` : "An agent",
          contact_name: `${lead.firstName} ${lead.lastName}`,
          campaign_name: null,
          created_at: new Date().toISOString()
        }
      }));

      toast.success(`${lead.firstName} ${lead.lastName} converted to client!`);
      onSuccess(clientId);
      onClose();
    } catch (err: any) {
      console.error("Conversion error:", err);
      toast.error(err.message || "Failed to convert lead to client");
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "h-9 text-xs shadow-sm bg-background border-border placeholder:text-muted-foreground/50";
  const labelCls = "text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block";

  return (
    <Dialog open={open} onOpenChange={(val) => !val && !loading && onClose()}>
      <DialogContent className="sm:max-w-[480px] w-[95vw] max-h-[90vh] flex flex-col p-0 overflow-hidden border-none shadow-2xl bg-card rounded-xl">
        <DialogHeader className="p-5 border-b border-green-500/10 bg-green-500/[0.03]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-green-500/10 flex items-center justify-center text-green-600">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold tracking-tight text-green-700">Convert to Client</DialogTitle>
              <DialogDescription className="text-muted-foreground text-[10px] -mt-0.5">
                Closing the sale for {lead?.firstName} {lead?.lastName}. Enter policy details below.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5 space-y-5 flex-1 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-muted-foreground/20">
          {/* Policy Basics */}
          <div className="space-y-3">
            <h4 className="text-[11px] font-bold text-foreground/80 uppercase tracking-wider flex items-center gap-2">
              <div className="w-1 h-3 bg-green-500 rounded-full" /> Policy Information
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Policy Type</label>
                <select 
                  value={formData.policyType} 
                  onChange={e => handleInputChange("policyType", e.target.value)}
                  className="w-full h-9 px-3 rounded-md bg-background text-xs text-foreground border border-input shadow-sm focus:ring-1 focus:ring-green-500/30"
                >
                  {POLICY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Carrier *</label>
                <Input 
                  value={formData.carrier} 
                  onChange={e => handleInputChange("carrier", e.target.value)}
                  placeholder="e.g. Prudential, Mutual of Omaha" 
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Policy Number</label>
              <Input 
                value={formData.policyNumber} 
                onChange={e => handleInputChange("policyNumber", e.target.value)}
                placeholder="P-12345678" 
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Face Amount ($)</label>
                <Input 
                  value={formData.faceAmount} 
                  onChange={e => handleInputChange("faceAmount", e.target.value)}
                  placeholder="500,000" 
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Monthly Premium ($)</label>
                <Input 
                  value={formData.premiumAmount} 
                  onChange={e => handleInputChange("premiumAmount", e.target.value)}
                  placeholder="125.00" 
                  className={inputCls}
                />
              </div>
            </div>
          </div>

          <div className="h-px bg-border/50" />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-4">
              <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Dates</h4>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Issue Date</label>
                  <div className="flex items-center gap-2 px-3 h-9 rounded-lg bg-muted/20 border border-border shadow-sm group focus-within:ring-1 focus-within:ring-primary transition-all">
                    <Calendar className="w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                    <Input 
                      type="date"
                      value={formData.issueDate}
                      onChange={e => handleInputChange("issueDate", e.target.value)}
                      className="h-full text-xs border-none bg-transparent shadow-none p-0 focus-visible:ring-0"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Effective Date</label>
                  <div className="flex items-center gap-2 px-3 h-9 rounded-lg bg-muted/20 border border-border shadow-sm group focus-within:ring-1 focus-within:ring-primary transition-all">
                    <Calendar className="w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                    <Input 
                      type="date"
                      value={formData.effectiveDate}
                      onChange={e => handleInputChange("effectiveDate", e.target.value)}
                      className="h-full text-xs border-none bg-transparent shadow-none p-0 focus-visible:ring-0"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Beneficiary</h4>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Name</label>
                  <Input 
                    value={formData.beneficiaryName} 
                    onChange={e => handleInputChange("beneficiaryName", e.target.value)}
                    placeholder="Primary beneficiary" 
                    className="h-9 text-xs bg-muted/20 border-border"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Relationship</label>
                  <Input 
                    value={formData.beneficiaryRelationship} 
                    onChange={e => handleInputChange("beneficiaryRelationship", e.target.value)}
                    placeholder="e.g. Spouse" 
                    className="h-9 text-xs bg-muted/20 border-border"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="h-px bg-border/50" />

          {/* Notes */}
          <div>
            <label className={labelCls}>Internal Conversion Notes</label>
            <textarea 
              value={formData.notes} 
              onChange={e => handleInputChange("notes", e.target.value)}
              rows={2} 
              className="w-full min-h-[60px] px-3 py-2 rounded-md bg-background text-xs text-foreground border border-input shadow-sm focus:ring-1 focus:ring-green-500/30 resize-none"
              placeholder="Any details about the sale or next steps..."
            />
          </div>
        </div>

        <DialogFooter className="p-5 border-t border-border bg-muted/5 flex items-center justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading} className="h-9 px-4 text-[10px] font-bold uppercase text-muted-foreground hover:bg-muted transition-colors">
            CANCEL
          </Button>
          <Button 
            size="sm" 
            onClick={handleConvert} 
            disabled={loading}
            className="h-9 px-6 text-[10px] font-bold uppercase tracking-widest bg-green-600 shadow-lg shadow-green-600/20 hover:shadow-xl hover:translate-y-[-1px] transition-all flex items-center gap-2"
          >
            {loading && <Loader2 className="w-3 h-3 animate-spin" />}
            CONVERT LEAD
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ConvertLeadModal;
