import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { supabase } from "@/integrations/supabase/client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { Globe, Plus, Trash2, Edit2, AlertTriangle, ArrowRight, Loader2, Calendar, CreditCard } from "lucide-react";
import { US_STATES } from "@/lib/us-states";
import { expirationStatus, type ExpirationStatus, type LicenseRow } from "../state-licenses/stateLicenseSchema";
import { useSearchParams } from "react-router-dom";
import { useBranding } from "@/contexts/BrandingContext";

const licenseFormSchema = z.object({
  state: z.string().min(1, "State is required"),
  license_number: z
    .string()
    .trim()
    .max(50, "Max 50 characters")
    .optional()
    .or(z.literal("")),
  expiration_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format")
    .optional()
    .or(z.literal("")),
});

type LicenseFormValues = z.infer<typeof licenseFormSchema>;

const statusBadgeClass: Record<Exclude<ExpirationStatus, "none">, string> = {
  expired: "bg-destructive/15 text-destructive border-destructive/40",
  soon: "bg-warning/15 text-warning border-warning/40",
  ok: "bg-muted text-foreground/70 border-border",
};

const STATE_ABBRS: Record<string, string> = {
  "Alabama": "AL",
  "Alaska": "AK",
  "Arizona": "AZ",
  "Arkansas": "AR",
  "California": "CA",
  "Colorado": "CO",
  "Connecticut": "CT",
  "Delaware": "DE",
  "Florida": "FL",
  "Georgia": "GA",
  "Hawaii": "HI",
  "Idaho": "ID",
  "Illinois": "IL",
  "Indiana": "IN",
  "Iowa": "IA",
  "Kansas": "KS",
  "Kentucky": "KY",
  "Louisiana": "LA",
  "Maine": "ME",
  "Maryland": "MD",
  "Massachusetts": "MA",
  "Michigan": "MI",
  "Minnesota": "MN",
  "Mississippi": "MS",
  "Missouri": "MO",
  "Montana": "MT",
  "Nebraska": "NE",
  "Nevada": "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  "Ohio": "OH",
  "Oklahoma": "OK",
  "Oregon": "OR",
  "Pennsylvania": "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  "Tennessee": "TN",
  "Texas": "TX",
  "Utah": "UT",
  "Vermont": "VT",
  "Virginia": "VA",
  "Washington": "WA",
  "West Virginia": "WV",
  "Wisconsin": "WI",
  "Wyoming": "WY",
  "District of Columbia": "DC"
};

function getStateAbbreviation(stateName: string): string {
  return STATE_ABBRS[stateName] ?? stateName.substring(0, 2).toUpperCase();
}

export const ProfileStateLicensesCard: React.FC = () => {
  const { user, profile } = useAuth();
  const { organizationId } = useOrganization();
  const [, setSearchParams] = useSearchParams();
  const { formatDate } = useBranding();

  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingLicense, setEditingLicense] = useState<LicenseRow | null>(null);
  const [deletingLicense, setDeletingLicense] = useState<LicenseRow | null>(null);

  const canAccessPhoneSystem =
    profile?.role === "Admin" ||
    profile?.role === "Team Leader" ||
    profile?.is_super_admin === true;

  const fetchLicenses = useCallback(async () => {
    if (!organizationId || !user?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("agent_state_licenses")
      .select("id, agent_id, state, license_number, expiration_date, created_at")
      .eq("organization_id", organizationId)
      .eq("agent_id", user.id)
      .order("state");

    if (error) {
      toast({
        title: "Failed to load licenses",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setLicenses((data as LicenseRow[]) ?? []);
    }
    setLoading(false);
  }, [organizationId, user?.id]);

  useEffect(() => {
    void fetchLicenses();
  }, [fetchLicenses]);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<LicenseFormValues>({
    resolver: zodResolver(licenseFormSchema),
    defaultValues: {
      state: "",
      license_number: "",
      expiration_date: "",
    },
  });

  const stateVal = watch("state");

  useEffect(() => {
    if (formOpen) {
      if (editingLicense) {
        reset({
          state: editingLicense.state,
          license_number: editingLicense.license_number ?? "",
          expiration_date: editingLicense.expiration_date ?? "",
        });
      } else {
        reset({
          state: "",
          license_number: "",
          expiration_date: "",
        });
      }
    }
  }, [formOpen, editingLicense, reset]);

  const onSubmit = async (values: LicenseFormValues) => {
    if (!organizationId || !user?.id) return;

    if (editingLicense) {
      const { error } = await supabase
        .from("agent_state_licenses")
        .update({
          license_number: values.license_number?.trim() || null,
          expiration_date: values.expiration_date || null,
        })
        .eq("id", editingLicense.id)
        .eq("agent_id", user.id);

      if (error) {
        toast({
          title: "Could not update license",
          description: error.message,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "License updated successfully.",
        className: "bg-success text-success-foreground",
      });
    } else {
      // Check if duplicate state exists
      const { data: existing } = await supabase
        .from("agent_state_licenses")
        .select("id")
        .eq("agent_id", user.id)
        .eq("state", values.state)
        .maybeSingle();

      if (existing) {
        toast({
          title: "Duplicate license",
          description: "You already have a license recorded for this state.",
          variant: "destructive",
        });
        return;
      }

      const { error } = await supabase.from("agent_state_licenses").insert({
        organization_id: organizationId,
        agent_id: user.id,
        state: values.state,
        license_number: values.license_number?.trim() || null,
        expiration_date: values.expiration_date || null,
      });

      if (error) {
        toast({
          title: "Could not add license",
          description: error.message,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "License added successfully.",
        className: "bg-success text-success-foreground",
      });
    }

    setFormOpen(false);
    setEditingLicense(null);
    void fetchLicenses();
  };

  const handleDelete = async () => {
    if (!deletingLicense || !user?.id) return;
    const { error } = await supabase
      .from("agent_state_licenses")
      .delete()
      .eq("id", deletingLicense.id)
      .eq("agent_id", user.id);

    if (error) {
      toast({
        title: "Could not remove license",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "License removed successfully.",
      className: "bg-success text-success-foreground",
    });
    setDeletingLicense(null);
    void fetchLicenses();
  };

  const handleEditClick = (lic: LicenseRow) => {
    setEditingLicense(lic);
    setFormOpen(true);
  };

  const handleAddClick = () => {
    setEditingLicense(null);
    setFormOpen(true);
  };

  const handleNavigateToTeam = () => {
    setSearchParams({ section: "state-licenses" });
  };

  return (
    <TooltipProvider>
      <Card className="bg-card border-border rounded-xl mb-6 overflow-hidden">
        <CardHeader className="border-b border-border/40 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-primary/10 rounded-lg shrink-0">
                <Globe className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg font-semibold tracking-tight">State Licenses</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Manage your personal state licenses here.
                </p>
              </div>
            </div>
            <Button size="sm" onClick={handleAddClick} className="shadow-sm">
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add License
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : licenses.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground border-2 border-dashed border-border/60 rounded-xl bg-secondary/5">
              No licenses added yet. Add your state licenses to receive state-specific calls.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {licenses.map((lic) => {
                const status = expirationStatus(lic.expiration_date);
                const stateAbbr = getStateAbbreviation(lic.state);
                
                let statusLabel = "Active";
                if (status === "expired") {
                  statusLabel = "Expired";
                } else if (status === "soon") {
                  statusLabel = "Expiring Soon";
                }

                return (
                  <div 
                    key={lic.id} 
                    className="group relative flex items-start gap-4 p-5 rounded-xl border border-border/60 bg-gradient-to-b from-card to-card/50 hover:from-card hover:to-secondary/10 hover:border-primary/20 hover:shadow-md hover:shadow-primary/5 hover:-translate-y-1 transition-all duration-300 ease-out"
                  >
                    {/* State Emblem */}
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-tr from-primary/10 to-primary/5 text-primary font-bold text-base shrink-0 border border-primary/15 shadow-sm group-hover:scale-110 group-hover:shadow-md transition-all duration-300">
                      {stateAbbr}
                    </div>

                    {/* License details */}
                    <div className="flex-1 min-w-0 pr-6">
                      <h4 className="font-bold text-sm text-foreground tracking-tight group-hover:text-primary transition-colors duration-200">
                        {lic.state}
                      </h4>
                      
                      <div className="flex items-center gap-1.5 mt-1 text-muted-foreground">
                        <CreditCard className="w-3.5 h-3.5 opacity-60" />
                        <span className="text-xs font-mono tracking-wide truncate">
                          {lic.license_number ? lic.license_number : <span className="italic text-muted-foreground/50">No license #</span>}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-border/30">
                        {/* Status indicator dot */}
                        <div className="relative flex h-2 w-2">
                          {status === "expired" && (
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                          )}
                          <span className={`relative inline-flex rounded-full h-2 w-2 ${
                            status === "expired" 
                              ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]" 
                              : status === "soon" 
                                ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]" 
                                : "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"
                          }`} />
                        </div>
                        
                        <span className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground/80">
                          {statusLabel}
                        </span>
                        
                        {lic.expiration_date && (
                          <div className="flex items-center gap-1 ml-auto text-muted-foreground/70">
                            <Calendar className="w-3 h-3" />
                            <span className="text-[10px] font-medium">
                              Exp. {formatDate(lic.expiration_date)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Hover Actions */}
                    <div className="absolute right-4 top-4 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-all duration-200 translate-y-1 group-hover:translate-y-0">
                      <button
                        type="button"
                        aria-label={`Edit ${lic.state} license`}
                        className="p-1.5 rounded-full bg-background/90 backdrop-blur-sm border border-border shadow-sm text-muted-foreground hover:text-foreground hover:bg-accent hover:border-border/80 transition-all duration-200"
                        onClick={() => handleEditClick(lic)}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${lic.state} license`}
                        className="p-1.5 rounded-full bg-background/90 backdrop-blur-sm border border-border shadow-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-destructive/20 transition-all duration-200"
                        onClick={() => setDeletingLicense(lic)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="pt-2 border-t border-border/40 flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
            <span>
              {canAccessPhoneSystem
                ? "Admins can manage team-wide licensing under Phone System → State Licenses."
                : "Your licenses are used to route state-based inbound calls to you."}
            </span>
            {canAccessPhoneSystem && (
              <Button
                type="button"
                onClick={handleNavigateToTeam}
                variant="link"
                className="h-auto p-0 flex items-center gap-1 text-primary hover:underline font-semibold"
              >
                <span>Go to Phone System → State Licenses</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Add/Edit Modal */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingLicense ? "Edit State License" : "Add State License"}</DialogTitle>
            <DialogDescription>
              {editingLicense
                ? "Update your license details. State selection cannot be modified."
                : "Record your state license. License number and expiration are optional but recommended."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="state">State *</Label>
              {editingLicense ? (
                <Input id="state" value={editingLicense.state} disabled className="bg-muted" />
              ) : (
                <Select
                  value={stateVal}
                  onValueChange={(v) => setValue("state", v, { shouldValidate: true })}
                >
                  <SelectTrigger id="state">
                    <SelectValue placeholder="Select a state..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-56">
                    {US_STATES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {errors.state && <p className="mt-1 text-xs text-destructive">{errors.state.message}</p>}
            </div>

            <div>
              <Label htmlFor="license_number">License Number</Label>
              <Input
                id="license_number"
                placeholder="Optional"
                {...register("license_number")}
              />
              {errors.license_number && (
                <p className="mt-1 text-xs text-destructive">{errors.license_number.message}</p>
              )}
            </div>

            <div>
              <Label htmlFor="expiration_date">Expiration Date</Label>
              <Input id="expiration_date" type="date" {...register("expiration_date")} />
              {errors.expiration_date && (
                <p className="mt-1 text-xs text-destructive">{errors.expiration_date.message}</p>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : editingLicense ? "Save Changes" : "Add License"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingLicense} onOpenChange={(o) => !o && setDeletingLicense(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove State License?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove your {deletingLicense?.state} license? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
};
