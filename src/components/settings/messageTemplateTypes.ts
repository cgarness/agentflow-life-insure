export interface TemplateAttachment {
  name: string;
  /** Storage object path within the `template-attachments` bucket (used with createSignedUrl). */
  url: string;
  size: number;
}

export type TemplateCategory =
  | "Prospecting"
  | "Follow-Up"
  | "Appointment"
  | "Re-Engagement"
  | "Closing";

export type TemplateScope = "agency" | "personal";

export interface Template {
  id: string;
  name: string;
  type: "email" | "sms";
  subject: string | null;
  content: string;
  updatedAt: Date;
  category: TemplateCategory | null;
  attachments: TemplateAttachment[];
  scope: TemplateScope;
  createdBy: string | null;
}
