import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type {
  AdminOverview,
  CreateGridMode,
  GridChangeSet,
  GridSnapshot,
  SharedGridCatalogEntry,
} from "./adminTypes";
import { CommissionApiError, toCommissionError } from "./errors";
import { categorySchema, idSchema, levelSchema, rateTextSchema } from "./schemas";

/**
 * Agency-admin grid management. Every write is one server operation that re-checks the caller's agency
 * admin role and organization itself; the client never names an organization. Responses are validated.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const origin = z.enum(["agentflow_reference", "blank", "structure_copy", "full_copy"]);
const gridFields = {
  id: idSchema,
  name: z.string(),
  effective_date: isoDate,
  is_active: z.boolean(),
  contract_levels: z.array(levelSchema).min(1),
  revision: z.number().int().positive(),
  origin,
  shared: z.boolean(),
  updated_at: z.string(),
  updated_by_name: z.string().nullable(),
};
const toGrid = (g: z.infer<z.ZodObject<typeof gridFields>>) => ({
  id: g.id,
  name: g.name,
  effectiveDate: g.effective_date,
  isActive: g.is_active,
  contractLevels: g.contract_levels,
  revision: g.revision,
  origin: g.origin,
  shared: g.shared,
  updatedAt: g.updated_at,
  updatedByName: g.updated_by_name,
});

const catalogSchema = z.array(
  z.object({ id: idSchema, name: z.string(), effective_date: isoDate, contract_levels: z.array(levelSchema), is_enabled: z.boolean() }),
);
const overviewSchema = z.object({
  calculator_grid_id: idSchema.nullable(),
  grids: z.array(z.object({ ...gridFields, product_count: z.number().int().min(0) })),
});
const ageBound = z.number().int().min(0).max(100).nullable();
const snapshotSchema = z.object({
  grid: z.object({ ...gridFields, editable: z.boolean() }),
  products: z.array(z.object({ id: idSchema, category: categorySchema, carrier: z.string(), product_name: z.string(), is_active: z.boolean() })),
  variants: z.array(
    z.object({
      id: idSchema,
      product_id: idSchema,
      label: z.string(),
      min_age: ageBound,
      max_age: ageBound,
      term_years: z.array(z.number().int()).nullable(),
    }),
  ),
  rates: z.array(z.object({ variant_id: idSchema, contract_level: levelSchema, rate_percent: rateTextSchema })),
  references: z.array(z.object({ variant_id: idSchema, source: z.string().nullable(), notes: z.string().nullable() })),
});

async function call<T>(promise: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>, schema: z.ZodType<T>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw toCommissionError(error);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new CommissionApiError("failed", "The server sent an unexpected response. Reload and try again.");
  return parsed.data;
}

export async function fetchSharedGridCatalog(): Promise<SharedGridCatalogEntry[]> {
  const rows = await call(supabase.rpc("comp_list_shared_grid_catalog"), catalogSchema);
  return rows.map((r) => ({ id: r.id, name: r.name, effectiveDate: r.effective_date, contractLevels: r.contract_levels, isEnabled: r.is_enabled }));
}

export async function fetchAdminOverview(): Promise<AdminOverview> {
  const result = await call(supabase.rpc("comp_get_admin_overview"), overviewSchema);
  return {
    calculatorGridId: result.calculator_grid_id,
    grids: result.grids.map((g) => ({ ...toGrid(g), productCount: g.product_count })),
  };
}

export async function fetchGridSnapshot(gridId: string): Promise<GridSnapshot> {
  return toSnapshot(await call(supabase.rpc("comp_get_grid_snapshot", { p_grid_id: gridId }), snapshotSchema));
}

/** Validate and map a raw comp_get_grid_snapshot payload (throws on an unexpected shape). */
export function parseGridSnapshot(payload: unknown): GridSnapshot {
  return toSnapshot(snapshotSchema.parse(payload));
}

function toSnapshot(s: z.infer<typeof snapshotSchema>): GridSnapshot {
  return {
    grid: { ...toGrid(s.grid), editable: s.grid.editable },
    products: s.products.map((p) => ({ id: p.id, category: p.category, carrier: p.carrier, productName: p.product_name, isActive: p.is_active })),
    variants: s.variants.map((v) => ({ id: v.id, productId: v.product_id, label: v.label, minAge: v.min_age, maxAge: v.max_age, termYears: v.term_years })),
    rates: s.rates.map((r) => ({ variantId: r.variant_id, contractLevel: r.contract_level, ratePercent: r.rate_percent })),
    references: s.references.map((x) => ({ variantId: x.variant_id, source: x.source, notes: x.notes })),
  };
}

const enableSchema = z.object({ selected: z.boolean(), kept_existing_selection: z.boolean(), calculator_grid_id: idSchema });
export async function enableSharedGrid(gridId: string) {
  const r = await call(supabase.rpc("comp_enable_shared_grid", { p_grid_id: gridId }), enableSchema);
  return { selected: r.selected, keptExistingSelection: r.kept_existing_selection, calculatorGridId: r.calculator_grid_id };
}

const disableSchema = z.object({ disabled: z.boolean(), cleared_selection: z.boolean() });
export async function disableSharedGrid(gridId: string) {
  const r = await call(supabase.rpc("comp_disable_shared_grid", { p_grid_id: gridId }), disableSchema);
  return { disabled: r.disabled, clearedSelection: r.cleared_selection };
}

const selectSchema = z.object({ calculator_grid_id: idSchema.nullable(), changed: z.boolean() });
/** Compare-and-set: `expectedCurrent` is the selection the admin last saw. */
export async function selectCalculatorGrid(gridId: string | null, expectedCurrent: string | null) {
  const r = await call(
    supabase.rpc("comp_select_calculator_grid", { p_grid_id: gridId, p_expected_current: expectedCurrent }),
    selectSchema,
  );
  return { calculatorGridId: r.calculator_grid_id, changed: r.changed };
}

const createSchema = z.object({ grid_id: idSchema });
export async function createPrivateGrid(mode: CreateGridMode, name: string, effectiveDate: string, sourceGridId?: string) {
  const args = { p_mode: mode, p_name: name, p_effective_date: effectiveDate, ...(sourceGridId ? { p_source_grid_id: sourceGridId } : {}) };
  const r = await call(supabase.rpc("comp_create_private_grid", args), createSchema);
  return { gridId: r.grid_id };
}

const saveSchema = z.object({ grid_id: idSchema, revision: z.number().int().positive() });
export async function saveGridChanges(gridId: string, expectedRevision: number, changes: GridChangeSet) {
  const r = await call(
    supabase.rpc("comp_save_grid_changes", {
      p_grid_id: gridId,
      p_expected_revision: expectedRevision,
      p_changes: changes as unknown as Json,
    }),
    saveSchema,
  );
  return { revision: r.revision };
}

const deleteSchema = z.object({ deleted: z.boolean(), cleared_selection: z.boolean() });
export async function deletePrivateGrid(gridId: string, expectedRevision: number) {
  const r = await call(supabase.rpc("comp_delete_private_grid", { p_grid_id: gridId, p_expected_revision: expectedRevision }), deleteSchema);
  return { clearedSelection: r.cleared_selection };
}
