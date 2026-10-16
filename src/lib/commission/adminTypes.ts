import type { CalculatorRate, CalculatorVariant, CompCategory } from "./types";

/** Agency-admin grid management types (Settings › Commission Grids). */
export type GridOrigin = "agentflow_reference" | "blank" | "structure_copy" | "full_copy";
export type CreateGridMode = "blank" | "structure" | "full";

/** Default editable levels for blank grids and structure copies: 145 down to 65 in steps of 5. */
export const DEFAULT_CONTRACT_LEVELS: readonly number[] = Array.from({ length: 17 }, (_, index) => 145 - index * 5);

export interface SharedGridCatalogEntry {
  id: string;
  name: string;
  effectiveDate: string;
  contractLevels: number[];
  isEnabled: boolean;
}

export interface AdminGridSummary {
  id: string;
  name: string;
  effectiveDate: string;
  isActive: boolean;
  contractLevels: number[];
  revision: number;
  origin: GridOrigin;
  shared: boolean;
  updatedAt: string;
  updatedByName: string | null;
  productCount: number;
}

export interface AdminOverview {
  calculatorGridId: string | null;
  grids: AdminGridSummary[];
}

export interface SnapshotProduct {
  id: string;
  category: CompCategory;
  carrier: string;
  productName: string;
  isActive: boolean;
}

export interface VariantReference {
  variantId: string;
  source: string | null;
  notes: string | null;
}

export interface GridSnapshot {
  grid: Omit<AdminGridSummary, "productCount"> & { editable: boolean };
  products: SnapshotProduct[];
  variants: CalculatorVariant[];
  rates: CalculatorRate[];
  references: VariantReference[];
}

/** comp_save_grid_changes payload (snake_case, exactly as the server expects). */
export interface GridChangeSet {
  grid?: { name: string; effective_date: string; is_active: boolean; contract_levels: number[] };
  delete_product_ids?: string[];
  delete_variant_ids?: string[];
  products?: Array<
    ({ id: string } | { key: string }) & { category: CompCategory; carrier: string; product_name: string; is_active: boolean }
  >;
  variants?: Array<
    ({ id: string } | { key: string; product_id: string } | { key: string; product_key: string }) & {
      label: string;
      min_age: number | null;
      max_age: number | null;
      term_years: number[] | null;
      reference?: { source: string; notes: string } | null;
    }
  >;
  rates?: Array<({ variant_id: string } | { variant_key: string }) & { contract_level: number; rate_percent: string | null }>;
}
