import { describe, expect, it } from "vitest";
import { APPOINTMENT_BUSINESS_CATEGORIES, APPOINTMENT_BUSINESS_CATEGORY_LABELS, SELECTABLE_APPOINTMENT_BUSINESS_CATEGORIES,
  parseAppointmentBusinessCategory, selectableAppointmentBusinessCategorySchema } from "@/lib/calendar/appointmentTypes";

describe("appointment business categories (D4 §3.2, §4)", () => {
  it("match the server CHECK and label every value", () => {
    expect([...APPOINTMENT_BUSINESS_CATEGORIES]).toEqual(["sales", "follow_up", "callback", "recruiting", "review", "service", "other", "unclassified"]);
    expect(APPOINTMENT_BUSINESS_CATEGORY_LABELS.sales).toBe("Sales appointment");
    expect(APPOINTMENT_BUSINESS_CATEGORY_LABELS.unclassified).toBe("Needs category");
  });
  it("Settings cannot choose callback or unclassified; unknown values read as unclassified", () => {
    expect(SELECTABLE_APPOINTMENT_BUSINESS_CATEGORIES).not.toContain("callback");
    expect(selectableAppointmentBusinessCategorySchema.safeParse("unclassified").success).toBe(false);
    expect([parseAppointmentBusinessCategory("follow_up"), parseAppointmentBusinessCategory(undefined), parseAppointmentBusinessCategory("x")])
      .toEqual(["follow_up", "unclassified", "unclassified"]);
  });
});
