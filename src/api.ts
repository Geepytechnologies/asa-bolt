import type {
  AvailableSchedule,
  Booking,
  ConflictReview,
  BookingAccessResponse,
  BookingCreationInput,
  FarePreview,
  OfferPreview,
  FareRule,
  LocationRequest,
  OperatingSchedule,
  ScheduleException,
  ServiceLocation,
  ServiceRoute,
  RequestHistory,
} from "../shared/contracts";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fare?: FarePreview,
    readonly offer?: OfferPreview,
    readonly review?: ConflictReview,
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

export async function fetchFare(
  originId: string,
  destinationId: string,
  date = nextDates(1)[0],
): Promise<FarePreview> {
  return getFarePreview(originId, destinationId, date);
}

export async function fetchCustomerSetup(): Promise<{
  locations: ServiceLocation[];
  routes: Pick<ServiceRoute, "id" | "originId" | "destinationId">[];
  availability: AvailableSchedule[];
}> {
  const dates = nextDates(8);
  const [locations, routes, availability] = await Promise.all([
    getLocations(),
    request<Pick<ServiceRoute, "id" | "originId" | "destinationId">[]>("/routes"),
    Promise.all(dates.map((date) => getAvailability(date))),
  ]);
  return {
    locations,
    routes,
    availability: availability
      .filter((item) => item.available)
      .flatMap((item) =>
        item.windows.map((window) => ({
          ...window,
          label: new Date(`${item.date}T12:00:00Z`).toLocaleDateString("en-NG", {
            weekday: "short",
            day: "numeric",
            month: "short",
            timeZone: "Africa/Lagos",
          }),
        })),
      ),
  };
}

export const previewPriceOffer = (amountNaira: string, signal?: AbortSignal) =>
  request<OfferPreview>("/offers/preview", { method: "POST", body: { amountNaira }, signal });

export async function createBooking(input: BookingCreationInput): Promise<BookingAccessResponse> {
  return request<BookingAccessResponse>("/bookings", { method: "POST", body: input });
}

export async function getBooking(token: string): Promise<BookingAccessResponse> {
  return request<BookingAccessResponse>(`/bookings/status/${encodeURIComponent(token)}`);
}

export const fetchBookingStatus = getBooking;

export async function cancelBooking(
  token: string,
  contact: string,
  reason: string,
  emailBased = false,
): Promise<{ booking: Booking }> {
  return request<{ booking: Booking }>(`/bookings/status/${encodeURIComponent(token)}/cancel`, {
    method: "POST",
    body: { [emailBased ? "email" : "phone"]: contact, reason },
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

export const requestHistoryLink = (email: string) =>
  request<{ message: string }>("/history/link", { method: "POST", body: { email } });
export const verifyHistoryLink = (token: string) =>
  request<{ expiresAt: number }>("/history/verify", { method: "POST", body: { token } });
export const fetchRequestHistory = () => request<RequestHistory>("/history");
export const closeRequestHistory = () => request("/history/logout", { method: "POST" });

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
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      response.status,
      friendlyError(response.status, payload),
      payload.fare,
      payload.offer,
      payload.review,
    );
  return payload as T;
}

function friendlyError(status: number, payload: unknown): string {
  if (isErrorPayload(payload)) return payload.error;
  if (status === 401) return "Your private session has ended. Verify your access again.";
  if (status === 403) return "The contact details do not match this request.";
  if (status === 404) return "We could not find that record. Refresh and try again.";
  if (status === 413) return "That request is too large. Shorten the notes and try again.";
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
  const localToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const today = new Date(`${localToday}T12:00:00Z`);
  for (let index = 0; index < count; index += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}
