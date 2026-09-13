import { afterEach, describe, expect, it } from "vitest";
import { createRequestHandler, type RequestHandler } from "./http.js";
import { Database } from "../infrastructure/database.js";
import type { NotificationGateway } from "../infrastructure/notifications/index.js";

const notifications: NotificationGateway = {
  notifyBookingCreated: async () => [{ channel: "test", status: "delivered" }],
  notifyStatusChanged: async () => [{ channel: "test", status: "delivered" }],
  notifyLocationRequestReviewed: async () => [{ channel: "test", status: "delivered" }],
};
const databases: Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("booking API", () => {
  it("creates one automatically confirmed booking per idempotency key", async () => {
    const database = new Database(":memory:");
    databases.push(database);
    const handler = createRequestHandler({
      database,
      env: { ASA_BOLT_OWNER_PASSWORD: "test" },
      notifications,
    });
    const locations = (await invoke(handler, "GET", "/api/locations")).body as Array<{
      id: string;
    }>;
    const input = {
      idempotencyKey: "api-duplicate",
      customerName: "Ada Customer",
      phone: "08012345678",
      originId: locations[0].id,
      destinationId: locations[1].id,
      pickupAt: "2026-08-17T10:00:00+01:00",
      pickupNote: "At the gate",
    };
    const first = await invoke(handler, "POST", "/api/bookings", input);
    const second = await invoke(handler, "POST", "/api/bookings", input);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBooking = (
      first.body as { booking: { id: string; status: string; fare: { amountKobo: number } } }
    ).booking;
    const secondBooking = (
      second.body as { booking: { id: string; status: string; fare: { amountKobo: number } } }
    ).booking;
    expect(firstBooking.status).toBe("confirmed");
    expect(secondBooking.id).toBe(firstBooking.id);
    expect(secondBooking.fare.amountKobo).toBe(firstBooking.fare.amountKobo);
  });
});

interface TestResponse {
  status: number;
  body: unknown;
}

async function invoke(
  handler: RequestHandler,
  method: string,
  url: string,
  body?: unknown,
): Promise<TestResponse> {
  let payload: unknown;
  let status = 200;
  const response = {
    setHeader: () => undefined,
    writeHead: (nextStatus: number) => {
      status = nextStatus;
    },
    end: (value?: string) => {
      payload = value ? JSON.parse(value) : {};
    },
  };
  const request = {
    method,
    url,
    headers: {},
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body));
    },
  };
  await handler(request as never, response as never);
  return { status, body: payload };
}
