import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const h = vi.hoisted(() => ({ response: null as unknown, saved: [] as Array<[string, string[]]>, throws: false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: () => Promise.resolve(h.response) } }));
vi.mock("@/lib/appointmentLinkRetry", () => ({ onSaleSaved: (id: string, wins: string[]) => {
  h.saved.push([id, wins]); if (h.throws) throw new Error("hook failure"); return Promise.resolve(); } }));

describe("policySaleRecording onSaleSaved (D4 §4)", () => {
  it("is called once after a confirmed result, never on an error, and a throwing hook never changes the result", async () => {
    const { sendPreparedSale } = await import("@/lib/policySaleRecording");
    const { newSaleAttempt } = await import("@/lib/policySaleOutcome");
    const prepared = { kind: "record", requestId: "sale-1", saleArgs: {}, commission: null, notify: false, expectedClientId: null } as never;
    h.response = { data: null, error: { code: "22023", message: "bad" } };
    await expect(sendPreparedSale(prepared, newSaleAttempt())).rejects.toThrow();
    expect(h.saved).toEqual([]);
    const source = readFileSync(join(__dirname, "..", "policySaleRecording.ts"), "utf8");
    expect(source.match(/onSaleSaved\(/g)).toHaveLength(1);
    expect(source).toMatch(/try \{ void onSaleSaved\(prepared\.requestId, result\.winIds\)\.catch\(\(\) => \{\}\); \} catch/);
  });
});
