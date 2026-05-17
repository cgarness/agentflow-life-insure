import { z } from "zod";

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD")
  .optional()
  .or(z.literal(""));

export const addLeadLeadFormSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  phone: z.string().min(10, "Valid phone number is required"),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  state: z.string().length(2, "State must be exactly 2 letters").optional().or(z.literal("")),
  dateOfBirth: isoDateSchema,
});
