import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import {
  BOOKING_STATUSES,
  BRAND_CONFIG,
  type BookingStatus,
  type RequestStatus,
} from "../../shared/config.js";
import type {
  BookingCreationInput,
  FareRule,
  OperatingSchedule,
  ScheduleException,
  ServiceLocation,
} from "../../shared/contracts.js";
import { BookingApplication } from "../application.js";
import { Database } from "../infrastructure/database.js";
import { Repository } from "../infrastructure/repository.js";
import { seedDatabase } from "../infrastructure/seed.js";
import {
  createNotificationGateway,
  type NotificationGateway,
} from "../infrastructure/notifications/index.js";

const MAX_BODY_BYTES = 1_000_000;
const SESSION_LENGTH_MS = 8 * 60 * 60 * 1000;

interface Runtime {
  repository: Repository;
  bookings: BookingApplication;
  password: string;
  sessions: Map<string, number>;
}

export interface AppOptions {
  database?: Database;
  env?: NodeJS.ProcessEnv;
  notifications?: NotificationGateway;
}

export type RequestHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createApp(options: AppOptions = {}): Server {
  return createServer(createRequestHandler(options));
}

export function createRequestHandler(options: AppOptions = {}): RequestHandler {
  const env = options.env ?? process.env;
  const database =
    options.database ?? new Database(env.ASA_BOLT_DATABASE_PATH ?? "./data/asa-bolt.sqlite");
  seedDatabase(database);
  const repository = new Repository(database);
  enrichSeedLocations(repository);
  const runtime: Runtime = {
    repository,
    bookings: new BookingApplication(
      repository,
      options.notifications ?? createNotificationGateway(env),
    ),
    password: env.ASA_BOLT_OWNER_PASSWORD ?? "local-change-me",
    sessions: new Map(),
  };
  return (request, response) => handleRequest(request, response, runtime);
}

function enrichSeedLocations(repository: Repository): void {
  const details: Record<string, { mapsUrl: string; coordinates: string }> = {
    "umuahia-central": {
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Umuahia+Central+Park",
      coordinates: "5.5266,7.4898",
    },
    "umuahia-tower": {
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Umuahia+Tower",
      coordinates: "5.5321,7.4895",
    },
    "isi-court": {
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Isi+Court+Junction+Umuahia",
      coordinates: "5.5280,7.4778",
    },
    "abia-mall": {
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Abia+Mall+Umuahia",
      coordinates: "5.5296,7.4789",
    },
  };
  for (const location of repository.listLocations()) {
    const detail = details[location.id];
    if (!detail || (location.mapsUrl && location.coordinates)) continue;
    repository.saveLocation({ ...location, ...detail });
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Runtime,
): Promise<void> {
  addCorsHeaders(response);
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) throw new HttpError(404, "API route not found.");
    await routeApi(request, response, runtime, url);
  } catch (error) {
    handleError(response, error);
  }
}

async function routeApi(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Runtime,
  url: URL,
): Promise<void> {
  const parts = url.pathname.split("/").filter(Boolean).slice(1);
  const body = request.method === "GET" ? {} : await readJson(request);
  if (request.method === "GET" && parts[0] === "config")
    return sendJson(response, 200, { brand: BRAND_CONFIG });
  if (request.method === "GET" && parts[0] === "locations")
    return publicLocations(response, runtime);
  if (request.method === "GET" && parts[0] === "availability")
    return availability(response, runtime, url);
  if (request.method === "GET" && parts[0] === "fares" && parts[1] === "preview") {
    return farePreview(response, runtime, url);
  }
  if (request.method === "POST" && parts[0] === "bookings")
    return createBooking(response, runtime, body);
  if (request.method === "GET" && parts[0] === "bookings" && parts[1] === "status") {
    return publicBooking(response, runtime, parts[2] ?? "");
  }
  if (
    request.method === "POST" &&
    parts[0] === "bookings" &&
    parts[1] === "status" &&
    parts[3] === "cancel"
  ) {
    return cancelBooking(response, runtime, parts[2] ?? "", body);
  }
  if (request.method === "POST" && parts[0] === "location-requests") {
    return createLocationRequest(response, runtime, body);
  }
  if (parts[0] === "owner") return routeOwner(request, response, runtime, parts.slice(1), body);
  throw new HttpError(404, "API route not found.");
}

function publicLocations(response: ServerResponse, runtime: Runtime): void {
  sendJson(response, 200, runtime.repository.listLocations(true));
}

function availability(response: ServerResponse, runtime: Runtime, url: URL): void {
  const date = dateValue(url.searchParams.get("date") ?? undefined);
  const windows = runtime.bookings.listAvailability(date);
  const exceptions = runtime.repository.listExceptions().filter((item) => item.date === date);
  sendJson(response, 200, {
    date,
    available: windows.length > 0 && !exceptions.some((item) => item.closed),
    windows,
    exceptions,
  });
}

function farePreview(response: ServerResponse, runtime: Runtime, url: URL): void {
  const originId = requiredQuery(url, "originId");
  const destinationId = requiredQuery(url, "destinationId");
  const date = dateValue(url.searchParams.get("date") ?? undefined);
  sendJson(response, 200, runtime.bookings.previewFare(originId, destinationId, date));
}

async function createBooking(
  response: ServerResponse,
  runtime: Runtime,
  body: unknown,
): Promise<void> {
  const result = await runtime.bookings.createBooking(bookingInput(body));
  sendJson(response, 201, result);
}

function publicBooking(response: ServerResponse, runtime: Runtime, token: string): void {
  if (!token) throw new HttpError(400, "A booking link is required.");
  sendJson(response, 200, runtime.bookings.getPublicBooking(token));
}

async function cancelBooking(
  response: ServerResponse,
  runtime: Runtime,
  token: string,
  body: unknown,
): Promise<void> {
  const input = asRecord(body);
  const booking = await runtime.bookings.cancelPublicBooking(
    token,
    requiredText(input.phone, "Phone number"),
    requiredText(input.reason, "Cancellation reason"),
  );
  sendJson(response, 200, { booking });
}

function createLocationRequest(response: ServerResponse, runtime: Runtime, body: unknown): void {
  const input = asRecord(body);
  const request = runtime.bookings.createLocationRequest({
    requesterName: requiredText(input.requesterName, "Your name"),
    phone: requiredText(input.phone, "Phone number"),
    locationName: requiredText(input.locationName, "Location name"),
    landmark: requiredText(input.landmark, "Landmark"),
    mapsUrl: optionalText(input.mapsUrl),
  });
  sendJson(response, 201, request);
}

async function routeOwner(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Runtime,
  parts: string[],
  body: unknown,
): Promise<void> {
  if (request.method === "POST" && parts[0] === "login") return ownerLogin(response, runtime, body);
  requireOwner(request, runtime);
  if (request.method === "POST" && parts[0] === "logout")
    return ownerLogout(request, response, runtime);
  if (request.method === "GET" && parts[0] === "session")
    return sendJson(response, 200, { authenticated: true });
  if (request.method === "GET" && parts[0] === "bookings") return ownerBookings(response, runtime);
  if (request.method === "PATCH" && parts[0] === "bookings")
    return ownerBookingStatus(response, runtime, parts[1] ?? "", body);
  if (request.method === "GET" && parts[0] === "schedules")
    return sendJson(response, 200, runtime.repository.listSchedules());
  if (request.method === "PATCH" && parts[0] === "schedules")
    return saveSchedule(response, runtime, parts[1] ?? "", body);
  if (request.method === "GET" && parts[0] === "exceptions")
    return sendJson(response, 200, runtime.repository.listExceptions());
  if (request.method === "PATCH" && parts[0] === "exceptions")
    return saveException(response, runtime, parts[1] ?? "", body);
  if (request.method === "GET" && parts[0] === "locations")
    return sendJson(response, 200, runtime.repository.listLocations());
  if (request.method === "PATCH" && parts[0] === "locations")
    return saveLocation(response, runtime, parts[1] ?? "", body);
  if (request.method === "GET" && parts[0] === "fare-rules")
    return sendJson(response, 200, runtime.repository.listFares());
  if (request.method === "PATCH" && parts[0] === "fare-rules")
    return saveFare(response, runtime, parts[1] ?? "", body);
  if (request.method === "GET" && parts[0] === "location-requests")
    return sendJson(response, 200, runtime.repository.listLocationRequests());
  if (request.method === "PATCH" && parts[0] === "location-requests")
    return reviewLocationRequest(response, runtime, parts[1] ?? "", body);
  throw new HttpError(404, "Owner route not found.");
}

function ownerLogin(response: ServerResponse, runtime: Runtime, body: unknown): void {
  const password = requiredText(asRecord(body).password, "Password");
  if (password !== runtime.password) throw new HttpError(401, "The owner password is incorrect.");
  const token = randomUUID();
  const expiresAt = Date.now() + SESSION_LENGTH_MS;
  runtime.sessions.set(token, expiresAt);
  sendJson(response, 200, { token, expiresAt });
}

function ownerLogout(request: IncomingMessage, response: ServerResponse, runtime: Runtime): void {
  const token = ownerToken(request);
  runtime.sessions.delete(token);
  sendJson(response, 200, { loggedOut: true });
}

function ownerBookings(response: ServerResponse, runtime: Runtime): void {
  sendJson(response, 200, runtime.repository.listBookings());
}

async function ownerBookingStatus(
  response: ServerResponse,
  runtime: Runtime,
  id: string,
  body: unknown,
): Promise<void> {
  const input = asRecord(body);
  const status = bookingStatus(input.status);
  const booking = await runtime.bookings.changeStatus(
    id,
    status,
    optionalText(input.reason),
    "owner",
  );
  sendJson(response, 200, { booking });
}

function saveSchedule(response: ServerResponse, runtime: Runtime, id: string, body: unknown): void {
  const input = asRecord(body);
  const dayOfWeek = numberValue(input.dayOfWeek, "Day");
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)
    throw new HttpError(400, "Day must be between Sunday and Saturday.");
  const schedule: OperatingSchedule = {
    id: id || randomUUID(),
    dayOfWeek,
    dayLabel: "",
    startTime: timeValue(input.startTime, "Start time"),
    endTime: timeValue(input.endTime, "End time"),
    active: input.active !== false,
  };
  if (schedule.startTime >= schedule.endTime)
    throw new HttpError(400, "End time must be after start time.");
  runtime.repository.saveSchedule(schedule);
  const saved = runtime.repository.listSchedules().find((item) => item.id === schedule.id);
  sendJson(response, 200, saved ?? schedule);
}

function saveException(
  response: ServerResponse,
  runtime: Runtime,
  id: string,
  body: unknown,
): void {
  const input = asRecord(body);
  const exception: ScheduleException = {
    id: id || randomUUID(),
    date: dateValue(optionalText(input.date)),
    note: requiredText(input.note, "Note"),
    closed: input.closed !== false,
  };
  runtime.repository.saveException(exception);
  const saved = runtime.repository.listExceptions().find((item) => item.date === exception.date);
  sendJson(response, 200, saved ?? exception);
}

function saveLocation(response: ServerResponse, runtime: Runtime, id: string, body: unknown): void {
  const input = asRecord(body);
  const location: ServiceLocation = {
    id: id || randomUUID(),
    name: requiredText(input.name, "Location name"),
    landmark: requiredText(input.landmark, "Landmark"),
    mapsUrl: optionalText(input.mapsUrl),
    coordinates: optionalText(input.coordinates),
    published: input.published !== false,
  };
  runtime.repository.saveLocation(location);
  sendJson(response, 200, location);
}

function saveFare(response: ServerResponse, runtime: Runtime, id: string, body: unknown): void {
  const input = asRecord(body);
  const fare: FareRule = {
    id: id || randomUUID(),
    originId: requiredText(input.originId, "Origin"),
    destinationId: requiredText(input.destinationId, "Destination"),
    amountKobo: numberValue(input.amountKobo, "Fare"),
    currency: BRAND_CONFIG.currency,
    effectiveFrom: dateValue(optionalText(input.effectiveFrom)),
    active: input.active !== false,
  };
  if (fare.originId === fare.destinationId || fare.amountKobo <= 0)
    throw new HttpError(400, "Enter a valid route and fare.");
  runtime.repository.saveFare(fare);
  sendJson(response, 200, fare);
}

function reviewLocationRequest(
  response: ServerResponse,
  runtime: Runtime,
  id: string,
  body: unknown,
): void {
  const input = asRecord(body);
  const status = requestStatus(input.status);
  const request = runtime.bookings.reviewLocationRequest(
    id,
    status,
    optionalText(input.responseNote),
  );
  sendJson(response, 200, request);
}

function bookingInput(body: unknown): BookingCreationInput {
  const input = asRecord(body);
  return {
    idempotencyKey: requiredText(input.idempotencyKey, "Booking key"),
    customerName: requiredText(input.customerName, "Your name"),
    phone: requiredText(input.phone, "Phone number"),
    originId: requiredText(input.originId, "Pickup"),
    destinationId: requiredText(input.destinationId, "Destination"),
    pickupAt: requiredText(input.pickupAt, "Pickup time"),
    pickupNote: optionalText(input.pickupNote),
  };
}

function requireOwner(request: IncomingMessage, runtime: Runtime): void {
  const token = ownerToken(request);
  const expiresAt = runtime.sessions.get(token) ?? 0;
  if (!token || expiresAt < Date.now()) {
    runtime.sessions.delete(token);
    throw new HttpError(401, "Owner sign-in is required.");
  }
}

function ownerToken(request: IncomingMessage): string {
  const authorization = request.headers.authorization ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "The request is too large.");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "Send valid JSON.");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new HttpError(400, "Send a JSON object.");
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new HttpError(400, `${label} is required.`);
  return text;
}

function optionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new HttpError(400, `${label} must be a number.`);
  return number;
}

function timeValue(value: unknown, label: string): string {
  const time = requiredText(value, label);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, `${label} must use HH:MM.`);
  return time;
}

function dateValue(value: string | null | undefined): string {
  const date = value ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00Z`).getTime())) {
    throw new HttpError(400, "Choose a valid date.");
  }
  return date;
}

function requiredQuery(url: URL, key: string): string {
  return requiredText(url.searchParams.get(key), key);
}

function bookingStatus(value: unknown): BookingStatus {
  const status = requiredText(value, "Status") as BookingStatus;
  if (!BOOKING_STATUSES.includes(status))
    throw new HttpError(400, "Choose a valid booking status.");
  return status;
}

function requestStatus(value: unknown): RequestStatus {
  const status = requiredText(value, "Status") as RequestStatus;
  if (status !== "approved" && status !== "declined")
    throw new HttpError(400, "Choose approve or decline.");
  return status;
}

function addCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(status === 204 ? undefined : JSON.stringify(data));
}

function handleError(response: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) return sendJson(response, error.status, { error: error.message });
  console.error("[api] request failed", error);
  sendJson(response, 400, {
    error: "The request could not be completed. Check the details and try again.",
  });
}
