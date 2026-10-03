import { A2pError, type Account, type Db, type Registration } from "./types.ts";
export function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw new A2pError("DATABASE_ERROR", "Could not save or retrieve registration data.", 503);
  return result.data;
}
export async function registration(db: Db, org: string): Promise<Registration | null> {
  return checked(await db.from("a2p_registrations").select("*").eq("organization_id", org).maybeSingle());
}
export async function account(db: Db, org: string): Promise<Account | null> {
  return checked(await db.from("a2p_accounts").select("*").eq("organization_id", org).maybeSingle());
}
export async function history(db: Db, org: string, kind: string, detail: unknown, actor?: string) {
  checked(await db.from("a2p_history").insert({ organization_id: org, kind, detail, actor_id: actor ?? null }));
}
export async function lockOperation(db: Db, r: Registration, kind: string) {
  const id = crypto.randomUUID();
  const row = checked(
    await db.from("a2p_registrations").update({
      operation_id: id,
      version: r.version + 1,
      operation_kind: kind,
      operation_started_at: new Date().toISOString(),
    }).eq("organization_id", r.organization_id).eq("version", r.version).is("operation_id", null).is("sync_token", null)
      .select("*")
      .maybeSingle(),
  );
  if (!row) {
    throw new A2pError(
      "OPERATION_PENDING",
      "Another action is in progress or needs reconciliation. Refresh status before continuing.",
      409,
    );
  }
  return id;
}
export async function patchOperation(db: Db, org: string, id: string, patch: Record<string, unknown>) {
  const row = checked(
    await db.from("a2p_registrations").update({ ...patch, updated_at: new Date().toISOString() }).eq(
      "organization_id",
      org,
    ).eq("operation_id", id).select("*").maybeSingle(),
  );
  if (!row) {
    throw new A2pError(
      "OPERATION_LOST",
      "Registration changed during this action. Contact support to reconcile.",
      409,
      true,
    );
  }
  return row as Registration;
}
export const unlock = (db: Db, org: string, id: string) =>
  patchOperation(db, org, id, { operation_id: null, operation_kind: null, operation_started_at: null });
