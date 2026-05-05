export type ProductType = "Term Life" | "Whole Life" | "IUL" | "Final Expense" | "Annuities" | "Custom";

export interface Script {
  id: string;
  name: string;
  productType: ProductType;
  active: boolean;
  content: string;
  updatedAt: Date;
}

export interface AgencyResource {
  id: string;
  organization_id: string;
  title: string;
  category: string;
  content_url?: string;
  file_size?: string;
  created_at: string;
}
