import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookingFixture, clockNow } from "../tests/booking-fixture.js";
import type { Database } from "./infrastructure/database.js";
const databases: Database[] = [];
const setup = () => {
  const f = bookingFixture();
  databases.push(f.database);
  return f;
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clockNow);
});
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
  vi.useRealTimers();
});

describe("email request lifecycle", () => {
  it("saves one pending request without a name or phone, and requires a matching email on replay", async () => {
    const f = setup(),
      input = f.input();
    const first = await f.application.createBooking(input),
      repeated = await f.application.createBooking(input);
    expect(first.booking).toMatchObject({
      status: "requested",
      email: "rider@example.test",
      phone: "",
      customerName: "",
    });
    expect(first.booking.agreedAmountKobo).toBeUndefined();
    expect(repeated.booking.id).toBe(first.booking.id);
    expect(f.repository.listEvents(first.booking.id)).toHaveLength(1);
    await expect(
      f.application.createBooking({ ...input, email: "other@example.test" }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("requires renewed quote consent and preserves saved prices after pricing edits", async () => {
    const f = setup(),
      input = f.input(),
      saved = await f.application.createBooking(input);
    f.pricing.saveSettings("200");
    expect(f.application.getPublicBooking(saved.booking.accessToken).booking.fare.amountKobo).toBe(
      85000,
    );
    await expect(f.application.createBooking(f.input())).rejects.toMatchObject({
      status: 409,
      details: { fare: { amountKobo: 165000 } },
    });
    const accepted = await f.application.changeStatus(saved.booking.id, "confirmed", "", "owner");
    expect(accepted.agreedAmountKobo).toBe(85000);
  });
  it("accepts exactly the rounded one-offer fare and records one decision", async () => {
    const f = setup(),
      saved = await f.application.createBooking(
        f.input({
          priceChoice: "negotiate",
          proposedAmountNaira: "812",
          proposedAmountKobo: 85000,
          negotiationNote: "My one offer",
        }),
      );
    const accepted = await f.application.changeStatus(saved.booking.id, "confirmed", "", "owner");
    expect(accepted).toMatchObject({
      agreedAmountKobo: 85000,
      offer: { amountNaira: "812", roundedAmountKobo: 85000 },
    });
    await f.application.changeStatus(saved.booking.id, "confirmed", "", "owner");
    expect(f.repository.listEvents(saved.booking.id)).toHaveLength(2);
    await expect(
      f.application.changeStatus(saved.booking.id, "rejected", "Unavailable", "owner"),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("rejects a forged rounded offer and an offer attached to accept-price mode", async () => {
    const f = setup();
    await expect(
      f.application.createBooking(
        f.input({
          priceChoice: "negotiate",
          proposedAmountNaira: "812",
          proposedAmountKobo: 81200,
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.application.createBooking(f.input({ priceChoice: "accept", proposedAmountNaira: "812" })),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("keeps rejection separate from cancellation and prevents customer decisions", async () => {
    const f = setup(),
      saved = await f.application.createBooking(f.input());
    await expect(
      f.application.changeStatus(saved.booking.id, "confirmed", "", "customer"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.application.changeStatus(saved.booking.id, "rejected", "", "owner"),
    ).rejects.toMatchObject({ status: 400 });
    const rejected = await f.application.changeStatus(
      saved.booking.id,
      "rejected",
      "Not serving this time",
      "owner",
    );
    expect(rejected.rejectionReason).toBe("Not serving this time");
    expect(rejected.cancellationReason).toBe("");
    expect(rejected.agreedAmountKobo).toBeUndefined();
  });
  it("checks the request email before cancellation", async () => {
    const f = setup(),
      saved = await f.application.createBooking(f.input());
    await expect(
      f.application.cancelPublicBooking(
        saved.booking.accessToken,
        "other@example.test",
        "Plans changed",
      ),
    ).rejects.toMatchObject({ status: 403 });
    const cancelled = await f.application.cancelPublicBooking(
      saved.booking.accessToken,
      "rider@example.test",
      "Plans changed",
    );
    expect(cancelled).toMatchObject({
      status: "cancelled",
      cancellationReason: "Plans changed",
      rejectionReason: "",
    });
  });
  it("requires open hours again at acceptance", async () => {
    const f = setup(),
      saved = await f.application.createBooking(f.input());
    f.repository.saveException({ id: "closed", date: "2030-01-07", closed: true, note: "Closed" });
    await expect(
      f.application.changeStatus(saved.booking.id, "confirmed", "", "owner"),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.application.getPublicBooking(saved.booking.accessToken).booking.status).toBe(
      "requested",
    );
  });
});

describe("scheduling and approved expiry", () => {
  it("expires at the exact pickup boundary, with one audit and durable notification, while preserving accepted rides", async () => {
    const f = setup(),
      pending = await f.application.createBooking(f.input()),
      accepted = await f.application.createBooking(
        f.input({ pickupAt: "2030-01-08T10:00:00+01:00" }),
      );
    await f.application.changeStatus(accepted.booking.id, "confirmed", "", "owner");
    const cutoff = Date.parse(pending.booking.pickupAt);
    expect(f.application.expirePending(new Date(cutoff - 1).toISOString())).toBe(0);
    expect(f.application.expirePending(new Date(cutoff).toISOString())).toBe(1);
    expect(f.application.expirePending("2030-01-10T00:00:00Z")).toBe(0);
    const result = f.application.getPublicBooking(pending.booking.accessToken).booking;
    expect(result).toMatchObject({
      status: "rejected",
      rejectionReason: "Not accepted before pickup time.",
    });
    expect(result.agreedAmountKobo).toBeUndefined();
    expect(result.events).toHaveLength(2);
    expect(result.events.at(-1)?.actor).toBe("system");
    expect(
      f.database.connection
        .prepare("SELECT count(*) AS n FROM email_deliveries WHERE event='request.rejected'")
        .get()?.n,
    ).toBe(1);
    expect(f.application.getPublicBooking(accepted.booking.accessToken).booking.status).toBe(
      "confirmed",
    );
  });
  it("preserves prices, rejects stale reschedules, and does not duplicate an identical save", async () => {
    const f = setup(),
      saved = await f.application.createBooking(f.input());
    const moved = await f.application.reschedule(
      saved.booking.id,
      "2030-01-08T11:00:00+01:00",
      0,
      "Customer requested later",
    );
    expect(moved.scheduleRevision).toBe(1);
    expect(moved.fare.amountKobo).toBe(85000);
    await f.application.reschedule(saved.booking.id, moved.pickupAt, 0, "Repeat request");
    expect(f.repository.listScheduleEvents(saved.booking.id)).toHaveLength(1);
    await expect(
      f.application.reschedule(saved.booking.id, "2030-01-09T11:00:00+01:00", 0, "Old edit"),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      f.database.connection
        .prepare("SELECT count(*) AS n FROM email_deliveries WHERE event='request.rescheduled'")
        .get()?.n,
    ).toBe(1);
  });
  it("flags possible same-day conflicts and permits a reviewed admin override", async () => {
    const f = setup(),
      first = await f.application.createBooking(f.input()),
      second = await f.application.createBooking(
        f.input({ pickupAt: "2030-01-07T15:00:00+01:00" }),
      );
    await f.application.changeStatus(first.booking.id, "confirmed", "", "owner");
    await expect(
      f.application.changeStatus(second.booking.id, "confirmed", "", "owner"),
    ).rejects.toMatchObject({ status: 409 });
    const review = f.application.conflictReview(second.booking.id);
    expect(review.conflicts).toMatchObject([{ id: first.booking.id, kind: "same_day" }]);
    expect(
      (await f.application.changeStatus(second.booking.id, "confirmed", "", "owner", review.token))
        .status,
    ).toBe("confirmed");
  });
  it("never infers WhatsApp consent from a legacy phone and stops new customer messages after opt-out", async () => {
    const f = setup();
    f.whatsapp.store.saveSettings({ ...f.whatsapp.store.settings(), emailEnabled: true });
    await f.application.createBooking(f.input({ phone: "08012345678" }));
    expect(f.whatsapp.overview().total).toBe(0);
    const opted = await f.application.createBooking(
      f.input({ whatsappUpdates: true, whatsappNumber: "08012345678" }),
    );
    expect(opted.booking.whatsappConsentAt).toBe(clockNow);
    await expect(
      Promise.resolve().then(() =>
        f.application.stopWhatsApp(opted.booking.accessToken, "other@example.test"),
      ),
    ).rejects.toMatchObject({ status: 403 });
    f.application.stopWhatsApp(opted.booking.accessToken, "rider@example.test");
    await f.application.changeStatus(opted.booking.id, "rejected", "Cannot accept", "owner");
    expect(f.whatsapp.overview().total).toBe(1);
    expect(f.whatsapp.overview().deliveries[0].retryable).toBe(false);
    await f.whatsapp.processQueued();
    expect(f.whatsapp.overview().counts.skipped).toBe(1);
  });
});
