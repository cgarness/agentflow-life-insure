import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = fs.readFileSync(".env", "utf8");
const urlMatch = env.match(/VITE_SUPABASE_URL="(.*)"/);
const keyMatch = env.match(/SUPABASE_SERVICE_ROLE_KEY="(.*)"/);
const supabaseUrl = urlMatch[1];
const supabaseKey = keyMatch[1];
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.rpc('get_policies', { table_name: 'leads' });
  if (error) {
    console.log("No RPC get_policies, let's just query pg_policies using rest if exposed, or fallback.");
  } else {
    console.log(data);
  }
}
run();
