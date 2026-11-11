import { z } from "zod";
import type { LabeledContact } from "@/components/settings/carrierContactUtils";

/** Only explicit, credential-free web URLs can become clickable carrier resources. */
export function safeCarrierWebUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!/^https?:\/\//i.test(value) || /[\s\\]/.test(value) || Array.from(value).length > 2048) return null;
  if (Array.from(value).some((character) => { const code = character.codePointAt(0)!; return code < 32 || (code >= 127 && code <= 159); })) return null;
  const authority = value.replace(/^https?:\/\//i, "").split(/[/?#]/, 1)[0];
  const ipv6 = authority.match(/^\[([0-9a-f:.]+)\](?::([0-9]{1,5}))?$/i);
  const dns = authority.match(/^([^:]+)(?::([0-9]{1,5}))?$/);
  const match = ipv6 ?? dns;
  if (!match || (match[2] && Number(match[2]) > 65535)) return null;
  if (!ipv6) {
    const host = match[1];
    if (host.length > 253 || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.?$/i.test(host)) return null;
    if (/(^|\.)([0-9]+|0x[0-9a-f]+)\.?$/i.test(host)) {
      const octets = host.split(".");
      if (octets.length !== 4 || octets.some((octet) => !/^(0|[1-9][0-9]{0,2})$/.test(octet) || Number(octet) > 255)) return null;
    }
  }
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function safeCarrierLogoUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (/^data:image\/(jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/i.test(raw) && raw.length <= 7_000_000) return raw;
  const url = safeCarrierWebUrl(raw);
  return url?.startsWith("https:") ? url : null;
}

export function carrierPhoneHref(raw: string): string | null {
  const match = raw.trim().match(/^(\+?[\d(). -]+?)(?:\s*(?:ext\.?|x|#)\s*(\d{1,10}))?$/i);
  if (!match) return null;
  const number = match[1].replace(/[^\d+]/g, "");
  if (!/^\+?\d{3,15}$/.test(number)) return null;
  return `tel:${number}${match[2] ? `;ext=${match[2]}` : ""}`;
}

export function carrierEmailHref(raw: string): string | null {
  const value = raw.trim();
  return /^[^\s@?&#%]+@[^\s@?&#%]+\.[^\s@?&#%]+$/.test(value) ? `mailto:${encodeURIComponent(value)}` : null;
}

export const carrierResourceLinkSchema = z.object({
  id: z.string().uuid("Invalid resource identifier"),
  label: z.string().trim().min(1, "Enter a link label").refine((value) => Array.from(value).length <= 120, "Use 120 characters or fewer"),
  url: z.string().trim().refine((value) => safeCarrierWebUrl(value) !== null, "Enter a full http:// or https:// URL (maximum 2048 characters)"),
  group: z.enum(["quick_links", "guides_training"]),
}).strict().transform((link) => ({ id: link.id, label: link.label, url: link.url, group: link.group }));

export const carrierResourceLinksSchema = z.array(carrierResourceLinkSchema).max(50, "Maximum of 50 resource links").superRefine((links, context) => {
  const seen = new Set<string>();
  links.forEach((link, index) => {
    const key = link.id.toLowerCase();
    if (seen.has(key)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate resource identifier", path: [index, "id"] });
    seen.add(key);
  });
});

export type CarrierResourceLink = z.infer<typeof carrierResourceLinkSchema>;
export type CarrierResourceErrors = Record<string, { label?: string; url?: string; group?: string }>;

export interface CarrierDirectoryItem {
  id: string;
  name: string;
  portal_url: string | null;
  logo_url: string | null;
  contact_phones: LabeledContact[];
  contact_emails: LabeledContact[];
  resource_links: CarrierResourceLink[];
}
