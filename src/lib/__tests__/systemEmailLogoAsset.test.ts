import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the AgentFlow system-email logo cache bust.
 *
 * `/agentflow-logo-full.png` is a STABLE path that was overwritten in place when the
 * wordmark artwork was corrected. Email image proxies (Gmail, Apple MPP, Outlook) cache
 * by URL, so they can keep serving the pre-correction bitmap against that path forever.
 * System email therefore renders from its own immutable filename,
 * `/agentflow-logo-email-v2.png`, which no proxy has ever seen.
 *
 * These assertions live in vitest (not the Deno suite) because `npm test` is the suite that
 * actually runs here, and because the five GoTrue templates are plain files that no
 * TypeScript module imports — nothing else in the repo covers them at all.
 */

const REPO_ROOT = path.resolve(__dirname, "../../..");

const EMAIL_LOGO = "agentflow-logo-email-v2.png";
/** The platform/UI asset. Correct for the browser, WRONG for email — see the header. */
const PLATFORM_LOGO = "agentflow-logo-full.png";

const AUTH_TEMPLATE_DIR = path.join(REPO_ROOT, "supabase/templates/auth");
const AUTH_TEMPLATES = [
  "change_email.html",
  "confirm_signup.html",
  "invite_user.html",
  "magic_link.html",
  "recovery.html",
] as const;

const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const readTemplate = (file: string) => readFileSync(path.join(AUTH_TEMPLATE_DIR, file), "utf8");
const sha256 = (rel: string) =>
  createHash("sha256").update(readFileSync(path.join(REPO_ROOT, rel))).digest("hex");
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("system email logo — shared renderer", () => {
  const renderer = read("supabase/functions/_shared/systemEmail.ts");

  it("resolves the logo to the immutable email-only asset", () => {
    expect(renderer).toContain(`/${EMAIL_LOGO}`);
    expect(renderer).toMatch(
      /return `\$\{siteUrl \?\? resolveSiteUrl\(\)\}\/agentflow-logo-email-v2\.png`;/,
    );
  });

  it("no longer references the overwritten platform logo path in rendering code", () => {
    // The filename may appear in the explanatory comment; it must not appear in a template
    // literal that builds a URL.
    const code = renderer
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    expect(code).not.toContain(PLATFORM_LOGO);
  });

  it("keeps the mobile-safe logo treatment", () => {
    expect(renderer).toContain('alt="AgentFlow" height="24"');
    expect(renderer).toContain("height: 24px; max-width: 100%; display: inline-block;");
    expect(renderer).not.toContain('height="36"');
  });
});

describe("system email logo — hosted Supabase Auth (GoTrue) templates", () => {
  it("covers every template file that exists on disk", () => {
    // A sixth template added later must fail here rather than silently keep the old logo.
    const onDisk = readdirSync(AUTH_TEMPLATE_DIR).filter((f) => f.endsWith(".html")).sort();
    expect(onDisk).toEqual([...AUTH_TEMPLATES].sort());
  });

  it.each(AUTH_TEMPLATES)("%s points at the immutable email asset", (file) => {
    const html = readTemplate(file);
    expect(html).toContain(`<img src="{{ .SiteURL }}/${EMAIL_LOGO}"`);
    expect(html).not.toContain(PLATFORM_LOGO);
  });

  it.each(AUTH_TEMPLATES)("%s preserves the mobile-safe logo sizing", (file) => {
    const html = readTemplate(file);
    expect(count(html, "<img")).toBe(1);
    expect(count(html, 'height="24"')).toBe(1);
    expect(count(html, "max-width: 100%")).toBe(1);
    expect(html).not.toContain('height="36"');
    expect(html).toContain(
      `<img src="{{ .SiteURL }}/${EMAIL_LOGO}" alt="AgentFlow" height="24" ` +
        `style="height: 24px; max-width: 100%; display: inline-block;">`,
    );
  });

  it.each(AUTH_TEMPLATES)("%s preserves its GoTrue variables exactly", (file) => {
    const html = readTemplate(file);
    // Go's html/template resolves these. Losing or renaming one silently breaks the email.
    expect(count(html, "{{ .ConfirmationURL }}")).toBe(3);
    expect(count(html, "{{ .SiteURL }}")).toBe(1);

    const isEmailChange = file === "change_email.html";
    expect(count(html, "{{ .Email }}")).toBe(isEmailChange ? 1 : 0);
    expect(count(html, "{{ .NewEmail }}")).toBe(isEmailChange ? 1 : 0);

    // No new template action may be introduced by a logo change.
    const actions = [...html.matchAll(/\{\{\s*\.([A-Za-z][A-Za-z.]*)\s*\}\}/g)].map((m) => m[1]);
    const allowed = new Set(["ConfirmationURL", "SiteURL", "Email", "NewEmail"]);
    expect(actions.filter((a) => !allowed.has(a))).toEqual([]);
  });
});

describe("system email logo — the asset itself", () => {
  it("is byte-identical to the approved platform wordmark", () => {
    // Parity guard: if the wordmark is ever corrected again and the email copy is not
    // refreshed alongside it, this fails loudly instead of drifting silently.
    expect(sha256(`public/${EMAIL_LOGO}`)).toBe(sha256(`public/${PLATFORM_LOGO}`));
  });

  it("is a transparent 8-bit RGBA PNG at the approved wordmark dimensions", () => {
    const buf = readFileSync(path.join(REPO_ROOT, "public", EMAIL_LOGO));
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    // IHDR is always the first chunk: length(4) type(4) width(4) height(4) depth(1) colorType(1)
    expect(buf.subarray(12, 16).toString("latin1")).toBe("IHDR");
    expect(buf.readUInt32BE(16)).toBe(1551);
    expect(buf.readUInt32BE(20)).toBe(120);
    expect(buf.readUInt8(24)).toBe(8); // bit depth
    expect(buf.readUInt8(25)).toBe(6); // color type 6 = RGBA, i.e. a real alpha channel
  });
});

describe("browser logo consumers are deliberately untouched", () => {
  // The email swap must not leak into web surfaces. `agentflow-logo-full-on-dark.png`
  // CONTAINS the string `agentflow-logo-full`, so a repo-wide substitution on the bare
  // stem would silently 404 the dark-mode marketing nav. These pin both filenames.
  it("MarketingNav still serves the platform wordmark in both themes", () => {
    const nav = read("src/components/marketing/MarketingNav.tsx");
    expect(nav).toContain('"/agentflow-logo-full-on-dark.png"');
    expect(nav).toContain('"/agentflow-logo-full.png"');
    expect(nav).not.toContain(EMAIL_LOGO);
  });

  it("index.html social preview tags still use the platform wordmark", () => {
    const html = read("index.html");
    expect(html).toContain('<meta property="og:image" content="/agentflow-logo-full.png">');
    expect(html).toContain('<meta name="twitter:image" content="/agentflow-logo-full.png">');
    expect(html).not.toContain(EMAIL_LOGO);
  });
});
