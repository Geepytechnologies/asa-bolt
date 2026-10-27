import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookingFixture, clockNow, silentNotifications } from "../tests/booking-fixture.js";
import { BookingApplication } from "./application.js";
import { GoogleCalendar } from "./calendar.js";

type Event = Record<string, unknown>;
const fixtures: ReturnType<typeof bookingFixture>[] = [];
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function setup(configured = true) {
  const f = bookingFixture(
    configured
      ? {
          GOOGLE_CALENDAR_CLIENT_ID: "fixture.apps.googleusercontent.com",
          GOOGLE_CALENDAR_CLIENT_SECRET: "fixture-client-secret",
          ASA_BOLT_CALENDAR_TOKEN_KEY: "ab".repeat(32),
        }
      : {},
  );
  fixtures.push(f);
  const events = new Map<string, Event>();
  const state = {
    failPatch: false,
    loseCreate: false,
    primary: "owner@example.test",
    scope:
      "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    shortToken: false,
    blockCreate: undefined as (() => Promise<void>) | undefined,
    creates: 0,
  };
  const send = vi.fn<typeof fetch>(async (input, options) => {
    const url = new URL(String(input));
    expect(["oauth2.googleapis.com", "www.googleapis.com"]).toContain(url.hostname);
    const method = options?.method ?? "GET",
      body = String(options?.body ?? "");
    if (url.pathname === "/token")
      return Response.json({
        access_token: "fixture-access-token",
        refresh_token: "fixture-refresh-token",
        expires_in:
          state.shortToken && new URLSearchParams(body).get("grant_type") === "authorization_code"
            ? 1
            : 3600,
        scope: state.scope,
      });
    if (url.pathname === "/revoke") return new Response(null, { status: 200 });
    if (url.pathname.endsWith("/calendarList"))
      return Response.json({
        items: [
          { id: state.primary, summary: "Primary", accessRole: "owner", primary: true },
          { id: "dispatch@group.calendar.google.com", summary: "Dispatch", accessRole: "writer" },
          { id: "read-only", summary: "Read only", accessRole: "reader" },
        ],
      });
    const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
    if (method === "GET")
      return events.has(id) ? Response.json(events.get(id)) : Response.json({}, { status: 404 });
    if (method === "POST") {
      const event = JSON.parse(body) as Event;
      expect(events.has(String(event.id))).toBe(false);
      state.creates++;
      events.set(String(event.id), { ...event, etag: "fixture-etag" });
      if (state.blockCreate) await state.blockCreate();
      if (state.loseCreate) {
        state.loseCreate = false;
        throw new Error("Provider accepted but response lost");
      }
      return Response.json(events.get(String(event.id)));
    }
    if (method === "PATCH") {
      if (state.failPatch) return Response.json({}, { status: 500 });
      const event = { ...events.get(id), ...JSON.parse(body) } as Event;
      events.set(id, event);
      return Response.json(event);
    }
    throw new Error("Unexpected fixture request");
  });
  const calendar = new GoogleCalendar(
    f.database,
    f.repository,
    f.env,
    "http://localhost:5173",
    send,
  );
  const application = new BookingApplication(
    f.repository,
    silentNotifications,
    f.email,
    f.pricing,
    f.whatsapp,
    calendar,
  );
  const session = "fixture-admin-session";
  const start = () => new URL(calendar.startAuthorization(session));
  const complete = (url: URL, active = true) =>
    calendar.completeAuthorization(
      new URLSearchParams({ state: url.searchParams.get("state")!, code: "fixture-code" }),
      (value) => active && value === digest(session),
    );
  const connect = async () => {
    await complete(start());
    await calendar.selectCalendar(
      "dispatch@group.calendar.google.com",
      calendar.overview().revision,
    );
  };
  const accepted = async () => {
    const saved = await application.createBooking(f.input());
    await application.changeStatus(saved.booking.id, "confirmed", "", "owner");
    return saved.booking;
  };
  const update = () => calendar.overview().updates[0];
  return {
    ...f,
    application,
    calendar,
    state,
    events,
    send,
    start,
    complete,
    connect,
    accepted,
    update,
  };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clockNow);
});
afterEach(() => {
  fixtures.splice(0).forEach((f) => f.database.close());
  vi.useRealTimers();
});

describe("Google Calendar linking", () => {
  it("keeps placeholders disconnected and acceptance saved without making provider calls", async () => {
    const f = setup(false),
      saved = await f.accepted();
    expect(f.calendar.overview()).toMatchObject({
      configured: false,
      connected: false,
      ready: false,
    });
    expect(f.calendar.overview().missing).toHaveLength(3);
    expect(f.update()).toMatchObject({
      bookingId: saved.id,
      status: "awaiting_setup",
      attempts: 0,
    });
    await f.calendar.processQueued();
    expect(f.send).not.toHaveBeenCalled();
    expect(() => f.start()).toThrow("not configured");
    expect(f.repository.findBookingById(saved.id)?.status).toBe("confirmed");
  });

  it("protects OAuth with expiring one-use state, PKCE and an active admin session; encrypts offline credentials", async () => {
    const f = setup(),
      url = f.start();
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    await expect(f.complete(url, false)).rejects.toMatchObject({ status: 401 });
    expect(f.send).not.toHaveBeenCalled();
    const expired = f.start();
    vi.setSystemTime(Date.now() + 600001);
    await expect(f.complete(expired)).rejects.toMatchObject({ status: 401 });
    const fresh = f.start();
    await f.complete(fresh);
    const form = new URLSearchParams(String(f.send.mock.calls[0][1]?.body));
    expect(createHash("sha256").update(form.get("code_verifier")!).digest("base64url")).toBe(
      fresh.searchParams.get("code_challenge"),
    );
    expect(form.get("redirect_uri")).toBe("http://localhost:5173/api/calendar/google/callback");
    await expect(f.complete(fresh)).rejects.toMatchObject({ status: 401 });
    const credentials = String(
      f.database.connection.prepare("SELECT credentials FROM calendar_connection").get()
        ?.credentials,
    );
    expect(credentials).not.toContain("fixture-refresh-token");
    expect(credentials).not.toContain("fixture-access-token");
    expect(JSON.stringify(f.calendar.overview())).not.toContain("fixture-client-secret");
    expect(f.calendar.overview()).toMatchObject({ connected: true, ready: false });
  });

  it("rejects denied or incomplete permissions without saving a connection", async () => {
    const f = setup(),
      url = f.start();
    await expect(
      f.calendar.completeAuthorization(
        new URLSearchParams({ state: url.searchParams.get("state")!, error: "access_denied" }),
        () => true,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.send).not.toHaveBeenCalled();
    f.state.scope = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
    await expect(f.complete(f.start())).rejects.toMatchObject({ status: 403 });
    expect(f.calendar.overview().connected).toBe(false);
  });

  it("filters read-only calendars, refreshes tokens and creates one private pickup marker", async () => {
    const f = setup();
    f.state.shortToken = true;
    await f.connect();
    expect((await f.calendar.calendars()).map((c) => c.id)).not.toContain("read-only");
    expect(
      f.send.mock.calls.some(([, options]) =>
        String(options?.body).includes("grant_type=refresh_token"),
      ),
    ).toBe(true);
    const booking = await f.accepted();
    await f.calendar.processQueued();
    expect(f.update()).toMatchObject({ status: "synced", attempts: 1 });
    expect(f.state.creates).toBe(1);
    const event = f.events.get(f.update().eventId)!;
    expect(event).toMatchObject({
      endTimeUnspecified: true,
      transparency: "transparent",
      visibility: "private",
      start: { dateTime: booking.pickupAt, timeZone: "Africa/Lagos" },
      reminders: { useDefault: false },
    });
    expect(event.attendees).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain(booking.accessToken);
    expect(event.description).toContain("₦850");
    expect(f.update().eventId).toMatch(/^[a-v0-9]{5,1024}$/);
  });

  it("updates and cancels the original event, while a failed patch never rolls back the ride", async () => {
    const f = setup();
    await f.connect();
    const booking = await f.accepted();
    await f.calendar.processQueued();
    const eventId = f.update().eventId;
    f.state.failPatch = true;
    await f.application.reschedule(booking.id, "2030-01-08T11:00:00+01:00", 0, "Later pickup");
    await f.calendar.processQueued();
    expect(f.update().status).toBe("failed");
    expect(f.repository.findBookingById(booking.id)).toMatchObject({
      status: "confirmed",
      pickupAt: "2030-01-08T10:00:00.000Z",
    });
    expect(() => f.calendar.retry(booking.id, 1)).toThrow("changed");
    f.state.failPatch = false;
    f.calendar.retry(booking.id, f.update().revision);
    await f.calendar.processQueued();
    expect(f.update()).toMatchObject({ status: "synced", eventId, attempts: 3 });
    expect(f.events.get(eventId)).toMatchObject({
      start: { dateTime: "2030-01-08T10:00:00.000Z" },
    });
    await f.application.cancelPublicBooking(
      booking.accessToken,
      "rider@example.test",
      "Plans changed",
    );
    await f.calendar.processQueued();
    expect(f.update()).toMatchObject({ status: "cancelled", eventId });
    expect(f.events.get(eventId)?.status).toBe("cancelled");
    expect(f.state.creates).toBe(1);
  });

  it("reconciles a lost creation response with the same event ID and no duplicate insert", async () => {
    const f = setup();
    await f.connect();
    const booking = await f.accepted();
    f.state.loseCreate = true;
    await f.calendar.processQueued();
    expect(f.update().status).toBe("failed");
    expect(f.events.size).toBe(1);
    f.calendar.retry(booking.id, f.update().revision);
    await f.calendar.processQueued();
    expect(f.update().status).toBe("synced");
    expect(f.state.creates).toBe(1);
    expect(f.events.size).toBe(1);
  });

  it("uses the accepted negotiated fare in the event rather than the original quote", async () => {
    const f = setup();
    await f.connect();
    const saved = await f.application.createBooking(
      f.input({ priceChoice: "negotiate", proposedAmountNaira: "999", proposedAmountKobo: 100000 }),
    );
    await f.application.changeStatus(saved.booking.id, "confirmed", "", "owner");
    await f.calendar.processQueued();
    expect(f.events.get(f.update().eventId)?.description).toContain("Agreed fare: ₦1,000");
    expect(f.events.get(f.update().eventId)?.description).not.toContain("₦850");
  });

  it("reports revoked access without exposing Google error bodies or undoing acceptance", async () => {
    const f = setup();
    await f.connect();
    const saved = await f.accepted();
    const checked = f.calendar.overview().lastCheckedAt;
    vi.setSystemTime(Date.now() + 5000);
    f.send.mockImplementationOnce(async () =>
      Response.json({ error: "fixture-access-token private upstream detail" }, { status: 401 }),
    );
    await f.calendar.processQueued();
    expect(f.update().status).toBe("failed");
    expect(f.calendar.overview().lastError).toContain("revoked");
    expect(JSON.stringify(f.calendar.overview())).not.toContain("fixture-access-token");
    expect(f.calendar.overview().lastCheckedAt).toBe(checked);
    expect(f.repository.findBookingById(saved.id)?.status).toBe("confirmed");
  });

  it("lets the newest reschedule win when a create response is still in flight", async () => {
    const f = setup();
    await f.connect();
    const booking = await f.accepted();
    let release!: () => void,
      started = false;
    f.state.blockCreate = () => {
      started = true;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const sending = f.calendar.processQueued();
    await vi.waitFor(() => expect(started).toBe(true));
    await f.application.reschedule(
      booking.id,
      "2030-01-08T11:00:00+01:00",
      0,
      "Changed during send",
    );
    release();
    await sending;
    expect(f.update().status).toBe("queued");
    f.state.blockCreate = undefined;
    await f.calendar.processQueued();
    expect(f.update().status).toBe("synced");
    expect(f.state.creates).toBe(1);
    expect(f.events.get(f.update().eventId)).toMatchObject({
      start: { dateTime: "2030-01-08T10:00:00.000Z" },
    });
  });

  it("does not create events for rejected requests, pending cancellations or a ride cancelled before first sync", async () => {
    const f = setup();
    await f.connect();
    const rejected = await f.application.createBooking(f.input());
    await f.application.changeStatus(rejected.booking.id, "rejected", "Not available", "owner");
    const pending = await f.application.createBooking(f.input());
    await f.application.cancelPublicBooking(
      pending.booking.accessToken,
      "rider@example.test",
      "Plans changed",
    );
    expect(f.calendar.overview().updates).toHaveLength(0);
    const accepted = await f.accepted();
    await f.application.cancelPublicBooking(
      accepted.accessToken,
      "rider@example.test",
      "Changed before syncing",
    );
    await f.calendar.processQueued();
    expect(f.update().status).toBe("cancelled");
    expect(f.state.creates).toBe(0);
  });

  it("recovers interrupted updates, survives a restart, and cannot read credentials with a different key", async () => {
    const f = setup();
    await f.connect();
    const booking = await f.accepted();
    await f.calendar.processQueued();
    f.database.connection
      .prepare("UPDATE calendar_updates SET status='syncing',lease_until=?")
      .run(Date.now() - 1);
    const restarted = new GoogleCalendar(
      f.database,
      f.repository,
      f.env,
      "http://localhost:5173",
      f.send,
    );
    restarted.reconcileUpcoming();
    expect(restarted.overview().updates).toHaveLength(1);
    expect(restarted.overview().updates[0].status).toBe("failed");
    restarted.retry(booking.id, f.update().revision);
    await restarted.processQueued();
    expect(f.state.creates).toBe(1);
    const calls = f.send.mock.calls.length;
    f.env.ASA_BOLT_CALENDAR_TOKEN_KEY = "cd".repeat(32);
    expect(f.calendar.overview()).toMatchObject({ connected: false, ready: false });
    await f.calendar.processQueued();
    expect(f.send.mock.calls.length).toBe(calls);
  });

  it("locks account/calendar after syncing and never overwrites an unrelated event", async () => {
    const f = setup();
    await f.connect();
    const booking = await f.accepted();
    await f.calendar.processQueued();
    await expect(
      f.calendar.selectCalendar("owner@example.test", f.calendar.overview().revision),
    ).rejects.toThrow("another calendar");
    f.state.primary = "another@example.test";
    await expect(f.complete(f.start())).rejects.toThrow("another Google account");
    const eventId = f.update().eventId;
    f.events.set(eventId, {
      id: eventId,
      status: "confirmed",
      summary: "Unrelated",
      extendedProperties: { private: { asaBookingId: "other-booking" } },
    });
    await f.application.reschedule(booking.id, "2030-01-08T11:00:00+01:00", 0, "Try changed event");
    const calls = f.send.mock.calls.length;
    await f.calendar.processQueued();
    expect(f.update().lastError).toContain("does not belong");
    expect(f.send.mock.calls.slice(calls).some(([, options]) => options?.method === "PATCH")).toBe(
      false,
    );
    expect(f.events.get(eventId)?.summary).toBe("Unrelated");
  });

  it("disconnects without deleting events and keeps later changes waiting for reconnection", async () => {
    const f = setup();
    await f.connect();
    const booking = await f.accepted();
    await f.calendar.processQueued();
    await f.calendar.disconnect(f.calendar.overview().revision);
    expect(f.calendar.overview()).toMatchObject({ connected: false, ready: false });
    expect(
      f.database.connection.prepare("SELECT credentials FROM calendar_connection").get()
        ?.credentials,
    ).toBe("");
    const calls = f.send.mock.calls.length;
    await f.application.reschedule(booking.id, "2030-01-08T11:00:00+01:00", 0, "Disconnected edit");
    await f.calendar.processQueued();
    expect(f.update().status).toBe("awaiting_setup");
    expect(f.send.mock.calls.length).toBe(calls);
    expect(f.events.size).toBe(1);
    await f.connect();
    await f.calendar.processQueued();
    expect(f.update().status).toBe("synced");
    expect(f.state.creates).toBe(1);
    expect(f.events.get(f.update().eventId)).toMatchObject({
      start: { dateTime: "2030-01-08T10:00:00.000Z" },
    });
  });
});
