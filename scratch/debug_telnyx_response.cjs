
const { createClient } = require("@supabase/supabase-js");
const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });

const supabaseUrl = process.env.VITE_SUPABASE_URL || "https://ovofnshmupfskmsaomun.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data: settings } = await supabase
    .from("telnyx_settings")
    .select("api_key")
    .limit(1)
    .single();

  if (!settings?.api_key) {
    console.error("API Key not found");
    return;
  }

  const apiKey = settings.api_key;
  const area_code = "213";

  console.log("Searching for numbers in area code:", area_code);
  const response = await fetch(
    `https://api.telnyx.com/v2/available_phone_numbers?filter[country_code]=US&filter[national_destination_code]=${area_code}&filter[limit]=1`,
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    }
  );

  const data = await response.json();
  console.log("RAW RESPONSE:");
  console.log(JSON.stringify(data, null, 2));
}

main();
