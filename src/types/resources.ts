export type ProductType = "Term Life" | "Whole Life" | "IUL" | "Final Expense" | "Annuities" | "Custom";

export interface Script {
  id: string;
  name: string;
  productType: ProductType;
  active: boolean;
  content: string;
  updatedAt: Date;
}

export interface AgencyResourceCategory {
  id: string;
  organization_id: string;
  name: string;
  created_at: string;
}

export interface AgencyResource {
  id: string;
  organization_id: string;
  title: string;
  category_id: string;
  content_url?: string;
  created_at: string;
}
