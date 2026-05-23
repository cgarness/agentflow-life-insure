import React, { useState, useCallback, useEffect, useRef } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { logActivity } from "@/lib/activityLogger";
import { useUnsavedChanges } from "@/contexts/UnsavedChangesContext";
import { useBranding } from "@/contexts/BrandingContext";
import { useBrandingUpload } from "@/hooks/useBrandingUpload";
import { Button } from "@/components/ui/button";
import BrandingForm from "./BrandingForm";
import { BrandingState, BRANDING_DEFAULTS } from "./brandingConfig";

const CompanyBranding: React.FC = () => {
  const { user, profile } = useAuth();
  const { role, isSuperAdmin } = useOrganization();
  const { refreshBranding } = useBranding();
  const { uploadLogo, deletePreviousLogo, uploading } = useBrandingUpload();
  const [state, setState] = useState<BrandingState>({ ...BRANDING_DEFAULTS });
  const [saved, setSaved] = useState<BrandingState>({ ...BRANDING_DEFAULTS });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nameError, setNameError] = useState(false);
  const { registerDirty } = useUnsavedChanges();

  // Track the pending logo file for Storage upload (not yet uploaded)
  const [pendingLogoFile, setPendingLogoFile] = useState<File | null>(null);

  // Track the logo URL that was loaded from the DB, so we can delete the
  // previous Storage object after a successful replacement/removal save.
  const previousLogoUrlRef = useRef<string | null>(null);

  // Track the object URL created for local preview so we can revoke it.
  const previewObjectUrlRef = useRef<string | null>(null);

  const canEdit = Boolean(isSuperAdmin || role?.toLowerCase() === "admin");
  const orgId = profile?.organization_id ?? null;
  const isDirty = JSON.stringify(state) !== JSON.stringify(saved);

  useEffect(() => {
    registerDirty("company-branding", isDirty);
    return () => registerDirty("company-branding", false);
  }, [isDirty, registerDirty]);

  const update = useCallback((patch: Partial<BrandingState>) => {
    setState(prev => ({ ...prev, ...patch }));
    setNameError(false);
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
            timezone: data.timezone || BRANDING_DEFAULTS.timezone,
            timeFormat: data.time_format || BRANDING_DEFAULTS.timeFormat,
            companyPhone: data.company_phone || "",
            websiteUrl: (data as { website_url?: string | null }).website_url || "",
          };
          setState(loaded);
          setSaved(loaded);
          previousLogoUrlRef.current = data.logo_url ?? null;
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

  // Cleanup object URL on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
      }
    };
  }, []);

  /** Called when the user selects a logo file via BrandingUploadField. */
  const handleLogoFileSelected = useCallback((file: File) => {
    // Revoke any previous preview object URL
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
    }

    // Create a local preview URL for instant feedback
    const previewUrl = URL.createObjectURL(file);
    previewObjectUrlRef.current = previewUrl;
    setPendingLogoFile(file);

    // Update state to show preview and trigger dirty detection
    setState(prev => ({
      ...prev,
      logoUrl: previewUrl,
      logoName: file.name,
    }));
    setNameError(false);
  }, []);

  /** Called when the user clicks Remove on the logo. */
  const handleLogoRemove = useCallback(() => {
    // Revoke preview object URL if any
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
    setPendingLogoFile(null);
    setState(prev => ({ ...prev, logoUrl: null, logoName: null }));
    setNameError(false);
  }, []);

  const handleSave = async () => {
    if (!canEdit) return;
    if (!orgId) {
      toast({ title: "No organization found on your profile", variant: "destructive" });
      return;
    }
    if (!state.companyName.trim()) {
      setNameError(true);
      toast({ title: "Please fix the errors before saving", variant: "destructive" });
      return;
    }
    setSaving(true);

    try {
      let finalLogoUrl = state.logoUrl;
      let finalLogoName = state.logoName;
      let newlyUploadedUrl: string | null = null;

      // If there's a pending file, upload it to Storage first
      if (pendingLogoFile) {
        const result = await uploadLogo(pendingLogoFile);
        if (!result) {
          // Upload failed — toast already shown by the hook
          setSaving(false);
          return;
        }
        finalLogoUrl = result.url;
        finalLogoName = result.name;
        newlyUploadedUrl = result.url;
      }

      // Revoke preview object URL now that we have the real Storage URL
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = null;
      }

      const { error } = await supabase
        .from("company_settings")
        .upsert({
          organization_id: orgId,
          company_name: state.companyName,
          logo_url: finalLogoUrl,
          logo_name: finalLogoName,
          timezone: state.timezone,
          time_format: state.timeFormat,
          company_phone: state.companyPhone,
          website_url: state.websiteUrl,
          updated_at: new Date().toISOString(),
        }, { onConflict: "organization_id" })
        .select();

      if (error) {
        // If upsert failed and we uploaded a new file, clean it up
        if (newlyUploadedUrl) {
          await deletePreviousLogo(newlyUploadedUrl);
        }
        throw error;
      }

      // Upsert succeeded — clean up the previous Storage object if it changed
      const previousUrl = previousLogoUrlRef.current;
      if (previousUrl && previousUrl !== finalLogoUrl) {
        await deletePreviousLogo(previousUrl);
      }

      // Update tracking refs and state
      previousLogoUrlRef.current = finalLogoUrl;
      setPendingLogoFile(null);

      const savedState: BrandingState = {
        ...state,
        logoUrl: finalLogoUrl,
        logoName: finalLogoName,
      };
      setState(savedState);
      setSaved(savedState);

      await refreshBranding();
      toast({ title: "Company branding saved successfully" });
      void logActivity({
        action: `Updated company branding${state.companyName ? ` for "${state.companyName}"` : ""}`,
        category: "settings",
        organizationId: orgId ?? "",
        userId: user?.id,
        userName: profile ? `${profile.first_name} ${profile.last_name}` : undefined,
        metadata: { companyName: state.companyName, timezone: state.timezone },
      });
    } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      console.error("Error saving company settings:", error);
      toast({
        title: "Failed to save settings",
        description: error.message || "Unknown error occurred",
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
        <h3 className="text-lg font-semibold text-foreground">Company Branding</h3>
        <Button
          onClick={handleSave}
          disabled={!canEdit || !isDirty || saving || uploading}
          className="gap-2 min-w-[120px] bg-[#3B82F6] hover:bg-[#3B82F6]/90 text-white shadow-sm disabled:opacity-50"
        >
          {(saving || uploading) && <Loader2 className="w-4 h-4 animate-spin" />}
          {uploading ? "Uploading…" : saving ? "Saving…" : "Save Changes"}
        </Button>
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
        nameError={nameError}
        canEdit={canEdit}
        update={update}
        onLogoFileSelected={handleLogoFileSelected}
        onLogoRemove={handleLogoRemove}
      />
    </div>
  );
};

export default CompanyBranding;
