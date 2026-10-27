export const BRAND_CONFIG = {
  name: "Asa Ride",
  city: "Umuahia",
  timezone: "Africa/Lagos",
  currency: "NGN",
} as const;

export const BOOKING_STATUSES = [
  "requested",
  "rejected",
  "confirmed",
  "picked_up",
  "arrived",
  "completed",
  "cancelled",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export type Actor = "customer" | "owner" | "system";
export type RequestStatus = "pending" | "approved" | "declined";
