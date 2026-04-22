import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, Trash2, Plus, Loader2, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export type ProfileCarrierRow = { carrier: string; writingNumber: string };

export function normalizeProfileCarriers(raw: unknown): ProfileCarrierRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): ProfileCarrierRow | null => {
      if (typeof item === "string") return { carrier: item, writingNumber: "" };
      if (item && typeof item === "object" && "carrier" in item) {
        const o = item as { carrier?: unknown; writingNumber?: unknown };
        const carrier = String(o.carrier ?? "").trim();
        if (!carrier) return null;
        return { carrier, writingNumber: String(o.writingNumber ?? "") };
      }
      return null;
    })
    .filter((x): x is ProfileCarrierRow => x !== null);
}

interface ProfileCarriersSectionProps {
  carriers: ProfileCarrierRow[];
  onChange: (next: ProfileCarrierRow[]) => void;
  disabled?: boolean;
  /** Optional footer (e.g. save button) rendered below the carrier grid */
  footer?: React.ReactNode;
  /** Shorter copy when an admin is editing another user */
  adminEditing?: boolean;
  /** When true, header toggles visibility (e.g. My Profile); User Management stays expanded */
  collapsible?: boolean;
}

const ProfileCarriersSection: React.FC<ProfileCarriersSectionProps> = ({
  carriers,
  onChange,
  disabled = false,
  footer,
  adminEditing = false,
  collapsible = false,
}) => {
  const [carrierToAdd, setCarrierToAdd] = useState("");
  const [orgCarrierNames, setOrgCarrierNames] = useState<string[]>([]);
  const [loadingNames, setLoadingNames] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingNames(true);
        const { data, error } = await supabase
          .from("carriers")
          .select("name")
          .order("name", { ascending: true });
        if (error) throw error;
        if (!cancelled) {
          const names = (data ?? [])
            .map((r) => (r as { name?: string }).name)
            .filter((n): n is string => typeof n === "string" && n.trim().length > 0);
          setOrgCarrierNames(names);
        }
      } catch {
        if (!cancelled) setOrgCarrierNames([]);
      } finally {
        if (!cancelled) setLoadingNames(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const addableNames = orgCarrierNames.filter((n) => !carriers.some((c) => c.carrier === n));

  const addCarrier = () => {
    if (!carrierToAdd || carriers.some((c) => c.carrier === carrierToAdd)) return;
    onChange([...carriers, { carrier: carrierToAdd, writingNumber: "" }]);
    setCarrierToAdd("");
  };

  const updateWritingNumber = (carrier: string, writingNumber: string) => {
    onChange(carriers.map((c) => (c.carrier === carrier ? { ...c, writingNumber } : c)));
  };

  const removeCarrier = (carrier: string) => {
    onChange(carriers.filter((c) => c.carrier !== carrier));
  };

  const headerBlock = (
    <div className="flex items-center gap-2 min-w-0">
      <div className="p-2 bg-primary/10 rounded-lg shrink-0">
        <Shield className="w-5 h-5 text-primary" />
      </div>
      <div className="min-w-0">
        <CardTitle className="text-lg">Insurance Carriers</CardTitle>
        <p className="text-xs text-muted-foreground">
          {adminEditing
            ? "Writing numbers for each carrier. Only carriers listed under Settings → Carriers can be selected."
            : "Configure your writing numbers. Only carriers your agency added under Settings → Carriers appear in the list."}
        </p>
      </div>
    </div>
  );

  const body = (
    <>
        <div className="flex flex-col md:flex-row gap-3 items-end bg-accent/30 p-4 rounded-xl border border-border/50">
          <div className="flex-1 w-full space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider ml-1">Select Carrier</label>
            <select
              value={carrierToAdd}
              onChange={(e) => setCarrierToAdd(e.target.value)}
              disabled={disabled || loadingNames || addableNames.length === 0}
              className="w-full h-11 px-4 rounded-lg border border-input bg-background/50 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <option value="">
                {loadingNames
                  ? "Loading carriers…"
                  : addableNames.length === 0
                    ? orgCarrierNames.length === 0
                      ? "Add carriers under Settings → Carriers first"
                      : "All listed carriers are already added"
                    : "Select a carrier"}
              </option>
              {addableNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            onClick={addCarrier}
            disabled={disabled || !carrierToAdd}
            className="h-11 px-6 rounded-lg font-medium transition-all hover:shadow-lg active:scale-95"
          >
            {loadingNames ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Loading
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-1.5" /> Add Carrier
              </>
            )}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {carriers.map(({ carrier, writingNumber }) => (
            <div
              key={carrier}
              className="group relative p-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:shadow-md transition-all duration-300"
            >
              <div className="flex items-center justify-between mb-3">
                <Badge variant="outline" className="font-semibold px-2.5 py-0.5 rounded-md border-primary/20 text-primary bg-primary/5">
                  {carrier}
                </Badge>
                <button
                  type="button"
                  onClick={() => removeCarrier(carrier)}
                  disabled={disabled}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:pointer-events-none disabled:opacity-40"
                  title="Remove Carrier"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">Writing Number</label>
                <Input
                  value={writingNumber}
                  onChange={(e) => updateWritingNumber(carrier, e.target.value)}
                  disabled={disabled}
                  placeholder="Enter writing #"
                  className="h-9 text-sm bg-accent/50 border-0 focus-visible:ring-1 focus-visible:ring-primary rounded-md"
                />
              </div>
            </div>
          ))}
          {carriers.length === 0 && (
            <div className="md:col-span-2 lg:col-span-3 py-12 flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl bg-accent/5">
              <Shield className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No carriers configured</p>
            </div>
          )}
        </div>

        {footer ? <div className="flex justify-start pt-2 border-t border-border/50">{footer}</div> : null}
    </>
  );

  if (collapsible) {
    return (
      <Card className="bg-card border-border rounded-xl overflow-hidden">
        <Collapsible defaultOpen={false} className="group">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
            >
              {headerBlock}
              <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-6 border-t border-border/50 pt-6">{body}</CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border rounded-xl">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">{headerBlock}</CardHeader>
      <CardContent className="space-y-6">{body}</CardContent>
    </Card>
  );
};

export default ProfileCarriersSection;
