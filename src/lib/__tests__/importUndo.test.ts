import { describe, it, expect, beforeEach, vi } from "vitest";

// Hoisted state the mocked supabase client reads/records.
const { calls, rpcResults } = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown }>,
  rpcResults: {} as Record<string, { data: unknown; error: unknown }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      calls.push({ name, args });
      return Promise.resolve(rpcResults[name] ?? { data: null, error: null });
    },
  },
}));

import {
  dedupeValidImportIds,
  importUndoRowStatus,
  describeImportUndoReason,
  previewImportUndo,
  finalizeImport,
  undoContactImport,
  type ImportUndoReasonCode,
} from "@/lib/supabase-import-undo";

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(rpcResults)) delete rpcResults[k];
});

describe("dedupeValidImportIds", () => {
  it("keeps distinct valid UUIDs only", () => {
    expect(dedupeValidImportIds([U1, U2, U1])).toEqual([U1, U2]);
  });
  it("drops non-strings, nulls, and malformed UUIDs", () => {
    expect(dedupeValidImportIds([U1, "nope", "", null, 5, undefined, "1234"])).toEqual([U1]);
  });
  it("returns [] for non-array input", () => {
    expect(dedupeValidImportIds(null)).toEqual([]);
    expect(dedupeValidImportIds(undefined)).toEqual([]);
    expect(dedupeValidImportIds("x")).toEqual([]);
  });
});

describe("importUndoRowStatus", () => {
  const now = Date.parse("2026-06-20T12:00:00Z");
  const recent = "2026-06-20T06:00:00Z"; // 6h ago
  const old = "2026-06-18T06:00:00Z"; // > 24h ago

  it("marks an undone import not undoable", () => {
    const s = importUndoRowStatus({ undoStatus: "undone", importedLeadIds: [U1], date: recent, now });
    expect(s).toEqual({ label: "Undone", undoable: false });
  });
  it("marks a legacy empty-ID import 'Undo unavailable'", () => {
    const s = importUndoRowStatus({ importedLeadIds: [], date: recent, now });
    expect(s.label).toBe("Undo unavailable");
    expect(s.undoable).toBe(false);
    expect(s.reason).toBe("legacy_no_ids");
  });
  it("marks an import older than 24h 'Expired'", () => {
    const s = importUndoRowStatus({ importedLeadIds: [U1], date: old, now });
    expect(s.label).toBe("Expired");
    expect(s.undoable).toBe(false);
    expect(s.reason).toBe("expired");
  });
  it("marks a recent import with IDs 'Active' + undoable", () => {
    const s = importUndoRowStatus({ importedLeadIds: [U1], date: recent, now });
    expect(s).toEqual({ label: "Active", undoable: true });
  });
  it("undone takes precedence over expiry/legacy", () => {
    const s = importUndoRowStatus({ undoStatus: "undone", importedLeadIds: [], date: old, now });
    expect(s.label).toBe("Undone");
  });
});

describe("describeImportUndoReason", () => {
  it("gives distinct, non-empty messages for representative codes", () => {
    const codes: ImportUndoReasonCode[] = [
      "expired", "legacy_no_ids", "invalid_import_provenance", "already_undone",
      "has_calls", "has_messages", "foreign_campaign_membership", "lead_missing",
    ];
    const msgs = codes.map(describeImportUndoReason);
    msgs.forEach((m) => expect(m.length).toBeGreaterThan(0));
    expect(new Set(msgs).size).toBe(codes.length);
  });
});

describe("RPC wrappers", () => {
  it("previewImportUndo calls preview_contact_import_undo with p_import_id and returns data", async () => {
    rpcResults["preview_contact_import_undo"] = { data: { eligible: true, imported_id_count: 3, blocked_reason_codes: [] }, error: null };
    const res = await previewImportUndo(U1);
    expect(calls[0]).toEqual({ name: "preview_contact_import_undo", args: { p_import_id: U1 } });
    expect(res.eligible).toBe(true);
    expect(res.imported_id_count).toBe(3);
  });

  it("finalizeImport calls finalize_contact_import and returns the outcome", async () => {
    rpcResults["finalize_contact_import"] = { data: { finalized: true, status: "completed_with_skips" }, error: null };
    const res = await finalizeImport(U1);
    expect(calls[0]).toEqual({ name: "finalize_contact_import", args: { p_import_id: U1 } });
    expect(res.status).toBe("completed_with_skips");
  });

  it("undoContactImport calls undo_contact_import and returns counts", async () => {
    rpcResults["undo_contact_import"] = { data: { success: true, deleted_leads: 4, deleted_campaign_rows: 4, undo_status: "undone" }, error: null };
    const res = await undoContactImport(U1);
    expect(calls[0]).toEqual({ name: "undo_contact_import", args: { p_import_id: U1 } });
    expect(res.success).toBe(true);
    expect(res.deleted_leads).toBe(4);
  });

  it("undoContactImport surfaces a blocked rejection (success:false)", async () => {
    rpcResults["undo_contact_import"] = { data: { success: false, reason: "ineligible", blocked_reason_codes: ["has_calls"] }, error: null };
    const res = await undoContactImport(U1);
    expect(res.success).toBe(false);
    expect(res.blocked_reason_codes).toContain("has_calls");
  });

  it("wrappers throw on RPC error", async () => {
    rpcResults["undo_contact_import"] = { data: null, error: { message: "boom" } };
    await expect(undoContactImport(U1)).rejects.toBeTruthy();
  });
});
