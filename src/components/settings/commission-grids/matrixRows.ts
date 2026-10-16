import type { GridSnapshot } from "@/lib/commission/adminTypes";
import type { GridDraft } from "@/lib/commission/gridDraft";
import { CATEGORY_LABELS, type CompCategory } from "@/lib/commission/types";
import type { MatrixRow } from "./RateMatrix";

const ages = (min: string, max: string) =>
  min === "" && max === "" ? "Any age" : min === "" ? `Up to ${max}` : max === "" ? `${min} and over` : `Ages ${min}–${max}`;

export const variantDetail = (minAge: string, maxAge: string, terms: string) =>
  terms.trim() === "" ? ages(minAge, maxAge) : `${ages(minAge, maxAge)} · ${terms} yr`;

const heading = (category: CompCategory, carrier: string, productName: string, isActive: boolean) =>
  `${CATEGORY_LABELS[category]} · ${carrier} · ${productName}${isActive ? "" : " (inactive)"}`;

/** Matrix rows for an editor draft, grouped by product in the draft's order. */
export function draftRows(draft: GridDraft): MatrixRow[] {
  return draft.products.flatMap((product) =>
    draft.variants
      .filter((variant) => variant.productRef === product.ref)
      .map((variant, index) => ({
        ref: variant.ref,
        productHeading: index === 0 ? heading(product.category, product.carrier, product.productName, product.isActive) : undefined,
        variantLabel: variant.label,
        variantDetail: variantDetail(variant.minAge, variant.maxAge, variant.terms),
      })),
  );
}

/** Matrix rows for a read-only snapshot (AgentFlow grids). */
export function snapshotRows(snapshot: GridSnapshot): MatrixRow[] {
  return snapshot.products.flatMap((product) =>
    snapshot.variants
      .filter((variant) => variant.productId === product.id)
      .map((variant, index) => ({
        ref: variant.id,
        productHeading: index === 0 ? heading(product.category, product.carrier, product.productName, product.isActive) : undefined,
        variantLabel: variant.label,
        variantDetail: variantDetail(
          variant.minAge === null ? "" : String(variant.minAge),
          variant.maxAge === null ? "" : String(variant.maxAge),
          variant.termYears?.join(", ") ?? "",
        ),
      })),
  );
}
