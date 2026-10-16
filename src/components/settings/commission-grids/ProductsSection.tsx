import React, { useState } from "react";
import { Boxes, ChevronDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SurfaceSection } from "@/components/commission/ui/CommissionSurface";
import type { DraftProduct, GridDraft } from "@/lib/commission/gridDraft";
import { CATEGORY_LABELS, CATEGORY_ORDER, type CompCategory } from "@/lib/commission/types";
import { cn } from "@/lib/utils";
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
  // Collapsing only hides a group's fields; the draft is untouched. Keyed by the group's first product ref.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
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
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const groups = carrierGroups(draft.products);

  return (
    <SurfaceSection
      icon={Boxes}
      title="Carriers and products"
      count={draft.products.length}
      as="h3"
      bodyClassName="space-y-3"
    >
      {groups.map(([carrier, products]) => {
        const key = products[0].ref;
        const open = !collapsed.has(key);
        const hasIssues = products.some((p) => messagesFor(p.ref).length > 0 || variantsOf(p).some((v) => messagesFor(v.ref).length > 0));
        return (
          <div key={key} className="overflow-hidden rounded-lg border border-border/60">
            <div className="flex flex-wrap items-center gap-2 bg-muted/40 px-2 py-2 sm:px-3">
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-expanded={open}
                aria-label={`${open ? "Collapse" : "Expand"} ${carrier || "carrier"}`} onClick={() => toggle(key)}>
                <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} aria-hidden />
              </Button>
              <Input aria-label="Carrier name" className="h-8 min-w-0 flex-1 bg-background font-medium sm:max-w-xs" value={carrier} maxLength={120} disabled={disabled}
                onChange={(e) => renameCarrier(products, e.target.value)} />
              <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
                {products.length} product{products.length === 1 ? "" : "s"}
              </span>
              {hasIssues && !open && <span role="img" className="h-2 w-2 rounded-full bg-destructive" title="Has problems to fix" aria-label="Has problems to fix" />}
              <div className="ml-auto flex items-center gap-1">
                <Button type="button" variant="ghost" size="sm" className="h-8" disabled={disabled}
                  onClick={() => products.forEach((p) => actions.updateProduct(p.ref, { isActive: !products.every((x) => x.isActive) }))}>
                  {products.every((p) => p.isActive) ? "Deactivate all" : "Activate all"}
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" disabled={disabled}
                  onClick={() => askDelete(carrier || "this carrier", () => products.forEach((p) => actions.removeProduct(p.ref)), products.flatMap((p) => variantsOf(p).map((v) => v.ref)))}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Delete carrier
                </Button>
              </div>
            </div>
            {open && (
              <div className="divide-y divide-border/50">
                {products.map((product) => (
                  <ProductCard key={product.ref} product={product} variants={variantsOf(product)} messagesFor={messagesFor}
                    disabled={disabled} actions={actions} askDelete={askDelete} />
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="grid gap-2 rounded-lg border border-dashed border-border/80 bg-muted/20 p-3 sm:grid-cols-[9rem_1fr_1fr_auto]">
        <Select value={adding.category} disabled={disabled} onValueChange={(category) => setAdding({ ...adding, category: category as CompCategory })}>
          <SelectTrigger aria-label="New product policy type" className="h-9 bg-background"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CATEGORY_ORDER.map((category) => <SelectItem key={category} value={category}>{CATEGORY_LABELS[category]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input aria-label="New product carrier" placeholder="Carrier" className="h-9 bg-background" value={adding.carrier} maxLength={120} disabled={disabled}
          list="comp-grid-carriers" onChange={(e) => setAdding({ ...adding, carrier: e.target.value })} />
        <Input aria-label="New product name" placeholder="Product name" className="h-9 bg-background" value={adding.productName} maxLength={160} disabled={disabled}
          onChange={(e) => setAdding({ ...adding, productName: e.target.value })} />
        <Button type="button" variant="outline" className="h-9" disabled={disabled || !adding.carrier || !adding.productName}
          onClick={() => { actions.addProduct(adding); setAdding({ ...adding, productName: "" }); }}>
          <Plus className="mr-1 h-4 w-4" aria-hidden /> Add product
        </Button>
        <datalist id="comp-grid-carriers">
          {groups.map(([carrier]) => <option key={carrier} value={carrier} />)}
        </datalist>
      </div>
    </SurfaceSection>
  );
};

export default ProductsSection;
