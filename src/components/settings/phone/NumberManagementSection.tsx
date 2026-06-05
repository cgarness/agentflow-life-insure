import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Phone, Loader2, ShoppingCart, MoreHorizontal, Radio, Trash2, Search, X, Route, PhoneCall, ShieldCheck, ShieldAlert } from "lucide-react";
import { PhoneNumberRoutingModal } from "./PhoneNumberRoutingModal";
import { PhoneNumberRoleModal } from "./PhoneNumberRoleModal";
import { formatPhoneNumber } from "@/utils/phoneUtils";
import { useAuth } from "@/contexts/AuthContext";
import { logActivity } from "@/lib/activityLogger";
import { toggleDirectLine } from "./numberGroupMutations";
import { numberSearchSchema } from "./numberSearchSchema";
import type { NumberGroupRow, NumberGroupMemberRow } from "./usePhoneSettingsController";

const formatPhone = formatPhoneNumber;

/** Display-only estimate shown in the purchase UI (Twilio bills separately). */
const TWILIO_NUMBER_PRICE_USD = 3;

const ADMIN_TOOLTIP = "Admin access required to manage phone numbers.";

// Outbound role is controlled by phone_numbers.assignment_type (invariant #18). Enforcement is live
// in caller-ID selection; admins can change the role here, non-admins see an accurate read-only badge.
const AGENCY_ROLE_TOOLTIP =
  "Shared outbound pool. Eligible for automatic local-presence and dialer rotation.";
const PERSONAL_ROLE_TOOLTIP =
  "Owner-only manual caller ID. Excluded from automatic rotation.";

export interface PhoneNumberRow {
  id: string;
  phone_number: string;
  friendly_name: string | null;
  status: string | null;
  assigned_to: string | null;
  assignment_type?: string | null;
  area_code: string | null;
  is_default: boolean | null;
  spam_status: string | null;
  spam_score: number | null;
  spam_checked_at: string | null;
  shaken_stir_attestation?: string | null;
  trust_hub_status?: string | null;
  attestation_level?: string | null;
  twilio_sid?: string | null;
  inbound_routing_mode?: string | null;
  voicemail_enabled?: boolean | null;
  fallback_action?: string | null;
  voicemail_greeting_text?: string | null;
  forwarding_number?: string | null;
  is_direct_line?: boolean | null;
  voicemail_greeting_url?: string | null;
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
  groups: NumberGroupRow[];
  groupMembers: NumberGroupMemberRow[];
  onRefresh: () => Promise<void>;
};

export const NumberManagementSection: React.FC<Props> = ({ organizationId, numbers, setNumbers, agents, groups, groupMembers, onRefresh }) => {
  const { user, profile } = useAuth();
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [searchAreaCode, setSearchAreaCode] = useState("");
  const [searchLocality, setSearchLocality] = useState("");
  const [searchState, setSearchState] = useState("");
  const [searchResults, setSearchResults] = useState<TwilioAvailableNumber[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchValidationError, setSearchValidationError] = useState<string | null>(null);
  const [purchasingNumber, setPurchasingNumber] = useState<string | null>(null);
  const [purchasingBatch, setPurchasingBatch] = useState(false);
  const [purchaseCart, setPurchaseCart] = useState<TwilioAvailableNumber[]>([]);
  const [cartDetailOpen, setCartDetailOpen] = useState(false);
  const [releaseConfirm, setReleaseConfirm] = useState<string | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);
  const [routingModalTarget, setRoutingModalTarget] = useState<PhoneNumberRow | null>(null);
  const [roleModalTarget, setRoleModalTarget] = useState<PhoneNumberRow | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [savingNameId, setSavingNameId] = useState<string | null>(null);

  const canManageNumbers =
    profile?.role === "Admin" ||
    profile?.is_super_admin === true;

  const activeNumbers = numbers.filter((n) => n.status === "active");

  const releaseTarget = releaseConfirm ? numbers.find((n) => n.id === releaseConfirm) : null;

  const handleSetDefault = async (id: string) => {
    if (!organizationId) { toast.error("Missing organization context."); return; }
    if (settingDefaultId) return;
    const target = numbers.find((n) => n.id === id);
    if (target && target.status !== "active") {
      toast.error("Only active numbers can be set as default.");
      return;
    }
    if (target?.assignment_type === "personal") {
      toast.error(
        "Personal numbers cannot be default caller IDs because they are owner-only and excluded from automatic rotation.",
      );
      return;
    }
    setSettingDefaultId(id);
    try {
      const { error: clearErr } = await supabase
        .from("phone_numbers")
        .update({ is_default: false })
        .neq("id", id)
        .eq("organization_id", organizationId)
        .eq("is_default", true);
      if (clearErr) {
        toast.error(`Could not update default: ${clearErr.message}`);
        return;
      }
      const { error: setErr } = await supabase
        .from("phone_numbers")
        .update({ is_default: true })
        .eq("id", id)
        .eq("organization_id", organizationId);
      if (setErr) {
        if (setErr.message?.includes("idx_phone_numbers_one_default_per_org") || setErr.code === "23505") {
          toast.error("Another number is already the default. Refresh and try again.");
        } else {
          toast.error(`Could not set default: ${setErr.message}`);
        }
        await onRefresh();
        return;
      }
      setNumbers((prev) => prev.map((n) => ({ ...n, is_default: n.id === id })));
      toast.success("Default number updated");
      void logActivity({
        action: `Set default number to ${target?.phone_number ?? id}`,
        category: "telephony",
        organizationId,
        userId: user?.id,
        userName: profile ? `${profile.first_name} ${profile.last_name}` : undefined,
      });
    } finally {
      setSettingDefaultId(null);
    }
  };

  const handleSaveName = async (id: string) => {
    if (!organizationId) { toast.error("Missing organization context."); return; }
    if (savingNameId) return;
    setSavingNameId(id);
    try {
      const { error } = await supabase.from("phone_numbers").update({ friendly_name: editNameValue }).eq("id", id).eq("organization_id", organizationId);
      if (error) {
        toast.error(`Could not save name: ${error.message}`);
        return;
      }
      setNumbers((prev) => prev.map((n) => (n.id === id ? { ...n, friendly_name: editNameValue } : n)));
      setEditingName(null);
      toast.success("Name updated");
    } finally {
      setSavingNameId(null);
    }
  };

  const handleAssign = async (numberId: string, agentId: string | null) => {
    if (!organizationId) {
      toast.error("Missing organization context. Refresh and try again.");
      return;
    }
    if (agentId && !agents.some((a) => a.id === agentId)) {
      toast.error("That user is not in your organization.");
      return;
    }
    const current = numbers.find((n) => n.id === numberId);
    if (agentId === null && current?.assignment_type === "personal") {
      toast.error(
        "Personal numbers must have an assigned owner. Change this number back to Agency before clearing assignment.",
      );
      return;
    }
    const clearDirect = agentId === null && current?.is_direct_line === true;
    const patch: Record<string, unknown> = { assigned_to: agentId };
    if (clearDirect) patch.is_direct_line = false;

    const { error } = await supabase
      .from("phone_numbers")
      .update(patch)
      .eq("id", numberId)
      .eq("organization_id", organizationId);
    if (error) {
      toast.error(`Assignment failed: ${error.message}`);
      return;
    }
    setNumbers((prev) =>
      prev.map((n) =>
        n.id === numberId ? { ...n, assigned_to: agentId, ...(clearDirect ? { is_direct_line: false } : {}) } : n,
      ),
    );
    const agentName = agentId ? agents.find((a) => a.id === agentId) : null;
    const label = agentName ? `${agentName.first_name} ${agentName.last_name}` : "Unassigned";
    toast.success(clearDirect ? "Direct line cleared (no agent)" : "Assignment updated");
    void logActivity({
      action: agentId
        ? `Assigned ${current?.phone_number ?? numberId} to ${label}`
        : `Unassigned ${current?.phone_number ?? numberId}`,
      category: "telephony",
      organizationId,
      userId: user?.id,
      userName: profile ? `${profile.first_name} ${profile.last_name}` : undefined,
    });
  };

  const handleToggleDirectLine = async (n: PhoneNumberRow, next: boolean) => {
    if (next && !n.assigned_to) {
      toast.error("Assign an agent before marking as a direct line");
      return;
    }
    const { error } = await toggleDirectLine(n.id, next, organizationId ?? undefined);
    if (error) {
      toast.error(`Failed: ${error}`);
      return;
    }
    setNumbers((prev) => prev.map((row) => (row.id === n.id ? { ...row, is_direct_line: next } : row)));
    await onRefresh();
    toast.success(next ? "Marked as direct line" : "Direct line cleared");
    void logActivity({
      action: next
        ? `Enabled direct line on ${n.phone_number}`
        : `Disabled direct line on ${n.phone_number}`,
      category: "telephony",
      organizationId: organizationId ?? "",
      userId: user?.id,
      userName: profile ? `${profile.first_name} ${profile.last_name}` : undefined,
    });
  };

  const handleRelease = async (id: string) => {
    if (!organizationId) { toast.error("Missing organization context."); return; }
    if (releasingId) return;
    setReleasingId(id);
    try {
      const { error } = await supabase
        .from("phone_numbers")
        .update({ status: "released", assigned_to: null, is_default: false, is_direct_line: false })
        .eq("id", id)
        .eq("organization_id", organizationId);
      if (error) {
        toast.error(`Release failed: ${error.message}`);
        return;
      }
      await supabase
        .from("number_group_members")
        .delete()
        .eq("phone_number_id", id);
      const releasedNumber = numbers.find((n) => n.id === id);
      setNumbers((prev) =>
        prev.map((n) =>
          n.id === id
            ? { ...n, status: "released", assigned_to: null, is_default: false, is_direct_line: false }
            : n,
        ),
      );
      setReleaseConfirm(null);
      await onRefresh();
      toast.success("Number released from AgentFlow");
      void logActivity({
        action: `Released number ${releasedNumber?.phone_number ?? id} from AgentFlow`,
        category: "telephony",
        organizationId,
        userId: user?.id,
        userName: profile ? `${profile.first_name} ${profile.last_name}` : undefined,
      });
    } finally {
      setReleasingId(null);
    }
  };

  const handleRemove = async (id: string) => {
    if (!organizationId) { toast.error("Missing organization context."); return; }
    if (removingId) return;
    setRemovingId(id);
    try {
      const removedNumber = numbers.find((n) => n.id === id);
      const { error } = await supabase.from("phone_numbers").delete().eq("id", id).eq("organization_id", organizationId);
      if (error) {
        toast.error(`Remove failed: ${error.message}`);
        return;
      }
      setNumbers((prev) => prev.filter((n) => n.id !== id));
      setRemoveConfirm(null);
      toast.success("Number removed from AgentFlow");
      void logActivity({
        action: `Removed released number ${removedNumber?.phone_number ?? id} from AgentFlow`,
        category: "telephony",
        organizationId,
        userId: user?.id,
        userName: profile ? `${profile.first_name} ${profile.last_name}` : undefined,
      });
    } finally {
      setRemovingId(null);
    }
  };

  const resetPurchaseModal = () => {
    setSearchAreaCode("");
    setSearchLocality("");
    setSearchState("");
    setSearchResults([]);
    setPurchaseCart([]);
    setCartDetailOpen(false);
    setPurchasingBatch(false);
    setSearchValidationError(null);
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
    const result = numberSearchSchema.safeParse({
      areaCode: searchAreaCode,
      state: searchState,
      locality: searchLocality,
    });
    if (!result.success) {
      const msg = result.error.issues[0]?.message ?? "Invalid search filters.";
      setSearchValidationError(msg);
      return;
    }
    setSearchValidationError(null);
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

  /** City + state from Twilio inventory row for default friendly name (still editable in the table). */
  const defaultFriendlyFromListing = (r: TwilioAvailableNumber): string | undefined => {
    const city = r.locality?.trim();
    const st = r.region?.trim();
    if (city && st) return `${city}, ${st}`;
    if (city) return city;
    if (st) return st;
    return undefined;
  };

  /** Purchase one number via Edge function; returns whether Twilio + DB succeeded. */
  const purchaseSingleNumber = async (e164: string, listing?: TwilioAvailableNumber): Promise<boolean> => {
    const { data, error } = await supabase.functions.invoke("twilio-buy-number", {
      body: {
        phone_number: e164,
        friendly_name: listing ? defaultFriendlyFromListing(listing) : undefined,
        locality: listing?.locality,
        region: listing?.region,
      },
    });
    if (error || (data && typeof data === "object" && "error" in data && (data as { error?: string }).error)) {
      toast.error(await readInvokeError(data, error));
      return false;
    }
    return true;
  };

  const addToCart = (r: TwilioAvailableNumber) => {
    setPurchaseCart((prev) => {
      if (prev.some((x) => x.phone_number === r.phone_number)) return prev;
      return [...prev, r];
    });
    toast.success("Added to cart");
  };

  const removeFromCart = (e164: string) => {
    setPurchaseCart((prev) => prev.filter((x) => x.phone_number !== e164));
  };

  const handleCheckoutCart = async () => {
    if (purchaseCart.length === 0) return;
    setPurchasingBatch(true);
    const queue = [...purchaseCart];
    const failed: TwilioAvailableNumber[] = [];
    for (const item of queue) {
      setPurchasingNumber(item.phone_number);
      const ok = await purchaseSingleNumber(item.phone_number, item);
      if (!ok) failed.push(item);
    }
    setPurchasingNumber(null);
    setPurchasingBatch(false);
    setPurchaseCart(failed);
    await onRefresh();
    const purchasedCount = queue.length - failed.length;
    if (purchasedCount > 0) {
      const purchasedNumbers = queue
        .filter((item) => !failed.some((f) => f.phone_number === item.phone_number))
        .map((item) => item.phone_number);
      toast.success(
        failed.length === 0
          ? `Purchased ${purchasedCount} number(s).`
          : `${purchasedCount} purchased; ${failed.length} still in cart — fix issues and try again.`,
      );
      void logActivity({
        action: purchasedCount === 1
          ? `Purchased phone number ${purchasedNumbers[0]}`
          : `Purchased ${purchasedCount} phone numbers`,
        category: "telephony",
        organizationId: organizationId ?? "",
        userId: user?.id,
        userName: profile ? `${profile.first_name} ${profile.last_name}` : undefined,
        metadata: { phoneNumbers: purchasedNumbers, failedCount: failed.length },
      });
    }
    if (failed.length === 0) {
      setCartDetailOpen(false);
      setPurchaseOpen(false);
      resetPurchaseModal();
    }
  };

  const cartTotalUsd = purchaseCart.length * TWILIO_NUMBER_PRICE_USD;

  const hasAnyFilter =
    searchAreaCode.trim().length > 0 ||
    searchState.trim().length > 0 ||
    searchLocality.trim().length > 0;

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
              {canManageNumbers && (
                <Button
                  size="sm"
                  onClick={() => {
                    resetPurchaseModal();
                    setPurchaseOpen(true);
                  }}
                >
                  <ShoppingCart className="w-3.5 h-3.5 mr-1.5" /> Purchase number
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {numbers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Phone className="w-12 h-12 text-muted-foreground mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">No phone numbers yet</p>
              <p className="text-xs text-muted-foreground mb-4 max-w-sm">
                Purchase a number from Twilio to use it for outbound caller ID and inbound routing.
              </p>
              {canManageNumbers && (
                <Button
                  size="sm"
                  onClick={() => {
                    resetPurchaseModal();
                    setPurchaseOpen(true);
                  }}
                >
                  <ShoppingCart className="w-3.5 h-3.5 mr-1.5" /> Purchase number
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-foreground">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-3 text-left">Phone number</th>
                    <th className="px-3 py-3 text-left">Friendly name</th>
                    <th className="px-3 py-3 text-left">Status</th>
                    <th className="w-16 px-3 py-3 text-center">Default</th>
                    <th className="min-w-[9rem] px-3 py-3 text-left">Assigned to</th>
                    <th className="w-24 px-3 py-3 text-center">Direct line</th>
                    <th className="min-w-[10rem] px-3 py-3 text-left">Groups</th>
                    <th className="w-12 px-3 py-3 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {numbers.map((n) => {
                    const isActive = n.status === "active";
                    const isReleased = n.status === "released";
                    const isDirect = n.is_direct_line === true;
                    const isPersonalNumber = n.assignment_type === "personal";
                    const memberGroups = groupMembers
                      .filter((m) => m.phone_number_id === n.id)
                      .map((m) => groups.find((g) => g.id === m.number_group_id))
                      .filter((g): g is NumberGroupRow => !!g);
                    return (
                      <tr key={n.id} className="border-b border-border/60 last:border-0 transition-colors hover:bg-muted/30">
                        <td className="px-3 py-3.5 font-mono font-medium text-foreground">
                          <div className="flex items-center gap-1.5">
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
                              <span>{formatPhone(n.phone_number)}</span>
                            )}
                            {isDirect && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <PhoneCall className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Direct line" />
                                </TooltipTrigger>
                                <TooltipContent className="text-xs">Direct line</TooltipContent>
                              </Tooltip>
                            )}
                            {n.trust_hub_status === "approved" && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label="Trust Hub approved" />
                                </TooltipTrigger>
                                <TooltipContent className="text-xs">Trust Hub approved</TooltipContent>
                              </Tooltip>
                            )}
                            {n.trust_hub_status && n.trust_hub_status !== "approved" && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label={`Trust Hub: ${n.trust_hub_status}`} />
                                </TooltipTrigger>
                                <TooltipContent className="text-xs">Trust Hub: {n.trust_hub_status}</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3.5">
                          {editingName === n.id ? (
                            <Input
                              autoFocus
                              value={editNameValue}
                              onChange={(e) => setEditNameValue(e.target.value)}
                              onBlur={() => void handleSaveName(n.id)}
                              onKeyDown={(e) => e.key === "Enter" && void handleSaveName(n.id)}
                              className="h-7 text-sm w-32"
                              disabled={!!savingNameId}
                            />
                          ) : canManageNumbers ? (
                            <span
                              className="cursor-pointer hover:underline text-foreground"
                              onClick={() => {
                                setEditingName(n.id);
                                setEditNameValue(n.friendly_name || "");
                              }}
                            >
                              {n.friendly_name || <span className="text-muted-foreground italic">Click to name</span>}
                            </span>
                          ) : (
                            <span className="text-foreground">
                              {n.friendly_name || <span className="text-muted-foreground italic">—</span>}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3.5">
                          {n.status === "active" && (
                            <Badge className="border-emerald-600/20 bg-emerald-600/10 text-xs text-emerald-700 dark:text-emerald-400">Active</Badge>
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
                          {n.status && !["active", "released", "spam"].includes(n.status) && (
                            <Badge variant="outline" className="text-xs capitalize">
                              {n.status}
                            </Badge>
                          )}
                          {!n.status && (
                            <Badge variant="outline" className="text-xs">
                              Unknown
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          {canManageNumbers ? (
                            settingDefaultId === n.id ? (
                              <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                            ) : (
                              <input
                                type="radio"
                                name="default-number"
                                checked={!!n.is_default}
                                onChange={() => void handleSetDefault(n.id)}
                                disabled={!isActive || isPersonalNumber || !!settingDefaultId}
                                title={isPersonalNumber ? "Personal numbers cannot be the default caller ID." : undefined}
                                className="w-4 h-4 accent-primary disabled:cursor-not-allowed"
                              />
                            )
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <input
                                  type="radio"
                                  name="default-number"
                                  checked={!!n.is_default}
                                  readOnly
                                  disabled
                                  className="w-4 h-4 accent-primary cursor-not-allowed"
                                />
                              </TooltipTrigger>
                              <TooltipContent className="text-xs">{ADMIN_TOOLTIP}</TooltipContent>
                            </Tooltip>
                          )}
                        </td>
                        <td className="px-3 py-3.5">
                          <div className="flex flex-col gap-1.5">
                            {isActive ? (
                              canManageNumbers ? (
                                <Select value={n.assigned_to || "unassigned"} onValueChange={(v) => handleAssign(n.id, v === "unassigned" ? null : v)}>
                                  <SelectTrigger className="h-8 w-40 border-border/70 bg-background text-xs">
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
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-xs text-foreground cursor-not-allowed">
                                      {n.assigned_to
                                        ? agents.find((a) => a.id === n.assigned_to)
                                          ? `${agents.find((a) => a.id === n.assigned_to)!.first_name} ${agents.find((a) => a.id === n.assigned_to)!.last_name}`
                                          : "Assigned"
                                        : "Unassigned"}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent className="text-xs">{ADMIN_TOOLTIP}</TooltipContent>
                                </Tooltip>
                              )
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                            {isActive && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  {canManageNumbers ? (
                                    <button
                                      type="button"
                                      onClick={() => setRoleModalTarget(n)}
                                      className="inline-flex w-fit cursor-pointer rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                      aria-label="Change outbound role"
                                    >
                                      {isPersonalNumber ? (
                                        <Badge className="border-primary/30 bg-primary/10 text-[10px] font-medium uppercase tracking-wide text-primary hover:bg-primary/20">
                                          Personal
                                        </Badge>
                                      ) : (
                                        <Badge variant="secondary" className="text-[10px] font-medium uppercase tracking-wide hover:bg-secondary/80">
                                          Agency
                                        </Badge>
                                      )}
                                    </button>
                                  ) : (
                                    <span className="inline-flex w-fit cursor-default">
                                      {isPersonalNumber ? (
                                        <Badge className="border-primary/30 bg-primary/10 text-[10px] font-medium uppercase tracking-wide text-primary">
                                          Personal
                                        </Badge>
                                      ) : (
                                        <Badge variant="secondary" className="text-[10px] font-medium uppercase tracking-wide">
                                          Agency
                                        </Badge>
                                      )}
                                    </span>
                                  )}
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs text-xs">
                                  {isPersonalNumber ? PERSONAL_ROLE_TOOLTIP : AGENCY_ROLE_TOOLTIP}
                                  {canManageNumbers && " Click to change role."}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          {isActive ? (
                            canManageNumbers ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex">
                                    <Switch
                                      checked={isDirect}
                                      onCheckedChange={(v) => void handleToggleDirectLine(n, v === true)}
                                      aria-label="Direct line"
                                    />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs text-xs">
                                  {n.assigned_to
                                    ? "Direct lines ring the assigned agent only and are excluded from groups."
                                    : "Assign an agent before marking as a direct line."}
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex">
                                    <Switch
                                      checked={isDirect}
                                      disabled
                                      aria-label="Direct line"
                                    />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="text-xs">{ADMIN_TOOLTIP}</TooltipContent>
                              </Tooltip>
                            )
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3.5">
                          {!isActive ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : isDirect ? (
                            <Badge className="border-primary/30 bg-primary/10 text-[10px] font-medium uppercase tracking-wide text-primary">
                              Direct Line
                            </Badge>
                          ) : memberGroups.length === 0 ? (
                            <span className="text-xs text-muted-foreground italic">No groups</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {memberGroups.slice(0, 3).map((g) => (
                                <Badge key={g.id} variant="secondary" className="text-[10px] font-medium">
                                  {g.name}
                                </Badge>
                              ))}
                              {memberGroups.length > 3 && (
                                <Badge variant="outline" className="text-[10px]">
                                  +{memberGroups.length - 3}
                                </Badge>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3.5 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {isActive && (
                                <>
                                  <DropdownMenuItem onClick={() => setRoutingModalTarget(n)}>
                                    <Route className="w-4 h-4 mr-2" /> Inbound routing
                                  </DropdownMenuItem>
                                  {canManageNumbers ? (
                                    <DropdownMenuItem onClick={() => setReleaseConfirm(n.id)} className="text-destructive">
                                      <Radio className="w-4 h-4 mr-2" /> Release number
                                    </DropdownMenuItem>
                                  ) : (
                                    <DropdownMenuItem disabled className="text-muted-foreground">
                                      <Radio className="w-4 h-4 mr-2" /> Release number
                                    </DropdownMenuItem>
                                  )}
                                </>
                              )}
                              {isReleased && (
                                canManageNumbers ? (
                                  <DropdownMenuItem onClick={() => setRemoveConfirm(n.id)} className="text-destructive">
                                    <Trash2 className="w-4 h-4 mr-2" /> Remove
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem disabled className="text-muted-foreground">
                                    <Trash2 className="w-4 h-4 mr-2" /> Remove
                                  </DropdownMenuItem>
                                )
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

      <Dialog
        open={purchaseOpen}
        onOpenChange={(o) => {
          if (!o) resetPurchaseModal();
          setPurchaseOpen(o);
        }}
      >
        <DialogContent className="flex max-h-[min(90vh,720px)] w-[calc(100vw-2rem)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:p-0">
          <div className="border-b px-6 pb-4 pt-6 pr-14">
            <DialogHeader className="text-left">
              <DialogTitle className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-primary" />
                Purchase number
              </DialogTitle>
            </DialogHeader>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="space-y-5">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Enter an area code, state, or city to search available numbers. Inventory is limited and changes frequently.
              </p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-4 px-0.5 pt-0.5">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Area code</label>
                  <Input
                    placeholder="e.g. 213"
                    value={searchAreaCode}
                    onChange={(e) => {
                      setSearchAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3));
                      setSearchValidationError(null);
                    }}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">State (2-letter)</label>
                  <Input
                    placeholder="e.g. CA"
                    value={searchState}
                    onChange={(e) => {
                      setSearchState(e.target.value.toUpperCase().slice(0, 2));
                      setSearchValidationError(null);
                    }}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">City</label>
                  <Input
                    placeholder="e.g. Los Angeles"
                    value={searchLocality}
                    onChange={(e) => {
                      setSearchLocality(e.target.value);
                      setSearchValidationError(null);
                    }}
                    autoComplete="off"
                  />
                </div>
              </div>
              {searchValidationError && (
                <p className="text-xs text-destructive">{searchValidationError}</p>
              )}
              <Button
                type="button"
                className="w-full"
                onClick={() => void handleSearchAvailable()}
                disabled={searching || purchasingBatch || !hasAnyFilter}
              >
                {searching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
                Search available numbers
              </Button>
              {searchResults.length > 0 && (
                <div className="rounded-lg border max-h-52 overflow-y-auto px-2.5 py-2">
                  <div className="divide-y">
                    {searchResults.map((r) => {
                      const inCart = purchaseCart.some((x) => x.phone_number === r.phone_number);
                      return (
                        <div key={r.phone_number} className="flex items-center gap-3 py-2.5 pl-1 pr-2 text-sm sm:gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="font-mono font-medium truncate">{r.phone_number}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {[r.locality, r.region, r.postal_code].filter(Boolean).join(", ") || "US local"}
                            </p>
                          </div>
                          <span className="shrink-0 text-xs font-semibold tabular-nums text-primary">${TWILIO_NUMBER_PRICE_USD.toFixed(2)}</span>
                          <Button
                            type="button"
                            size="sm"
                            variant={inCart ? "secondary" : "default"}
                            className="shrink-0 whitespace-nowrap px-3"
                            disabled={inCart || !!purchasingNumber || purchasingBatch}
                            onClick={() => addToCart(r)}
                          >
                            {inCart ? "In cart" : "Add to cart"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            {purchaseCart.length > 0 && (
              <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="text-muted-foreground">{purchaseCart.length} in cart</span>
                    <span className="mx-1.5 text-muted-foreground">·</span>
                    <span className="font-semibold text-foreground">Total ${cartTotalUsd.toFixed(2)}</span>
                    <span className="ml-1.5 text-[10px] text-muted-foreground">(estimate)</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPurchaseCart([])} disabled={purchasingBatch}>
                      Clear cart
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setCartDetailOpen((v) => !v)} disabled={purchasingBatch}>
                      {cartDetailOpen ? "Hide cart" : "View cart"}
                    </Button>
                    <Button type="button" size="sm" onClick={() => void handleCheckoutCart()} disabled={purchasingBatch}>
                      {purchasingBatch ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Purchasing…
                        </>
                      ) : (
                        "Purchase all"
                      )}
                    </Button>
                  </div>
                </div>
                {cartDetailOpen && (
                  <ul className="max-h-40 overflow-y-auto divide-y rounded-md border border-border/60 bg-background text-sm">
                    {purchaseCart.map((c) => (
                      <li key={c.phone_number} className="flex items-center justify-between gap-2 px-2 py-2">
                        <div className="min-w-0">
                          <p className="font-mono text-xs truncate">{c.phone_number}</p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {[c.locality, c.region].filter(Boolean).join(", ") || "—"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-medium">${TWILIO_NUMBER_PRICE_USD.toFixed(2)}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={purchasingBatch}
                            onClick={() => removeFromCart(c.phone_number)}
                            aria-label={`Remove ${c.phone_number} from cart`}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!releaseConfirm} onOpenChange={() => setReleaseConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release this number from AgentFlow?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                This marks the number as inactive in AgentFlow. It will no longer be available for outbound caller ID, local presence, or group membership.
              </span>
              <span className="block font-medium">
                This does not release the number from your Twilio account. To fully remove it, visit the Twilio Console after releasing here.
              </span>
              {releaseTarget?.is_default && (
                <span className="block text-destructive font-medium">
                  This is currently your default number. After release, another active number will need to be set as default.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!releasingId}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => releaseConfirm && void handleRelease(releaseConfirm)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!!releasingId}
            >
              {releasingId ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Releasing…</> : "Release from AgentFlow"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!removeConfirm} onOpenChange={() => setRemoveConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this number?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the released number record from AgentFlow. The number may still exist in your Twilio account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!removingId}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeConfirm && void handleRemove(removeConfirm)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!!removingId}
            >
              {removingId ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Removing…</> : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {routingModalTarget && (
        <PhoneNumberRoutingModal
          open={!!routingModalTarget}
          onOpenChange={(o) => !o && setRoutingModalTarget(null)}
          phoneNumber={routingModalTarget}
          organizationId={organizationId!}
          onUpdate={onRefresh}
        />
      )}

      {roleModalTarget && organizationId && (
        <PhoneNumberRoleModal
          open={!!roleModalTarget}
          onOpenChange={(o) => !o && setRoleModalTarget(null)}
          phoneNumber={roleModalTarget}
          agents={agents}
          organizationId={organizationId}
          onUpdated={onRefresh}
        />
      )}
    </>
  );
};
