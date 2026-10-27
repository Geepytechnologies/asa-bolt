import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookingFixture, clockNow } from "../../../tests/booking-fixture.js";
import type { Database } from "../database.js";
import { HistoryAccess } from "../../history.js";
const databases: Database[] = [];
const secret = Buffer.alloc(32, 7);
const setup = (mode: "accept" | "reject" | "lost" = "accept") => {
  const provider = new Map<string, { id: string; body: Record<string, unknown> }>();
  const state = { mode };
  const send = vi.fn<typeof fetch>(async (_url, options) => {
    const key = new Headers(options?.headers).get("Idempotency-Key")!;
    const body = JSON.parse(String(options?.body));
    if (state.mode === "reject") return new Response("{}", { status: 422 });
    if (!provider.has(key)) provider.set(key, { id: randomUUID(), body });
    if (state.mode === "lost") throw new Error("Lost response");
    return new Response(JSON.stringify({ id: provider.get(key)!.id }), { status: 200 });
  });
  const f = bookingFixture(
    {
      RESEND_API_KEY: "re_fixture",
      ASA_BOLT_EMAIL_FROM: "Asa Ride <ride@example.test>",
      RESEND_WEBHOOK_SECRET: "whsec_" + secret.toString("base64"),
    },
    send,
  );
  databases.push(f.database);
  return { ...f, provider, state, send };
};
function event(
  type: string,
  emailId: string,
  deliveryId?: string,
  age = 0,
  id = "msg_" + randomUUID(),
) {
  const body = JSON.stringify({
    type,
    created_at: new Date().toISOString(),
    data: { email_id: emailId, ...(deliveryId ? { tags: { asa_delivery_id: deliveryId } } : {}) },
  });
  const timestamp = String(Math.floor(Date.now() / 1000) - age);
  const headers = {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature":
      "v1," + createHmac("sha256", secret).update(`${id}.${timestamp}.${body}`).digest("base64"),
  };
  return { body, headers };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clockNow);
});
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
  vi.useRealTimers();
});
describe("Resend durable messages", () => {
  it("reports invalid/partial sender configuration without silently changing transports", () => {
    const f = setup();
    f.env.ASA_BOLT_EMAIL_FROM = "Broken <ride@example.test";
    expect(f.email.connection().mode).toBe("invalid");
    f.env.ASA_BOLT_EMAIL_FROM = "ride@example.test";
    f.env.RESEND_API_KEY = "";
    f.env.ASA_BOLT_EMAIL_WEBHOOK_URL = "https://other.example.test";
    expect(f.email.connection().mode).toBe("unconfigured");
    expect(JSON.stringify(f.email.connection())).not.toContain("re_fixture");
  });
  it("sends the frozen recipient, prices and stable key through native Resend", async () => {
    const f = setup(),
      saved = await f.application.createBooking(f.input());
    expect(f.send).toHaveBeenCalledTimes(1);
    const [url, init] = f.send.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer re_fixture");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      from: "Asa Ride <ride@example.test>",
      to: ["rider@example.test"],
    });
    expect(body.text).toContain("₦850");
    expect(body.text).toContain("automatically rejected");
    const row = f.email.overview().deliveries[0];
    expect(row).toMatchObject({ status: "accepted", attempts: 1, provider: "resend" });
    expect(body.tags).toEqual([{ name: "asa_delivery_id", value: row.id }]);
    expect(saved.booking.customerEmailStatus).toBe("accepted");
  });
  it("keeps a failed ride saved and retries an uncertain send without a duplicate provider message", async () => {
    const f = setup("lost"),
      saved = await f.application.createBooking(f.input());
    const row = f.email.overview().deliveries[0];
    expect(row.status).toBe("uncertain");
    f.state.mode = "accept";
    const retried = await f.email.retry(row.id, row.attempts);
    expect(retried.delivery).toMatchObject({ status: "accepted", attempts: 2 });
    expect(f.provider.size).toBe(1);
    expect(f.send.mock.calls[0][1]?.body).toBe(f.send.mock.calls[1][1]?.body);
    expect(new Headers(f.send.mock.calls[0][1]?.headers).get("Idempotency-Key")).toBe(
      new Headers(f.send.mock.calls[1][1]?.headers).get("Idempotency-Key"),
    );
    await f.email.retry(row.id, 1);
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.repository.listEvents(saved.booking.id)).toHaveLength(1);
  });
  it("blocks an uncertain retry after the conservative retention window or a transport change", async () => {
    const f = setup("lost");
    await f.application.createBooking(f.input());
    const row = f.email.overview().deliveries[0];
    f.env.RESEND_API_KEY = "re_other";
    await expect(f.email.retry(row.id, 1)).rejects.toThrow("same adapter");
    f.env.RESEND_API_KEY = "re_fixture";
    vi.setSystemTime(Date.now() + 23 * 3600000);
    await expect(f.email.retry(row.id, 1)).rejects.toThrow("window has expired");
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("blocks stale ride snapshots and disabled recipients/events", async () => {
    const f = setup("reject"),
      saved = await f.application.createBooking(f.input());
    const row = f.email.overview().deliveries[0];
    f.email.store.saveSettings({ ...f.email.store.settings(), emailEnabled: false });
    await expect(f.email.retry(row.id, 1)).rejects.toThrow("disabled");
    f.email.store.saveSettings({ ...f.email.store.settings(), emailEnabled: true });
    await f.application.changeStatus(saved.booking.id, "rejected", "No availability", "owner");
    await expect(f.email.retry(row.id, 1)).rejects.toThrow("older ride status");
  });
  it("queues recipient snapshots atomically with a ride and rolls back if queuing fails", async () => {
    const f = setup();
    vi.spyOn(f.email, "queueBooking").mockImplementation(() => {
      throw new Error("Storage failed");
    });
    await expect(f.application.createBooking(f.input())).rejects.toThrow("Storage failed");
    expect(f.repository.listBookings()).toHaveLength(0);
    expect(f.email.overview().total).toBe(0);
    expect(f.send).not.toHaveBeenCalled();
  });
  it("recovers an interrupted lease as uncertain", async () => {
    const f = setup();
    const saved = await f.application.createBooking(f.input());
    const pending = f.email.store.queue({
      occurrence: "lease-fixture",
      bookingId: saved.booking.id,
      reference: saved.booking.reference,
      event: "request.received",
      audience: "customer",
      recipient: "rider@example.test",
      subject: "Lease",
      text: "Snapshot",
      bookingStatus: "requested",
      enabled: true,
    });
    f.email.store.claim(pending.id, 0, "system", "fingerprint", "resend");
    vi.setSystemTime(Date.now() + 31000);
    await f.email.processQueued();
    expect(f.email.detail(pending.id).delivery.status).toBe("uncertain");
    expect(f.email.detail(pending.id).attempts[0]).toMatchObject({
      status: "uncertain",
      finishedAt: expect.any(String),
    });
  });
  it("deduplicates a customer who is also an admin and preserves revision checks", async () => {
    const f = setup();
    const settings = f.email.store.settings();
    const updated = f.email.store.saveSettings({
      ...settings,
      adminRecipients: ["RIDER@example.test", "rider@example.test"],
    });
    expect(updated.adminRecipients).toEqual(["rider@example.test"]);
    expect(() => f.email.store.saveSettings(settings)).toThrow("settings changed");
    await f.application.createBooking(f.input());
    expect(f.provider.size).toBe(1);
    expect(f.email.overview().deliveries[0].audience).toBe("both");
  });
});
describe("signed Resend callbacks", () => {
  it("verifies signatures, timestamp freshness, duplicate identity, and delivery precedence", async () => {
    const f = setup();
    await f.application.createBooking(f.input());
    const row = f.email.overview().deliveries[0],
      id = row.providerMessageId;
    const delivered = event("email.delivered", id, row.id);
    f.email.receiveResendWebhook(delivered.body, delivered.headers);
    f.email.receiveResendWebhook(delivered.body, delivered.headers);
    const late = event("email.delivery_delayed", id);
    f.email.receiveResendWebhook(late.body, late.headers);
    expect(f.email.detail(row.id).delivery.status).toBe("delivered");
    expect(f.email.detail(row.id).providerEvents).toHaveLength(2);
    expect(() =>
      f.email.receiveResendWebhook(delivered.body, {
        ...delivered.headers,
        "svix-signature": "v1,invalid",
      }),
    ).toThrow("signature");
    const stale = event("email.sent", id, row.id, 600);
    expect(() => f.email.receiveResendWebhook(stale.body, stale.headers)).toThrow("timestamp");
    const collision = event("email.bounced", id, row.id, 0, delivered.headers["svix-id"]);
    expect(() => f.email.receiveResendWebhook(collision.body, collision.headers)).toThrow(
      "different data",
    );
    const bounce = event("email.bounced", id);
    f.email.receiveResendWebhook(bounce.body, bounce.headers);
    expect(f.email.detail(row.id).delivery).toMatchObject({ status: "bounced", retryable: false });
  });
  it("preserves a delivered callback arriving before the HTTP response, even without tags", async () => {
    const id = randomUUID();
    const send: typeof fetch = async () => {
      const delivered = event("email.delivered", id);
      f.email.receiveResendWebhook(delivered.body, delivered.headers);
      return new Response(JSON.stringify({ id }), { status: 200 });
    };
    const f = bookingFixture(
      {
        RESEND_API_KEY: "re_fixture",
        ASA_BOLT_EMAIL_FROM: "ride@example.test",
        RESEND_WEBHOOK_SECRET: "whsec_" + secret.toString("base64"),
      },
      send,
    );
    databases.push(f.database);
    await f.application.createBooking(f.input());
    expect(f.email.overview().deliveries[0].status).toBe("delivered");
    expect(f.email.detail(f.email.overview().deliveries[0].id).providerEvents).toHaveLength(1);
  });
});
describe("private email history", () => {
  it("stores no verification body in admin records and consumes a link once", async () => {
    const f = setup();
    await f.application.createBooking(f.input());
    const history = new HistoryAccess(f.database, f.repository, f.email);
    await history.requestLink("rider@example.test", "fixture-ip");
    const link = f.email.overview().deliveries.find((row) => row.event === "history.link")!;
    expect(f.email.detail(link.id)).toMatchObject({ text: "", delivery: { retryable: false } });
    const body = [...f.provider.values()].at(-1)!.body;
    const token = String(body.text).match(/token=([a-f0-9]{64})/)![1];
    const session = history.exchange(token, "fixture-ip");
    expect(history.read(session.token).bookings).toHaveLength(1);
    expect(() => history.exchange(token, "fixture-ip")).toThrow("already used");
    history.logout(session.token);
    expect(() => history.read(session.token)).toThrow("expired");
  });
  it("does not reveal another email and rejects expired links and sessions", async () => {
    const f = setup();
    await f.application.createBooking(f.input());
    const history = new HistoryAccess(f.database, f.repository, f.email);
    await history.requestLink("other@example.test", "fixture-ip");
    const token = String([...f.provider.values()].at(-1)!.body.text).match(
      /token=([a-f0-9]{64})/,
    )![1];
    const session = history.exchange(token, "fixture-ip");
    expect(history.read(session.token).bookings).toEqual([]);
    vi.setSystemTime(Date.now() + 30 * 60000);
    expect(() => history.read(session.token)).toThrow("expired");
    await history.requestLink("rider@example.test", "fixture-ip");
    const later = String([...f.provider.values()].at(-1)!.body.text).match(
      /token=([a-f0-9]{64})/,
    )![1];
    vi.setSystemTime(Date.now() + 15 * 60000);
    expect(() => history.exchange(later, "fixture-ip")).toThrow("expired");
  });
});
