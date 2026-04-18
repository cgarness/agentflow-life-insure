import type { TemplateCategory } from "@/components/settings/messageTemplateTypes";

export const TEMPLATE_CATEGORY_OPTIONS: { value: TemplateCategory; label: string }[] = [
  { value: "Prospecting", label: "Prospecting" },
  { value: "Follow-Up", label: "Follow-Up" },
  { value: "Appointment", label: "Appointment" },
  { value: "Re-Engagement", label: "Re-Engagement" },
  { value: "Closing", label: "Closing" },
];

export const TEMPLATE_CATEGORY_VALUES: TemplateCategory[] = TEMPLATE_CATEGORY_OPTIONS.map((o) => o.value);

export function parseCategory(raw: unknown): TemplateCategory | null {
  if (typeof raw !== "string") return null;
  return TEMPLATE_CATEGORY_VALUES.includes(raw as TemplateCategory) ? (raw as TemplateCategory) : null;
}
