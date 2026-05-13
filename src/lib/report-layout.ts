import { supabase } from "@/integrations/supabase/client";
import { ReportLayoutConfig, DEFAULT_LAYOUT, TabName } from "./report-layout-constants";

export function getDefaultLayout(): ReportLayoutConfig {
  return JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
}

function mergeWithDefault(fetched: any): ReportLayoutConfig {
  if (!fetched || fetched.version !== 1 || !fetched.tabs) return getDefaultLayout();

  const merged = getDefaultLayout();
  
  (Object.keys(merged.tabs) as TabName[]).forEach(tab => {
    const fetchedTab = fetched.tabs[tab];
    if (Array.isArray(fetchedTab)) {
      const validFetchedSections = fetchedTab.filter((fs: any) => 
        merged.tabs[tab].some(ds => ds.id === fs.id)
      );
      
      const missingSections = merged.tabs[tab].filter(ds => 
        !fetchedTab.some((fs: any) => fs.id === ds.id)
      );
      
      merged.tabs[tab] = [...validFetchedSections, ...missingSections];
    }
  });

  return merged;
}

export async function fetchUserLayout(orgId: string): Promise<ReportLayoutConfig> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
      const { data: userLayout } = await supabase
        .from("report_layouts")
        .select("layout")
        .eq("organization_id", orgId)
        .eq("user_id", user.id)
        .maybeSingle();
        
      if (userLayout?.layout) {
        return mergeWithDefault(userLayout.layout);
      }
    }

    const { data: orgLayout } = await supabase
      .from("report_layouts")
      .select("layout")
      .eq("organization_id", orgId)
      .is("user_id", null)
      .maybeSingle();

    if (orgLayout?.layout) {
      return mergeWithDefault(orgLayout.layout);
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
