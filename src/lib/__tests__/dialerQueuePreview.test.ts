/**
 * Lead-score exposure fix (2026-08-06) — Dialer queue-preview field vocabulary.
 *
 * "Score" is removed as an individual queue-preview field option. Agents may
 * already hold a persisted `agentflow_queue_preview` localStorage value naming
 * it, so the stored preference is normalized on read: an unknown / removed /
 * malformed slot falls back to that slot's default instead of rendering a raw
 * lead score (or breaking the card).
 *
 * Queue FILTERING and SORTING by score (Min/Max Score, "Highest Score") are a
 * separate, preserved concern and are not touched by this module.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_QUEUE_PREVIEW_FIELDS,
  QUEUE_PREVIEW_FIELDS,
  QUEUE_PREVIEW_FIELD_LABELS,
  normalizeQueuePreviewFields,
} from "@/lib/dialer-queue-preview";

describe("queue preview field vocabulary", () => {
  it("does not offer score as a preview field", () => {
    expect(QUEUE_PREVIEW_FIELDS).not.toContain("score");
    expect(Object.keys(QUEUE_PREVIEW_FIELD_LABELS)).not.toContain("score");
    expect(Object.values(QUEUE_PREVIEW_FIELD_LABELS)).not.toContain("Score");
  });

  it("keeps every other preview field and its label", () => {
    expect([...QUEUE_PREVIEW_FIELDS]).toEqual([
      "age",
      "state",
      "source",
      "attempts",
      "status",
      "best_time",
    ]);
    expect(QUEUE_PREVIEW_FIELD_LABELS).toEqual({
      age: "Age",
      state: "State",
      source: "Source",
      attempts: "Attempts",
      status: "Status",
      best_time: "Best Time",
    });
  });

  it("defaults to state + attempts", () => {
    expect(DEFAULT_QUEUE_PREVIEW_FIELDS).toEqual(["state", "attempts"]);
  });
});

describe("normalizeQueuePreviewFields — persisted preferences containing score", () => {
  it("falls back per slot, keeping the agent's other valid choice", () => {
    expect(normalizeQueuePreviewFields(["score", "status"])).toEqual(["state", "status"]);
    expect(normalizeQueuePreviewFields(["age", "score"])).toEqual(["age", "attempts"]);
  });

  it("falls back to the full default pair when both slots are score", () => {
    expect(normalizeQueuePreviewFields(["score", "score"])).toEqual(["state", "attempts"]);
  });

  it("falls back for the exact legacy stored shapes", () => {
    expect(normalizeQueuePreviewFields(JSON.parse('["score","attempts"]'))).toEqual([
      "state",
      "attempts",
    ]);
    expect(normalizeQueuePreviewFields(JSON.parse('["state","score"]'))).toEqual([
      "state",
      "attempts",
    ]);
  });

  it("passes valid pairs through unchanged", () => {
    expect(normalizeQueuePreviewFields(["age", "status"])).toEqual(["age", "status"]);
    expect(normalizeQueuePreviewFields(["best_time", "source"])).toEqual(["best_time", "source"]);
    expect(normalizeQueuePreviewFields(["state", "attempts"])).toEqual(["state", "attempts"]);
  });

  it("falls back safely for malformed / missing input", () => {
    expect(normalizeQueuePreviewFields(null)).toEqual(["state", "attempts"]);
    expect(normalizeQueuePreviewFields(undefined)).toEqual(["state", "attempts"]);
    expect(normalizeQueuePreviewFields({})).toEqual(["state", "attempts"]);
    expect(normalizeQueuePreviewFields([])).toEqual(["state", "attempts"]);
    expect(normalizeQueuePreviewFields(["bogus", 42])).toEqual(["state", "attempts"]);
    expect(normalizeQueuePreviewFields(["age"])).toEqual(["age", "attempts"]);
    expect(normalizeQueuePreviewFields("score")).toEqual(["state", "attempts"]);
  });

  it("ignores extra entries beyond the two rendered slots", () => {
    expect(normalizeQueuePreviewFields(["age", "status", "score"])).toEqual(["age", "status"]);
  });

  it("always returns a pair the renderer can resolve", () => {
    for (const raw of [["score", "score"], null, ["bogus"], [1, 2], ["state", "score"]]) {
      const [a, b] = normalizeQueuePreviewFields(raw);
      expect(QUEUE_PREVIEW_FIELDS).toContain(a);
      expect(QUEUE_PREVIEW_FIELDS).toContain(b);
    }
  });
});
