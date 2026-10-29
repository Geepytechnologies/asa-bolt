import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestHandler } from "./http.js";
import { bookingFixture, clockNow, silentNotifications } from "../../tests/booking-fixture.js";
import type { CalendarOverview } from "../../shared/calendar.js";
import type {
  Booking,
  BookingAccessResponse,
  FarePreview,
  PricingArea,
  PricingOverview,
  RequestHistory,
} from "../../shared/contracts.js";
const fixtures: ReturnType<typeof bookingFixture>[] = [];
const servers: Server[] = [];
async function responseJson<T>(response: Response | Promise<Response>): Promise<T> {
  return (await response).json() as Promise<T>;
}
async function setup(options: { calendarFetch?: typeof fetch } = {}) {
  const f = bookingFixture();
  fixtures.push(f);
  const handler = createRequestHandler({
    database: f.database,
    env: f.env,
    notifications: silentNotifications,
    calendarFetch: options.calendarFetch,
  });
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      redirect: "manual",
      headers: { "content-type": "application/json", Origin: "http://localhost:5173", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const login = async () => {
    const r = await call("/owner/login", "POST", { password: "test-owner" });
    const session = await responseJson<{ token: string; expiresAt: number }>(r);
    return { Authorization: `Bearer ${session.token}` };
  };
  return { ...f, call, login };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clockNow);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  fixtures.splice(0).forEach((f) => f.database.close());
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("email request API", () => {
  it("leaves blank Google configuration honest and saves accepted rides awaiting calendar setup", async () => {
    const send = vi.fn<typeof fetch>();
    const f = await setup({ calendarFetch: send });
    expect((await f.call("/owner/calendar")).status).toBe(401);
    expect((await f.call("/owner/calendar/connect", "POST", {})).status).toBe(401);
    const auth = await f.login();
    const overview = await responseJson<CalendarOverview>(
      f.call("/owner/calendar", "GET", undefined, auth),
    );
    expect(overview).toMatchObject({ configured: false, connected: false, ready: false });
    expect(overview.missing).toHaveLength(3);
    expect((await f.call("/owner/calendar/connect", "POST", {}, auth)).status).toBe(409);
    const created = await responseJson<BookingAccessResponse>(
      f.call("/bookings", "POST", f.input()),
    );
    expect(
      (
        await f.call(
          `/owner/bookings/${created.booking.id}/status`,
          "PATCH",
          { status: "confirmed" },
          auth,
        )
      ).status,
    ).toBe(200);
    const pending = await responseJson<CalendarOverview>(
      f.call("/owner/calendar", "GET", undefined, auth),
    );
    expect(pending.updates).toMatchObject([
      { bookingId: created.booking.id, status: "awaiting_setup", attempts: 0 },
    ]);
    expect(send).not.toHaveBeenCalled();
  });
  it("binds Google callbacks to a live admin session and exposes only safe connection metadata", async () => {
    const send = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/token")
        return Response.json({
          access_token: "fixture-access",
          refresh_token: "fixture-refresh",
          expires_in: 3600,
        });
      if (url.pathname.endsWith("/calendarList"))
        return Response.json({
          items: [
            { id: "owner@example.test", summary: "Dispatch", primary: true, accessRole: "owner" },
          ],
        });
      if (url.pathname === "/revoke") return new Response(null, { status: 200 });
      throw new Error("Unexpected Google fixture request");
    });
    const f = await setup({ calendarFetch: send });
    Object.assign(f.env, {
      GOOGLE_CALENDAR_CLIENT_ID: "fixture.apps.googleusercontent.com",
      GOOGLE_CALENDAR_CLIENT_SECRET: "fixture-secret",
      ASA_BOLT_CALENDAR_TOKEN_KEY: "ab".repeat(32),
    });
    const expiredAuth = await f.login();
    const expired = await responseJson<{ url: string }>(
      f.call("/owner/calendar/connect", "POST", {}, expiredAuth),
    );
    await f.call("/owner/logout", "POST", {}, expiredAuth);
    const callback = async (url: string) =>
      f.call(
        `/calendar/google/callback?state=${new URL(url).searchParams.get("state")}&code=fixture-code`,
      );
    expect((await callback(expired.url)).headers.get("location")).toBe(
      "http://localhost:5173/admin?calendar=failed",
    );
    expect(send).not.toHaveBeenCalled();
    const auth = await f.login();
    const start = await responseJson<{ url: string }>(
      f.call("/owner/calendar/connect", "POST", {}, auth),
    );
    expect(new URL(start.url).origin).toBe("https://accounts.google.com");
    const response = await callback(start.url);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:5173/admin?calendar=connected");
    expect((await callback(start.url)).headers.get("location")).toContain("calendar=failed");
    let overview = await responseJson<CalendarOverview>(
      f.call("/owner/calendar", "GET", undefined, auth),
    );
    expect(JSON.stringify(overview)).not.toMatch(/fixture-secret|fixture-access|fixture-refresh/);
    expect(overview).toMatchObject({ connected: true, ready: false });
    expect(
      (
        await f.call(
          "/owner/calendar/settings",
          "PATCH",
          { calendarId: "owner@example.test", expectedRevision: overview.revision },
          auth,
        )
      ).status,
    ).toBe(200);
    overview = await responseJson<CalendarOverview>(
      f.call("/owner/calendar", "GET", undefined, auth),
    );
    expect(overview).toMatchObject({ ready: true, calendarName: "Dispatch" });
    expect(
      (
        await f.call(
          "/owner/calendar/disconnect",
          "POST",
          { expectedRevision: overview.revision },
          auth,
        )
      ).status,
    ).toBe(200);
  });
  it("protects area writes and applies assigned area, default fallback and fixed precedence to customer quotes", async () => {
    const f = await setup();
    const path = "/owner/pricing/areas/new";
    expect((await f.call(path, "PATCH", { name: "Area A", ratePerKm: "150" })).status).toBe(401);
    const auth = await f.login();
    const response = await f.call(path, "PATCH", { name: "Area A", ratePerKm: "150" }, auth);
    expect(response.status).toBe(200);
    const area = await responseJson<PricingArea>(response);
    const routeBody = { ...f.route, distanceKm: "8.12", published: true, pricingAreaId: area.id };
    expect((await f.call(`/owner/routes/${f.route.id}`, "PATCH", routeBody, auth)).status).toBe(
      200,
    );
    const query = new URLSearchParams({
      originId: f.route.originId,
      destinationId: f.route.destinationId,
      date: "2030-01-07",
    });
    const quote = () => responseJson<FarePreview>(f.call(`/fares/preview?${query}`));
    expect(await quote()).toMatchObject({ amountKobo: 125000, pricing: { rateSource: "area" } });
    expect((await f.call(path, "PATCH", { name: "AREA A", ratePerKm: "100" }, auth)).status).toBe(
      409,
    );
    expect(
      (await f.call(`/owner/pricing/areas/${area.id}`, "PATCH", { name: area.name }, auth)).status,
    ).toBe(400);
    expect(
      (
        await f.call(
          `/owner/routes/${f.route.id}`,
          "PATCH",
          { ...routeBody, pricingAreaId: "missing" },
          auth,
        )
      ).status,
    ).toBe(400);
    await f.call(
      `/owner/pricing/areas/${area.id}`,
      "PATCH",
      { name: area.name, ratePerKm: null },
      auth,
    );
    expect(await quote()).toMatchObject({
      amountKobo: 85000,
      pricing: { pricingAreaId: area.id, rateSource: "default" },
    });
    await f.call(
      `/owner/pricing/areas/${area.id}`,
      "PATCH",
      { name: area.name, ratePerKm: "200" },
      auth,
    );
    await f.call(
      "/owner/fare-rules/new",
      "PATCH",
      {
        originId: f.route.originId,
        destinationId: f.route.destinationId,
        amountNaira: "999",
        effectiveFrom: "2030-01-07",
        active: true,
      },
      auth,
    );
    expect(await quote()).toMatchObject({ amountKobo: 100000, pricing: { rateSource: "fixed" } });
    const overview = await responseJson<PricingOverview>(
      f.call("/owner/pricing", "GET", undefined, auth),
    );
    expect(overview.areas).toMatchObject([{ id: area.id, ratePerKm: "200" }]);
    const draft = await f.call(
      "/owner/pricing/preview",
      "POST",
      {
        originId: f.route.originId,
        destinationId: f.route.destinationId,
        date: "2030-01-07",
        mode: "distance",
        pricingAreaId: null,
      },
      auth,
    );
    expect((await responseJson<FarePreview>(draft)).amountKobo).toBe(85000);
  });
  it("returns one pending request per key even when email is unconfigured", async () => {
    const f = await setup(),
      input = f.input();
    const first = await f.call("/bookings", "POST", input),
      second = await f.call("/bookings", "POST", input);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const a = await responseJson<BookingAccessResponse>(first),
      b = await responseJson<BookingAccessResponse>(second);
    expect(a.booking).toMatchObject({ status: "requested", customerEmailStatus: "failed" });
    expect(b.booking.id).toBe(a.booking.id);
    expect(f.repository.listBookings()).toHaveLength(1);
    expect(f.repository.listEvents(a.booking.id)).toHaveLength(1);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(first.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("protects every notification channel and permits a rounded admin decision", async () => {
    const f = await setup();
    const created = await responseJson<BookingAccessResponse>(
      f.call(
        "/bookings",
        "POST",
        f.input({
          priceChoice: "negotiate",
          proposedAmountNaira: "812",
          proposedAmountKobo: 85000,
        }),
      ),
    );
    expect((await f.call("/owner/notifications")).status).toBe(401);
    expect((await f.call("/owner/whatsapp-notifications")).status).toBe(401);
    const auth = await f.login();
    const accepted = await f.call(
      `/owner/bookings/${created.booking.id}/status`,
      "PATCH",
      { status: "confirmed" },
      auth,
    );
    expect(accepted.status).toBe(200);
    expect((await responseJson<{ booking: Booking }>(accepted)).booking).toMatchObject({
      status: "confirmed",
      agreedAmountKobo: 85000,
    });
    expect((await f.call("/owner/notifications/settings", "PATCH", {}, auth)).status).toBe(400);
    await f.call("/owner/logout", "POST", {}, auth);
    expect((await f.call("/owner/notifications", "GET", undefined, auth)).status).toBe(401);
  });
  it("rejects unanswered requests before serving their private details at cutoff", async () => {
    const f = await setup(),
      created = await responseJson<BookingAccessResponse>(f.call("/bookings", "POST", f.input()));
    vi.setSystemTime(created.booking.pickupAt);
    const response = await f.call(`/bookings/status/${created.booking.accessToken}`);
    const detail = await responseJson<BookingAccessResponse>(response);
    expect(detail.booking).toMatchObject({
      status: "rejected",
      rejectionReason: "Not accepted before pickup time.",
    });
    await f.call(`/bookings/status/${created.booking.accessToken}`);
    expect(f.repository.listEvents(created.booking.id)).toHaveLength(2);
    const auth = await f.login();
    expect(
      (
        await f.call(
          `/owner/bookings/${created.booking.id}/status`,
          "PATCH",
          { status: "confirmed" },
          auth,
        )
      ).status,
    ).toBe(409);
  });
  it("does not expose history by email alone and sets a constrained one-use session cookie", async () => {
    const f = await setup();
    expect((await f.call("/history?email=rider@example.test")).status).toBe(401);
    const token = "a".repeat(64);
    f.database.connection
      .prepare("INSERT INTO history_links VALUES (?, ?, ?)")
      .run(
        createHash("sha256").update(token).digest("hex"),
        "rider@example.test",
        Date.now() + 60000,
      );
    const verified = await f.call("/history/verify", "POST", { token });
    expect(verified.status).toBe(200);
    const setCookie = verified.headers.get("set-cookie")!;
    expect(setCookie).toContain("HttpOnly; SameSite=Strict");
    expect(setCookie).toContain("Path=/api/history");
    const cookie = setCookie.split(";")[0];
    const history = await f.call("/history", "GET", undefined, { Cookie: cookie });
    expect(history.status).toBe(200);
    expect((await responseJson<RequestHistory>(history)).email).toBe("rider@example.test");
    expect((await f.call("/history/verify", "POST", { token })).status).toBe(401);
    expect(
      (
        await f.call(
          "/history/logout",
          "POST",
          {},
          { Cookie: cookie, Origin: "https://other.example.test" },
        )
      ).status,
    ).toBe(403);
    await f.call("/history/logout", "POST", {}, { Cookie: cookie });
    expect((await f.call("/history", "GET", undefined, { Cookie: cookie })).status).toBe(401);
  });
  it("enforces durable login limits and ignores untrusted forwarded addresses", async () => {
    const f = await setup();
    f.database.connection
      .prepare("INSERT INTO history_rate_limits VALUES (?,9,?)")
      .run(createHash("sha256").update("login:127.0.0.1").digest("hex"), Date.now() + 900000);
    expect(
      (
        await f.call(
          "/owner/login",
          "POST",
          { password: "wrong" },
          { "X-Forwarded-For": "203.0.113.1" },
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await f.call(
          "/owner/login",
          "POST",
          { password: "wrong" },
          { "X-Forwarded-For": "203.0.113.2" },
        )
      ).status,
    ).toBe(429);
  });
  it("rejects foreign-origin mutations and unsigned provider events", async () => {
    const f = await setup();
    expect(
      (await f.call("/bookings", "POST", f.input(), { Origin: "https://other.example.test" }))
        .status,
    ).toBe(403);
    expect((await f.call("/webhooks/resend", "POST", {})).status).toBe(401);
    expect(f.repository.listBookings()).toHaveLength(0);
  });
  it("does not put private tokens, contacts, or request paths in request logs", async () => {
    const f = await setup();
    const saved = await responseJson<BookingAccessResponse>(f.call("/bookings", "POST", f.input()));
    await f.call(`/bookings/status/${saved.booking.accessToken}`);
    const logs = vi.mocked(console.info).mock.calls.flat().join(" ");
    expect(logs).toContain('"category":"customer"');
    expect(logs).not.toContain(saved.booking.accessToken);
    expect(logs).not.toContain("rider@example.test");
    expect(logs).not.toContain("/bookings/status/");
  });
});
