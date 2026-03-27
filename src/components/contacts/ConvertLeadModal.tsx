import React, { useState } from "react";
import { X, ArrowRight, Shield, Check, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lead } from "@/lib/types";
import { conversionSupabaseApi } from "@/lib/supabase-conversion";
import { toast } from "sonner";
import { useOrganization } from "@/hooks/useOrganization";

interface ConvertLeadModalProps {
  open: boolean;
  onClose: () => void;
  lead: Lead | null;
  onSuccess: (clientId: string) => void;
}

const POLICY_TYPES = ["Term", "Whole Life", "IUL", "Final Expense"];

const ConvertLeadModal: React.FC<ConvertLeadModalProps> = ({ open, onClose, lead, onSuccess }) => {
  const { organizationId } = useOrganization();
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
  const labelCls = "text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1 mb-1 block";

  return (
    <Dialog open={open} onOpenChange={(val) => !val && !loading && onClose()}>
      <DialogContent className="sm:max-w-[500px] w-[95vw] p-0 overflow-hidden border-none shadow-2xl bg-card z-[110] rounded-xl">
        <DialogHeader className="p-4 border-b border-border bg-green-500/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center text-green-600">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold tracking-tight">Convert to Client</DialogTitle>
              <DialogDescription className="text-muted-foreground text-[11px] -mt-0.5">
                Closing the sale for {lead.firstName} {lead.lastName}. Enter policy details below.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5 space-y-5 max-h-[85vh] overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20">
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

          {/* Dates & Beneficiary */}
          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-3">
              <h4 className="text-[11px] font-bold text-foreground/80 uppercase tracking-wider">Dates</h4>
              <div>
                <label className={labelCls}>Issue Date</label>
                <Input 
                  type="date"
                  value={formData.issueDate} 
                  onChange={e => handleInputChange("issueDate", e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Effective Date</label>
                <Input 
                  type="date"
                  value={formData.effectiveDate} 
                  onChange={e => handleInputChange("effectiveDate", e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
            <div className="space-y-3">
              <h4 className="text-[11px] font-bold text-foreground/80 uppercase tracking-wider">Beneficiary</h4>
              <div>
                <label className={labelCls}>Name</label>
                <Input 
                  value={formData.beneficiaryName} 
                  onChange={e => handleInputChange("beneficiaryName", e.target.value)}
                  placeholder="Primary beneficiary" 
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Relationship</label>
                <Input 
                  value={formData.beneficiaryRelationship} 
                  onChange={e => handleInputChange("beneficiaryRelationship", e.target.value)}
                  placeholder="e.g. Spouse, Child" 
                  className={inputCls}
                />
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

        <DialogFooter className="p-4 border-t border-border bg-muted/10">
          <div className="flex items-center justify-end gap-3 w-full">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onClose} 
              disabled={loading}
              className="h-9 px-4 text-xs font-bold uppercase text-muted-foreground"
            >
              Cancel
            </Button>
            <Button 
              size="sm" 
              onClick={handleConvert}
              disabled={loading}
              className="h-9 px-6 text-xs font-bold uppercase tracking-widest bg-green-600 hover:bg-green-700 text-white shadow-lg transition-all flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4" /> Convert Lead</>}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ConvertLeadModal;
