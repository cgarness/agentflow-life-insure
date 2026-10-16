import { useCallback, useEffect, useMemo, useState } from "react";
import { supportedTermLengths } from "@/lib/commission/matching";
import type { CalculatorFormValues } from "@/lib/commission/schemas";
import { CATEGORY_ORDER, type CompCategory, type ReadyCalculatorContext } from "@/lib/commission/types";

export const EMPTY_CALCULATOR_VALUES: CalculatorFormValues = {
  category: "",
  carrier: "",
  productId: "",
  age: "",
  monthlyPremium: "",
  term: "",
};

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

/**
 * Calculator inputs in the required order (policy type, carrier, product, age, premium, term) with the
 * required resets: a new policy type or carrier clears everything downstream; a new product clears an
 * age or term the product does not support. Options come only from the selected grid's ACTIVE products.
 */
export function useCalculatorInputs(context: ReadyCalculatorContext) {
  const [values, setValues] = useState<CalculatorFormValues>(EMPTY_CALCULATOR_VALUES);

  const categories = useMemo(
    () => CATEGORY_ORDER.filter((category) => context.products.some((p) => p.category === category)),
    [context.products],
  );
  const carriers = useMemo(
    () => [...new Set(context.products.filter((p) => p.category === values.category).map((p) => p.carrier))].sort(byText),
    [context.products, values.category],
  );
  const products = useMemo(
    () =>
      context.products
        .filter((p) => p.category === values.category && p.carrier === values.carrier)
        .sort((a, b) => byText(a.productName, b.productName)),
    [context.products, values.category, values.carrier],
  );
  const variantsOf = useCallback(
    (productId: string) => context.variants.filter((v) => v.productId === productId),
    [context.variants],
  );
  const terms = useMemo(() => supportedTermLengths(variantsOf(values.productId)), [variantsOf, values.productId]);

  // A refreshed grid (same grid, new revision) may drop the chosen product: start that choice over.
  useEffect(() => {
    if (values.productId && !context.products.some((p) => p.id === values.productId)) {
      setValues((current) => ({ ...EMPTY_CALCULATOR_VALUES, category: current.category }));
    }
  }, [context.products, values.productId]);

  const setCategory = (category: string) => setValues({ ...EMPTY_CALCULATOR_VALUES, category: category as CompCategory });
  const setCarrier = (carrier: string) => setValues((current) => ({ ...EMPTY_CALCULATOR_VALUES, category: current.category, carrier }));
  const setProduct = (productId: string) =>
    setValues((current) => {
      const variants = variantsOf(productId);
      const nextTerms = supportedTermLengths(variants);
      const age = Number(current.age);
      const ageFits =
        current.age !== "" &&
        variants.some((v) => (v.minAge === null || age >= v.minAge) && (v.maxAge === null || age <= v.maxAge));
      return {
        ...current,
        productId,
        age: ageFits ? current.age : "",
        term: nextTerms.includes(Number(current.term)) ? current.term : "",
      };
    });
  const setField = (field: "age" | "monthlyPremium" | "term") => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  return {
    values,
    categories,
    carriers,
    products,
    terms,
    setCategory,
    setCarrier,
    setProduct,
    setAge: setField("age"),
    setMonthlyPremium: setField("monthlyPremium"),
    setTerm: setField("term"),
  };
}
