import { randomUUID } from "node:crypto";
import { type Actor, type BookingStatus, type RequestStatus } from "../shared/config.js";
import type {
  AvailableSchedule,
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
  requireCancellationReason,
} from "./domain/rules.js";
import type { BookingRecord, Repository } from "./infrastructure/repository.js";
import type {
  NotificationGateway,
  NotificationResult,
} from "./infrastructure/notifications/index.js";

export class BookingApplication {
  constructor(
    private readonly repository: Repository,
    private readonly notifications: NotificationGateway,
  ) {}

  listPublicLocations(): ServiceLocation[] {
    return this.repository.listLocations(true);
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
    const fare = this.repository.findFare(originId, destinationId, date);
    return {
      amountKobo: fare.amountKobo,
      currency: fare.currency,
      originName: fare.originName ?? "Pickup",
      destinationName: fare.destinationName ?? "Destination",
    };
  }

  async createBooking(input: BookingCreationInput): Promise<BookingAccessResponse> {
    const existing = this.repository.findBookingByIdempotency(input.idempotencyKey);
    if (existing) return this.accessResponse(existing);
    const record = this.buildBookingRecord(input);
    this.repository.createBooking(record);
    this.repository.addBookingEvent(record.id, "", "confirmed", "", "system", record.createdAt);
    const booking = this.repository.toBooking(record);
    await this.recordNotification(record.id, await this.safeCreatedNotification(booking));
    return this.accessResponse(this.requireBooking(record.id));
  }

  getPublicBooking(token: string): BookingAccessResponse {
    const record = this.repository.findBookingByToken(token);
    if (!record) throw new Error("This booking link is not valid or has expired.");
    return this.accessResponse(record);
  }

  async cancelPublicBooking(token: string, phone: string, reason: string): Promise<Booking> {
    const access = this.getPublicBooking(token);
    if (normalizePhone(phone) !== access.booking.phone) {
      throw new Error("The phone number does not match this booking.");
    }
    return this.changeStatus(access.booking.id, "cancelled", reason, "customer");
  }

  async changeStatus(
    id: string,
    nextStatus: BookingStatus,
    reason: string,
    actor: Actor,
  ): Promise<Booking> {
    const current = this.requireBooking(id);
    if (current.status === nextStatus) return this.repository.toBooking(current);
    if (!canTransitionStatus(current.status, nextStatus)) {
      throw new Error(`Cannot move a booking from ${current.status} to ${nextStatus}.`);
    }
    const cancellationReason = nextStatus === "cancelled" ? requireCancellationReason(reason) : "";
    const now = new Date().toISOString();
    this.repository.updateBookingStatus(id, nextStatus, cancellationReason, actor, now);
    const booking = this.repository.toBooking(this.requireBooking(id));
    await this.recordNotification(id, await this.safeStatusNotification(booking));
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
    const pickupDate = new Date(input.pickupAt);
    const date = input.pickupAt.slice(0, 10);
    const time = input.pickupAt.slice(11, 16);
    const origin = this.repository.getLocation(input.originId);
    const destination = this.repository.getLocation(input.destinationId);
    if (!input.customerName.trim()) throw new Error("Your name is required.");
    if (origin.id === destination.id) throw new Error("Choose two different locations.");
    if (Number.isNaN(pickupDate.getTime()) || pickupDate.getTime() < Date.now()) {
      throw new Error("Choose a future pickup time.");
    }
    if (!origin.published || !destination.published) throw new Error("Choose published locations.");
    if (!this.isOpen(date, time)) throw new Error("That pickup time is outside operating hours.");
    const fare = this.repository.findFare(origin.id, destination.id, date);
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      reference: createReference(this.repository.listBookings().length + 1),
      accessToken: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      customerName: input.customerName.trim().slice(0, 80),
      phone: normalizePhone(input.phone),
      originId: origin.id,
      destinationId: destination.id,
      pickupNote: input.pickupNote.trim().slice(0, 240),
      pickupAt: pickupDate.toISOString(),
      fareAmountKobo: fare.amountKobo,
      fareCurrency: fare.currency,
      status: "confirmed",
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
      return await this.notifications.notifyBookingCreated(booking);
    } catch (error) {
      console.error("[notification] booking delivery failed", error);
      return [{ channel: "system", status: "failed" }];
    }
  }

  private async safeStatusNotification(booking: Booking): Promise<NotificationResult[]> {
    try {
      return await this.notifications.notifyStatusChanged(booking);
    } catch (error) {
      console.error("[notification] status delivery failed", error);
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
  if (results.some((result) => result.status === "delivered")) return "delivered";
  return "mocked";
}
