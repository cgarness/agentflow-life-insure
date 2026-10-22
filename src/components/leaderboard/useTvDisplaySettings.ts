import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranding } from "@/contexts/BrandingContext";

/** TV display name and the org-wide ticker banner (read once on mount; saved only by Admin / Team Leader). */
export function useTvDisplaySettings() {
  const { profile } = useAuth();
  const { branding } = useBranding();
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [settingsRowId, setSettingsRowId] = useState<string | null>(null);
  const [customBanner, setCustomBanner] = useState<string | null>(null);
  const [bannerDraft, setBannerDraft] = useState("");
  const [savingBanner, setSavingBanner] = useState(false);

  useEffect(() => {
    const orgId = profile?.organization_id;
    if (!orgId) return;
    void supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle()
      .then(({ data }) => setOrganizationName(data?.name?.trim() || null));
  }, [profile?.organization_id]);

  const tvDisplayName = useMemo(() => {
    const branded = branding.companyName?.trim();
    if (branded && branded.toLowerCase() !== "agentflow") return branded;
    return organizationName || branded || "AgentFlow";
  }, [branding.companyName, organizationName]);

  const canEditBanner =
    profile?.role?.toLowerCase() === "admin" ||
    profile?.role?.toLowerCase() === "team leader";

  // Fetch banner text (only the banner — branding context handles name/timezone)
  useEffect(() => {
    void supabase
      .from("company_settings")
      .select("id, leaderboard_tv_banner_text")
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) return;
        if (data?.id) setSettingsRowId(data.id);
        const b = data?.leaderboard_tv_banner_text ?? null;
        setCustomBanner(b?.trim() ? b : null);
        setBannerDraft(b ?? "");
      });
  }, []);

  const saveBanner = async () => {
    if (!canEditBanner || !settingsRowId) {
      toast.error("Unable to save (missing settings row or permission).");
      return;
    }
    setSavingBanner(true);
    const trimmed = bannerDraft.trim();
    const { error } = await supabase
      .from("company_settings")
      .update({ leaderboard_tv_banner_text: trimmed || null })
      .eq("id", settingsRowId);
    setSavingBanner(false);
    if (error) { toast.error(error.message || "Save failed"); return; }
    setCustomBanner(trimmed || null);
    toast.success(trimmed ? "Ticker message updated" : "Ticker reset to live wins");
  };

  return { tvDisplayName, canEditBanner, customBanner, bannerDraft, setBannerDraft, savingBanner, saveBanner };
}
