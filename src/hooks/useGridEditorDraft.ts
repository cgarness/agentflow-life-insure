import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GridSnapshot } from "@/lib/commission/adminTypes";
import {
  buildChangeSet,
  draftFromSnapshot,
  isEmptyChangeSet,
  validateDraft,
  type DraftProduct,
  type DraftVariant,
  type GridDraft,
} from "@/lib/commission/gridDraft";
import type { CompCategory } from "@/lib/commission/types";

const emptyVariant = (ref: string, productRef: string): DraftVariant => ({
  ref, id: null, productRef, label: "", minAge: "", maxAge: "", terms: "", source: "", notes: "",
});

const withoutLevel = (rates: GridDraft["rates"], level: number): GridDraft["rates"] =>
  Object.fromEntries(
    Object.entries(rates).map(([ref, cells]) => [ref, Object.fromEntries(Object.entries(cells).filter(([l]) => Number(l) !== level))]),
  );

/**
 * Editor state for one private grid. The draft is built from a server snapshot (`base`) and saved as ONE
 * change set at `base.grid.revision`. A newer snapshot (another admin's save, a focus refresh) replaces
 * the draft only while nothing is unsaved; otherwise it is reported as `newerRevision` and the next save
 * is refused as stale by the server — never silently overwritten.
 */
export function useGridEditorDraft(snapshot: GridSnapshot | undefined) {
  const [base, setBase] = useState<GridSnapshot | null>(null);
  const [draft, setDraft] = useState<GridDraft | null>(null);
  /** After a successful save: the revision whose snapshot replaces the saved draft. */
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const counter = useRef(0);

  const changes = useMemo(() => (base && draft ? buildChangeSet(base, draft) : {}), [base, draft]);
  // Once a save succeeded its draft IS the saved content, even while the saved snapshot is still loading
  // (or that refresh failed): nothing is unsaved, so nothing is held or called unsaved.
  const dirty = savedRevision === null && !isEmptyChangeSet(changes);
  const issues = useMemo(() => (draft ? validateDraft(draft) : []), [draft]);

  useEffect(() => {
    if (!snapshot) return;
    const sameGrid = !!base && base.grid.id === snapshot.grid.id;
    const newer = sameGrid && snapshot.grid.revision !== base.grid.revision;
    const savedArrived = sameGrid && savedRevision !== null && snapshot.grid.revision >= savedRevision;
    if (!sameGrid || savedArrived || (newer && !dirty && savedRevision === null)) {
      setBase(snapshot);
      setDraft(draftFromSnapshot(snapshot));
      setSavedRevision(null);
    }
  }, [snapshot, base, dirty, savedRevision]);

  /** Replace the draft with a fresh snapshot (after "Reload" on a conflict). */
  const reset = useCallback((next: GridSnapshot) => {
    setBase(next);
    setDraft(draftFromSnapshot(next));
    setSavedRevision(null);
  }, []);

  const discard = useCallback(() => {
    if (base) setDraft(draftFromSnapshot(base));
  }, [base]);

  // Stable identities (they use only the state setter), so memoized matrix rows stay memoized.
  const actions = useMemo(() => {
    const update = (fn: (current: GridDraft) => GridDraft) => setDraft((current) => (current ? fn(current) : current));
    const nextRef = () => `new:${(counter.current += 1)}`;
    return {
      setDetails: (patch: Partial<Pick<GridDraft, "name" | "effectiveDate" | "isActive">>) => update((d) => ({ ...d, ...patch })),
      addLevel: (level: number) =>
        update((d) => (d.levels.includes(level) ? d : { ...d, levels: [...d.levels, level].sort((a, b) => b - a) })),
      removeLevel: (level: number) =>
        update((d) => ({ ...d, levels: d.levels.filter((l) => l !== level), rates: withoutLevel(d.rates, level) })),
      addProduct: (product: { category: CompCategory; carrier: string; productName: string }) =>
        update((d) => {
          const productRef = nextRef();
          const added: DraftProduct = { ref: productRef, id: null, isActive: true, ...product };
          return { ...d, products: [...d.products, added], variants: [...d.variants, emptyVariant(nextRef(), productRef)] };
        }),
      updateProduct: (ref: string, patch: Partial<Omit<DraftProduct, "ref" | "id">>) =>
        update((d) => ({ ...d, products: d.products.map((p) => (p.ref === ref ? { ...p, ...patch } : p)) })),
      removeProduct: (ref: string) =>
        update((d) => {
          const removed = new Set(d.variants.filter((v) => v.productRef === ref).map((v) => v.ref));
          return {
            ...d,
            products: d.products.filter((p) => p.ref !== ref),
            variants: d.variants.filter((v) => !removed.has(v.ref)),
            rates: Object.fromEntries(Object.entries(d.rates).filter(([variantRef]) => !removed.has(variantRef))),
          };
        }),
      addVariant: (productRef: string) => update((d) => ({ ...d, variants: [...d.variants, emptyVariant(nextRef(), productRef)] })),
      updateVariant: (ref: string, patch: Partial<Omit<DraftVariant, "ref" | "id" | "productRef">>) =>
        update((d) => ({ ...d, variants: d.variants.map((v) => (v.ref === ref ? { ...v, ...patch } : v)) })),
      removeVariant: (ref: string) =>
        update((d) => {
          const { [ref]: _removed, ...rates } = d.rates;
          return { ...d, variants: d.variants.filter((v) => v.ref !== ref), rates };
        }),
      setRate: (variantRef: string, level: number, text: string) =>
        update((d) => ({ ...d, rates: { ...d.rates, [variantRef]: { ...(d.rates[variantRef] ?? {}), [level]: text } } })),
    };
  }, []);

  return {
    base,
    draft,
    changes,
    dirty,
    issues,
    /** Someone else saved a newer revision while this draft has unsaved changes. */
    newerRevision: !!snapshot && !!base && savedRevision === null && snapshot.grid.revision !== base.grid.revision,
    /** True between a successful save and the arrival of the saved snapshot. */
    awaitingSaved: savedRevision !== null,
    markSaved: setSavedRevision,
    reset,
    discard,
    actions,
  };
}
