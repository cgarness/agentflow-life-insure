const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://jncvvsvckxhqgqvkppmj.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpuY3Z2c3Zja3hocWdxdmtwcG1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1Njc4ODYsImV4cCI6MjA4ODE0Mzg4Nn0.wlLRugR92OUUpV7_vl8T8EnfPqrAosJ-CfNpKmw0IPE";
const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnostic() {
  const table = "inbound_routing_settings";
  console.log(`Checking columns for table: ${table}`);
  const { data, error } = await supabase.from(table).select("*").limit(1);
  if (error) {
    console.log(`  Error: ${error.message}`);
  } else if (data && data.length > 0) {
    console.log(`  Columns: ${Object.keys(data[0]).join(", ")}`);
    console.log(`  Sample Data: ${JSON.stringify(data[0], null, 2)}`);
  } else {
    console.log("  No data found in inbound_routing_settings table.");
  }
}

diagnostic().catch(console.error);
