import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { DraftProduct, DraftVariant } from "@/lib/commission/gridDraft";
import { CATEGORY_LABELS, CATEGORY_ORDER, type CompCategory } from "@/lib/commission/types";
import type { EditorActions } from "./editorTypes";
import { cn } from "@/lib/utils";
import VariantFields from "./VariantFields";

interface ProductCardProps {
  product: DraftProduct;
  variants: DraftVariant[];
  messagesFor: (ref: string) => string[];
  disabled: boolean;
  actions: EditorActions;
  /** Ask before deleting rows that already exist on the server (their rates go with them). */
  askDelete: (what: string, onConfirm: () => void, variantRefs: string[]) => void;
}

/** One product: category, name, active flag and its variants. */
const ProductCard: React.FC<ProductCardProps> = ({ product, variants, messagesFor, disabled, actions, askDelete }) => {
  const id = `product-${product.ref}`;
  const removeProduct = () =>
    askDelete(product.productName || "this product", () => actions.removeProduct(product.ref), variants.map((v) => v.ref));
  return (
    <div className={cn("space-y-2.5 bg-card p-3 transition-colors", !product.isActive && "bg-muted/20")}>
      <div className="grid gap-2 sm:grid-cols-[9rem_1fr_auto] sm:items-center">
        <Select value={product.category} disabled={disabled} onValueChange={(category) => actions.updateProduct(product.ref, { category: category as CompCategory })}>
          <SelectTrigger aria-label="Policy type" className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CATEGORY_ORDER.map((category) => <SelectItem key={category} value={category}>{CATEGORY_LABELS[category]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input aria-label="Product name" placeholder="Product name" className="h-9 font-medium" value={product.productName} maxLength={160} disabled={disabled}
          onChange={(e) => actions.updateProduct(product.ref, { productName: e.target.value })} />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Switch id={`${id}-active`} aria-label={`${product.productName || "Product"} is active`} checked={product.isActive}
              disabled={disabled} onCheckedChange={(isActive) => actions.updateProduct(product.ref, { isActive })} />
            <Label htmlFor={`${id}-active`} className="text-xs text-muted-foreground">Active</Label>
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Delete ${product.productName || "product"}`} disabled={disabled} onClick={removeProduct}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
      {messagesFor(product.ref).map((message) => <p key={message} className="text-xs text-destructive">{message}</p>)}
      <div className="space-y-1.5 sm:pl-3">
        {variants.map((variant) => (
          <VariantFields
            key={variant.ref}
            variant={variant}
            disabled={disabled}
            messages={messagesFor(variant.ref)}
            onChange={(patch) => actions.updateVariant(variant.ref, patch)}
            onRemove={() => askDelete(variant.label || "this variant", () => actions.removeVariant(variant.ref), [variant.ref])}
          />
        ))}
        <Button type="button" variant="ghost" size="sm" className="h-8 text-muted-foreground hover:text-foreground" disabled={disabled} onClick={() => actions.addVariant(product.ref)}>
          <Plus className="mr-1 h-4 w-4" aria-hidden /> Add variant
        </Button>
      </div>
    </div>
  );
};

export default ProductCard;
