import { z } from "zod";

// Mirrors the live storage bucket "agency-group-resources" exactly.
// If the bucket allow-list changes, update the bucket via migration first,
// then update this list — the bucket is the source of truth.
export const ALLOWED_RESOURCE_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "video/mp4",
  "image/png",
  "image/jpeg",
  "text/plain",
] as const;

export type AllowedResourceMime = (typeof ALLOWED_RESOURCE_MIME_TYPES)[number];

// Matches the bucket's file_size_limit (10 MB).
export const MAX_RESOURCE_BYTES = 10 * 1024 * 1024;

export const groupNameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(80, "Name must be at most 80 characters");

export const inviteEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email");

const allowedMimeSet = new Set<string>(ALLOWED_RESOURCE_MIME_TYPES);

export const resourceFileSchema = z
  .object({
    name: z.string().min(1, "File name is required").max(255, "File name too long"),
    type: z.string(),
    size: z.number().int().positive(),
  })
  .superRefine((file, ctx) => {
    if (!allowedMimeSet.has(file.type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["type"],
        message: "File type not supported. Allowed: PDF, Word, PowerPoint, MP4, PNG, JPEG, TXT.",
      });
    }
    if (file.size > MAX_RESOURCE_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["size"],
        message: "File too large — 10 MB maximum.",
      });
    }
  });

// Strip directory separators, control chars, and any character that's risky
// in a storage path. Collapse whitespace to single underscores. Preserve a
// single trailing extension if present.
export function sanitizeFileName(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "file";

  const lastDot = trimmed.lastIndexOf(".");
  const hasExt = lastDot > 0 && lastDot < trimmed.length - 1;
  const base = hasExt ? trimmed.slice(0, lastDot) : trimmed;
  const ext = hasExt ? trimmed.slice(lastDot + 1) : "";

  const cleanPart = (s: string) =>
    s
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f]/g, "")
      .replace(/[/\\:*?"<>|]/g, "")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[._-]+|[._-]+$/g, "");

  const cleanBase = cleanPart(base) || "file";
  const cleanExt = cleanPart(ext).toLowerCase();

  const joined = cleanExt ? `${cleanBase}.${cleanExt}` : cleanBase;
  return joined.slice(0, 120);
}
