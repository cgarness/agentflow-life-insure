import { useId } from "react";
import type { PreviewSelection } from "@/hooks/usePolicyCommissionPreview";
import type { CalculatorProduct } from "@/lib/commission/types";

const fieldCls =
  "w-full h-8 px-2 rounded-md bg-background text-xs text-foreground border border-input shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/40 disabled:opacity-50";
const labelCls = "block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1";

interface PolicyCommissionInputsProps {
  products: CalculatorProduct[];
  terms: number[];
  selection: { productId: string; term: string; age: string };
  ageOptional: boolean;
  onChange: (patch: Partial<PreviewSelection>) => void;
}

/** Explicit label/control pairs, so each control's accessible name is exactly its label (never option text). */
export function PolicyCommissionInputs({ products, terms, selection, ageOptional, onChange }: PolicyCommissionInputsProps) {
  const id = useId();
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <div className="col-span-2 min-w-0 sm:col-span-1">
        <label htmlFor={`${id}-product`} className={labelCls}>Product</label>
        <select
          id={`${id}-product`}
          className={fieldCls}
          value={selection.productId}
          onChange={(event) => onChange({ productId: event.target.value, term: "" })}
        >
          <option value="">Choose…</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.productName}
            </option>
          ))}
        </select>
      </div>
      {terms.length > 0 && (
        <div className="min-w-0">
          <label htmlFor={`${id}-term`} className={labelCls}>Term</label>
          <select id={`${id}-term`} className={fieldCls} value={selection.term} onChange={(event) => onChange({ term: event.target.value })}>
            <option value="">Choose…</option>
            {terms.map((term) => (
              <option key={term} value={String(term)}>
                {term} yr
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="min-w-0">
        <label htmlFor={`${id}-age`} className={labelCls}>Insured age{ageOptional ? " (optional)" : ""}</label>
        <input
          id={`${id}-age`}
          className={fieldCls}
          inputMode="numeric"
          value={selection.age}
          onChange={(event) => onChange({ age: event.target.value })}
        />
      </div>
    </div>
  );
}
