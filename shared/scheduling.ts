import type { Booking, OperatingSchedule, RideConflict, ScheduleException } from "./contracts.js";

export const OCCUPIED_STATUSES = ["confirmed", "picked_up", "arrived"];

export function localPickupParts(value: string): { date: string; time: string } {
  const pickup = new Date(value);
  if (Number.isNaN(pickup.getTime())) throw new Error("Choose a valid pickup time.");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(pickup);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

export function pickupIsOpen(
  pickupAt: string,
  schedules: OperatingSchedule[],
  exceptions: ScheduleException[],
): boolean {
  const { date, time } = localPickupParts(pickupAt);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return (
    !exceptions.some((item) => item.date === date && item.closed) &&
    schedules.some(
      (item) =>
        item.active && item.dayOfWeek === weekday && time >= item.startTime && time < item.endTime,
    )
  );
}

// Advisory only: without duration estimates, other active rides on the same
// Lagos pickup date need the admin's judgement. No finish time is inferred.
export function findRideConflicts(
  target: Pick<Booking, "id" | "pickupAt">,
  bookings: Booking[],
): RideConflict[] {
  const date = localPickupParts(target.pickupAt).date;
  return bookings
    .filter(
      (booking) =>
        booking.id !== target.id &&
        OCCUPIED_STATUSES.includes(booking.status) &&
        localPickupParts(booking.pickupAt).date === date,
    )
    .map((booking) => ({
      id: booking.id,
      reference: booking.reference,
      pickupAt: booking.pickupAt,
      route: `${booking.origin.name} → ${booking.destination.name}`,
      kind:
        new Date(booking.pickupAt).getTime() === new Date(target.pickupAt).getTime()
          ? ("same_pickup" as const)
          : ("same_day" as const),
    }))
    .sort((a, b) => a.pickupAt.localeCompare(b.pickupAt) || a.id.localeCompare(b.id));
}
