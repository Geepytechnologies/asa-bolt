import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { accessSync, constants } from "node:fs";
import { resolve } from "node:path";
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
import { CustomerEmail } from "../infrastructure/notifications/email.js";
import { HISTORY_COOKIE, HISTORY_SESSION_SECONDS, HistoryAccess } from "../history.js";
import { previewOffer } from "../domain/offers.js";
import { parsePickupTime } from "../domain/rules.js";
import { HttpError } from "../errors.js";
import { PricingService, type PricingDraft } from "../pricing.js";
import { importRouteResearch } from "../infrastructure/research.js";
import { koboToNaira, nairaToKobo, roundNairaUpTo50 } from "../domain/pricing.js";
import { seedDatabase } from "../infrastructure/seed.js";
import {
  createNotificationGateway,
  type NotificationGateway,
} from "../infrastructure/notifications/index.js";

import { ApiLimits, clientAddress, secureHeaders, serveFrontend } from "../operations.js";
import { createBackup } from "../backup.js";
import { GoogleCalendar } from "../calendar.js";

const MAX_BODY_BYTES = 1_000_000;
const SESSION_LENGTH_MS = 8 * 60 * 60 * 1000;

interface Runtime {
  repository: Repository;
  bookings: BookingApplication;
  password: string;
  sessions: Map<string, number>;
  history: HistoryAccess;
  pricing: PricingService;
  appOrigin: string;
  email: CustomerEmail;
  whatsapp: CustomerEmail;
  limits: ApiLimits;
  trustProxy: boolean;
  production: boolean;
  staticDirectory: string;
  database: Database;
  calendar: GoogleCalendar;
}

export interface AppOptions {
  database?: Database;
  env?: NodeJS.ProcessEnv;
  notifications?: NotificationGateway;
  emailFetch?: typeof fetch;
  calendarFetch?: typeof fetch;
}

export type RequestHandler = ((
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>) & { maintain: () => void };

export function createApp(options: AppOptions = {}): Server {
  const handler = createRequestHandler(options);
  const server = createServer(handler);
  let timer: ReturnType<typeof setInterval> | undefined;
  server.on("listening", () => {
    handler.maintain();
    timer = setInterval(handler.maintain, 5000);
    timer.unref();
  });
  server.on("close", () => {
    if (timer) clearInterval(timer);
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 30000;
  return server;
}

export function createRequestHandler(options: AppOptions = {}): RequestHandler {
  const env = options.env ?? process.env;
  const password = env.ASA_BOLT_OWNER_PASSWORD ?? "local-change-me";
  if (
    env.NODE_ENV === "production" &&
    (password.length < 32 || /change.me|example|password/i.test(password))
  )
    throw new Error(
      "Set a unique ASA_BOLT_OWNER_PASSWORD of at least 32 characters before production startup.",
    );
  if (env.ASA_BOLT_STATIC_DIR)
    accessSync(resolve(env.ASA_BOLT_STATIC_DIR, "index.html"), constants.R_OK);
  const database =
    options.database ?? new Database(env.ASA_BOLT_DATABASE_PATH ?? "./data/asa-bolt.sqlite");
  seedDatabase(database);
  importRouteResearch(database);
  const repository = new Repository(database);
  const email = new CustomerEmail(env, database, options.emailFetch);
  const whatsapp = new CustomerEmail(env, database, options.emailFetch, "whatsapp");
  const pricing = new PricingService(database, repository);
  const calendar = new GoogleCalendar(
    database,
    repository,
    env,
    email.appOrigin,
    options.calendarFetch,
  );
  calendar.reconcileUpcoming();
  enrichSeedLocations(repository);
  const runtime: Runtime = {
    repository,
    pricing,
    bookings: new BookingApplication(
      repository,
      options.notifications ?? createNotificationGateway(env, { separateBookingEmail: true }),
      email,
      pricing,
      whatsapp,
      calendar,
    ),
    password,
    limits: new ApiLimits(database),
    trustProxy: env.ASA_BOLT_TRUST_PROXY === "1",
    production: env.NODE_ENV === "production",
    staticDirectory: env.ASA_BOLT_STATIC_DIR ?? "",
    database,
    calendar,
    sessions: new Map(),
    history: new HistoryAccess(database, repository, email),
    appOrigin: email.appOrigin,
    email,
    whatsapp,
  };
  let delivering = false,
    backingUp = false,
    lastBackup = 0;
  const backupHours = Number(env.ASA_BOLT_BACKUP_HOURS ?? 6);
  if (env.ASA_BOLT_BACKUP_DIR && (!Number.isFinite(backupHours) || backupHours < 1))
    throw new Error("Backup interval must be at least one hour.");
  const handler = ((request, response) =>
    handleRequest(request, response, runtime)) as RequestHandler;
  const runMaintenance = () => {
    const now = Date.now();
    for (const [token, expires] of runtime.sessions)
      if (expires <= now) runtime.sessions.delete(token);
    database.connection.prepare("DELETE FROM history_rate_limits WHERE resets_at <= ?").run(now);
    if (
      env.ASA_BOLT_BACKUP_DIR &&
      database.filePath !== ":memory:" &&
      !backingUp &&
      now - lastBackup >= backupHours * 3600000
    ) {
      backingUp = true;
      lastBackup = now;
      void createBackup(database.filePath, env.ASA_BOLT_BACKUP_DIR)
        .then(() => console.info("[operations] database backup verified"))
        .catch(() => {
          console.error("[operations] database backup failed; check storage and permissions");
          lastBackup = Date.now() - backupHours * 3600000 + 60000;
        })
        .finally(() => {
          backingUp = false;
        });
    }
    try {
      runtime.bookings.expirePending();
    } catch {
      console.error("[operations] request expiry could not be completed");
    }
    if (!delivering) {
      delivering = true;
      void Promise.all([email.processQueued(), whatsapp.processQueued(), calendar.processQueued()])
        .catch(() => console.error("[operations] queued email delivery failed"))
        .finally(() => {
          delivering = false;
        });
    }
  };
  handler.maintain = () => {
    try {
      runMaintenance();
    } catch {
      console.error("[operations] maintenance failed; retrying shortly");
    }
  };
  return handler;
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
  secureHeaders(response, runtime.production);
  const started = Date.now(),
    requestId = randomUUID();
  response.setHeader("X-Request-Id", requestId);
  const safePath = (request.url ?? "").split("?")[0];
  const category = safePath.startsWith("/api/owner/")
    ? "admin"
    : safePath.startsWith("/api/webhooks/")
      ? "provider"
      : safePath.startsWith("/api/")
        ? "customer"
        : "frontend";
  response.once("finish", () =>
    console.info(
      JSON.stringify({
        requestId,
        method: request.method,
        category,
        status: response.statusCode,
        durationMs: Date.now() - started,
      }),
    ),
  );
  addCorsHeaders(request, response, runtime.appOrigin);
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/"))
      return await serveFrontend(request, response, url.pathname, runtime.staticDirectory);
    runtime.limits.check(request, url.pathname, clientAddress(request, runtime.trustProxy));
    if (request.method === "GET" && url.pathname === "/api/health") {
      runtime.database.connection.prepare("SELECT 1").get();
      return sendJson(response, 200, { status: "ok" });
    }
    if (
      !["GET", "HEAD"].includes(request.method ?? "") &&
      request.headers.origin &&
      request.headers.origin !== runtime.appOrigin
    )
      throw new HttpError(403, "Open the request portal to continue.");
    runtime.bookings.expirePending();
    if (request.method === "GET" && url.pathname === "/api/calendar/google/callback") {
      let result = "connected";
      try {
        await runtime.calendar.completeAuthorization(url.searchParams, (sessionHash) =>
          [...runtime.sessions].some(
            ([token, expiresAt]) =>
              expiresAt > Date.now() &&
              createHash("sha256").update(token).digest("hex") === sessionHash,
          ),
        );
      } catch {
        result = "failed";
      }
      response.writeHead(303, { Location: `${runtime.appOrigin}/admin?calendar=${result}` });
      response.end();
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/webhooks/resend") {
      if (
        !request.headers["svix-id"] ||
        !request.headers["svix-timestamp"] ||
        !request.headers["svix-signature"]
      )
        throw new HttpError(401, "Webhook signature is required.");
      runtime.email.receiveResendWebhook(await readBody(request), request.headers);
      return sendJson(response, 200, { received: true });
    }
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
  if (parts[0] === "history") return routeHistory(request, response, runtime, parts.slice(1), body);
  if (request.method === "GET" && parts[0] === "config")
    return sendJson(response, 200, { brand: BRAND_CONFIG });
  if (request.method === "GET" && parts[0] === "locations")
    return publicLocations(response, runtime);
  if (request.method === "GET" && parts[0] === "routes")
    return sendJson(
      response,
      200,
      runtime.pricing
        .routes(true)
        .map(({ id, originId, destinationId }) => ({ id, originId, destinationId })),
    );
  if (request.method === "GET" && parts[0] === "availability")
    return availability(response, runtime, url);
  if (request.method === "GET" && parts[0] === "fares" && parts[1] === "preview") {
    return farePreview(response, runtime, url);
  }
  if (
    request.method === "POST" &&
    parts.length === 2 &&
    parts[0] === "offers" &&
    parts[1] === "preview"
  )
    return sendJson(response, 200, previewOffer(asRecord(body).amountNaira));
  if (request.method === "POST" && parts.length === 1 && parts[0] === "bookings")
    return createBooking(request, response, runtime, body);
  if (
    request.method === "POST" &&
    parts.length === 4 &&
    parts[0] === "bookings" &&
    parts[1] === "status" &&
    parts[3] === "whatsapp"
  ) {
    const booking = runtime.bookings.stopWhatsApp(
      parts[2],
      requiredText(asRecord(body).email, "Request email"),
    );
    return sendJson(response, 200, { booking });
  }
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

async function routeHistory(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Runtime,
  parts: string[],
  body: unknown,
): Promise<void> {
  const cookie =
    (request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${HISTORY_COOKIE}=`))
      ?.slice(HISTORY_COOKIE.length + 1) ?? "";
  if (request.method !== "GET" && request.headers.origin !== runtime.appOrigin) {
    throw new HttpError(403, "Open the request portal to continue.");
  }
  const ip = clientAddress(request, runtime.trustProxy);
  if (request.method === "POST" && parts.length === 1 && parts[0] === "link") {
    await runtime.history.requestLink(requiredText(asRecord(body).email, "Email"), ip);
    return sendJson(response, 202, {
      message: "Check your email for a private link. It expires in 15 minutes.",
    });
  }
  const secure = runtime.appOrigin.startsWith("https:") ? "; Secure" : "";
  const setCookie = (value: string, age: number) =>
    response.setHeader(
      "Set-Cookie",
      `${HISTORY_COOKIE}=${value}; Path=/api/history; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`,
    );
  if (request.method === "POST" && parts.length === 1 && parts[0] === "verify") {
    const session = runtime.history.exchange(
      requiredText(asRecord(body).token, "Private link"),
      ip,
    );
    if (cookie) runtime.history.logout(cookie);
    setCookie(session.token, HISTORY_SESSION_SECONDS);
    return sendJson(response, 200, { expiresAt: session.expiresAt });
  }
  if (request.method === "POST" && parts.length === 1 && parts[0] === "logout") {
    runtime.history.logout(cookie);
    setCookie("", 0);
    return sendJson(response, 200, { loggedOut: true });
  }
  if (request.method === "GET" && parts.length === 0) {
    return sendJson(response, 200, runtime.history.read(cookie));
  }
  throw new HttpError(404, "History route not found.");
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
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Runtime,
  body: unknown,
): Promise<void> {
  const input = bookingInput(body);
  if (!runtime.repository.findBookingByIdempotency(input.idempotencyKey)) {
    runtime.history.limitBooking(input.email ?? "", clientAddress(request, runtime.trustProxy));
  }
  const result = await runtime.bookings.createBooking(input);
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
    requiredText(input.email ?? input.phone, "Booking email or phone"),
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
  if (parts[0] === "calendar") {
    if (request.method === "GET" && parts.length === 1) {
      const url = new URL(request.url ?? "/", runtime.appOrigin);
      return sendJson(response, 200, runtime.calendar.overview(url.searchParams.get("q") ?? ""));
    }
    if (request.method === "POST" && parts[1] === "connect" && parts.length === 2)
      return sendJson(response, 200, {
        url: runtime.calendar.startAuthorization(ownerToken(request)),
      });
    if (request.method === "GET" && parts[1] === "calendars" && parts.length === 2)
      return sendJson(response, 200, await runtime.calendar.calendars());
    const input = asRecord(body);
    if (request.method === "PATCH" && parts[1] === "settings" && parts.length === 2) {
      await runtime.calendar.selectCalendar(
        requiredText(input.calendarId, "Calendar"),
        numberValue(input.expectedRevision, "Settings revision"),
      );
      return sendJson(response, 200, runtime.calendar.overview());
    }
    if (request.method === "POST" && parts[1] === "disconnect" && parts.length === 2) {
      await runtime.calendar.disconnect(numberValue(input.expectedRevision, "Settings revision"));
      return sendJson(response, 200, runtime.calendar.overview());
    }
    if (
      request.method === "POST" &&
      parts[1] === "updates" &&
      parts[2] &&
      parts[3] === "retry" &&
      parts.length === 4
    ) {
      runtime.calendar.retry(parts[2], numberValue(input.expectedRevision, "Update revision"));
      return sendJson(response, 200, runtime.calendar.overview());
    }
    throw new HttpError(404, "Calendar route not found.");
  }
  if (request.method === "POST" && parts[0] === "logout")
    return ownerLogout(request, response, runtime);
  if (request.method === "GET" && parts[0] === "session")
    return sendJson(response, 200, { authenticated: true });
  if (["notifications", "whatsapp-notifications"].includes(parts[0])) {
    const channel = parts[0] === "notifications" ? runtime.email : runtime.whatsapp;
    if (request.method === "GET" && parts.length === 1) {
      const url = new URL(request.url ?? "/", "http://localhost");
      return sendJson(
        response,
        200,
        channel.overview(
          url.searchParams.get("q") ?? "",
          url.searchParams.get("status") ?? "",
          Number(url.searchParams.get("page") ?? 0),
        ),
      );
    }
    if (request.method === "PATCH" && parts[1] === "settings" && parts.length === 2)
      return sendJson(response, 200, channel.store.saveSettings(body));
    if (request.method === "GET" && parts[1] === "deliveries" && parts[2] && parts.length === 3)
      return sendJson(response, 200, channel.detail(parts[2]));
    if (
      request.method === "POST" &&
      parts[1] === "deliveries" &&
      parts[2] &&
      parts[3] === "retry" &&
      parts.length === 4
    )
      return sendJson(
        response,
        200,
        await channel.retry(
          parts[2],
          numberValue(asRecord(body).expectedAttempts, "Attempt count"),
        ),
      );
    throw new HttpError(404, "Notification route not found.");
  }
  if (request.method === "GET" && parts[0] === "pricing")
    return sendJson(response, 200, runtime.pricing.overview());
  if (
    request.method === "PATCH" &&
    parts[0] === "pricing" &&
    parts[1] === "areas" &&
    parts.length === 3
  ) {
    const input = asRecord(body);
    if (!("ratePerKm" in input))
      throw new HttpError(400, "Supply an area rate, or null to use the default rate.");
    return sendJson(response, 200, runtime.pricing.saveArea(parts[2], input.name, input.ratePerKm));
  }
  if (request.method === "PATCH" && parts[0] === "pricing" && parts[1] === "settings") {
    const input = asRecord(body);
    if (!("defaultRatePerKm" in input))
      throw new HttpError(400, "Supply a default rate, or null to clear it.");
    return sendJson(response, 200, runtime.pricing.saveSettings(input.defaultRatePerKm));
  }
  if (request.method === "POST" && parts[0] === "pricing" && parts[1] === "preview") {
    const input = asRecord(body);
    if (input.mode !== undefined && !["saved", "fixed", "distance"].includes(String(input.mode)))
      throw new HttpError(400, "Choose a valid pricing method.");
    const draft: PricingDraft = {
      originId: optionalText(input.originId),
      destinationId: optionalText(input.destinationId),
      date: dateValue(optionalText(input.date)),
      mode: input.mode as PricingDraft["mode"],
    };
    for (const key of [
      "distanceKm",
      "defaultRatePerKm",
      "fixedAmountNaira",
      "pricingAreaId",
      "areaRatePerKm",
    ] as const)
      if (key in input) draft[key] = input[key];
    return sendJson(response, 200, runtime.pricing.preview(draft));
  }
  if (request.method === "PATCH" && parts[0] === "routes") {
    const input = asRecord(body);
    return sendJson(
      response,
      200,
      runtime.pricing.saveRoute(parts[1] ?? "new", {
        originId: requiredText(input.originId, "Pickup"),
        destinationId: requiredText(input.destinationId, "Destination"),
        distanceKm: input.distanceKm,
        published: input.published === true,
        distanceNote: optionalText(input.distanceNote),
        ...("pricingAreaId" in input ? { pricingAreaId: input.pricingAreaId } : {}),
      }),
    );
  }
  if (request.method === "GET" && parts[0] === "bookings" && parts[2] === "conflicts")
    return sendJson(response, 200, runtime.bookings.conflictReview(parts[1] ?? ""));
  if (request.method === "POST" && parts[0] === "bookings" && parts[2] === "schedule-preview") {
    const input = asRecord(body);
    const pickupAt = parsePickupTime(requiredText(input.pickupAt, "Pickup time"));
    return sendJson(response, 200, runtime.bookings.conflictReview(parts[1] ?? "", pickupAt));
  }
  if (request.method === "PATCH" && parts[0] === "bookings" && parts[2] === "schedule") {
    const input = asRecord(body);
    if (input.reservedMinutes != null)
      throw new HttpError(400, "Duration estimates are deferred. Change the pickup time only.");
    const revision = numberValue(input.expectedRevision, "Schedule revision");
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw new HttpError(400, "Refresh the schedule before editing it.");
    return sendJson(response, 200, {
      booking: await runtime.bookings.reschedule(
        parts[1] ?? "",
        requiredText(input.pickupAt, "Pickup time"),
        revision,
        requiredText(input.reason, "Schedule-change reason"),
        optionalText(input.conflictToken),
      ),
    });
  }
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
  if (
    !timingSafeEqual(
      createHash("sha256").update(password).digest(),
      createHash("sha256").update(runtime.password).digest(),
    )
  )
    throw new HttpError(401, "The owner password is incorrect.");
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
    optionalText(input.conflictToken),
  );
  sendJson(response, 200, { booking });
}

function saveSchedule(response: ServerResponse, runtime: Runtime, id: string, body: unknown): void {
  const input = asRecord(body);
  const dayOfWeek = numberValue(input.dayOfWeek, "Day");
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)
    throw new HttpError(400, "Day must be between Sunday and Saturday.");
  const schedule: OperatingSchedule = {
    id: !id || id === "new" ? randomUUID() : id,
    dayOfWeek,
    dayLabel: "",
    startTime: timeValue(input.startTime, "Start time"),
    endTime: timeValue(input.endTime, "End time"),
    active: input.active !== false,
  };
  if (schedule.startTime >= schedule.endTime)
    throw new HttpError(400, "End time must be after start time.");
  const schedules = runtime.repository.listSchedules();
  if (id !== "new" && !schedules.some((item) => item.id === id))
    throw new HttpError(404, "Pickup window no longer exists. Refresh the schedule.");
  if (
    schedule.active &&
    schedules.some(
      (item) =>
        item.id !== schedule.id &&
        item.active &&
        item.dayOfWeek === schedule.dayOfWeek &&
        item.startTime < schedule.endTime &&
        item.endTime > schedule.startTime,
    )
  )
    throw new HttpError(
      409,
      "This pickup window overlaps another active window on that day. Edit the existing window or use separate times.",
    );
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
    id: !id || id === "new" ? randomUUID() : id,
    date: dateValue(optionalText(input.date)),
    note: requiredText(input.note, "Note"),
    closed: input.closed !== false,
  };
  if (id !== "new") {
    const existing = runtime.repository.listExceptions().find((item) => item.id === id);
    if (!existing || existing.date !== exception.date)
      throw new HttpError(409, "Refresh the date closure before editing it.");
  }
  runtime.repository.saveException(exception);
  const saved = runtime.repository.listExceptions().find((item) => item.date === exception.date);
  sendJson(response, 200, saved ?? exception);
}

function saveLocation(response: ServerResponse, runtime: Runtime, id: string, body: unknown): void {
  const input = asRecord(body);
  const location: ServiceLocation = {
    id: !id || id === "new" ? randomUUID() : id,
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
    id: !id || id === "new" ? randomUUID() : id,
    originId: requiredText(input.originId, "Origin"),
    destinationId: requiredText(input.destinationId, "Destination"),
    amountKobo:
      input.amountNaira !== undefined
        ? nairaToKobo(requiredText(input.amountNaira, "Fixed price"))
        : numberValue(input.amountKobo, "Fare"),
    currency: BRAND_CONFIG.currency,
    effectiveFrom: dateValue(optionalText(input.effectiveFrom)),
    active: input.active !== false,
  };
  if (
    fare.originId === fare.destinationId ||
    !Number.isSafeInteger(fare.amountKobo) ||
    fare.amountKobo <= 0
  )
    throw new HttpError(400, "Enter a valid route and fare.");
  if (
    !runtime.pricing
      .routes()
      .some(
        (route) => route.originId === fare.originId && route.destinationId === fare.destinationId,
      )
  )
    throw new HttpError(400, "Save this route before setting its fixed price.");
  const existing = runtime.repository.listFares().find((rule) => rule.id === fare.id);
  if (
    existing &&
    (existing.originId !== fare.originId || existing.destinationId !== fare.destinationId)
  )
    throw new HttpError(400, "A fixed price cannot be moved to a different route.");
  fare.roundedAmountKobo = roundNairaUpTo50(koboToNaira(fare.amountKobo));
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
  const priceChoice = input.priceChoice ?? "accept";
  if (priceChoice !== "accept" && priceChoice !== "negotiate")
    throw new HttpError(400, "Choose Accept price or Negotiate price.");
  for (const field of ["proposedAmountNaira", "negotiationNote"]) {
    if (input[field] !== undefined && typeof input[field] !== "string")
      throw new HttpError(400, "Send one offer amount and an optional text note.");
  }
  return {
    priceChoice,
    proposedAmountNaira: input.proposedAmountNaira as string | undefined,
    proposedAmountKobo:
      input.proposedAmountKobo === undefined
        ? undefined
        : numberValue(input.proposedAmountKobo, "Rounded offer"),
    negotiationNote: input.negotiationNote as string | undefined,
    idempotencyKey: requiredText(input.idempotencyKey, "Booking key"),
    customerName: optionalText(input.customerName),
    phone: optionalText(input.phone),
    whatsappUpdates: input.whatsappUpdates === true,
    whatsappNumber: optionalText(input.whatsappNumber),
    email: requiredText(input.email, "Email"),
    quotedAmountKobo: numberValue(input.quotedAmountKobo, "Quoted fare"),
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

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "The request is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const body = await readBody(request);
  if (!body) return {};
  try {
    return JSON.parse(body) as unknown;
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
  const parsed = new Date(`${date}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
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

function addCorsHeaders(request: IncomingMessage, response: ServerResponse, origin: string): void {
  response.setHeader("Vary", "Origin");
  if (request.headers.origin === origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
  }
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(status === 204 ? undefined : JSON.stringify(data));
}

function handleError(response: ServerResponse, error: unknown): void {
  if (error instanceof HttpError)
    return sendJson(response, error.status, { error: error.message, ...error.details });
  console.error("[api] request failed", error instanceof Error ? error.name : "UnknownError");
  sendJson(response, 400, {
    error: "The request could not be completed. Check the details and try again.",
  });
}
