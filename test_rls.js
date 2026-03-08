import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = fs.readFileSync(".env", "utf8");
const urlMatch = env.match(/VITE_SUPABASE_URL="(.*)"/);
const keyMatch = env.match(/SUPABASE_SERVICE_ROLE_KEY="(.*)"/); // use service role

const supabaseUrl = urlMatch ? urlMatch[1] : "";
const supabaseServiceKey = keyMatch ? keyMatch[1] : "";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkRLS() {
    const { data, error } = await supabase.rpc('get_table_info', { table_name: 'leads' });
    console.log("RPC Error:", error);
    console.log("Data:", data);
}

checkRLS();
