import type { Booking } from "./contracts.js";

export function hasAcceptedFare(booking: Booking): boolean {
  return (
    booking.events.some((event) => event.toStatus === "confirmed") ||
    ["confirmed", "picked_up", "arrived", "completed"].includes(booking.status)
  );
}

export function agreedFareAmount(booking: Booking): number | undefined {
  if (!hasAcceptedFare(booking)) return undefined;
  return booking.agreedAmountKobo ?? booking.offer?.roundedAmountKobo ?? booking.fare.amountKobo;
}
