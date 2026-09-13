import { describe, expect, it } from "vitest";
import {
  canTransitionStatus,
  isScheduleAvailable,
  normalizePhone,
  requireCancellationReason,
} from "./rules.js";

describe("booking rules", () => {
  it("normalizes common Nigerian phone formats", () => {
    expect(normalizePhone("0801 234 5678")).toBe("+2348012345678");
    expect(normalizePhone("+234 801 234 5678")).toBe("+2348012345678");
  });

  it("rejects an invalid phone number", () => {
    expect(() => normalizePhone("080123")).toThrow("valid Nigerian phone number");
  });

  it("requires a meaningful cancellation reason", () => {
    expect(() => requireCancellationReason("  ")).toThrow("cancellation reason");
    expect(requireCancellationReason("Customer changed plans")).toBe("Customer changed plans");
  });

  it("allows only the forward booking lifecycle", () => {
    expect(canTransitionStatus("confirmed", "picked_up")).toBe(true);
    expect(canTransitionStatus("picked_up", "confirmed")).toBe(false);
    expect(canTransitionStatus("completed", "cancelled")).toBe(false);
  });

  it("checks schedule windows and closed dates", () => {
    const schedules = [
      {
        id: "monday",
        dayOfWeek: 1,
        dayLabel: "Monday",
        startTime: "06:30",
        endTime: "21:00",
        active: true,
      },
    ];
    expect(isScheduleAvailable("2026-08-17T10:00:00+01:00", schedules, [])).toBe(true);
    expect(isScheduleAvailable("2026-08-17T21:00:00+01:00", schedules, [])).toBe(false);
    expect(
      isScheduleAvailable("2026-08-17T10:00:00+01:00", schedules, [
        { id: "closed", date: "2026-08-17", note: "Holiday", closed: true },
      ]),
    ).toBe(false);
  });
});
