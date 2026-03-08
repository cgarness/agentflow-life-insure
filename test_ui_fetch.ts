import { leadsSupabaseApi } from "./src/lib/supabase-contacts.ts";
async function check() {
  const leads = await leadsSupabaseApi.getAll();
  console.log("UI Fetch count:", leads.length);
  if (leads.length > 0) {
    console.log(leads[0]);
  }
}
check();
