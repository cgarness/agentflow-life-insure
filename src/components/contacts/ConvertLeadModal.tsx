import React, { useCallback, useEffect, useState } from "react";
import { Shield, Loader2, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lead } from "@/lib/types";
import {
  conversionSupabaseApi,
  type AdditionalPolicyPayload,
  type LeadConversionPayload,
} from "@/lib/supabase-conversion";
import { toast } from "sonner";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { PhoneInput } from "@/components/shared/PhoneInput";
import { DateInput } from "@/components/shared/DateInput";
import { normalizePhoneNumber } from "@/utils/phoneUtils";
import { supabase } from "@/integrations/supabase/client";

interface ConvertLeadModalProps {
  open: boolean;
  onClose: () => void;
  lead: Lead | null;
  onSuccess: (clientId: string) => void;
}

const POLICY_TYPES = ["Term", "Whole Life", "IUL", "Final Expense"];

type PolicyRow = {
  key: string;
  policyType: string;
  carrier: string;
  policyNumber: string;
  faceAmount: string;
  premiumAmount: string;
  issueDate: string;
  effectiveDate: string;
};

function newPolicyRow(): PolicyRow {
  return {
    key: crypto.randomUUID(),
    policyType: "Term",
    carrier: "",
    policyNumber: "",
    faceAmount: "",
    premiumAmount: "",
    issueDate: "",
    effectiveDate: "",
  };
}

const ConvertLeadModal: React.FC<ConvertLeadModalProps> = ({ open, onClose, lead, onSuccess }) => {
  const { organizationId } = useOrganization();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [carrierNames, setCarrierNames] = useState<string[]>([]);
  const [carriersLoading, setCarriersLoading] = useState(false);
  const [policies, setPolicies] = useState<PolicyRow[]>([newPolicyRow()]);
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [beneficiaryRelationship, setBeneficiaryRelationship] = useState("");
  const [beneficiaryPhone, setBeneficiaryPhone] = useState("");
  const [notes, setNotes] = useState("");

  const resetForm = useCallback(() => {
    setPolicies([newPolicyRow()]);
    setBeneficiaryName("");
    setBeneficiaryRelationship("");
    setBeneficiaryPhone("");
    setNotes("");
  }, []);

  useEffect(() => {
    if (!open) return;
    resetForm();
  }, [open, resetForm]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setCarriersLoading(true);
      try {
        const { data, error } = await supabase.from("carriers").select("name").order("name", { ascending: true });
        if (error) throw error;
        if (!cancelled) {
          const names = (data ?? []).map((r) => String(r.name ?? "").trim()).filter(Boolean);
          setCarrierNames(names);
        }
      } catch (e) {
        console.error("Error loading carriers for convert modal:", e);
        if (!cancelled) {
          setCarrierNames([]);
          toast.error("Could not load carriers from Settings. Add carriers under Settings → Carriers.");
        }
      } finally {
        if (!cancelled) setCarriersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!lead) return null;

  const updatePolicy = (key: string, patch: Partial<Omit<PolicyRow, "key">>) => {
    setPolicies((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  };

  const addPolicy = () => setPolicies((prev) => [...prev, newPolicyRow()]);

  const removePolicy = (key: string) => {
    setPolicies((prev) => (prev.length <= 1 ? prev : prev.filter((p) => p.key !== key)));
  };

  const handleConvert = async () => {
    for (let i = 0; i < policies.length; i++) {
      if (!policies[i].carrier.trim()) {
        toast.error(policies.length > 1 ? `Carrier is required for policy ${i + 1}` : "Carrier is required");
        return;
      }
    }

    const [primary, ...rest] = policies;
    const additionalPolicies: AdditionalPolicyPayload[] | undefined =
      rest.length > 0
        ? rest.map((p) => ({
            policyType: p.policyType,
            carrier: p.carrier.trim(),
            policyNumber: p.policyNumber.trim(),
            faceAmount: p.faceAmount,
            premiumAmount: p.premiumAmount,
            issueDate: p.issueDate || null,
            effectiveDate: p.effectiveDate || null,
          }))
        : undefined;

    const payload: LeadConversionPayload = {
      policyType: primary.policyType,
      carrier: primary.carrier.trim(),
      policyNumber: primary.policyNumber,
      faceAmount: primary.faceAmount,
      premiumAmount: primary.premiumAmount,
      issueDate: primary.issueDate,
      effectiveDate: primary.effectiveDate,
      beneficiaryName,
      beneficiaryRelationship,
      beneficiaryPhone,
      notes,
      additionalPolicies,
    };

    setLoading(true);
    try {
      const clientId = await conversionSupabaseApi.convertLeadToClient(lead, payload, organizationId);

      window.dispatchEvent(
        new CustomEvent("win-celebration", {
          detail: {
            id: clientId,
            agent_name: profile ? `${profile.first_name} ${profile.last_name}` : "An agent",
            contact_name: `${lead.firstName} ${lead.lastName}`,
            campaign_name: null,
            created_at: new Date().toISOString(),
          },
        })
      );

      toast.success(`${lead.firstName} ${lead.lastName} converted to client!`);
      onSuccess(clientId);
      onClose();
    } catch (err: unknown) {
      console.error("Conversion error:", err);
      const message = err instanceof Error ? err.message : "Failed to convert lead to client";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "h-9 text-xs shadow-sm bg-background border-border placeholder:text-muted-foreground/50";
  const labelCls = "text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block";
  const selectCls =
    "w-full h-9 px-3 rounded-md bg-background text-xs text-foreground border border-input shadow-sm focus:ring-1 focus:ring-green-500/30";

  return (
    <Dialog open={open} onOpenChange={(val) => !val && !loading && onClose()}>
      <DialogContent className="sm:max-w-[520px] w-[95vw] max-h-[90vh] flex flex-col p-0 overflow-hidden border-none shadow-2xl bg-card rounded-xl">
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
          {policies.map((row, index) => (
            <div key={row.key} className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[11px] font-bold text-foreground/80 uppercase tracking-wider flex items-center gap-2 min-w-0">
                  <span className="w-1 h-3 bg-green-500 rounded-full shrink-0" />
                  <span className="truncate">
                    Policy {index + 1}
                    {policies.length > 1 ? ` of ${policies.length}` : ""}
                  </span>
                </h4>
                <div className="flex items-center gap-1 shrink-0">
                  {index === 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 border-green-500/30 text-green-700 hover:bg-green-500/10"
                      onClick={addPolicy}
                      disabled={loading}
                      title="Add another policy"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  )}
                  {policies.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => removePolicy(row.key)}
                      disabled={loading}
                      title="Remove this policy"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Policy Type</label>
                  <select
                    value={row.policyType}
                    onChange={(e) => updatePolicy(row.key, { policyType: e.target.value })}
                    className={selectCls}
                  >
                    {POLICY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Carrier *</label>
                  <select
                    value={row.carrier}
                    onChange={(e) => updatePolicy(row.key, { carrier: e.target.value })}
                    className={selectCls}
                    disabled={carriersLoading}
                  >
                    <option value="">{carriersLoading ? "Loading carriers…" : "Select carrier…"}</option>
                    {carrierNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  {index === 0 && !carriersLoading && carrierNames.length === 0 && (
                    <p className="text-[10px] text-muted-foreground mt-1">Add carriers under Settings → Carriers.</p>
                  )}
                </div>
              </div>
              <div>
                <label className={labelCls}>Policy Number</label>
                <Input
                  value={row.policyNumber}
                  onChange={(e) => updatePolicy(row.key, { policyNumber: e.target.value })}
                  placeholder="P-12345678"
                  className={inputCls}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Face Amount ($)</label>
                  <Input
                    value={row.faceAmount}
                    onChange={(e) => updatePolicy(row.key, { faceAmount: e.target.value })}
                    placeholder="500,000"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Monthly Premium ($)</label>
                  <Input
                    value={row.premiumAmount}
                    onChange={(e) => updatePolicy(row.key, { premiumAmount: e.target.value })}
                    placeholder="125.00"
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="space-y-3">
                <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Dates</h4>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Issue Date</label>
                  <DateInput value={row.issueDate} onChange={(val) => updatePolicy(row.key, { issueDate: val })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Effective Date</label>
                  <DateInput value={row.effectiveDate} onChange={(val) => updatePolicy(row.key, { effectiveDate: val })} />
                </div>
              </div>
              {index < policies.length - 1 && <div className="h-px bg-border/50" />}
            </div>
          ))}

          <div className="h-px bg-border/50" />

          <div className="space-y-3">
            <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Beneficiary</h4>
            <p className="text-[10px] text-muted-foreground -mt-1">Saved on the client once (covers all policies on this conversion).</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Name</label>
                <Input
                  value={beneficiaryName}
                  onChange={(e) => setBeneficiaryName(e.target.value)}
                  placeholder="Primary beneficiary"
                  className="h-9 text-xs bg-muted/20 border-border"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Relationship</label>
                <Input
                  value={beneficiaryRelationship}
                  onChange={(e) => setBeneficiaryRelationship(e.target.value)}
                  placeholder="e.g. Spouse"
                  className="h-9 text-xs bg-muted/20 border-border"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Beneficiary Phone</label>
              <PhoneInput
                value={beneficiaryPhone}
                onChange={(val) => setBeneficiaryPhone(normalizePhoneNumber(val))}
                placeholder="(555)555-5555"
                className="h-9 text-xs bg-muted/20 border-border"
              />
            </div>
          </div>

          <div className="h-px bg-border/50" />

          <div>
            <label className={labelCls}>Internal Conversion Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full min-h-[60px] px-3 py-2 rounded-md bg-background text-xs text-foreground border border-input shadow-sm focus:ring-1 focus:ring-green-500/30 resize-none"
              placeholder="Any details about the sale or next steps..."
            />
          </div>
        </div>

        <DialogFooter className="p-5 border-t border-border bg-muted/5 flex items-center justify-end gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={loading}
            className="h-9 px-4 text-[10px] font-bold uppercase text-muted-foreground hover:bg-muted transition-colors"
          >
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
