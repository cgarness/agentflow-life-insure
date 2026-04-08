import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

async function testProfiles() {
  console.log("Testing profiles query...");
  // Try selecting all Expected Columns
  const allExpectedColumns = [
    "id", "first_name", "last_name", "email", "role", "phone", "status", "avatar_url",
    "availability_status", "theme_preference", "created_at", "last_login_at", "licensed_states",
    "resident_state", "commission_level", "upline_id", "onboarding_complete",
    "monthly_call_goal", "monthly_sales_goal", "monthly_policies_goal", "weekly_appointment_goal",
    "monthly_talk_time_goal_hours", "npn", "timezone", "onboarding_items",
    "win_sound_enabled", "email_notifications_enabled", "sms_notifications_enabled",
    "push_notifications_enabled", "carriers"
  ];

  console.log("1. Fetching allExpectedColumns...");
  const { data, error } = await supabase.from("profiles").select(allExpectedColumns.join(",")).limit(1);
  console.log("Error 1:", error);
  console.log("Data length:", data?.length);

  console.log("\n2. Fetching with safeColumns...");
  const safeColumns = [
    "id", "first_name", "last_name", "email", "role", "phone", "status", "avatar_url", 
    "availability_status", "theme_preference", "created_at"
  ];
  const { data: data2, error: error2 } = await supabase.from("profiles").select(safeColumns.join(",")).limit(1);
  console.log("Error 2:", error2);
  console.log("Data 2 length:", data2?.length);

  console.log("\n3. Fetching just *");
  const { data: data3, error: error3 } = await supabase.from("profiles").select("*").limit(1);
  console.log("Error 3:", error3);
  console.log("Data 3 length:", data3?.length);
  if (data3 && data3.length > 0) {
    console.log("Sample columns available:", Object.keys(data3[0]).join(", "));
  }
}

testProfiles().catch(console.error);
