import { supabase } from "@/integrations/supabase/client";
import { Lead } from "@/lib/types";

export async function importLeadsToSupabase(
  rows: Partial<Lead>[]
): Promise<{ imported: number; duplicates: number; errors: number }> {
  let imported = 0;
  let duplicates = 0;
  let errors = 0;

  // Pull existing phones and emails for duplicate check
  const { data: existing } = await supabase
    .from("leads")
    .select("phone, email");

  const existingPhones = new Set((existing || []).map((r: any) => r.phone).filter(Boolean)); // eslint-disable-line @typescript-eslint/no-explicit-any
  const existingEmails = new Set((existing || []).map((r: any) => r.email).filter(Boolean)); // eslint-disable-line @typescript-eslint/no-explicit-any

  // Filter out duplicates
  const toInsert = rows.filter((row) => {
    if (row.phone && existingPhones.has(row.phone)) { duplicates++; return false; }
    if (row.email && existingEmails.has(row.email)) { duplicates++; return false; }
    return true;
  });

  // Map to Supabase column names (snake_case)
  const mapped = toInsert.map((row) => ({
    first_name: row.firstName || "",
    last_name: row.lastName || "",
    phone: row.phone || "",
    email: row.email || "",
    state: row.state || "",
    status: row.status || "New",
    lead_source: row.leadSource || "",
    age: row.age || null,
    date_of_birth: row.dateOfBirth || null,
    health_status: row.healthStatus || "",
    best_time_to_call: row.bestTimeToCall || "",
    notes: row.notes || "",
    assigned_agent_id: row.assignedAgentId || null,
  }));

  // Insert in batches of 50
  const BATCH_SIZE = 50;
  for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
    const batch = mapped.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("leads").insert(batch);
    if (error) {
      console.error("Supabase import batch error:", error.message);
      errors += batch.length;
    } else {
      imported += batch.length;
    }
  }

  return { imported, duplicates, errors };
}
