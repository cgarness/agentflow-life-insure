import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = fs.readFileSync(".env", "utf8");
const urlMatch = env.match(/VITE_SUPABASE_URL="(.*)"/);
const keyMatch = env.match(/VITE_SUPABASE_PUBLISHABLE_KEY="(.*)"/);

const supabaseUrl = urlMatch ? urlMatch[1] : "";
const supabaseAnonKey = keyMatch ? keyMatch[1] : "";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function check() {
    const { data, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(5);
    console.log("FETCH WITH ANON KEY:");
    console.log("Error:", error);
    console.log("Data count:", data ? data.length : 0);
    if (data && data.length > 0) {
        console.log("First lead:", data[0].first_name, data[0].last_name, "Agent:", data[0].assigned_agent_id);
    }
}

check();
