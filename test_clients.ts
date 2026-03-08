import { clientsSupabaseApi } from "./src/lib/supabase-clients.ts";
async function check() {
  try {
    const clients = await clientsSupabaseApi.getAll();
    console.log("Clients Fetch count:", clients.length);
  } catch (err) {
    console.error("Error fetching clients:", err);
  }
}
check();
