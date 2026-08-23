// Rev 8 C13 — the checked-in Supabase RPC typing must match the five-argument database signature.
// M2 (unapplied) declares finalize_inbound_call_terminal(uuid, uuid, text, boolean, boolean DEFAULT
// false); types.ts still declared only the first four, so a `p_external_answer` call site would not
// type-check against the generated Database types. The parameter stays OPTIONAL in the typing
// because the SQL parameter defaults to false and existing four-argument callers remain valid.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";

type FinalizeArgs =
  Database["public"]["Functions"]["finalize_inbound_call_terminal"]["Args"];

// COMPILE-TIME pins (these fail `tsc --noEmit` if the typing drifts from the SQL signature).
const withProof: FinalizeArgs = {
  p_call_row_id: "11111111-2222-4333-8444-555555555555",
  p_org_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  p_status: "completed",
  p_mark_missed: false,
  p_external_answer: true,
};

// The four-argument form must remain valid — the SQL parameter defaults to false.
const withoutProof: FinalizeArgs = {
  p_call_row_id: "11111111-2222-4333-8444-555555555555",
  p_org_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  p_status: "no-answer",
  p_mark_missed: true,
};

describe("C13 — the generated RPC typing carries the optional external-answer argument", () => {
  it("accepts the five-argument call shape", () => {
    expect(withProof.p_external_answer).toBe(true);
    expect(Object.keys(withProof).sort()).toEqual([
      "p_call_row_id",
      "p_external_answer",
      "p_mark_missed",
      "p_org_id",
      "p_status",
    ]);
  });

  it("still accepts the four-argument call shape (SQL default false)", () => {
    expect("p_external_answer" in withoutProof).toBe(false);
    expect(withoutProof.p_status).toBe("no-answer");
  });
});

describe("C13 — the checked-in typing matches the SQL signature exactly", () => {
  const types = readFileSync(
    resolve(__dirname, "../../integrations/supabase/types.ts"),
    "utf8",
  );
  const m2 = readFileSync(
    resolve(__dirname, "../../../supabase/migrations/20260823222805_inbound_claim_lifecycle.sql"),
    "utf8",
  );
  const argsBlock = (() => {
    const start = types.indexOf("      finalize_inbound_call_terminal: {");
    return types.slice(start, types.indexOf("Returns", start));
  })();

  it("declares p_external_answer as an OPTIONAL boolean", () => {
    expect(argsBlock.includes("p_external_answer?: boolean")).toBe(true);
  });

  it("declares exactly the five SQL parameters and nothing else", () => {
    const declared = [...argsBlock.matchAll(/^\s{10}(p_[a-z_]+)\??:/gm)].map((x) => x[1]).sort();
    expect(declared).toEqual([
      "p_call_row_id",
      "p_external_answer",
      "p_mark_missed",
      "p_org_id",
      "p_status",
    ]);
  });

  it("the SQL side really does declare the five-argument form with a default", () => {
    expect(/p_external_answer boolean DEFAULT false/.test(m2)).toBe(true);
  });

  it("every ACL/COMMENT reference names ONLY the five-argument signature", () => {
    const fourArg = /finalize_inbound_call_terminal\(uuid,\s*uuid,\s*text,\s*boolean\)/;
    expect(fourArg.test(m2)).toBe(false);
    const claimSuite = readFileSync(
      resolve(__dirname, "../../../supabase/tests/inbound_claim.sql"),
      "utf8",
    );
    expect(fourArg.test(claimSuite)).toBe(false);
    expect(
      claimSuite.includes("finalize_inbound_call_terminal(uuid, uuid, text, boolean, boolean)"),
    ).toBe(true);
  });

  it("M2 defines the function exactly once, so no stale four-argument overload can be created", () => {
    const defs = m2.match(/CREATE OR REPLACE FUNCTION public\.finalize_inbound_call_terminal/g) || [];
    expect(defs.length).toBe(1);
  });
});
