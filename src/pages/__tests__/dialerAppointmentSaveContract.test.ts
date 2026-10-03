/**
 * Source contract for the Main Dialer appointment / callback-shadow writer (implementation_plan.md root §19).
 *
 *   - DialerPage never calls CalendarContext.addAppointment: that is a real `appointments` INSERT, not a
 *     state helper, and the Dialer's camelCase object made it a second (invalid) write per save. Calendar
 *     state is synchronised by ONE silent `fetchAppointments({ silent: true })` after the scheduler writes.
 *   - saveCallData still has exactly the two scheduler writers (appointment + callback shadow).
 *   - The CANONICAL campaign-callback instant computations are byte-for-byte unchanged (saveCallData's
 *     `callbackDueAtISO` and proceedSaveAndNext's `callbackDueAt`); the writer fix must never touch them.
 *   - dialer-api.saveAppointment builds instants with the shared local wall-clock helper and stamps
 *     `created_by` with the dialing agent.
 * The live behaviour is proven by dialerAppointmentSave.test.tsx; this file stops a regression at the source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve(__dirname, "../DialerPage.tsx"), "utf8");
const api = readFileSync(resolve(__dirname, "../../lib/dialer-api.ts"), "utf8");

function body(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  const j = src.indexOf(end, i + start.length);
  if (i < 0 || j < 0) throw new Error(`markers not found: ${start} … ${end}`);
  return src.slice(i, j);
}

const count = (src: string, needle: string) => src.split(needle).length - 1;

const saveCallData = body(page, "const saveCallData = async", "const proceedSaveOnly = async");

const CANONICAL_PARSE = (variable: "callbackDueAtISO" | "callbackDueAt", indent: string) =>
  [
    `${indent}const [h, rest] = callbackTime.split(':');`,
    `${indent}const [min, period] = (rest || '').split(' ');`,
    `${indent}let hours24 = parseInt(h, 10);`,
    `${indent}if (period === 'PM' && hours24 < 12) hours24 += 12;`,
    `${indent}if (period === 'AM' && hours24 === 12) hours24 = 0;`,
    `${indent}${variable} = new Date(`,
    `${indent}  callbackDate.getFullYear(),`,
    `${indent}  callbackDate.getMonth(),`,
    `${indent}  callbackDate.getDate(),`,
    `${indent}  hours24,`,
    `${indent}  parseInt(min || '0', 10),`,
    `${indent}).toISOString();`,
  ].join("\n");

describe("DialerPage appointment writer contract", () => {
  it("never calls or destructures CalendarContext.addAppointment", () => {
    // Whole-line comments may name it (to explain why it is not used). Every other line — including code
    // with a trailing comment — may not call, destructure or alias it.
    const code = page
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .join("\n");
    expect(code).not.toMatch(/\baddAppointment\b/);
    expect(page).toMatch(/const \{ fetchAppointments \} = useCalendar\(\);/);
  });

  it("saveCallData keeps exactly the two scheduler writers and ONE silent Calendar refresh", () => {
    expect(count(saveCallData, "saveAppointment(")).toBe(2);
    expect(count(saveCallData, "fetchAppointments({ silent: true })")).toBe(1);
  });

  it("the refresh runs only after a scheduler write succeeded, and the flag is set only after each awaited write", () => {
    expect(saveCallData).toMatch(/if \(schedulerWriteSucceeded\) \{[\s\S]{0,240}fetchAppointments\(\{ silent: true \}\)/);
    // Each flag assignment directly follows an awaited saveAppointment(...) call, inside its try.
    const assignments = saveCallData.match(/\}, organizationId\);\s*\n\s*schedulerWriteSucceeded = true;/g) ?? [];
    expect(assignments).toHaveLength(2);
    expect(count(saveCallData, "schedulerWriteSucceeded = true")).toBe(2);
  });

  it("the canonical saveCallData callbackDueAtISO computation is unchanged", () => {
    expect(saveCallData.replace(/\s+/g, "")).toContain(CANONICAL_PARSE("callbackDueAtISO", "").replace(/\s+/g, "").replace(",).toISOString()", ").toISOString()"));
  });

  it("the canonical proceedSaveAndNext callbackDueAt computation is unchanged", () => {
    const saveAndNext = body(page, "const proceedSaveAndNext = async", "const handleSaveAndNext");
    expect(saveAndNext).toContain(CANONICAL_PARSE("callbackDueAt", "            "));
  });

  it("the canonical instant still reaches advanceCampaignLead as callbackDueAt", () => {
    expect(saveCallData).toMatch(/callbackDueAt:\s*callbackDueAtISO/);
  });
});

describe("dialer-api.saveAppointment contract", () => {
  const writer = body(api, "export async function saveAppointment", "\n}\n");

  it("builds instants with the shared local wall-clock helper, never a bare date+time string", () => {
    expect(writer).toContain("localDateTimeToIso(");
    expect(api).not.toMatch(/\bconvertTo24h\b/);
    expect(writer).not.toMatch(/`\$\{data\.date\}T/);
    expect(writer).not.toMatch(/data\.date\s*\+\s*["'`]T/);
  });

  it("stamps created_by and user_id with the dialing agent and sets no type", () => {
    expect(writer).toMatch(/user_id:\s*data\.agent_id/);
    expect(writer).toMatch(/created_by:\s*data\.agent_id/);
    expect(writer).not.toMatch(/\btype:/);
  });
});
