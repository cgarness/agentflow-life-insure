
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env") });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Fetch API Key
  const { data: settings, error: settingsError } = await supabase
    .from("telnyx_settings")
    .select("api_key")
    .limit(1)
    .single();

  if (settingsError) {
    console.error("Error fetching telnyx_settings:", settingsError);
  } else {
    console.log("TELNYX_API_KEY=" + settings.api_key);
  }

  // Fetch Phone Numbers
  const { data: numbers, error: numbersError } = await supabase
    .from("phone_numbers")
    .select("phone_number")
    .eq("status", "active")
    .limit(10);

  if (numbersError) {
    console.error("Error fetching phone_numbers:", numbersError);
  } else {
    console.log("PHONE_NUMBERS=" + numbers.map(n => n.phone_number).join(","));
  }
}

main();
