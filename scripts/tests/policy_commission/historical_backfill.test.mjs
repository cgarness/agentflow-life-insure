import test from "node:test";
import assert from "node:assert/strict";
import { calculateCents } from "../../policy_commission_backfill_batch.mjs";

test("historical commissions use exact monthly premium, rate and 75% advance", () => {
  assert.deepEqual(calculateCents("108.91", "75"), { firstYearCents: 98019, advanceCents: 73514 });
  assert.deepEqual(calculateCents("112.42", "70"), { firstYearCents: 94433, advanceCents: 70825 });
  assert.deepEqual(calculateCents("0.25", "50"), { firstYearCents: 150, advanceCents: 113 });
});

test("historical commission arithmetic refuses invalid or unknown premiums", () => {
  for (const text of ["", "0", "0.00", "1e2", "-1", "12.345", "Infinity", "abc"]) {
    assert.throws(() => calculateCents(text, "75"));
  }
});

test("historical commission arithmetic never uses floating point rate rounding", () => {
  assert.deepEqual(calculateCents("33.33", "87.5"), { firstYearCents: 34997, advanceCents: 26247 });
});
