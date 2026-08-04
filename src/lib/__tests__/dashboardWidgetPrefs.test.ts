import { describe, it, expect } from "vitest";
import {
  DASHBOARD_WIDGET_KEYS,
  canonicalizeWidgetKey,
  defaultWidgetPreferences,
  normalizeWidgetPreferences,
  restorableWidgetKeys,
  serializeWidgetPreferences,
  visibleWidgetKeys,
} from "@/lib/dashboard-widget-prefs";

/**
 * `user_preferences.settings` is an unversioned JSON blob, so these tests cover the
 * shapes that actually reach production: renamed keys, removed keys, duplicates,
 * non-strings, and nothing at all. The old code accepted any array after a bare
 * `Array.isArray` check, which rendered untitled empty cards and could permanently
 * hide a widget under a stale key.
 */

describe("normalizeWidgetPreferences — safe defaults", () => {
  it("returns the full default layout when nothing is saved", () => {
    const prefs = normalizeWidgetPreferences(undefined, undefined);
    expect(prefs.order).toEqual([...DASHBOARD_WIDGET_KEYS]);
    expect(prefs.hidden).toEqual([]);
  });

  it.each([
    ["null", null],
    ["a string", "callbacks"],
    ["a number", 42],
    ["an object", { callbacks: true }],
    ["an empty array", []],
  ])("falls back to the default order when the saved order is %s", (_label, raw) => {
    expect(normalizeWidgetPreferences(raw, null).order).toEqual([...DASHBOARD_WIDGET_KEYS]);
  });

  it("never returns an empty order", () => {
    expect(normalizeWidgetPreferences(["nope", "gone"], null).order.length).toBe(
      DASHBOARD_WIDGET_KEYS.length,
    );
  });
});

describe("normalizeWidgetPreferences — invalid and legacy keys", () => {
  it("drops unknown and removed keys", () => {
    const prefs = normalizeWidgetPreferences(
      ["callbacks", "intelligence_feed", "leaderboard", "old_widget"],
      null,
    );
    expect(prefs.order).not.toContain("intelligence_feed" as never);
    expect(prefs.order).not.toContain("old_widget" as never);
    expect(prefs.order.slice(0, 2)).toEqual(["callbacks", "leaderboard"]);
  });

  it("drops non-string entries without throwing", () => {
    const prefs = normalizeWidgetPreferences(
      ["callbacks", null, 7, { a: 1 }, ["leaderboard"], "leaderboard"],
      null,
    );
    expect(prefs.order.slice(0, 2)).toEqual(["callbacks", "leaderboard"]);
    expect(prefs.order).toHaveLength(DASHBOARD_WIDGET_KEYS.length);
  });

  it("de-duplicates repeated keys, keeping first position", () => {
    const prefs = normalizeWidgetPreferences(
      ["leaderboard", "callbacks", "leaderboard", "callbacks"],
      null,
    );
    expect(prefs.order.filter((k) => k === "leaderboard")).toHaveLength(1);
    expect(prefs.order.filter((k) => k === "callbacks")).toHaveLength(1);
    expect(prefs.order.slice(0, 2)).toEqual(["leaderboard", "callbacks"]);
  });

  it("maps the legacy `schedule` alias onto `appointments` without duplicating it", () => {
    const prefs = normalizeWidgetPreferences(["schedule", "callbacks"], null);
    expect(prefs.order.filter((k) => k === "appointments")).toHaveLength(1);
    expect(prefs.order[0]).toBe("appointments");
  });

  it("does not duplicate when BOTH the alias and the canonical key are saved", () => {
    const prefs = normalizeWidgetPreferences(["schedule", "appointments"], null);
    expect(prefs.order.filter((k) => k === "appointments")).toHaveLength(1);
  });

  it("is case- and whitespace-insensitive", () => {
    const prefs = normalizeWidgetPreferences(["  CALLBACKS  ", "Leaderboard"], null);
    expect(prefs.order.slice(0, 2)).toEqual(["callbacks", "leaderboard"]);
  });
});

describe("normalizeWidgetPreferences — forward compatibility", () => {
  it("appends widgets the saved order predates, so a new widget still appears", () => {
    const prefs = normalizeWidgetPreferences(["callbacks", "leaderboard"], null);
    expect(prefs.order).toHaveLength(DASHBOARD_WIDGET_KEYS.length);
    for (const key of DASHBOARD_WIDGET_KEYS) expect(prefs.order).toContain(key);
    expect(prefs.order.slice(0, 2)).toEqual(["callbacks", "leaderboard"]);
  });

  it("preserves a full custom order exactly", () => {
    const custom = ["anniversaries", "missed_calls", "leaderboard", "goal_progress", "appointments", "callbacks"];
    expect(normalizeWidgetPreferences(custom, null).order).toEqual(custom);
  });
});

describe("hidden widgets", () => {
  it("keeps only canonical keys in hidden", () => {
    const prefs = normalizeWidgetPreferences(null, ["callbacks", "bogus", 3, null]);
    expect(prefs.hidden).toEqual(["callbacks"]);
  });

  it("resolves a legacy alias in the hidden list", () => {
    const prefs = normalizeWidgetPreferences(null, ["schedule"]);
    expect(prefs.hidden).toEqual(["appointments"]);
  });

  it("excludes hidden widgets from the visible list", () => {
    const prefs = normalizeWidgetPreferences(null, ["callbacks", "leaderboard"]);
    const visible = visibleWidgetKeys(prefs);
    expect(visible).not.toContain("callbacks");
    expect(visible).not.toContain("leaderboard");
    expect(visible).toHaveLength(DASHBOARD_WIDGET_KEYS.length - 2);
  });

  it("always makes a hidden widget restorable — the old stale-key trap", () => {
    // Previously `hidden` was filtered against the default order while `order` was
    // not, so a widget hidden under an unrecognised key vanished from both lists.
    const prefs = normalizeWidgetPreferences(["schedule", "callbacks"], ["schedule"]);
    expect(restorableWidgetKeys(prefs)).toEqual(["appointments"]);
    expect(visibleWidgetKeys(prefs)).not.toContain("appointments");
  });

  it("restorable is always a subset of order", () => {
    const prefs = normalizeWidgetPreferences(null, [...DASHBOARD_WIDGET_KEYS]);
    for (const key of restorableWidgetKeys(prefs)) expect(prefs.order).toContain(key);
  });

  it("hiding every widget yields an empty visible list rather than throwing", () => {
    const prefs = normalizeWidgetPreferences(null, [...DASHBOARD_WIDGET_KEYS]);
    expect(visibleWidgetKeys(prefs)).toEqual([]);
    expect(restorableWidgetKeys(prefs)).toHaveLength(DASHBOARD_WIDGET_KEYS.length);
  });
});

describe("round-trip persistence", () => {
  it("serializes to the persisted key names", () => {
    const prefs = defaultWidgetPreferences();
    expect(serializeWidgetPreferences(prefs)).toEqual({
      dashboard_widget_order: prefs.order,
      dashboard_hidden_widgets: prefs.hidden,
    });
  });

  it("normalize(serialize(x)) === x", () => {
    const original = normalizeWidgetPreferences(
      ["leaderboard", "callbacks", "appointments", "goal_progress", "missed_calls", "anniversaries"],
      ["missed_calls"],
    );
    const blob = serializeWidgetPreferences(original);
    const round = normalizeWidgetPreferences(
      blob.dashboard_widget_order,
      blob.dashboard_hidden_widgets,
    );
    expect(round).toEqual(original);
  });
});

describe("canonicalizeWidgetKey", () => {
  it.each([
    ["callbacks", "callbacks"],
    ["schedule", "appointments"],
    ["appointments", "appointments"],
    ["goals", "goal_progress"],
    ["nonsense", null],
    ["", null],
  ])("canonicalizeWidgetKey(%s) === %s", (input, expected) => {
    expect(canonicalizeWidgetKey(input)).toBe(expected);
  });
});
