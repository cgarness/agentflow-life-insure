import { MERGE_PREVIEW } from "./callScriptConstants";
import type { ProductType } from "./callScriptSchema";

export function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `Modified ${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Modified ${hrs} hr${hrs > 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  return `Modified ${days} day${days > 1 ? "s" : ""} ago`;
}

export function wordCount(text: string): number {
  if (!text) return 0;
  const stripped = text.replace(/[#*_\->[\]()]/g, "").trim();
  if (!stripped) return 0;
  return stripped.split(/\s+/).length;
}

export function renderMergePreview(content: string, productType: ProductType | null): string {
  return content.replace(/\{\{(\w+)\}\}/g, (match) => {
    if (match === "{{product_name}}" && productType) return productType;
    return MERGE_PREVIEW[match] ?? match;
  });
}
