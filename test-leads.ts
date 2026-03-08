import { supabase } from "./src/integrations/supabase/client.ts";
async function check() {
  const { data, error } = await supabase.from('leads').select('*').limit(5);
  console.log("Data:", data, "Error:", error);
}
check();
