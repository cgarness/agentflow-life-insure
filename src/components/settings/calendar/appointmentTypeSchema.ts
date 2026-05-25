import { z } from "zod";

export const appointmentTypeFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(40, "Name must be 40 characters or fewer"),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a valid #RRGGBB hex value"),
  duration_minutes: z
    .number({ invalid_type_error: "Duration is required" })
    .int("Duration must be a whole number")
    .min(5, "Duration must be at least 5 minutes")
    .max(240, "Duration must be 240 minutes or fewer"),
});

export type AppointmentTypeFormValues = z.infer<typeof appointmentTypeFormSchema>;
