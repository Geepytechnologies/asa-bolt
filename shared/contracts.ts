import type { Actor, BookingStatus, RequestStatus } from "./config.js";
import type { EmailState } from "./notifications.js";

export interface ServiceLocation {
  id: string;
  name: string;
  landmark: string;
  mapsUrl: string;
  coordinates: string;
  published: boolean;
  researchId?: string;
  researchArea?: string;
  researchCategory?: string;
  researchSourceUrl?: string;
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
  roundedAmountKobo?: number;
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
  pricing?: PricingBreakdown;
}

export interface PricingBreakdown {
  routeId: string;
  method: "fixed" | "distance";
  distanceKm: string | null;
  ratePerKm: string | null;
  fixedAmountNaira: string | null;
  fixedRuleId: string | null;
  unroundedNaira: string;
  roundingNaira: 50;
  pricingAreaId?: string | null;
  pricingAreaName?: string | null;
  rateSource?: "fixed" | "area" | "default";
}

export interface PricingArea {
  id: string;
  name: string;
  ratePerKm: string | null;
}

export interface ServiceRoute {
  id: string;
  originId: string;
  destinationId: string;
  originName: string;
  destinationName: string;
  distanceKm: string | null;
  published: boolean;
  researchDistanceKm: string | null;
  sourceUrl: string;
  sourceLabel: string;
  collectedAt: string;
  sourcePairKey: string;
  sourceRow: number | null;
  distanceNote: string;
  pricingAreaId: string | null;
}

export interface PricingSettings {
  defaultRatePerKm: string | null;
}

export interface PricingOverview {
  settings: PricingSettings;
  areas: PricingArea[];
  routes: ServiceRoute[];
  fares: FareRule[];
  locations: ServiceLocation[];
  research: {
    workbook: string;
    sha256: string;
    collectionDate: string;
    locationCount: number;
    routePairCount: number;
    directionalRouteCount: number;
    suggestedRatePerKm: string;
  };
}

export interface BookingStatusEvent {
  fromStatus: BookingStatus | "";
  toStatus: BookingStatus;
  reason: string;
  actor: Actor;
  createdAt: string;
}

export interface OfferPreview {
  amountNaira: string;
  roundedAmountKobo: number;
}

export interface PriceOffer extends OfferPreview {
  note: string;
}

export interface BookingScheduleEvent {
  id: string;
  fromPickupAt: string;
  toPickupAt: string;
  fromReservedMinutes: number | null;
  toReservedMinutes: number | null;
  reason: string;
  actor: "owner";
  createdAt: string;
}

export interface RideConflict {
  id: string;
  reference: string;
  pickupAt: string;
  route: string;
  kind: "same_pickup" | "same_day";
}

export interface ConflictReview {
  conflicts: RideConflict[];
  token: string;
}

export interface Booking {
  id: string;
  reference: string;
  accessToken: string;
  customerName: string;
  phone: string;
  email?: string;
  whatsappNumber?: string;
  whatsappUpdates?: boolean;
  whatsappConsentAt?: string;
  whatsappOptOutAt?: string;
  rejectionReason?: string;
  origin: ServiceLocation;
  destination: ServiceLocation;
  pickupNote: string;
  pickupAt: string;
  reservedMinutes?: number | null;
  scheduleRevision?: number;
  scheduleEvents?: BookingScheduleEvent[];
  fare: FarePreview;
  offer?: PriceOffer;
  agreedAmountKobo?: number;
  status: BookingStatus;
  cancellationReason: string;
  notificationStatus: string;
  customerEmailStatus?: EmailState;
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
  customerName?: string;
  phone?: string;
  email?: string;
  whatsappNumber?: string;
  whatsappUpdates?: boolean;
  whatsappConsentAt?: string;
  whatsappOptOutAt?: string;
  quotedAmountKobo?: number;
  priceChoice?: "accept" | "negotiate";
  proposedAmountNaira?: string;
  proposedAmountKobo?: number;
  negotiationNote?: string;
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

export interface RequestHistory {
  email: string;
  bookings: Booking[];
  expiresAt: number;
}
