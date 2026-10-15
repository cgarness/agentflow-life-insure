import type { GridChangeSet, GridSnapshot } from "./adminTypes";
import { equals, parseDecimal } from "./money";
import type { CompCategory } from "./types";

/**
 * Private-grid editor draft. Pure functions: snapshot -> draft, draft validation (the database rules,
 * mirrored so mistakes show before saving), and draft -> one atomic change set at the loaded revision.
 * Existing rows are referenced by id; new rows by a draft-local ref ("new:N"). Removed rows are simply
 * absent from the draft. Nothing is rounded, trimmed or repaired: invalid input is reported, not fixed.
 */
export interface DraftProduct {
  ref: string;
  id: string | null;
  category: CompCategory;
  carrier: string;
  productName: string;
  isActive: boolean;
}

export interface DraftVariant {
  ref: string;
  id: string | null;
  productRef: string;
  label: string;
  /** Text inputs: "" = unbounded side / not applicable. Terms are comma-separated ("10, 20"). */
  minAge: string;
  maxAge: string;
  terms: string;
  source: string;
  notes: string;
}

export interface GridDraft {
  name: string;
  effectiveDate: string;
  isActive: boolean;
  /** Highest first. */
  levels: number[];
  products: DraftProduct[];
  variants: DraftVariant[];
  /** variant ref -> contract level -> exact rate text ("" = blank, i.e. no rate). */
  rates: Record<string, Record<number, string>>;
}

export interface DraftIssue {
  scope: "grid" | "level" | "product" | "variant" | "rate";
  ref?: string;
  level?: number;
  message: string;
}

const RATE_TEXT = /^(0|[1-9]\d{0,2})(\.\d{1,2})?$/;
const WHOLE = /^(0|[1-9]\d{0,2})$/;

export function draftFromSnapshot(snapshot: GridSnapshot): GridDraft {
  const references = new Map(snapshot.references.map((x) => [x.variantId, x]));
  const rates: GridDraft["rates"] = {};
  for (const rate of snapshot.rates) (rates[rate.variantId] ??= {})[rate.contractLevel] = rate.ratePercent;
  return {
    name: snapshot.grid.name,
    effectiveDate: snapshot.grid.effectiveDate,
    isActive: snapshot.grid.isActive,
    levels: [...snapshot.grid.contractLevels],
    products: snapshot.products.map((p) => ({ ref: p.id, id: p.id, category: p.category, carrier: p.carrier, productName: p.productName, isActive: p.isActive })),
    variants: snapshot.variants.map((v) => ({
      ref: v.id,
      id: v.id,
      productRef: v.productId,
      label: v.label,
      minAge: v.minAge === null ? "" : String(v.minAge),
      maxAge: v.maxAge === null ? "" : String(v.maxAge),
      terms: v.termYears === null ? "" : v.termYears.join(", "),
      source: references.get(v.id)?.source ?? "",
      notes: references.get(v.id)?.notes ?? "",
    })),
    rates,
  };
}

/** Parsed variant fields, or null where the text is invalid (reported by validateDraft). */
export function parseVariantFields(variant: DraftVariant) {
  const age = (text: string) => (text === "" ? null : WHOLE.test(text) && Number(text) <= 100 ? Number(text) : undefined);
  const parts = variant.terms.split(",").map((part) => part.trim());
  const terms =
    variant.terms.trim() === ""
      ? null
      : parts.every((part) => WHOLE.test(part) && Number(part) >= 1 && Number(part) <= 100)
        ? parts.map(Number)
        : undefined;
  return { minAge: age(variant.minAge), maxAge: age(variant.maxAge), terms };
}

/** A real calendar date in YYYY-MM-DD (no roll-over of impossible dates such as 2025-02-30). */
export function isIsoDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const trimmedLength = (text: string, min: number, max: number) => text === text.trim() && text.length >= min && text.length <= max;

function overlaps(a: ReturnType<typeof parseVariantFields>, b: ReturnType<typeof parseVariantFields>): boolean {
  const lowA = a.minAge ?? 0, highA = a.maxAge ?? 100, lowB = b.minAge ?? 0, highB = b.maxAge ?? 100;
  if (Math.max(lowA, lowB) > Math.min(highA, highB)) return false;
  if (a.terms === null && b.terms === null) return true;
  return !!a.terms && !!b.terms && a.terms.some((term) => b.terms!.includes(term));
}

export function validateDraft(draft: GridDraft): DraftIssue[] {
  const issues: DraftIssue[] = [];
  if (!trimmedLength(draft.name, 1, 120)) issues.push({ scope: "grid", message: "The grid name needs 1 to 120 characters, without leading or trailing spaces." });
  if (!isIsoDate(draft.effectiveDate)) issues.push({ scope: "grid", message: "Choose an effective date." });
  if (draft.levels.length < 1 || draft.levels.length > 60) issues.push({ scope: "level", message: "A grid needs 1 to 60 contract levels." });

  const identities = new Set<string>();
  for (const product of draft.products) {
    if (!trimmedLength(product.carrier, 1, 120)) issues.push({ scope: "product", ref: product.ref, message: "Carrier names need 1 to 120 characters, without leading or trailing spaces." });
    if (!trimmedLength(product.productName, 1, 160)) issues.push({ scope: "product", ref: product.ref, message: "Product names need 1 to 160 characters, without leading or trailing spaces." });
    const identity = `${product.category}\u0000${product.carrier}\u0000${product.productName}`;
    if (identities.has(identity)) issues.push({ scope: "product", ref: product.ref, message: "That carrier already has a product with this name in this category." });
    identities.add(identity);
  }

  for (const product of draft.products) {
    const variants = draft.variants.filter((v) => v.productRef === product.ref);
    const parsed = variants.map((variant) => ({ variant, fields: parseVariantFields(variant) }));
    const labels = new Set<string>();
    for (const { variant, fields } of parsed) {
      const add = (message: string) => issues.push({ scope: "variant", ref: variant.ref, message });
      if (variant.label !== variant.label.trim() || variant.label.length > 120) add("Variant labels can be up to 120 characters, without leading or trailing spaces.");
      if (labels.has(variant.label)) add("Each variant of a product needs a different label.");
      labels.add(variant.label);
      if (variant.label === "" && variants.length > 1) add("Only a product with a single variant may leave its label blank.");
      if (fields.minAge === undefined || fields.maxAge === undefined) add("Ages must be whole numbers from 0 to 100 (blank = no limit).");
      else if (fields.minAge !== null && fields.maxAge !== null && fields.minAge > fields.maxAge) add("The minimum age can't be above the maximum age.");
      if (fields.terms === undefined) add("Term lengths must be whole numbers from 1 to 100, separated by commas.");
      else if (fields.terms && (new Set(fields.terms).size !== fields.terms.length || fields.terms.length > 20)) add("List each term length once (at most 20).");
      if (variant.source.length > 2000) add("The source reference can be up to 2,000 characters.");
      if (variant.notes.length > 4000) add("Notes can be up to 4,000 characters.");
    }
    const valid = parsed.filter(({ fields }) => fields.minAge !== undefined && fields.maxAge !== undefined && fields.terms !== undefined);
    if (valid.some(({ fields }) => fields.terms === null) && valid.some(({ fields }) => fields.terms !== null)) {
      issues.push({ scope: "product", ref: product.ref, message: "A product can't mix variants with and without term lengths." });
    }
    for (let i = 0; i < valid.length; i += 1) {
      for (let j = i + 1; j < valid.length; j += 1) {
        if (overlaps(valid[i].fields, valid[j].fields)) {
          issues.push({ scope: "variant", ref: valid[j].variant.ref, message: "Two variants of this product would match the same age and term." });
        }
      }
    }
  }

  for (const variant of draft.variants) {
    for (const level of draft.levels) {
      const text = draft.rates[variant.ref]?.[level] ?? "";
      if (text !== "" && (!RATE_TEXT.test(text) || Number(text) > 300)) {
        issues.push({ scope: "rate", ref: variant.ref, level, message: "Rates must be between 0 and 300 with at most two decimal places." });
      }
    }
  }
  return issues;
}

const sameRate = (a: string, b: string) => {
  if (a === b) return true;
  const x = parseDecimal(a), y = parseDecimal(b);
  return !!x && !!y && equals(x, y);
};

/** The change set that turns the snapshot into the draft (assumes validateDraft returned no issues). */
export function buildChangeSet(snapshot: GridSnapshot, draft: GridDraft): GridChangeSet {
  const changes: GridChangeSet = {};
  const g = snapshot.grid;
  const levelsChanged = draft.levels.join(",") !== g.contractLevels.join(",");
  if (draft.name !== g.name || draft.effectiveDate !== g.effectiveDate || draft.isActive !== g.isActive || levelsChanged) {
    changes.grid = { name: draft.name, effective_date: draft.effectiveDate, is_active: draft.isActive, contract_levels: draft.levels };
  }

  const keptProducts = new Set(draft.products.flatMap((p) => (p.id ? [p.id] : [])));
  const keptVariants = new Set(draft.variants.flatMap((v) => (v.id ? [v.id] : [])));
  const deletedProducts = snapshot.products.filter((p) => !keptProducts.has(p.id)).map((p) => p.id);
  const deletedVariants = snapshot.variants.filter((v) => !keptVariants.has(v.id) && keptProducts.has(v.productId)).map((v) => v.id);
  if (deletedProducts.length) changes.delete_product_ids = deletedProducts;
  if (deletedVariants.length) changes.delete_variant_ids = deletedVariants;

  const originalProducts = new Map(snapshot.products.map((p) => [p.id, p]));
  const products: NonNullable<GridChangeSet["products"]> = [];
  for (const p of draft.products) {
    const fields = { category: p.category, carrier: p.carrier, product_name: p.productName, is_active: p.isActive };
    const before = p.id ? originalProducts.get(p.id) : undefined;
    if (!p.id) products.push({ key: p.ref, ...fields });
    else if (before && (before.category !== p.category || before.carrier !== p.carrier || before.productName !== p.productName || before.isActive !== p.isActive)) {
      products.push({ id: p.id, ...fields });
    }
  }
  if (products.length) changes.products = products;

  const productByRef = new Map(draft.products.map((p) => [p.ref, p]));
  const originalVariants = new Map(snapshot.variants.map((v) => [v.id, v]));
  const originalReferences = new Map(snapshot.references.map((x) => [x.variantId, x]));
  const variants: NonNullable<GridChangeSet["variants"]> = [];
  for (const v of draft.variants) {
    const parsed = parseVariantFields(v);
    const fields = { label: v.label, min_age: parsed.minAge ?? null, max_age: parsed.maxAge ?? null, term_years: parsed.terms ?? null };
    const reference = v.source === "" && v.notes === "" ? null : { source: v.source, notes: v.notes };
    if (!v.id) {
      const product = productByRef.get(v.productRef)!;
      const parent = product.id ? { product_id: product.id } : { product_key: product.ref };
      variants.push({ key: v.ref, ...parent, ...fields, ...(reference ? { reference } : {}) });
      continue;
    }
    const before = originalVariants.get(v.id)!;
    const ref = originalReferences.get(v.id);
    const referenceChanged = (ref?.source ?? "") !== v.source || (ref?.notes ?? "") !== v.notes;
    const fieldsChanged =
      before.label !== v.label || before.minAge !== fields.min_age || before.maxAge !== fields.max_age ||
      (before.termYears ?? []).join(",") !== (fields.term_years ?? []).join(",") || (before.termYears === null) !== (fields.term_years === null);
    if (fieldsChanged || referenceChanged) variants.push({ id: v.id, ...fields, ...(referenceChanged ? { reference } : {}) });
  }
  if (variants.length) changes.variants = variants;

  const originalRates = new Map<string, Map<number, string>>();
  for (const r of snapshot.rates) {
    if (!originalRates.has(r.variantId)) originalRates.set(r.variantId, new Map());
    originalRates.get(r.variantId)!.set(r.contractLevel, r.ratePercent);
  }
  const allLevels = [...new Set([...draft.levels, ...g.contractLevels])];
  const rates: NonNullable<GridChangeSet["rates"]> = [];
  for (const v of draft.variants) {
    for (const level of allLevels) {
      const now = draft.levels.includes(level) ? draft.rates[v.ref]?.[level] ?? "" : "";
      const before = v.id ? originalRates.get(v.id)?.get(level) ?? "" : "";
      if (sameRate(now, before) || (!v.id && now === "")) continue;
      const target = v.id ? { variant_id: v.id } : { variant_key: v.ref };
      rates.push({ ...target, contract_level: level, rate_percent: now === "" ? null : now });
    }
  }
  if (rates.length) changes.rates = rates;
  return changes;
}

export const isEmptyChangeSet = (changes: GridChangeSet) => Object.keys(changes).length === 0;

/** Non-blank rate cells at one level (to confirm a level removal). */
export const ratesAtLevel = (draft: GridDraft, level: number) =>
  draft.variants.filter((v) => (draft.rates[v.ref]?.[level] ?? "") !== "").length;
