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
import { toast } from "sonner";
import { Phone, Loader2, ShoppingCart, MoreHorizontal, Radio, Trash2, Search, X } from "lucide-react";
import { formatPhoneNumber } from "@/utils/phoneUtils";

const formatPhone = formatPhoneNumber;

/** Display-only estimate shown in the purchase UI (Twilio bills separately). */
const TWILIO_NUMBER_PRICE_USD = 3;

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

export const NumberManagementSection: React.FC<Props> = ({ numbers, setNumbers, agents, onRefresh }) => {
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [searchAreaCode, setSearchAreaCode] = useState("");
  const [searchLocality, setSearchLocality] = useState("");
  const [searchState, setSearchState] = useState("");
  const [searchResults, setSearchResults] = useState<TwilioAvailableNumber[]>([]);
  const [searching, setSearching] = useState(false);
  const [purchasingNumber, setPurchasingNumber] = useState<string | null>(null);
  const [purchasingBatch, setPurchasingBatch] = useState(false);
  const [purchaseCart, setPurchaseCart] = useState<TwilioAvailableNumber[]>([]);
  const [cartDetailOpen, setCartDetailOpen] = useState(false);
  const [releaseConfirm, setReleaseConfirm] = useState<string | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);

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

  const resetPurchaseModal = () => {
    setSearchAreaCode("");
    setSearchLocality("");
    setSearchState("");
    setSearchResults([]);
    setPurchaseCart([]);
    setCartDetailOpen(false);
    setPurchasingBatch(false);
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
    const friendly_name = listing ? defaultFriendlyFromListing(listing) : undefined;
    const { data, error } = await supabase.functions.invoke("twilio-buy-number", {
      body: {
        phone_number: e164,
        ...(friendly_name ? { friendly_name } : {}),
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
      toast.success(
        failed.length === 0
          ? `Purchased ${purchasedCount} number(s).`
          : `${purchasedCount} purchased; ${failed.length} still in cart — fix issues and try again.`,
      );
    }
    if (failed.length === 0) {
      setCartDetailOpen(false);
      setPurchaseOpen(false);
      resetPurchaseModal();
    }
  };

  const cartTotalUsd = purchaseCart.length * TWILIO_NUMBER_PRICE_USD;

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
        </CardHeader>
        <CardContent>
          {numbers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Phone className="w-12 h-12 text-muted-foreground mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">No phone numbers yet</p>
              <p className="text-xs text-muted-foreground mb-4 max-w-sm">
                Purchase a number from Twilio to use it for outbound caller ID and inbound routing.
              </p>
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
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b bg-accent/50">
                    <th className="text-left py-3 px-3 font-medium">Phone number</th>
                    <th className="text-left py-3 px-3 font-medium">Friendly name</th>
                    <th className="text-left py-3 px-3 font-medium">Status</th>
                    <th className="text-center py-3 px-3 font-medium w-16">Default</th>
                    <th className="text-left py-3 px-3 font-medium min-w-[9rem]">Assigned to</th>
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
                        <td className="py-3 px-3">
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
                                <DropdownMenuItem onClick={() => setReleaseConfirm(n.id)} className="text-destructive">
                                  <Radio className="w-4 h-4 mr-2" /> Release number
                                </DropdownMenuItem>
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

      <Dialog
        open={purchaseOpen}
        onOpenChange={(o) => {
          if (!o) resetPurchaseModal();
          setPurchaseOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-primary" />
              Purchase number
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto flex-1 min-h-0 pr-1">
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
            <Button type="button" className="w-full" onClick={() => void handleSearchAvailable()} disabled={searching || purchasingBatch}>
              {searching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              Search available numbers
            </Button>
            {searchResults.length > 0 && (
              <div className="border rounded-md max-h-52 overflow-y-auto divide-y">
                {searchResults.map((r) => {
                  const inCart = purchaseCart.some((x) => x.phone_number === r.phone_number);
                  return (
                    <div key={r.phone_number} className="flex items-center gap-2 p-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono font-medium truncate">{r.phone_number}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {[r.locality, r.region, r.postal_code].filter(Boolean).join(", ") || "US local"}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-primary">${TWILIO_NUMBER_PRICE_USD.toFixed(2)}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant={inCart ? "secondary" : "default"}
                        className="shrink-0"
                        disabled={inCart || !!purchasingNumber || purchasingBatch}
                        onClick={() => addToCart(r)}
                      >
                        {inCart ? "In cart" : "Add to cart"}
                      </Button>
                    </div>
                  );
                })}
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
