import { randomUUID } from "node:crypto";
import { Database } from "../server/infrastructure/database.js";
import { Repository } from "../server/infrastructure/repository.js";
import { seedDatabase } from "../server/infrastructure/seed.js";
import { importRouteResearch } from "../server/infrastructure/research.js";
import { PricingService } from "../server/pricing.js";
import { CustomerEmail } from "../server/infrastructure/notifications/email.js";
import { BookingApplication } from "../server/application.js";
import type { BookingCreationInput } from "../shared/contracts.js";
import type { NotificationGateway } from "../server/infrastructure/notifications/index.js";

export const clockNow = "2030-01-01T08:00:00.000Z";
export const silentNotifications: NotificationGateway = {
  notifyBookingCreated: async () => [],
  notifyStatusChanged: async () => [],
  notifyLocationRequestReviewed: async () => [],
};
export function bookingFixture(
  overrides: NodeJS.ProcessEnv = {},
  sendRequest: typeof fetch = fetch,
) {
  const database = new Database(":memory:");
  seedDatabase(database);
  importRouteResearch(database);
  const repository = new Repository(database),
    pricing = new PricingService(database, repository);
  const route = pricing.routes()[0];
  database.connection
    .prepare("UPDATE service_locations SET published = 1 WHERE id IN (?, ?)")
    .run(route.originId, route.destinationId);
  database.connection
    .prepare("UPDATE service_routes SET published = 1, distance_km = '8.12' WHERE id = ?")
    .run(route.id);
  pricing.saveSettings("100");
  const env: NodeJS.ProcessEnv = {
    ASA_BOLT_PUBLIC_APP_URL: "http://localhost:5173",
    ASA_BOLT_OWNER_PASSWORD: "test-owner",
    ASA_BOLT_EMAIL_PROVIDER: "resend",
    ...overrides,
  };
  const email = new CustomerEmail(env, database, sendRequest),
    whatsapp = new CustomerEmail(env, database, sendRequest, "whatsapp");
  const application = new BookingApplication(
    repository,
    silentNotifications,
    email,
    pricing,
    whatsapp,
  );
  const input = (changes: Partial<BookingCreationInput> = {}): BookingCreationInput => ({
    idempotencyKey: randomUUID(),
    email: "rider@example.test",
    originId: route.originId,
    destinationId: route.destinationId,
    pickupAt: "2030-01-07T10:00:00+01:00",
    pickupNote: "At the gate",
    quotedAmountKobo: 85000,
    priceChoice: "accept",
    ...changes,
  });
  return { database, repository, pricing, route, env, email, whatsapp, application, input };
}
