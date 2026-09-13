import type {
  AvailableSchedule,
  Booking,
  BookingAccessResponse,
  BookingCreationInput,
  FarePreview,
  FareRule,
  LocationRequest,
  OperatingSchedule,
  ScheduleException,
  ServiceLocation,
} from "../shared/contracts";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8787/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface AvailabilityResponse {
  date: string;
  available: boolean;
  windows: AvailableSchedule[];
  exceptions: ScheduleException[];
}

export interface OwnerData {
  bookings: Booking[];
  locations: ServiceLocation[];
  fares: FareRule[];
  schedules: OperatingSchedule[];
  exceptions: ScheduleException[];
  requests: LocationRequest[];
}

export type OwnerSnapshot = OwnerData;

export interface ScheduleSetup {
  schedules: OperatingSchedule[];
  exceptions: ScheduleException[];
}

export type ScheduleResponse = ScheduleSetup;

export async function getLocations(): Promise<ServiceLocation[]> {
  return request<ServiceLocation[]>("/locations");
}

export async function getAvailability(date: string): Promise<AvailabilityResponse> {
  return request<AvailabilityResponse>(`/availability?date=${encodeURIComponent(date)}`);
}

export async function getFarePreview(
  originId: string,
  destinationId: string,
  date: string,
): Promise<FarePreview> {
  const query = new URLSearchParams({ originId, destinationId, date });
  return request<FarePreview>(`/fares/preview?${query.toString()}`);
}

export async function fetchFare(originId: string, destinationId: string): Promise<FarePreview> {
  return getFarePreview(originId, destinationId, new Date().toISOString().slice(0, 10));
}

export async function fetchCustomerSetup(): Promise<{
  locations: ServiceLocation[];
  schedule: ScheduleSetup;
}> {
  const locations = await getLocations();
  const dates = nextDates(8);
  const availability = await Promise.all(dates.map((date) => getAvailability(date)));
  const schedules = availability.flatMap((item) =>
    item.windows.map((window) => ({
      id: `${item.date}-${window.startTime}`,
      dayOfWeek: new Date(`${item.date}T12:00:00Z`).getUTCDay(),
      dayLabel: window.label,
      startTime: window.startTime,
      endTime: window.endTime,
      active: item.available,
    })),
  );
  return {
    locations,
    schedule: { schedules, exceptions: availability.flatMap((item) => item.exceptions) },
  };
}

export async function createBooking(input: BookingCreationInput): Promise<BookingAccessResponse> {
  return request<BookingAccessResponse>("/bookings", { method: "POST", body: input });
}

export async function getBooking(token: string): Promise<BookingAccessResponse> {
  return request<BookingAccessResponse>(`/bookings/status/${encodeURIComponent(token)}`);
}

export const fetchBookingStatus = getBooking;

export async function cancelBooking(
  token: string,
  phone: string,
  reason: string,
): Promise<{ booking: Booking }> {
  return request<{ booking: Booking }>(`/bookings/status/${encodeURIComponent(token)}/cancel`, {
    method: "POST",
    body: { phone, reason },
  });
}

export async function createLocationRequest(input: {
  requesterName: string;
  phone: string;
  locationName: string;
  landmark: string;
  mapsUrl: string;
}): Promise<LocationRequest> {
  return request<LocationRequest>("/location-requests", { method: "POST", body: input });
}

export const submitLocationRequest = createLocationRequest;

export const apiFetch = request;

export function buildAvailability(schedule: ScheduleSetup, days: number): AvailableSchedule[] {
  const result: AvailableSchedule[] = [];
  const today = new Date();
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    const dateValue = date.toISOString().slice(0, 10);
    const daySchedule = schedule.schedules.find(
      (item) => item.dayOfWeek === date.getDay() && item.active,
    );
    const closed = schedule.exceptions.some((item) => item.date === dateValue && item.closed);
    if (daySchedule && !closed)
      result.push({
        date: dateValue,
        startTime: daySchedule.startTime,
        endTime: daySchedule.endTime,
        label: date.toLocaleDateString("en-NG", {
          weekday: "short",
          day: "numeric",
          month: "short",
        }),
      });
  }
  return result;
}

export async function ownerLogin(password: string): Promise<{ token: string; expiresAt: number }> {
  return request<{ token: string; expiresAt: number }>("/owner/login", {
    method: "POST",
    body: { password },
  });
}

export async function ownerLogout(token: string): Promise<void> {
  await ownerRequest<{ loggedOut: boolean }>(token, "/owner/logout", { method: "POST" });
}

export async function getOwnerData(token: string): Promise<OwnerData> {
  const headers = { Authorization: `Bearer ${token}` };
  const [bookings, locations, fares, schedules, exceptions, requests] = await Promise.all([
    ownerRequest<Booking[]>(token, "/owner/bookings", { headers }),
    ownerRequest<ServiceLocation[]>(token, "/owner/locations", { headers }),
    ownerRequest<FareRule[]>(token, "/owner/fare-rules", { headers }),
    ownerRequest<OperatingSchedule[]>(token, "/owner/schedules", { headers }),
    ownerRequest<ScheduleException[]>(token, "/owner/exceptions", { headers }),
    ownerRequest<LocationRequest[]>(token, "/owner/location-requests", { headers }),
  ]);
  return { bookings, locations, fares, schedules, exceptions, requests };
}

export async function updateOwnerBooking(
  token: string,
  id: string,
  status: string,
  reason: string,
): Promise<Booking> {
  const result = await ownerRequest<{ booking: Booking }>(token, `/owner/bookings/${id}`, {
    method: "PATCH",
    body: { status, reason },
  });
  return result.booking;
}

export async function saveOwnerLocation(
  token: string,
  location: ServiceLocation,
): Promise<ServiceLocation> {
  return ownerRequest<ServiceLocation>(token, `/owner/locations/${location.id}`, {
    method: "PATCH",
    body: location,
  });
}

export async function saveOwnerFare(token: string, fare: FareRule): Promise<FareRule> {
  return ownerRequest<FareRule>(token, `/owner/fare-rules/${fare.id}`, {
    method: "PATCH",
    body: fare,
  });
}

export async function saveOwnerSchedule(
  token: string,
  schedule: OperatingSchedule,
): Promise<OperatingSchedule> {
  return ownerRequest<OperatingSchedule>(token, `/owner/schedules/${schedule.id}`, {
    method: "PATCH",
    body: schedule,
  });
}

export async function saveOwnerException(
  token: string,
  exception: ScheduleException,
): Promise<ScheduleException> {
  return ownerRequest<ScheduleException>(token, `/owner/exceptions/${exception.id}`, {
    method: "PATCH",
    body: exception,
  });
}

export async function reviewOwnerRequest(
  token: string,
  id: string,
  status: "approved" | "declined",
  responseNote: string,
): Promise<LocationRequest> {
  return ownerRequest<LocationRequest>(token, `/owner/location-requests/${id}`, {
    method: "PATCH",
    body: { status, responseNote },
  });
}

type ApiOptions = Omit<RequestInit, "body"> & { body?: unknown };

async function ownerRequest<T>(token: string, path: string, options: ApiOptions = {}): Promise<T> {
  return request<T>(path, {
    ...options,
    headers: { ...(options.headers ?? {}), Authorization: `Bearer ${token}` },
  });
}

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, ...requestOptions } = options;
  const response = await fetch(`${API_BASE}${path}`, {
    ...requestOptions,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, friendlyError(response.status, payload));
  return payload as T;
}

function friendlyError(status: number, payload: unknown): string {
  if (status === 401) return "Your owner session has ended. Sign in again to continue.";
  if (status === 403) return "That phone number does not match the booking.";
  if (status === 404) return "We could not find that record. Refresh and try again.";
  if (status === 413) return "That request is too large. Shorten the notes and try again.";
  if (isErrorPayload(payload)) return payload.error;
  return "We could not complete that request. Check the details and try again.";
}

function isErrorPayload(value: unknown): value is { error: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  );
}

function nextDates(count: number): string[] {
  const dates: string[] = [];
  const today = new Date();
  for (let index = 0; index < count; index += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}
