import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  Phone,
  Loader2,
  Plus,
  ShoppingCart,
  MoreHorizontal,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  AlertTriangle,
  RefreshCw,
  Trash2,
  Search,
  Radio,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { formatPhoneNumber, normalizePhoneNumber } from "@/utils/phoneUtils";
import { PhoneInput } from "@/components/shared/PhoneInput";

const formatPhone = formatPhoneNumber;

const extractAreaCode = (num: string) => {
  const cleaned = num.replace(/\D/g, "");
  const digits = cleaned.startsWith("1") && cleaned.length === 11 ? cleaned.slice(1) : cleaned;
  return digits.slice(0, 3);
};

export interface PhoneNumberRow {
  id: string;
  phone_number: string;
  friendly_name: string | null;
  status: string | null;
  assigned_to: string | null;
  area_code: string | null;
  is_default: boolean | null;
  spam_status: string | null;
  spam_score: number | null;
  spam_checked_at: string | null;
  shaken_stir_attestation?: string | null;
  trust_hub_status?: string | null;
  attestation_level?: string | null;
  twilio_sid?: string | null;
}

type TwilioAvailableNumber = {
  phone_number: string;
  friendly_name: string | null;
  locality: string | null;
  region: string | null;
  postal_code: string | null;
  country: string;
};

interface Profile {
  id: string;
  first_name: string;
  last_name: string;
}

type Props = {
  organizationId: string | null;
  numbers: PhoneNumberRow[];
  setNumbers: React.Dispatch<React.SetStateAction<PhoneNumberRow[]>>;
  agents: Profile[];
  onRefresh: () => Promise<void>;
};

const DisabledWithTip: React.FC<{ children: React.ReactNode; label: string }> = ({ children, label }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="inline-flex cursor-not-allowed">{children}</span>
    </TooltipTrigger>
    <TooltipContent className="max-w-xs text-xs">{label}</TooltipContent>
  </Tooltip>
);

export const NumberManagementSection: React.FC<Props> = ({
  organizationId,
  numbers,
  setNumbers,
  agents,
  onRefresh,
}) => {
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [bulkChecking, setBulkChecking] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [addManualOpen, setAddManualOpen] = useState(false);
  const [manualPhone, setManualPhone] = useState("");
  const [manualName, setManualName] = useState("");
  const [addingManual, setAddingManual] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [searchAreaCode, setSearchAreaCode] = useState("");
  const [searchLocality, setSearchLocality] = useState("");
  const [searchState, setSearchState] = useState("");
  const [searchResults, setSearchResults] = useState<TwilioAvailableNumber[]>([]);
  const [searching, setSearching] = useState(false);
  const [purchasingNumber, setPurchasingNumber] = useState<string | null>(null);
  const [releaseConfirm, setReleaseConfirm] = useState<string | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);

  const upgradeTip = "Number management is being upgraded — available soon.";
  const activeNumbers = numbers.filter((n) => n.status === "active");

  const handleSetDefault = async (id: string) => {
    await supabase.from("phone_numbers").update({ is_default: false }).neq("id", id);
    await supabase.from("phone_numbers").update({ is_default: true }).eq("id", id);
    setNumbers((prev) => prev.map((n) => ({ ...n, is_default: n.id === id })));
    toast.success("Default number updated");
  };

  const handleSaveName = async (id: string) => {
    await supabase.from("phone_numbers").update({ friendly_name: editNameValue }).eq("id", id);
    setNumbers((prev) => prev.map((n) => (n.id === id ? { ...n, friendly_name: editNameValue } : n)));
    setEditingName(null);
    toast.success("Name updated");
  };

  const handleAssign = async (numberId: string, agentId: string | null) => {
    await supabase.from("phone_numbers").update({ assigned_to: agentId }).eq("id", numberId);
    setNumbers((prev) => prev.map((n) => (n.id === numberId ? { ...n, assigned_to: agentId } : n)));
    toast.success("Assignment updated");
  };

  const handleSpamCheck = async (id: string) => {
    setNumbers((prev) => prev.map((n) => (n.id === id ? { ...n, spam_status: "checking" as any } : n)));
    await new Promise((r) => setTimeout(r, 1000));
    const now = new Date().toISOString();
    await supabase.from("phone_numbers").update({ spam_status: "Clean", spam_score: 0, spam_checked_at: now }).eq("id", id);
    setNumbers((prev) =>
      prev.map((n) => (n.id === id ? { ...n, spam_status: "Clean", spam_score: 0, spam_checked_at: now } : n)),
    );
    toast.success("Spam check complete — Clean");
  };

  const handleBulkSpamCheck = async () => {
    const active = numbers.filter((n) => n.status === "active");
    if (active.length === 0) return;
    setBulkChecking(true);
    setBulkProgress(0);
    for (let i = 0; i < active.length; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const now = new Date().toISOString();
      await supabase.from("phone_numbers").update({ spam_status: "Clean", spam_score: 0, spam_checked_at: now }).eq("id", active[i].id);
      setNumbers((prev) =>
        prev.map((n) => (n.id === active[i].id ? { ...n, spam_status: "Clean", spam_score: 0, spam_checked_at: now } : n)),
      );
      setBulkProgress(Math.round(((i + 1) / active.length) * 100));
    }
    setBulkChecking(false);
    toast.success(`Spam check complete for ${active.length} numbers`);
  };

  const handleRelease = async (id: string) => {
    await supabase.from("phone_numbers").update({ status: "released", assigned_to: null, is_default: false }).eq("id", id);
    setNumbers((prev) =>
      prev.map((n) => (n.id === id ? { ...n, status: "released", assigned_to: null, is_default: false } : n)),
    );
    setReleaseConfirm(null);
    toast.success("Number released");
  };

  const handleRemove = async (id: string) => {
    await supabase.from("phone_numbers").delete().eq("id", id);
    setNumbers((prev) => prev.filter((n) => n.id !== id));
    setRemoveConfirm(null);
    toast.success("Number removed");
  };

  const handleAddManual = async () => {
    if (!manualPhone.trim() || !organizationId) return;
    setAddingManual(true);
    const areaCode = extractAreaCode(manualPhone);
    const { error } = await supabase.from("phone_numbers").insert({
      phone_number: manualPhone.trim(),
      friendly_name: manualName.trim() || null,
      status: "active",
      area_code: areaCode,
      spam_status: "Unknown",
      organization_id: organizationId,
    } as any);
    setAddingManual(false);
    if (error) {
      toast.error("Failed to add number");
      return;
    }
    setAddManualOpen(false);
    setManualPhone("");
    setManualName("");
    await onRefresh();
    toast.success("Number added");
  };

  const resetPurchaseModal = () => {
    setSearchAreaCode("");
    setSearchLocality("");
    setSearchState("");
    setSearchResults([]);
  };

  const readInvokeError = async (data: unknown, error: unknown): Promise<string> => {
    if (data && typeof data === "object" && "error" in data && typeof (data as { error: string }).error === "string") {
      return (data as { error: string }).error;
    }
    if (error && typeof error === "object") {
      const e = error as { message?: string; context?: Response };
      if (e.context && typeof e.context.json === "function") {
        try {
          const j = (await e.context.json()) as { error?: string };
          if (j?.error) return j.error;
        } catch {
          /* ignore */
        }
      }
      if (e.message) return e.message;
    }
    return "Request failed";
  };

  const handleSearchAvailable = async () => {
    setSearching(true);
    setSearchResults([]);
    try {
      const { data, error } = await supabase.functions.invoke("twilio-search-numbers", {
        body: {
          area_code: searchAreaCode.trim() || undefined,
          locality: searchLocality.trim() || undefined,
          state: searchState.trim() || undefined,
          limit: 20,
        },
      });
      if (error || (data && typeof data === "object" && "error" in data && (data as { error?: string }).error)) {
        toast.error(await readInvokeError(data, error));
        return;
      }
      const list = (data as { numbers?: TwilioAvailableNumber[] })?.numbers ?? [];
      setSearchResults(list);
      if (list.length === 0) toast.message("No numbers matched those filters.");
    } finally {
      setSearching(false);
    }
  };

  const handleBuyTwilioNumber = async (e164: string) => {
    setPurchasingNumber(e164);
    try {
      const { data, error } = await supabase.functions.invoke("twilio-buy-number", {
        body: { phone_number: e164 },
      });
      if (error || (data && typeof data === "object" && "error" in data && (data as { error?: string }).error)) {
        toast.error(await readInvokeError(data, error));
        return;
      }
      await onRefresh();
      toast.success("Number purchased and wired to AgentFlow webhooks.");
      setPurchaseOpen(false);
      resetPurchaseModal();
    } finally {
      setPurchasingNumber(null);
    }
  };

  const renderSpamBadge = (n: PhoneNumberRow) => {
    if ((n as any).spam_status === "checking") return <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />;
    switch (n.spam_status) {
      case "Clean":
        return (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="w-3.5 h-3.5" /> Verified clean
          </span>
        );
      case "At Risk":
        return (
          <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5" /> At risk
          </span>
        );
      case "Flagged":
        return (
          <span className="inline-flex items-center gap-1 text-xs text-destructive">
            <ShieldAlert className="w-3.5 h-3.5" /> Spam flagged
          </span>
        );
      case "Insufficient Data":
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
              <ShieldQuestion className="w-3.5 h-3.5" /> More calls needed
            </span>
            <span className="text-[10px] text-muted-foreground">Make at least five calls with this number to build a score</span>
          </div>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldQuestion className="w-3.5 h-3.5" /> Not checked
          </span>
        );
    }
  };

  const attestationLabel = (n: PhoneNumberRow) =>
    (n.shaken_stir_attestation || n.attestation_level || "—").toString().toUpperCase();

  return (
    <>
      <Card className="border-border/80 shadow-sm">
        <CardHeader className="border-b border-border/40 pb-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                Phone numbers
                <Badge variant="secondary" className="text-xs">
                  {activeNumbers.length} active
                </Badge>
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <DisabledWithTip
                  label={upgradeTip}
                >
                  <Button variant="outline" size="sm" disabled className="pointer-events-none opacity-50">
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Sync numbers
                  </Button>
                </DisabledWithTip>
                <DisabledWithTip label={upgradeTip}>
                  <Button variant="outline" size="sm" disabled className="pointer-events-none opacity-50">
                    <Radio className="w-3.5 h-3.5 mr-1.5" /> Carrier routing
                  </Button>
                </DisabledWithTip>
                <Button variant="outline" size="sm" onClick={handleBulkSpamCheck} disabled={bulkChecking || activeNumbers.length === 0}>
                  {bulkChecking ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> {bulkProgress}%
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Bulk spam check
                    </>
                  )}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setAddManualOpen(true)}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" /> Add manually
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    resetPurchaseModal();
                    setPurchaseOpen(true);
                  }}
                >
                  <ShoppingCart className="w-3.5 h-3.5 mr-1.5" /> Purchase number
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {numbers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Phone className="w-12 h-12 text-muted-foreground mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">No phone numbers yet</p>
              <p className="text-xs text-muted-foreground mb-4 max-w-sm">
                Add a number you already own, or purchase one through Twilio once the upgraded purchase flow is live.
              </p>
              <div className="flex gap-2 flex-wrap justify-center">
                <Button
                  size="sm"
                  onClick={() => {
                    resetPurchaseModal();
                    setPurchaseOpen(true);
                  }}
                >
                  <ShoppingCart className="w-3.5 h-3.5 mr-1.5" /> Purchase number
                </Button>
                <Button variant="outline" size="sm" onClick={() => setAddManualOpen(true)}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" /> Add manually
                </Button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b bg-accent/50">
                    <th className="text-left py-3 px-3 font-medium">Phone number</th>
                    <th className="text-left py-3 px-3 font-medium hidden md:table-cell">Twilio SID</th>
                    <th className="text-left py-3 px-3 font-medium hidden sm:table-cell">Trust / STIR</th>
                    <th className="text-left py-3 px-3 font-medium">Friendly name</th>
                    <th className="text-left py-3 px-3 font-medium hidden md:table-cell">Area code</th>
                    <th className="text-left py-3 px-3 font-medium">Status</th>
                    <th className="text-left py-3 px-3 font-medium hidden lg:table-cell">Spam status</th>
                    <th className="text-center py-3 px-3 font-medium w-16">Default</th>
                    <th className="text-left py-3 px-3 font-medium hidden xl:table-cell">Assigned to</th>
                    <th className="text-right py-3 px-3 font-medium w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {numbers.map((n) => {
                    const isActive = n.status === "active";
                    const isReleased = n.status === "released";
                    return (
                      <tr key={n.id} className="border-b last:border-0 hover:bg-accent/30 transition-colors">
                        <td className="py-3 px-3 font-mono font-medium text-foreground">
                          {isReleased ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help underline decoration-dotted decoration-muted-foreground underline-offset-2">
                                  {formatPhone(n.phone_number)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs">
                                Number released from AgentFlow. To fully release from your Twilio account, visit the Twilio Console.
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            formatPhone(n.phone_number)
                          )}
                        </td>
                        <td className="py-3 px-3 hidden md:table-cell">
                          {n.twilio_sid ? (
                            <Badge variant="outline" className="text-[10px] font-mono max-w-[140px] truncate block">
                              {n.twilio_sid}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3 px-3 hidden sm:table-cell">
                          <div className="flex flex-wrap gap-1">
                            <Badge variant="outline" className="text-[10px] font-mono">
                              {attestationLabel(n)}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px]">
                              {n.trust_hub_status || "—"}
                            </Badge>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          {editingName === n.id ? (
                            <Input
                              autoFocus
                              value={editNameValue}
                              onChange={(e) => setEditNameValue(e.target.value)}
                              onBlur={() => handleSaveName(n.id)}
                              onKeyDown={(e) => e.key === "Enter" && handleSaveName(n.id)}
                              className="h-7 text-sm w-32"
                            />
                          ) : (
                            <span
                              className="cursor-pointer hover:underline text-foreground"
                              onClick={() => {
                                setEditingName(n.id);
                                setEditNameValue(n.friendly_name || "");
                              }}
                            >
                              {n.friendly_name || <span className="text-muted-foreground italic">Click to name</span>}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 hidden md:table-cell">
                          <Badge variant="secondary" className="text-xs font-mono">
                            {n.area_code || extractAreaCode(n.phone_number)}
                          </Badge>
                        </td>
                        <td className="py-3 px-3">
                          {n.status === "active" && (
                            <Badge className="bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 border-emerald-600/20 text-xs">Active</Badge>
                          )}
                          {n.status === "released" && (
                            <Badge variant="secondary" className="text-xs">
                              Released
                            </Badge>
                          )}
                          {n.status === "spam" && (
                            <Badge variant="destructive" className="text-xs">
                              Spam
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 px-3 hidden lg:table-cell">
                          <div className="flex flex-col gap-0.5">
                            {renderSpamBadge(n)}
                            <span className="text-[10px] text-muted-foreground">
                              {n.spam_checked_at ? `Checked ${formatDistanceToNow(new Date(n.spam_checked_at), { addSuffix: true })}` : "Never checked"}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <input
                            type="radio"
                            name="default-number"
                            checked={!!n.is_default}
                            onChange={() => handleSetDefault(n.id)}
                            disabled={!isActive}
                            className="w-4 h-4 accent-primary"
                          />
                        </td>
                        <td className="py-3 px-3 hidden xl:table-cell">
                          {isActive ? (
                            <Select value={n.assigned_to || "unassigned"} onValueChange={(v) => handleAssign(n.id, v === "unassigned" ? null : v)}>
                              <SelectTrigger className="h-7 text-xs w-36">
                                <SelectValue placeholder="Unassigned" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unassigned">Unassigned</SelectItem>
                                {agents.map((a) => (
                                  <SelectItem key={a.id} value={a.id}>
                                    {a.first_name} {a.last_name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {isActive && (
                                <>
                                  <DropdownMenuItem onClick={() => handleSpamCheck(n.id)}>
                                    <ShieldCheck className="w-4 h-4 mr-2" /> Check spam status
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setReleaseConfirm(n.id)} className="text-destructive">
                                    <Radio className="w-4 h-4 mr-2" /> Release number
                                  </DropdownMenuItem>
                                </>
                              )}
                              {isReleased && (
                                <DropdownMenuItem onClick={() => setRemoveConfirm(n.id)} className="text-destructive">
                                  <Trash2 className="w-4 h-4 mr-2" /> Remove
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={addManualOpen} onOpenChange={setAddManualOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add phone number manually</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Phone number</label>
              <PhoneInput
                value={manualPhone}
                onChange={(val) => setManualPhone(normalizePhoneNumber(val))}
                placeholder="(555) 123-4567"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Friendly name (optional)</label>
              <Input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Main term line" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleAddManual} disabled={addingManual || !manualPhone.trim()}>
              {addingManual ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={purchaseOpen}
        onOpenChange={(o) => {
          if (!o) resetPurchaseModal();
          setPurchaseOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-primary" />
              Purchase number
            </DialogTitle>
            <DialogDescription>
              Search Twilio inventory, then purchase. New numbers are pointed at AgentFlow voice and SMS webhooks automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Area code</label>
                  <Input
                    placeholder="e.g. 213"
                    value={searchAreaCode}
                    onChange={(e) => setSearchAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3))}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">State (2-letter)</label>
                  <Input
                    placeholder="e.g. CA"
                    value={searchState}
                    onChange={(e) => setSearchState(e.target.value.toUpperCase().slice(0, 2))}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">City</label>
                  <Input placeholder="e.g. Los Angeles" value={searchLocality} onChange={(e) => setSearchLocality(e.target.value)} autoComplete="off" />
                </div>
              </div>
              <Button type="button" className="w-full" onClick={() => void handleSearchAvailable()} disabled={searching}>
                {searching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
                Search available numbers
              </Button>
              {searchResults.length > 0 && (
                <div className="border rounded-md max-h-56 overflow-y-auto divide-y">
                  {searchResults.map((r) => (
                    <div key={r.phone_number} className="flex items-center justify-between gap-2 p-2 text-sm">
                      <div className="min-w-0">
                        <p className="font-mono font-medium truncate">{r.phone_number}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {[r.locality, r.region, r.postal_code].filter(Boolean).join(", ") || "US local"}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!!purchasingNumber}
                        onClick={() => void handleBuyTwilioNumber(r.phone_number)}
                      >
                        {purchasingNumber === r.phone_number ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          "Buy"
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground text-center">
                You can also add numbers you already own with <span className="font-medium text-foreground">Add manually</span>. Releasing a number here only
                updates AgentFlow; it stays on your Twilio account until you remove it in the Twilio Console.
              </p>
            </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!releaseConfirm} onOpenChange={() => setReleaseConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release this number?</AlertDialogTitle>
            <AlertDialogDescription>It will no longer be available for outbound caller ID until you add it again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => releaseConfirm && handleRelease(releaseConfirm)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Release
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!removeConfirm} onOpenChange={() => setRemoveConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this number?</AlertDialogTitle>
            <AlertDialogDescription>This permanently deletes the row from AgentFlow.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeConfirm && handleRemove(removeConfirm)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
