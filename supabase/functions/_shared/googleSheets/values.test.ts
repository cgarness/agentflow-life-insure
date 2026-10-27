// Run: deno test supabase/functions/_shared/googleSheets/values.test.ts
// Lossless typed values (mapping v2): a value is rewritten only when every digit, the sign and every decimal place
// survive and the meaning is certain; anything else is kept EXACTLY and flagged.
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { normalizeDate, normalizeNumber, normalizeUsState, typedValue } from "./values.ts";

Deno.test("Number: only a leading $ and valid thousands commas are removed; digits, sign and decimals are kept", () => {
  const ok: [string, string][] = [
    ["1234", "1234"], ["0", "0"], ["0.5", "0.5"], [".5", ".5"], ["-12.50", "-12.50"], ["$1,234.50", "1234.50"], ["1,234", "1234"],
    ["-$5", "-5"], ["$0.10", "0.10"], ["12,345,678.900", "12345678.900"], ["$25,000", "25000"], ["123456789012345678901", "123456789012345678901"],
    ["10.", "10."],
  ];
  for (const [raw, value] of ok) assertEquals(normalizeNumber(raw), { value }, raw);
});

Deno.test("Number: leading zeros, identifiers and ambiguous forms are kept exactly", () => {
  // "007" and "02134" are plain numbers to the contact view and are never rewritten (kept, not flagged).
  assertEquals(normalizeNumber("007"), { value: "007" });
  assertEquals(normalizeNumber("02134"), { value: "02134" });
  for (const raw of ["$007", "0,123", "$02,134", "+5", "5%", "(1,234)", "$-5", "1e5", "1,23", "1 234", "€5", "£1,000", "abc", "1.2.3",
    "$", "-", "1,2345", "12,34,567", "$$5", "5$", " 5"]) {
    assertEquals(normalizeNumber(raw), { value: raw, kept_as_text: true }, raw);
  }
});

Deno.test("Date: ISO and year-first always; M/D/YYYY only in a month-first sheet locale", () => {
  assertEquals(normalizeDate("2026-10-27", null), { value: "2026-10-27" });
  assertEquals(normalizeDate("2026/1/5", "en_GB"), { value: "2026-01-05" });
  assertEquals(normalizeDate("10/27/2026", "en_US"), { value: "2026-10-27" });
  assertEquals(normalizeDate("1-5-2026", "es_US"), { value: "2026-01-05" });
  assertEquals(normalizeDate("1.5.2026", "en_US"), { value: "2026-01-05" });
  for (const [raw, locale] of [["10/12/2026", "en_GB"], ["10/12/2026", null], ["10/12/2026", "fr_FR"], ["27/10/2026", "en_US"],
    ["10/27/26", "en_US"], ["45000", "en_US"], ["10/27/2026 3:04 PM", "en_US"], ["2026-10-27T10:00:00Z", null], ["Oct 27, 2026", "en_US"],
    ["2/30/2026", "en_US"], ["2026-02-30", null], ["10/27-2026", "en_US"], ["0999-01-01", null]] as [string, string | null][]) {
    assertEquals(normalizeDate(raw, locale), { value: raw, kept_as_text: true }, `${raw} @ ${locale}`);
  }
});

Deno.test("typedValue: Text / Phone / Email / ZIP-like values are never transformed; Dropdown flags non-options", () => {
  for (const type of ["Text", "Phone", "Email", null, undefined, "Unknown"]) {
    for (const raw of ["02134", "$1,234.50", "10/27/2026", "007-12-3456"]) {
      assertEquals(typedValue(raw, type === undefined ? undefined : { type }, "en_US"), { value: raw }, `${type}:${raw}`);
    }
  }
  assertEquals(typedValue("Yes", { type: "Dropdown", options: ["Yes", "No"] }, null), { value: "Yes" });
  assertEquals(typedValue("yes", { type: "Dropdown", options: ["Yes", "No"] }, null), { value: "yes", not_an_option: true });
  assertEquals(typedValue("$5", { type: "Number" }, null), { value: "5" });
  assertEquals(typedValue("10/27/2026", { type: "Date" }, "en_US"), { value: "2026-10-27" });
});

Deno.test("normalizeUsState mirrors public.normalize_us_state", () => {
  const cases: [string, string][] = [
    ["", ""], ["  ", "  "], ["tx", "TX"], [" Tx ", "TX"], ["dc", "DC"], ["Texas", "TX"], ["  new york ", "NY"], ["NEW JERSEY", "NJ"],
    ["district of columbia", "DC"], ["new  york", "new  york"], ["Puerto Rico", "Puerto Rico"], ["PR", "PR"], ["Tex.", "Tex."],
    ["\tTX", "\tTX"],
  ];
  for (const [raw, out] of cases) assertEquals(normalizeUsState(raw), out, JSON.stringify(raw));
});
