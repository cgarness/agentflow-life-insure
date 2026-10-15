import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CalculatorFormValues } from "@/lib/commission/schemas";
import { CATEGORY_LABELS, type CalculatorProduct, type CompCategory } from "@/lib/commission/types";
import type { useCalculatorInputs } from "./useCalculatorInputs";

interface CalculatorInputsProps {
  inputs: ReturnType<typeof useCalculatorInputs>;
  /** Field messages shown only for fields that already have a value (no nagging on empty fields). */
  errors: Partial<Record<keyof CalculatorFormValues, string>>;
}

const FieldError: React.FC<{ message?: string }> = ({ message }) =>
  message ? <p className="mt-1 text-xs text-destructive">{message}</p> : null;

const ChoiceField: React.FC<{
  id: string;
  label: string;
  value: string;
  placeholder: string;
  disabled?: boolean;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}> = ({ id, label, value, placeholder, disabled, options, onChange }) => (
  <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

const productOption = (product: CalculatorProduct) => ({ value: product.id, label: product.productName });

const CalculatorInputs: React.FC<CalculatorInputsProps> = ({ inputs, errors }) => {
  const { values } = inputs;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <ChoiceField
        id="calc-policy-type"
        label="Policy type"
        value={values.category}
        placeholder="Choose a policy type"
        options={inputs.categories.map((category: CompCategory) => ({ value: category, label: CATEGORY_LABELS[category] }))}
        onChange={inputs.setCategory}
      />
      <ChoiceField
        id="calc-carrier"
        label="Carrier"
        value={values.carrier}
        placeholder="Choose a carrier"
        disabled={!values.category}
        options={inputs.carriers.map((carrier) => ({ value: carrier, label: carrier }))}
        onChange={inputs.setCarrier}
      />
      <ChoiceField
        id="calc-product"
        label="Product"
        value={values.productId}
        placeholder="Choose a product"
        disabled={!values.carrier}
        options={inputs.products.map(productOption)}
        onChange={inputs.setProduct}
      />
      <div className="space-y-1.5">
        <Label htmlFor="calc-age">Client age</Label>
        <Input
          id="calc-age"
          inputMode="numeric"
          autoComplete="off"
          placeholder="0–100"
          value={values.age}
          disabled={!values.productId}
          onChange={(event) => inputs.setAge(event.target.value)}
        />
        <FieldError message={values.age ? errors.age : undefined} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="calc-premium">Monthly premium</Label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
          <Input
            id="calc-premium"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            className="pl-6"
            value={values.monthlyPremium}
            disabled={!values.productId}
            onChange={(event) => inputs.setMonthlyPremium(event.target.value)}
          />
        </div>
        <FieldError message={values.monthlyPremium ? errors.monthlyPremium : undefined} />
      </div>
      {inputs.terms.length > 0 && (
        <ChoiceField
          id="calc-term"
          label="Term length"
          value={values.term}
          placeholder="Choose a term length"
          options={inputs.terms.map((term) => ({ value: String(term), label: `${term} years` }))}
          onChange={inputs.setTerm}
        />
      )}
    </div>
  );
};

export default CalculatorInputs;
