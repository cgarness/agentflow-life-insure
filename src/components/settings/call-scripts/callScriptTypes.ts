import type { ProductType } from "./callScriptSchema";

export type { ProductType };

export interface Script {
  id: string;
  name: string;
  productType: ProductType;
  active: boolean;
  content: string;
  updatedAt: Date;
}
