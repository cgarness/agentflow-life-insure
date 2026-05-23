import type { ProductType } from "./callScriptSchema";

export const productBadgeClass: Record<ProductType, string> = {
  "Term Life": "bg-blue-500/15 text-blue-500 border-blue-500/30",
  "Whole Life": "bg-purple-500/15 text-purple-500 border-purple-500/30",
  "IUL": "bg-indigo-500/15 text-indigo-500 border-indigo-500/30",
  "Final Expense": "bg-orange-500/15 text-orange-500 border-orange-500/30",
  "Annuities": "bg-green-500/15 text-green-500 border-green-500/30",
  "Custom": "bg-muted text-muted-foreground border-border",
};

export const MERGE_FIELDS = [
  "{{contact_first_name}}",
  "{{contact_last_name}}",
  "{{agent_name}}",
  "{{product_name}}",
  "{{company_name}}",
];

export const MERGE_PREVIEW: Record<string, string> = {
  "{{contact_first_name}}": "John",
  "{{contact_last_name}}": "Smith",
  "{{agent_name}}": "Chris",
  "{{product_name}}": "",
  "{{company_name}}": "AgentFlow",
};
