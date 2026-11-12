import { describe, expect, it } from "vitest";
import { carrierEmailHref, carrierPhoneHref, carrierResourceLinksSchema, safeCarrierLogoUrl, safeCarrierWebUrl } from "../carrierResources";
import { carrierSchema } from "@/components/settings/carriers/carrierSchema";

const first = { id: "10000000-0000-4000-8000-000000000001", label: "Application", url: "https://carrier.example/app", group: "quick_links" };
const second = { ...first, id: "10000000-0000-4000-8000-000000000002", label: "Training", group: "guides_training" };

describe("carrier resource contract", () => {
  it("preserves ordered IDs, groups and URLs, trims form input, and permits removal to empty", () => {
    expect(carrierResourceLinksSchema.parse([second, { ...first, label: " Application ", url: ` ${first.url} ` }])).toEqual([second, first]);
    expect(carrierResourceLinksSchema.parse([])).toEqual([]);
  });
  it.each([null, {}, "[]", [{ ...first, extra: "untrusted" }], [{ ...first, id: "not-an-id" }], [{ ...first, label: " " }], [{ ...first, group: "contacts" }], [first, first]])("rejects malformed arrays and rows: %j", (value) => {
    expect(carrierResourceLinksSchema.safeParse(value).success).toBe(false);
  });
  it("enforces Unicode codepoint lengths, entry cap, and case-insensitive ID uniqueness", () => {
    expect(carrierResourceLinksSchema.safeParse([{ ...first, label: "😀".repeat(120) }]).success).toBe(true);
    expect(carrierResourceLinksSchema.safeParse([{ ...first, label: "😀".repeat(121) }]).success).toBe(false);
    const many = Array.from({ length: 50 }, (_, index) => ({ ...first, id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}` }));
    expect(carrierResourceLinksSchema.safeParse(many).success).toBe(true);
    expect(carrierResourceLinksSchema.safeParse([...many, second]).success).toBe(false);
    const alphaId = { ...first, id: "abcdefab-0000-4000-8000-000000000001" };
    expect(carrierResourceLinksSchema.safeParse([alphaId, { ...alphaId, id: alphaId.id.toUpperCase() }]).success).toBe(false);
  });
  it("leaves omitted resource links optional for existing carrier-form callers", () => {
    expect(carrierSchema.parse({ name: "Synthetic carrier", contact_phones: [], contact_emails: [] }).resource_links).toEqual([]);
    expect(carrierSchema.partial().parse({ resource_links: [first] })).toEqual({ resource_links: [first] });
  });
});

describe("carrier clickable destinations", () => {
  it.each([
    "javascript:alert(1)", "data:text/html,test", "//carrier.example", "carrier.example", "https://",
    "https://user:secret@carrier.example", "https://carrier.example/a b", "https://carrier.example/a\\b",
    "https://carrier.example/\u0000bad", "https://carrier.example/\u0085bad", "https://carrier.example:65536/",
    "https://carrier.example:000080/", "https://example..com/", "https://-example.com/", "https://exa_mple.com/",
    "https://127.1/", "https://0x7f000001/", "https://127.0.0.01/", "https://127.0.0.256/",
    "https://[:::1]/", "https://éxample.test/", "https://carrier%2eexample/", "https://carrier.example/" + "x".repeat(2048),
  ])("does not make unsafe or ambiguous URLs clickable: %s", (url) => {
    expect(safeCarrierWebUrl(url)).toBeNull();
    expect(carrierResourceLinksSchema.safeParse([{ ...first, url }]).success).toBe(false);
  });
  it.each(["https://carrier.example/path?product=life#guide", "HTTP://carrier.example:80/", "https://[::1]:443/", "http://127.0.0.1:8080/", "https://xn--xample-9ua.test/", "https://carrier.example./guide"])("accepts a valid explicit web URL: %s", (url) => {
    expect(safeCarrierWebUrl(url)).toBe(new URL(url).href);
  });
  it("allows only safe raster data and HTTPS logos", () => {
    expect(safeCarrierLogoUrl("data:image/png;base64,aGVsbG8=")).toContain("data:image/png;");
    expect(safeCarrierLogoUrl("https://carrier.example/logo.png")).toBe("https://carrier.example/logo.png");
    expect(safeCarrierLogoUrl("data:image/svg+xml,<svg onload='alert(1)'/>")).toBeNull();
    expect(safeCarrierLogoUrl("http://carrier.example/logo.png")).toBeNull();
  });
  it("preserves telephone extensions and keeps email headers out of destinations", () => {
    expect(carrierPhoneHref("+1 (800) 555-0100 ext. 123")).toBe("tel:+18005550100;ext=123");
    expect(carrierPhoneHref("800-555-0100 x23")).toBe("tel:8005550100;ext=23");
    expect(carrierPhoneHref("tel:8005550100")).toBeNull();
    expect(carrierEmailHref(" support+agency@carrier.example ")).toBe("mailto:support%2Bagency%40carrier.example");
    expect(carrierEmailHref("support@carrier.example?bcc=elsewhere@example.test")).toBeNull();
    expect(carrierEmailHref("support@carrier.example\r\nBcc:elsewhere@example.test")).toBeNull();
  });
});
