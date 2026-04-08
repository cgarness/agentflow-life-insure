import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnostic() {
  const tables = ["organization_settings", "contact_settings", "contact_management_settings", "organizations"];
  for (const table of tables) {
    console.log(`Checking table: ${table}`);
    const { error } = await supabase.from(table).select("*").limit(1);
    if (error) {
      console.log(`  Error: ${error.message}`);
    } else {
      console.log(`  Success! Table ${table} exists.`);
    }
  }
}

diagnostic().catch(console.error);
