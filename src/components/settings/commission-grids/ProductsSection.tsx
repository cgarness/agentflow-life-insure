import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DraftProduct, GridDraft } from "@/lib/commission/gridDraft";
import { CATEGORY_LABELS, CATEGORY_ORDER, type CompCategory } from "@/lib/commission/types";
import type { PendingConfirmation } from "./ConfirmActionDialog";
import type { EditorActions } from "./editorTypes";
import ProductCard from "./ProductCard";

interface ProductsSectionProps {
  draft: GridDraft;
  disabled: boolean;
  actions: EditorActions;
  messagesFor: (ref: string) => string[];
  confirm: (confirmation: PendingConfirmation) => void;
}

/** Carriers are a grid-local grouping of products (CRM-wide carrier records are never touched). */
function carrierGroups(products: DraftProduct[]) {
  const groups = new Map<string, DraftProduct[]>();
  for (const product of products) groups.set(product.carrier, [...(groups.get(product.carrier) ?? []), product]);
  return [...groups.entries()];
}

const ProductsSection: React.FC<ProductsSectionProps> = ({ draft, disabled, actions, messagesFor, confirm }) => {
  const [adding, setAdding] = useState<{ category: CompCategory; carrier: string; productName: string }>({ category: "term", carrier: "", productName: "" });
  const rateCount = (variantRefs: string[]) =>
    variantRefs.reduce((sum, ref) => sum + draft.levels.filter((level) => (draft.rates[ref]?.[level] ?? "") !== "").length, 0);
  const askDelete = (what: string, onConfirm: () => void, variantRefs: string[]) => {
    const rates = rateCount(variantRefs);
    confirm({
      title: `Delete ${what}?`,
      description: `${variantRefs.length} variant${variantRefs.length === 1 ? "" : "s"} and ${rates} rate${rates === 1 ? "" : "s"} are deleted when you save.`,
      confirmLabel: "Delete",
      destructive: true,
      onConfirm,
    });
  };
  const variantsOf = (product: DraftProduct) => draft.variants.filter((v) => v.productRef === product.ref);
  const renameCarrier = (products: DraftProduct[], carrier: string) => products.forEach((p) => actions.updateProduct(p.ref, { carrier }));

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Carriers and products</h3>
      {carrierGroups(draft.products).map(([carrier, products]) => (
        <div key={products[0].ref} className="space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="Carrier name" className="max-w-xs font-medium" value={carrier} maxLength={120} disabled={disabled}
              onChange={(e) => renameCarrier(products, e.target.value)} />
            <Button type="button" variant="ghost" size="sm" disabled={disabled}
              onClick={() => products.forEach((p) => actions.updateProduct(p.ref, { isActive: !products.every((x) => x.isActive) }))}>
              {products.every((p) => p.isActive) ? "Deactivate all" : "Activate all"}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={disabled}
              onClick={() => askDelete(carrier || "this carrier", () => products.forEach((p) => actions.removeProduct(p.ref)), products.flatMap((p) => variantsOf(p).map((v) => v.ref)))}>
              <Trash2 className="mr-1 h-4 w-4" aria-hidden /> Delete carrier
            </Button>
          </div>
          {products.map((product) => (
            <ProductCard key={product.ref} product={product} variants={variantsOf(product)} messagesFor={messagesFor}
              disabled={disabled} actions={actions} askDelete={askDelete} />
          ))}
        </div>
      ))}
      <div className="grid gap-2 rounded-lg border border-dashed p-3 sm:grid-cols-[9rem_1fr_1fr_auto]">
        <Select value={adding.category} disabled={disabled} onValueChange={(category) => setAdding({ ...adding, category: category as CompCategory })}>
          <SelectTrigger aria-label="New product policy type"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CATEGORY_ORDER.map((category) => <SelectItem key={category} value={category}>{CATEGORY_LABELS[category]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input aria-label="New product carrier" placeholder="Carrier" value={adding.carrier} maxLength={120} disabled={disabled}
          list="comp-grid-carriers" onChange={(e) => setAdding({ ...adding, carrier: e.target.value })} />
        <Input aria-label="New product name" placeholder="Product name" value={adding.productName} maxLength={160} disabled={disabled}
          onChange={(e) => setAdding({ ...adding, productName: e.target.value })} />
        <Button type="button" variant="outline" disabled={disabled || !adding.carrier || !adding.productName}
          onClick={() => { actions.addProduct(adding); setAdding({ ...adding, productName: "" }); }}>
          <Plus className="mr-1 h-4 w-4" aria-hidden /> Add product
        </Button>
        <datalist id="comp-grid-carriers">
          {carrierGroups(draft.products).map(([carrier]) => <option key={carrier} value={carrier} />)}
        </datalist>
      </div>
    </section>
  );
};

export default ProductsSection;
