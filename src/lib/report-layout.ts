import { supabase } from "@/integrations/supabase/client";
import { ReportLayoutConfig, DEFAULT_LAYOUT, SectionConfig } from "./report-layout-constants";

export function getDefaultLayout(): ReportLayoutConfig {
  return JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
}

function mergeWithDefault(fetched: any): ReportLayoutConfig {
  if (!fetched) return getDefaultLayout();

  let fetchedSections: SectionConfig[] = [];

  // Migration logic: v1 (tabs) -> v2 (flat sections)
  if (fetched.version === 1 && fetched.tabs) {
    const tabs = fetched.tabs;
    // Flatten in a reasonable order
    if (Array.isArray(tabs.overview)) fetchedSections.push(...tabs.overview);
    if (Array.isArray(tabs.calls)) fetchedSections.push(...tabs.calls);
    if (Array.isArray(tabs.pipeline)) fetchedSections.push(...tabs.pipeline);
    if (Array.isArray(tabs.team)) fetchedSections.push(...tabs.team);
    
    // Deduplicate just in case
    const seen = new Set<string>();
    fetchedSections = fetchedSections.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
  } else if ((fetched.version === 2 || fetched.version === 3) && Array.isArray(fetched.sections)) {
    fetchedSections = fetched.sections;
  } else {
    // Unknown format or missing sections
    return getDefaultLayout();
  }

  const merged = getDefaultLayout();
  
  const validFetchedSections = fetchedSections.filter(fs => 
    merged.sections.some(ds => ds.id === fs.id)
  );
  
  const missingSections = merged.sections.filter(ds => 
    !fetchedSections.some(fs => fs.id === ds.id)
  );
  
  merged.sections = [...validFetchedSections, ...missingSections];

  return merged;
}

export async function fetchUserLayout(orgId: string): Promise<ReportLayoutConfig> {
  let needsMigrationSave = false;
  let layoutToSave: ReportLayoutConfig | null = null;
  let userId: string | null = null;

  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
      userId = user.id;
      const { data: userLayout } = await supabase
        .from("report_layouts")
        .select("layout")
        .eq("organization_id", orgId)
        .eq("user_id", user.id)
        .maybeSingle();
        
      if (userLayout?.layout) {
        const parsed = userLayout.layout as any;
        const merged = mergeWithDefault(parsed);
        if (parsed.version === 1) {
          needsMigrationSave = true;
          layoutToSave = merged;
        }
        
        // Background async save for migration
        if (needsMigrationSave && layoutToSave && userId) {
          saveUserLayout(orgId, layoutToSave).catch(e => console.error("Auto-migration save failed:", e));
        }
        
        return merged;
      }
    }

    const { data: orgLayout } = await supabase
      .from("report_layouts")
      .select("layout")
      .eq("organization_id", orgId)
      .is("user_id", null)
      .maybeSingle();

    if (orgLayout?.layout) {
      const parsed = orgLayout.layout as any;
      const merged = mergeWithDefault(parsed);
      
      // If we are relying on an org layout that is v1, we just return the v2 merged version.
      // We don't automatically upgrade the org layout here (let an admin do it by saving).
      return merged;
    }
  } catch (err) {
    console.error("Error fetching report layout:", err);
  }

  return getDefaultLayout();
}

export async function saveUserLayout(orgId: string, layout: ReportLayoutConfig): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const { data: existing } = await supabase
      .from("report_layouts")
      .select("id")
      .eq("organization_id", orgId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) {
      await supabase.from("report_layouts").update({ layout: layout as any, updated_at: new Date().toISOString() }).eq("id", existing.id);
    } else {
      await supabase.from("report_layouts").insert({ user_id: user.id, organization_id: orgId, layout: layout as any });
    }
  } catch (err) {
    console.error("Error saving user layout:", err);
  }
}

export async function saveOrgDefaultLayout(orgId: string, layout: ReportLayoutConfig): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from("report_layouts")
      .select("id")
      .eq("organization_id", orgId)
      .is("user_id", null)
      .maybeSingle();

    if (existing) {
      await supabase.from("report_layouts").update({ layout: layout as any, updated_at: new Date().toISOString() }).eq("id", existing.id);
    } else {
      await supabase.from("report_layouts").insert({ organization_id: orgId, layout: layout as any });
    }
  } catch (err) {
    console.error("Error saving org layout:", err);
  }
}

export async function resetUserLayout(orgId: string): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    await supabase
      .from("report_layouts")
      .delete()
      .eq("organization_id", orgId)
      .eq("user_id", user.id);
  } catch (err) {
    console.error("Error resetting user layout:", err);
  }
}
