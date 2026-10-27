import { createHash, randomUUID } from "node:crypto";
import { type Actor, type BookingStatus, type RequestStatus } from "../shared/config.js";
import type {
  AvailableSchedule,
  ConflictReview,
  Booking,
  BookingAccessResponse,
  BookingCreationInput,
  FarePreview,
  LocationRequest,
  ServiceLocation,
} from "../shared/contracts.js";
import {
  canTransitionStatus,
  createReference,
  normalizePhone,
  normalizeEmail,
  localPickupParts,
  requireCancellationReason,
  parsePickupTime,
} from "./domain/rules.js";
import type { BookingRecord, Repository } from "./infrastructure/repository.js";
import type {
  NotificationGateway,
  NotificationResult,
} from "./infrastructure/notifications/index.js";
import type { CustomerEmail } from "./infrastructure/notifications/email.js";
import type { PricingService } from "./pricing.js";
import { koboToNaira, roundNairaUpTo50 } from "./domain/pricing.js";
import { previewOffer } from "./domain/offers.js";
import { findRideConflicts } from "../shared/scheduling.js";
import { HttpError } from "./errors.js";
import type { GoogleCalendar } from "./calendar.js";

export class BookingApplication {
  constructor(
    private readonly repository: Repository,
    private readonly notifications: NotificationGateway,
    private readonly email?: CustomerEmail,
    private readonly pricing?: PricingService,
    private readonly whatsapp?: CustomerEmail,
    private readonly calendar?: GoogleCalendar,
  ) {}

  listPublicLocations(): ServiceLocation[] {
    return this.repository.listLocations(true);
  }

  expirePending(now = new Date().toISOString()): number {
    let expired = 0;
    for (const id of this.repository.dueRequests(now)) {
      try {
        this.repository.updateBookingStatus(
          id,
          "rejected",
          "Not accepted before pickup time.",
          "system",
          now,
          "requested",
          (fresh) => {
            if (Date.parse(fresh.pickupAt) > Date.parse(now))
              throw new HttpError(409, "Pickup changed before expiry.");
          },
          () => {
            this.email?.queueBooking(
              this.repository.toBooking(this.requireBooking(id)),
              "request.updated",
            );
            this.whatsapp?.queueBooking(
              this.repository.toBooking(this.requireBooking(id)),
              "request.updated",
            );
          },
        );
        expired += 1;
      } catch (error) {
        if (error instanceof HttpError && error.status === 409) continue;
        throw error;
      }
    }
    return expired;
  }

  listAvailability(date: string): AvailableSchedule[] {
    const dayOfWeek = calendarDay(date);
    return this.repository
      .listSchedules()
      .filter((schedule) => schedule.active && schedule.dayOfWeek === dayOfWeek)
      .map((schedule) => ({
        date,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        label: `${schedule.dayLabel} · ${schedule.startTime}–${schedule.endTime}`,
      }));
  }

  previewFare(originId: string, destinationId: string, date: string): FarePreview {
    if (this.pricing) return this.pricing.quote(originId, destinationId, date);
    const fare = this.repository.findFare(originId, destinationId, date);
    return {
      amountKobo: roundNairaUpTo50(koboToNaira(fare.amountKobo)),
      currency: fare.currency,
      originName: fare.originName ?? "Pickup",
      destinationName: fare.destinationName ?? "Destination",
    };
  }

  async createBooking(input: BookingCreationInput): Promise<BookingAccessResponse> {
    const email = normalizeEmail(input.email ?? "");
    const existing = this.repository.findBookingByIdempotency(input.idempotencyKey);
    if (existing) {
      if (existing.email !== email)
        throw new HttpError(409, "Start a new request with a new booking key.");
      return this.accessResponse(existing);
    }
    const record = this.buildBookingRecord(input);
    this.repository.createBookingRequest(record, () => {
      this.email?.queueBooking(this.repository.toBooking(record), "request.received");
      this.whatsapp?.queueBooking(this.repository.toBooking(record), "request.received");
    });
    const booking = this.repository.toBooking(record);
    await this.recordNotification(record.id, await this.safeCreatedNotification(booking));
    return this.accessResponse(this.requireBooking(record.id));
  }

  getPublicBooking(token: string): BookingAccessResponse {
    const record = this.repository.findBookingByToken(token);
    if (!record) throw new Error("This booking link is not valid or has expired.");
    return this.accessResponse(record);
  }

  stopWhatsApp(token: string, contact: string): Booking {
    const booking = this.getPublicBooking(token).booking;
    if (!booking.email || normalizeEmail(contact) !== booking.email)
      throw new HttpError(403, "Use the email for this request.");
    this.repository.stopWhatsApp(booking.id);
    return this.repository.toBooking(this.requireBooking(booking.id));
  }

  async cancelPublicBooking(token: string, contact: string, reason: string): Promise<Booking> {
    const access = this.getPublicBooking(token);
    const matches = access.booking.email
      ? normalizeEmail(contact) === access.booking.email
      : normalizePhone(contact) === access.booking.phone;
    if (!matches) {
      throw new HttpError(403, "The contact details do not match this request.");
    }
    return this.changeStatus(access.booking.id, "cancelled", reason, "customer");
  }

  async changeStatus(
    id: string,
    nextStatus: BookingStatus,
    reason: string,
    actor: Actor,
    conflictToken?: string,
  ): Promise<Booking> {
    const current = this.requireBooking(id);
    if (current.status === nextStatus) return this.repository.toBooking(current);
    if (!canTransitionStatus(current.status, nextStatus)) {
      throw new HttpError(
        409,
        "This request cannot move to that status. Refresh to see the current decision.",
      );
    }
    if (
      current.status === "requested" &&
      ["confirmed", "rejected"].includes(nextStatus) &&
      actor !== "owner"
    ) {
      throw new HttpError(403, "Only the admin can accept or reject a request.");
    }
    if (nextStatus === "rejected" && reason.trim().length < 3) {
      throw new HttpError(400, "Give a short reason for rejecting this request.");
    }
    const cancellationReason =
      nextStatus === "cancelled"
        ? requireCancellationReason(reason)
        : nextStatus === "rejected"
          ? reason.trim().slice(0, 240)
          : "";
    const now = new Date().toISOString();
    this.repository.updateBookingStatus(
      id,
      nextStatus,
      cancellationReason,
      actor,
      now,
      current.status,
      nextStatus === "confirmed"
        ? (fresh) => {
            this.requireOpenFuture(fresh.pickupAt);
            this.checkConflicts(fresh, fresh.pickupAt, conflictToken);
          }
        : undefined,
      () => {
        this.email?.queueBooking(
          this.repository.toBooking(this.requireBooking(id)),
          "request.updated",
        );
        this.whatsapp?.queueBooking(
          this.repository.toBooking(this.requireBooking(id)),
          "request.updated",
        );
        this.calendar?.queueBooking(this.repository.toBooking(this.requireBooking(id)));
      },
    );
    const booking = this.repository.toBooking(this.requireBooking(id));
    await this.recordNotification(id, await this.safeStatusNotification(booking));
    return this.repository.toBooking(this.requireBooking(id));
  }

  private requireOpenFuture(pickupAt: string): void {
    const { date, time } = localPickupParts(pickupAt);
    if (new Date(pickupAt).getTime() <= Date.now() || !this.isOpen(date, time))
      throw new HttpError(
        409,
        "This pickup time is unavailable. Choose a future time within open pickup hours.",
      );
  }

  conflictReview(id: string, pickupAt?: string): ConflictReview {
    const current = this.requireBooking(id);
    return this.makeConflictReview(current, pickupAt ?? current.pickupAt);
  }

  private makeConflictReview(current: BookingRecord, pickupAt: string): ConflictReview {
    const conflicts = findRideConflicts(
      { id: current.id, pickupAt },
      this.repository.listBookings(),
    );
    const token = createHash("sha256")
      .update(
        JSON.stringify({
          id: current.id,
          status: current.status,
          revision: current.scheduleRevision ?? 0,
          pickupAt,
          conflicts,
        }),
      )
      .digest("hex");
    return { conflicts, token };
  }

  private checkConflicts(current: BookingRecord, pickupAt: string, token?: string): void {
    const review = this.makeConflictReview(current, pickupAt);
    if (review.conflicts.length && token !== review.token)
      throw new HttpError(409, "Review possible scheduling conflicts before continuing.", {
        review,
      });
  }

  async reschedule(
    id: string,
    pickupAt: string,
    revision: number,
    reason: string,
    conflictToken?: string,
  ): Promise<Booking> {
    const nextPickup = parsePickupTime(pickupAt);
    const trimmed = reason.trim();
    if (trimmed.length < 3 || trimmed.length > 240)
      throw new HttpError(400, "Give a schedule-change reason of 3–240 characters.");
    let timeChanged = false;
    const changed = this.repository.updateBookingSchedule(
      id,
      nextPickup,
      this.requireBooking(id).reservedMinutes ?? null,
      revision,
      trimmed,
      (fresh) => {
        timeChanged = fresh.pickupAt !== nextPickup;
        if (timeChanged) this.requireOpenFuture(nextPickup);
        if (fresh.status === "confirmed") this.checkConflicts(fresh, nextPickup, conflictToken);
      },
      () => {
        if (timeChanged)
          this.email?.queueBooking(
            this.repository.toBooking(this.requireBooking(id)),
            "request.rescheduled",
          );
        this.whatsapp?.queueBooking(
          this.repository.toBooking(this.requireBooking(id)),
          "request.rescheduled",
        );
        if (timeChanged)
          this.calendar?.queueBooking(this.repository.toBooking(this.requireBooking(id)));
      },
    );
    if (changed && timeChanged) {
      const booking = this.repository.toBooking(this.requireBooking(id));
      const results = await Promise.all([
        (
          this.notifications.notifyBookingRescheduled?.(booking) ??
          this.notifications.notifyStatusChanged(booking)
        ).catch(() => [{ channel: "system", status: "failed" as const }]),
        this.email?.sendBooking(booking, "request.rescheduled") ?? Promise.resolve([]),
      ]);
      await this.recordNotification(id, results.flat());
    }
    return this.repository.toBooking(this.requireBooking(id));
  }

  createLocationRequest(
    input: Omit<LocationRequest, "id" | "status" | "responseNote" | "createdAt">,
  ): LocationRequest {
    return this.repository.createLocationRequest({ ...input, phone: normalizePhone(input.phone) });
  }

  reviewLocationRequest(id: string, status: RequestStatus, responseNote: string): LocationRequest {
    this.repository.updateLocationRequest(id, status, responseNote.trim().slice(0, 240));
    const request = this.repository.getLocationRequest(id);
    void this.notifyLocationRequestReviewed(request);
    return request;
  }

  private async notifyLocationRequestReviewed(request: LocationRequest): Promise<void> {
    try {
      await this.notifications.notifyLocationRequestReviewed(request);
    } catch (error) {
      console.error("[notification] location review delivery failed", error);
    }
  }

  private buildBookingRecord(input: BookingCreationInput): BookingRecord {
    const pickupAt = parsePickupTime(input.pickupAt);
    const pickupDate = new Date(pickupAt);
    const { date, time } = localPickupParts(pickupAt);
    const origin = this.repository.getLocation(input.originId);
    const destination = this.repository.getLocation(input.destinationId);
    if (origin.id === destination.id) throw new Error("Choose two different locations.");
    if (Number.isNaN(pickupDate.getTime()) || pickupDate.getTime() < Date.now()) {
      throw new Error("Choose a future pickup time.");
    }
    if (!origin.published || !destination.published) throw new Error("Choose published locations.");
    if (!this.isOpen(date, time)) throw new Error("That pickup time is outside operating hours.");
    const fare = this.previewFare(origin.id, destination.id, date);
    if (fare.amountKobo !== input.quotedAmountKobo) {
      throw new HttpError(409, "The fare has changed. Review the new quote and agree again.", {
        fare: this.previewFare(origin.id, destination.id, date),
      });
    }
    const choice = input.priceChoice ?? "accept";
    if (choice !== "accept" && choice !== "negotiate")
      throw new HttpError(400, "Choose Accept price or Negotiate price.");
    if (
      choice === "accept" &&
      (input.proposedAmountNaira !== undefined ||
        input.proposedAmountKobo !== undefined ||
        input.negotiationNote)
    )
      throw new HttpError(400, "Choose Negotiate price to make an offer.");
    const offer = choice === "negotiate" ? previewOffer(input.proposedAmountNaira) : undefined;
    if (offer && offer.roundedAmountKobo !== input.proposedAmountKobo)
      throw new HttpError(409, "Review the rounded offer and agree again.", { offer });
    if ((input.negotiationNote?.length ?? 0) > 240)
      throw new HttpError(400, "Keep the negotiation note within 240 characters.");
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      reference: createReference(this.repository.listBookings().length + 1),
      accessToken: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      customerName: input.customerName?.trim().slice(0, 80) ?? "",
      phone: input.phone?.trim() ? normalizePhone(input.phone) : "",
      whatsappNumber: input.whatsappUpdates ? normalizePhone(input.whatsappNumber ?? "") : "",
      whatsappConsentAt: input.whatsappUpdates ? now : "",
      email: normalizeEmail(input.email ?? ""),
      rejectionReason: "",
      originId: origin.id,
      destinationId: destination.id,
      pickupNote: input.pickupNote.trim().slice(0, 240),
      pickupAt: pickupDate.toISOString(),
      fareAmountKobo: fare.amountKobo,
      fareCurrency: fare.currency,
      fareSnapshot: JSON.stringify(fare),
      proposedAmountNaira: offer?.amountNaira,
      proposedAmountKobo: offer?.roundedAmountKobo,
      negotiationNote: offer ? (input.negotiationNote?.trim() ?? "") : "",
      status: "requested",
      cancellationReason: "",
      notificationStatus: "queued",
      createdAt: now,
      updatedAt: now,
    };
  }

  private isOpen(date: string, time: string): boolean {
    const schedules = this.repository.listSchedules();
    const exceptions = this.repository.listExceptions();
    const closed = exceptions.some((exception) => exception.closed && exception.date === date);
    return (
      !closed &&
      schedules.some(
        (schedule) =>
          schedule.active &&
          schedule.dayOfWeek === calendarDay(date) &&
          time >= schedule.startTime &&
          time < schedule.endTime,
      )
    );
  }

  private async recordNotification(id: string, results: NotificationResult[]): Promise<void> {
    this.repository.updateNotificationStatus(id, notificationStatus(results));
  }

  private async safeCreatedNotification(booking: Booking): Promise<NotificationResult[]> {
    try {
      const [notifications, email] = await Promise.all([
        this.notifications.notifyBookingCreated(booking),
        this.email?.sendBooking(booking, "request.received") ?? Promise.resolve([]),
      ]);
      return [...notifications, ...email];
    } catch (error) {
      console.error(
        "[notification] booking delivery failed",
        error instanceof Error ? error.name : "UnknownError",
      );
      return [{ channel: "system", status: "failed" }];
    }
  }

  private async safeStatusNotification(booking: Booking): Promise<NotificationResult[]> {
    try {
      const [notifications, email] = await Promise.all([
        this.notifications.notifyStatusChanged(booking),
        this.email?.sendBooking(booking, "request.updated") ?? Promise.resolve([]),
      ]);
      return [...notifications, ...email];
    } catch (error) {
      console.error(
        "[notification] status delivery failed",
        error instanceof Error ? error.name : "UnknownError",
      );
      return [{ channel: "system", status: "failed" }];
    }
  }

  private requireBooking(id: string): BookingRecord {
    const booking = this.repository.findBookingById(id);
    if (!booking) throw new Error("Booking was not found.");
    return booking;
  }

  private accessResponse(record: BookingRecord): BookingAccessResponse {
    return {
      booking: this.repository.toBooking(record),
      statusUrl: `/status/${record.accessToken}`,
    };
  }
}

function calendarDay(date: string): number {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Choose a valid date.");
  return parsed.getUTCDay();
}

function notificationStatus(results: NotificationResult[]): string {
  if (results.some((result) => result.status === "failed")) return "failed";
  if (results.some((result) => result.status === "queued")) return "queued";
  if (results.some((result) => result.status === "delivered")) return "delivered";
  return "mocked";
}
