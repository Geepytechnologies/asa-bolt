import type { Actor, BookingStatus, RequestStatus } from "./config.js";

export interface ServiceLocation {
  id: string;
  name: string;
  landmark: string;
  mapsUrl: string;
  coordinates: string;
  published: boolean;
}

export interface OperatingSchedule {
  id: string;
  dayOfWeek: number;
  dayLabel: string;
  startTime: string;
  endTime: string;
  active: boolean;
}

export interface ScheduleException {
  id: string;
  date: string;
  note: string;
  closed: boolean;
}

export interface FareRule {
  id: string;
  originId: string;
  destinationId: string;
  amountKobo: number;
  currency: string;
  effectiveFrom: string;
  active: boolean;
  originName?: string;
  destinationName?: string;
}

export interface AvailableSchedule {
  date: string;
  startTime: string;
  endTime: string;
  label: string;
}

export interface FarePreview {
  amountKobo: number;
  currency: string;
  originName: string;
  destinationName: string;
}

export interface BookingStatusEvent {
  fromStatus: BookingStatus | "";
  toStatus: BookingStatus;
  reason: string;
  actor: Actor;
  createdAt: string;
}

export interface Booking {
  id: string;
  reference: string;
  accessToken: string;
  customerName: string;
  phone: string;
  origin: ServiceLocation;
  destination: ServiceLocation;
  pickupNote: string;
  pickupAt: string;
  fare: FarePreview;
  status: BookingStatus;
  cancellationReason: string;
  notificationStatus: string;
  createdAt: string;
  events: BookingStatusEvent[];
}

export interface LocationRequest {
  id: string;
  requesterName: string;
  phone: string;
  locationName: string;
  landmark: string;
  mapsUrl: string;
  status: RequestStatus;
  responseNote: string;
  createdAt: string;
}

export interface BookingCreationInput {
  idempotencyKey: string;
  customerName: string;
  phone: string;
  originId: string;
  destinationId: string;
  pickupAt: string;
  pickupNote: string;
}

export interface BookingAccessResponse {
  booking: Booking;
  statusUrl: string;
}

export interface OwnerSession {
  token: string;
  expiresAt: number;
}
