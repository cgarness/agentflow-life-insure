/**
 * Case G — the Contacts Kanban call buttons must declare the contact type.
 *
 * Both `onCall` handlers dispatched a raw `quick-call` CustomEvent with NO `type`, and
 * `FloatingDialer`'s listener defaults a missing type to `"lead"` — so every recruit
 * quick-call from the Recruits Kanban was written as `calls.contact_type = 'lead'`.
 *
 * WHY THIS IS A SOURCE-CONTRACT TEST AND NOT A RENDER TEST (stated plainly):
 * mounting `Contacts.tsx` and switching to the Kanban view reproduces a PRE-EXISTING
 * "Maximum update depth exceeded" infinite render loop — the same defect class as the
 * DialerPage loop fixed in PR #354. It reproduces on unmodified `main` with
 * `ContactKanbanBoard` stubbed to a no-op (so no handler touched by this change runs),
 * and it starves the event loop, so even a `waitFor` timeout never fires. Repairing that
 * loop is a separate, unapproved task, so the interaction test is not available here.
 *
 * This guard therefore pins the shipped handler TEXT: it fails if either handler loses
 * `dispatchQuickCall`, loses its explicit `type`, or regresses to a raw CustomEvent. The
 * dispatched payload's runtime behaviour is covered behaviourally by
 * `src/lib/__tests__/quickCall.test.ts` and `contactName.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CONTACTS_SRC = readFileSync(resolve(process.cwd(), "src/pages/Contacts.tsx"), "utf8");

/**
 * Extract one `<ContactKanbanBoard … />` element's source by its `tab="…"` prop.
 * Brace-matched from the element start so nested handlers are captured whole.
 */
function kanbanBoardSource(tab: "Leads" | "Recruits"): string {
  const marker = `<ContactKanbanBoard`;
  let from = 0;
  for (;;) {
    const start = CONTACTS_SRC.indexOf(marker, from);
    if (start === -1) throw new Error(`No <ContactKanbanBoard> with tab="${tab}" found`);
    const end = CONTACTS_SRC.indexOf("/>", start);
    const block = CONTACTS_SRC.slice(start, end === -1 ? undefined : end + 2);
    if (new RegExp(`tab=["']${tab}["']`).test(block)) return block;
    from = start + marker.length;
  }
}

describe("G. Contacts Kanban quick-calls declare the real contact type", () => {
  it("the Recruits board dispatches type 'recruit', not the FloatingDialer 'lead' default", () => {
    const block = kanbanBoardSource("Recruits");
    expect(block).toMatch(/onCall=/);
    expect(block).toMatch(/dispatchQuickCall\(/);
    expect(block).toMatch(/type:\s*["']recruit["']/);
    expect(block).not.toMatch(/type:\s*["']lead["']/);
  });

  it("the Leads board dispatches type 'lead' explicitly", () => {
    const block = kanbanBoardSource("Leads");
    expect(block).toMatch(/onCall=/);
    expect(block).toMatch(/dispatchQuickCall\(/);
    expect(block).toMatch(/type:\s*["']lead["']/);
  });

  it("every Kanban onCall carries an explicit type — none may rely on the listener default", () => {
    for (const tab of ["Leads", "Recruits"] as const) {
      const block = kanbanBoardSource(tab);
      const onCallStart = block.indexOf("onCall=");
      expect(onCallStart).toBeGreaterThan(-1);
      const handler = block.slice(onCallStart, block.indexOf("onAddContact", onCallStart));
      expect(handler).toMatch(/type:\s*["'](lead|client|recruit)["']/);
    }
  });

  it("no raw quick-call CustomEvent survives in Contacts.tsx", () => {
    expect(CONTACTS_SRC).not.toMatch(/new CustomEvent\(\s*["']quick-call["']/);
  });

  it("resolves the dispatched name through the canonical helper, not a raw template literal", () => {
    for (const tab of ["Leads", "Recruits"] as const) {
      expect(kanbanBoardSource(tab)).toMatch(/name:\s*contactDisplayName\(/);
    }
    expect(CONTACTS_SRC).toMatch(/import \{ contactDisplayName \} from "@\/lib\/contact-name"/);
  });
});
