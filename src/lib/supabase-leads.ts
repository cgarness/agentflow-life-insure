import { supabase } from "@/integrations/supabase/client";
import { Lead } from "@/lib/types";

export type ImportStrategy = "skip" | "update" | "import_new";

export async function importLeadsToSupabase(
  rows: Partial<Lead>[],
  organizationId: string | null = null,
  strategy: ImportStrategy = "skip"
): Promise<{ imported: number; duplicates: number; errors: number; importedLeadIds: string[] }> {
  let imported = 0;
  let duplicates = 0;
  let errors = 0;
  const importedLeadIds: string[] = [];

  // Pull existing phones and emails for duplicate check
  const { data: existing } = await supabase
    .from("leads")
    .select("id, phone, email");

  const existingByPhone = new Map<string, string>((existing || []).filter((r: any) => r.phone).map((r: any) => [r.phone, r.id]));
  const existingByEmail = new Map<string, string>((existing || []).filter((r: any) => r.email).map((r: any) => [r.email, r.id]));

  const toInsert: any[] = [];
  const toUpdate: { id: string; data: any }[] = [];

  rows.forEach((row) => {
    let existingId: string | undefined;
    if (row.phone && existingByPhone.has(row.phone)) existingId = existingByPhone.get(row.phone);
    else if (row.email && existingByEmail.has(row.email)) existingId = existingByEmail.get(row.email);

    const mappedRow = {
      first_name: row.firstName || "",
      last_name: row.lastName || "",
      phone: row.phone || "",
      email: row.email || "",
      state: row.state || "",
      status: row.status || "New",
      lead_source: row.leadSource || "",
      lead_score: row.leadScore ?? 5,
      age: row.age || null,
      date_of_birth: row.dateOfBirth || null,
      health_status: row.healthStatus || "",
      best_time_to_call: row.bestTimeToCall || "",
      notes: row.notes || "",
      assigned_agent_id: row.assignedAgentId || null,
      organization_id: organizationId,
      custom_fields: row.customFields || {},
      updated_at: new Date().toISOString(),
    };

    if (existingId) {
      duplicates++;
      if (strategy === "skip") {
        return;
      } else if (strategy === "update") {
        toUpdate.push({ id: existingId, data: mappedRow });
        return;
      }
      // strategy === "import_new" falls through to toInsert
    }
    toInsert.push(mappedRow);
  });

  // Handle Updates
  for (const update of toUpdate) {
    const { error } = await supabase.from("leads").update(update.data).eq("id", update.id);
    if (error) {
      console.error("Supabase import update error:", error.message);
      errors++;
    } else {
      imported++;
      importedLeadIds.push(update.id);
    }
  }

  // Handle Inserts in batches
  const BATCH_SIZE = 50;
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase.from("leads").insert(batch).select("id");
    if (error) {
      console.error("Supabase import insert batch error:", error.message);
      errors += batch.length;
    } else {
      imported += batch.length;
      if (data) {
        importedLeadIds.push(...data.map((r: any) => r.id));
      }
    }
  }

  return { imported, duplicates, errors, importedLeadIds };
}
