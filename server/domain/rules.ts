import type { BookingStatus } from "../../shared/config.js";
import type { OperatingSchedule, ScheduleException } from "../../shared/contracts.js";

const NIGERIAN_PHONE = /^\+234\d{10}$/;

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.startsWith("234") ? `+${digits}` : `+234${digits.slice(-10)}`;
  if (!NIGERIAN_PHONE.test(normalized)) {
    throw new Error("Enter a valid Nigerian phone number, for example 08012345678.");
  }
  return normalized;
}

export function isValidRoute(originId: string, destinationId: string): boolean {
  return originId.length > 0 && destinationId.length > 0 && originId !== destinationId;
}

export function isScheduleAvailable(
  pickupAt: string,
  schedules: OperatingSchedule[],
  exceptions: ScheduleException[],
): boolean {
  const pickup = new Date(pickupAt);
  if (Number.isNaN(pickup.getTime())) return false;
  const date = pickupAt.slice(0, 10);
  if (exceptions.some((item) => item.date === date && item.closed)) return false;
  const weekday = pickup.getDay();
  const time = pickupAt.slice(11, 16);
  return schedules.some(
    (schedule) =>
      schedule.active &&
      schedule.dayOfWeek === weekday &&
      time >= schedule.startTime &&
      time < schedule.endTime,
  );
}

const NEXT_STATUS: Record<BookingStatus, BookingStatus[]> = {
  requested: ["confirmed", "cancelled"],
  confirmed: ["picked_up", "cancelled"],
  picked_up: ["arrived", "cancelled"],
  arrived: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransitionStatus(from: BookingStatus, to: BookingStatus): boolean {
  return NEXT_STATUS[from].includes(to);
}

export function requireCancellationReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length < 3) throw new Error("A cancellation reason is required.");
  return trimmed.slice(0, 240);
}

export function formatNaira(amountKobo: number): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    amountKobo / 100,
  );
}

export function createReference(sequence: number): string {
  return `ASA-${new Date().getFullYear()}-${String(sequence).padStart(5, "0")}`;
}
