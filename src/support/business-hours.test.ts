import { describe, expect, it } from "vitest";
import { getBusinessHoursStatus } from "./business-hours.js";
import type { BusinessHoursConfig } from "../config.js";

const schedule: BusinessHoursConfig = {
  monday: [{ start: "09:00", end: "18:00" }],
  tuesday: [{ start: "09:00", end: "18:00" }],
  wednesday: [{ start: "09:00", end: "18:00" }],
  thursday: [{ start: "09:00", end: "18:00" }],
  friday: [{ start: "09:00", end: "18:00" }]
};

const timezone = "America/Argentina/Buenos_Aires";

describe("getBusinessHoursStatus", () => {
  it("is open inside a configured period", () => {
    const status = getBusinessHoursStatus({
      timezone,
      schedule,
      holidays: [],
      now: new Date("2026-04-27T13:00:00.000Z")
    });

    expect(status.isOpen).toBe(true);
    expect(status.localDate).toBe("2026-04-27");
    expect(status.localTime).toBe("10:00");
  });

  it("is closed at the exact end boundary", () => {
    const status = getBusinessHoursStatus({
      timezone,
      schedule,
      holidays: [],
      now: new Date("2026-04-27T21:00:00.000Z")
    });

    expect(status.isOpen).toBe(false);
    expect(status.nextOpenAt?.toISOString()).toBe("2026-04-28T12:00:00.000Z");
  });

  it("skips holidays when looking for the next opening", () => {
    const status = getBusinessHoursStatus({
      timezone,
      schedule,
      holidays: ["2026-04-28"],
      now: new Date("2026-04-27T22:00:00.000Z")
    });

    expect(status.isOpen).toBe(false);
    expect(status.nextOpenAt?.toISOString()).toBe("2026-04-29T12:00:00.000Z");
  });
});
