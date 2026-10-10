import { describe, expect, it } from "vitest";
import { formatCount, formatPremium } from "@/lib/reports-format";
import { LONG_PREMIUM, heroValueSize, isLongPremium } from "@/lib/reports-hero-size";

// Phone sizes from largest to smallest; a longer value must never get a larger one.
const PHONE = ["text-4xl", "text-3xl", "text-[1.75rem]", "text-2xl", "text-xl", "text-lg"];
const phoneRank = (classes: string) => PHONE.indexOf(classes.split(" ")[0]);

describe("Production band value sizes", () => {
  it("stacks the band only for a premium longer than twelve characters", () => {
    expect(LONG_PREMIUM).toBe(12);
    expect(isLongPremium(formatPremium(999999.99))).toBe(false); // "$999,999.99"
    expect(isLongPremium("Unavailable")).toBe(false);
    expect(isLongPremium(formatPremium(1234567.89))).toBe(true); // "$1,234,567.89"
  });

  it.each([
    ["8", "text-4xl md:text-5xl xl:text-[3.5rem]"],
    ["999", "text-4xl md:text-5xl xl:text-[3.5rem]"],
    ["1,234", "text-3xl md:text-5xl xl:text-[3.5rem]"],
    ["12,345", "text-2xl md:text-4xl xl:text-[3.5rem]"],
    ["123,456", "text-xl md:text-3xl xl:text-[3.5rem]"],
    ["1,234,567", "text-lg md:text-2xl xl:text-[3.5rem]"],
  ])("sizes a count of %s in the split band", (text, classes) => {
    expect(heroValueSize("count", text, false)).toBe(classes);
  });

  it("keeps today's count size when the stacked band gives it the full width", () => {
    for (const text of ["8", "12,345", "1,234,567"]) {
      expect(heroValueSize("count", text, true)).toBe("text-4xl md:text-5xl xl:text-[3.5rem]");
    }
  });

  it.each([
    ["$1,481.40", false, "text-3xl md:text-4xl xl:text-[3.5rem]"],
    ["$14,406.00", false, "text-[1.75rem] md:text-4xl xl:text-[3.5rem]"],
    ["$140,406.00", false, "text-2xl md:text-4xl xl:text-[3.5rem]"],
    ["$1,234,567,890.12", true, "text-3xl md:text-4xl xl:text-[3.5rem]"],
    ["$12,345,678,901.23", true, "text-2xl md:text-4xl xl:text-[3.5rem]"],
  ])("sizes a premium of %s (stacked: %s)", (text, stacked, classes) => {
    expect(isLongPremium(text)).toBe(stacked);
    expect(heroValueSize("premium", text, stacked)).toBe(classes);
  });

  it("never gives a longer value a larger phone size, and never exceeds today's md and xl sizes", () => {
    const counts = Array.from({ length: 10 }, (_, i) => formatCount(10 ** (i + 1) - 1));
    const premiums = Array.from({ length: 13 }, (_, i) => formatPremium(10 ** (i + 1) - 0.01));
    const ranks = (values: string[], size: (text: string) => string) => values.map((text) => phoneRank(size(text)));
    const nonIncreasing = (list: number[]) => list.every((rank, i) => rank >= 0 && (i === 0 || rank >= list[i - 1]));
    expect(nonIncreasing(ranks(counts, (text) => heroValueSize("count", text, false)))).toBe(true);
    expect(nonIncreasing(ranks(premiums.filter((text) => !isLongPremium(text)), (text) => heroValueSize("premium", text, false)))).toBe(true);
    expect(nonIncreasing(ranks(premiums.filter(isLongPremium), (text) => heroValueSize("premium", text, true)))).toBe(true);
    const sized = [
      ...counts.map((text) => ["count", heroValueSize("count", text, false)]),
      ...premiums.map((text) => ["premium", heroValueSize("premium", text, isLongPremium(text))]),
    ];
    for (const [kind, classes] of sized) {
      expect(classes.split(" ")).toContain("xl:text-[3.5rem]");
      expect(classes.split(" ").find((name) => name.startsWith("md:"))).toMatch(kind === "count" ? /^md:text-(2xl|3xl|4xl|5xl)$/ : /^md:text-4xl$/);
    }
  });
});
