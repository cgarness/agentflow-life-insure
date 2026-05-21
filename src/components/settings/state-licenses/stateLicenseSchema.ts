import { z } from "zod";

export const stateLicenseFormSchema = z.object({
  agent_id: z.string().uuid({ message: "Agent is required" }),
  state: z.string().min(1, "State is required"),
  license_number: z
    .string()
    .trim()
    .max(50, "Max 50 characters")
    .optional()
    .or(z.literal("")),
  expiration_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")
    .optional()
    .or(z.literal("")),
});

export type StateLicenseFormValues = z.infer<typeof stateLicenseFormSchema>;

export type LicenseRow = {
  id: string;
  agent_id: string;
  state: string;
  license_number: string | null;
  expiration_date: string | null;
  created_at: string;
};

export type AgentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
};

export type ExpirationStatus = "expired" | "soon" | "ok" | "none";

export function expirationStatus(date: string | null): ExpirationStatus {
  if (!date) return "none";
  const target = new Date(date).getTime();
  if (Number.isNaN(target)) return "none";
  const days = (target - Date.now()) / 86_400_000;
  if (days < 0) return "expired";
  if (days <= 30) return "soon";
  return "ok";
}
