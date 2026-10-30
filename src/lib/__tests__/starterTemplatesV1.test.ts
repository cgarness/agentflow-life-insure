import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { templateFormSchema } from "@/components/settings/templateModalSchema";
import { MANUAL_MESSAGE_TEMPLATE_TOKENS } from "../messageTemplateMerge";

type Starter = {
  key: string; name: string; type: "sms" | "email"; subject: string | null;
  content: string; category: string; scope: string; sms_purpose: "marketing" | "informational" | null;
  attachments: unknown[];
};
const root = process.cwd();
const library = JSON.parse(readFileSync(resolve(root,
  "docs/plans/2026-10-30-starter-templates/agentflow_starter_templates_v1_1.json"), "utf8")) as { version: string; templates: Starter[] };
const seed = readFileSync(resolve(root, "supabase/ops/starter_templates_v1_1_seed_home_agency.sql"), "utf8");
const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const known = new Set(MANUAL_MESSAGE_TEMPLATE_TOKENS);

describe("reviewed AgentFlow starter template V1.1 library", () => {
  it("contains exactly twelve SMS and six email entries with unique (type,name) keys", () => {
    expect(library.version).toBe("1.1");
    expect(library.templates).toHaveLength(18);
    expect(library.templates.filter((t) => t.type === "sms")).toHaveLength(12);
    expect(library.templates.filter((t) => t.type === "email")).toHaveLength(6);
    const keys = library.templates.map((t) => `${t.type}:${t.name.toLowerCase().trim()}`);
    expect(new Set(keys).size).toBe(18);
    expect(library.templates.filter((t) => t.name === "Appointment Confirmation")).toHaveLength(2);
  });

  it("passes the same Zod validation that Settings uses when saving agency templates", () => {
    for (const t of library.templates) {
      const check = templateFormSchema.safeParse(t);
      expect(check.success, `Invalid ${t.key}: ${JSON.stringify(check.success ? null : check.error.issues)}`).toBe(true);
      expect(t.scope).toBe("agency");
      expect(t.attachments).toEqual([]);
      if (t.type === "sms") {
        expect(t.subject).toBeNull();
        expect(["informational", "marketing"]).toContain(t.sms_purpose);
      } else {
        expect(t.subject).toBeTruthy();
        expect(t.sms_purpose).toBeNull();
      }
    }
  });

  it("only uses supported manual merge fields; appointment placeholders are absent", () => {
    for (const t of library.templates) {
      const value = `${t.subject ?? ""}\n${t.content}`;
      const placeholders = [...value.matchAll(/\{\{[^{}]+\}\}/g)].map((match) => match[0]);
      for (const token of placeholders) {
        expect(known.has(token), `${t.key} has unsupported ${token}`).toBe(true);
        expect(token.startsWith("{{appointment_"), `${t.key} contains a non-populating appointment token`).toBe(false);
      }
      expect(t.content.length).toBeLessThanOrEqual(t.type === "sms" ? 1600 : 10000);
    }
  });

  it("provides a STOP instruction in each of the seven marketing SMS drafts", () => {
    const marketing = library.templates.filter((t) => t.type === "sms" && t.sms_purpose === "marketing");
    expect(marketing).toHaveLength(7);
    for (const t of marketing) expect(t.content).toMatch(/Reply STOP to opt out\./i);
  });

  it("keeps the exact source text in the insert-only home agency SQL and preserves existing rows", () => {
    const statements = seed.replace(/^--.*$/gm, "");
    expect(statements).toMatch(/INSERT INTO public\.message_templates/);
    expect(statements).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
    expect(statements).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
    expect(statements).toContain("'a0000000-0000-0000-0000-000000000001'::uuid");
    expect((seed.match(/'[0-9a-f-]{36}'::uuid, '/g) ?? [])).toHaveLength(18);
    for (const t of library.templates) {
      const subject = t.subject === null ? "NULL" : quote(t.subject);
      const purpose = t.sms_purpose === null ? "NULL" : quote(t.sms_purpose);
      expect(seed, `Missing exact reviewed seed for ${t.key}`).toContain(
        `, ${quote(t.name)}, ${quote(t.type)}, ${subject}, ${quote(t.content)}, ${quote(t.category)}, ${purpose})`,
      );
    }
  });
});
