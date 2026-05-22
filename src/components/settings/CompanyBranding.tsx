import React, { useState, useCallback, useEffect } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { logActivity } from "@/lib/activityLogger";
import { useUnsavedChanges } from "@/contexts/UnsavedChangesContext";
import BrandingForm from "./BrandingForm";
import { BrandingState, BRANDING_DEFAULTS } from "./brandingConfig";
import { brandingFormSchema } from "./brandingSchema";

const CompanyBranding: React.FC = () => {
  const { user, profile } = useAuth();
  const { role, isSuperAdmin } = useOrganization();
  const [state, setState] = useState<BrandingState>({ ...BRANDING_DEFAULTS });
  const [saved, setSaved] = useState<BrandingState>({ ...BRANDING_DEFAULTS });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Partial<Record<keyof BrandingState, string>>>({});
  const { registerDirty } = useUnsavedChanges();

  const canEdit = Boolean(isSuperAdmin || role?.toLowerCase() === "admin");
  const canEditFavicon = Boolean(isSuperAdmin);
  const orgId = profile?.organization_id ?? null;
  const isDirty = JSON.stringify(state) !== JSON.stringify(saved);

  useEffect(() => {
    registerDirty("company-branding", isDirty);
    return () => registerDirty("company-branding", false);
  }, [isDirty, registerDirty]);

  const update = useCallback((patch: Partial<BrandingState>) => {
    setState(prev => ({ ...prev, ...patch }));
    setErrors(prev => {
      const next = { ...prev };
      for (const key of Object.keys(patch) as (keyof BrandingState)[]) delete next[key];
      return next;
    });
  }, []);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    const fetchSettings = async () => {
      try {
        const { data, error } = await supabase
          .from("company_settings")
          .select("*")
          .eq("organization_id", orgId)
          .maybeSingle();
        if (error) throw error;
        if (data) {
          const loaded: BrandingState = {
            companyName: data.company_name || "",
            logoUrl: data.logo_url,
            logoName: data.logo_name,
            faviconUrl: data.favicon_url,
            faviconName: data.favicon_name,
            timezone: data.timezone || BRANDING_DEFAULTS.timezone,
            timeFormat: data.time_format || BRANDING_DEFAULTS.timeFormat,
            companyPhone: data.company_phone || "",
            websiteUrl: (data as { website_url?: string | null }).website_url || "",
            primaryColor: (data as { primary_color?: string | null }).primary_color || BRANDING_DEFAULTS.primaryColor,
          };
          setState(loaded);
          setSaved(loaded);
        }
      } catch (error) {
        console.error("Error fetching company settings:", error);
        toast({ title: "Failed to load settings", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, [orgId]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const handleSave = async () => {
    if (!canEdit) return;
    if (!orgId) {
      toast({ title: "No organization found on your profile", variant: "destructive" });
      return;
    }

    const parsed = brandingFormSchema.safeParse(state);
    if (!parsed.success) {
      const fieldErrors: Partial<Record<keyof BrandingState, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof BrandingState | undefined;
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      toast({ title: "Please fix the errors before saving", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("company_settings")
        .upsert({
          organization_id: orgId,
          company_name: state.companyName,
          logo_url: state.logoUrl,
          logo_name: state.logoName,
          favicon_url: state.faviconUrl,
          favicon_name: state.faviconName,
          timezone: state.timezone,
          time_format: state.timeFormat,
          company_phone: state.companyPhone,
          website_url: state.websiteUrl,
          primary_color: state.primaryColor,
          updated_at: new Date().toISOString(),
        }, { onConflict: "organization_id" })
        .select();
      if (error) throw error;
      setSaved({ ...state });
      setErrors({});
      toast({ title: "Company branding saved successfully" });
      void logActivity({
        action: `Updated company branding${state.companyName ? ` for "${state.companyName}"` : ""}`,
        category: "settings",
        organizationId: orgId ?? "",
        userId: user?.id,
        userName: profile ? `${profile.first_name} ${profile.last_name}` : undefined,
        metadata: { companyName: state.companyName, timezone: state.timezone },
      });
    } catch (error: unknown) {
      console.error("Error saving company settings:", error);
      const message = error instanceof Error ? error.message : "Unknown error occurred";
      toast({
        title: "Failed to save settings",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Company Branding</h3>
          <p className="text-sm text-muted-foreground">Customize how your agency appears across AgentFlow</p>
        </div>
        <button
          onClick={handleSave}
          disabled={!canEdit || !isDirty || saving}
          className={`px-5 py-2 rounded-md text-sm font-medium text-white flex items-center gap-2 transition-colors ${canEdit && isDirty && !saving ? "bg-primary cursor-pointer" : "bg-muted cursor-not-allowed opacity-70"}`}
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save Changes
        </button>
      </div>

      {!canEdit && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 mt-0.5 text-warning shrink-0" />
          <p className="text-sm text-foreground">
            Company Branding can only be edited by an Admin. Contact your agency administrator to make changes.
          </p>
        </div>
      )}

      <BrandingForm
        state={state}
        errors={errors}
        canEdit={canEdit}
        canEditFavicon={canEditFavicon}
        organizationId={orgId}
        update={update}
      />
    </div>
  );
};

export default CompanyBranding;
