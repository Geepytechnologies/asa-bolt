import { describe, expect, it } from "vitest";
import { BookingApplication } from "./application.js";
import { createNotificationGateway } from "./infrastructure/notifications/index.js";
import { Database } from "./infrastructure/database.js";
import { Repository } from "./infrastructure/repository.js";
import { seedDatabase } from "./infrastructure/seed.js";

function futureMonday(): string {
  const date = new Date("2026-08-17T08:00:00.000Z");
  return date.toISOString();
}

describe("booking application", () => {
  it("keeps the fare snapshot after a route fare changes", async () => {
    const database = new Database(":memory:");
    seedDatabase(database);
    const repository = new Repository(database);
    const application = new BookingApplication(repository, createNotificationGateway({}));
    const firstFare = repository.findFare("umuahia-central", "umuahia-tower", "2026-08-16");
    const result = await application.createBooking({
      idempotencyKey: "snapshot-test",
      customerName: "Ada Rider",
      phone: "08012345678",
      originId: "umuahia-central",
      destinationId: "umuahia-tower",
      pickupAt: futureMonday(),
      pickupNote: "Beside the gate",
    });
    repository.saveFare({
      ...firstFare,
      amountKobo: firstFare.amountKobo + 50000,
      effectiveFrom: "2026-08-17",
    });
    const status = application.getPublicBooking(result.booking.accessToken);
    expect(status.booking.fare.amountKobo).toBe(firstFare.amountKobo);
    database.close();
  });
});
