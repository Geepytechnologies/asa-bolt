import { HttpError } from "../errors.js";
import { randomUUID } from "node:crypto";
import type { Database } from "./database.js";
import { dayLabel } from "./seed.js";
import type {
  FareRule,
  FarePreview,
  LocationRequest,
  OperatingSchedule,
  ServiceLocation,
  ScheduleException,
  Booking,
  BookingStatusEvent,
  BookingScheduleEvent,
} from "../../shared/contracts.js";
import { koboToNaira, roundNairaUpTo50 } from "../domain/pricing.js";
import type { BookingStatus, RequestStatus } from "../../shared/config.js";
import type { EmailState } from "../../shared/notifications.js";

type Row = Record<string, unknown>;

export interface BookingRecord {
  id: string;
  reference: string;
  accessToken: string;
  idempotencyKey: string;
  customerName: string;
  phone: string;
  email: string;
  whatsappNumber?: string;
  whatsappConsentAt?: string;
  whatsappOptOutAt?: string;
  rejectionReason: string;
  originId: string;
  destinationId: string;
  pickupNote: string;
  pickupAt: string;
  reservedMinutes?: number | null;
  scheduleRevision?: number;
  fareAmountKobo: number;
  fareCurrency: string;
  fareSnapshot?: string;
  proposedAmountNaira?: string;
  proposedAmountKobo?: number;
  negotiationNote?: string;
  agreedAmountKobo?: number;
  status: BookingStatus;
  cancellationReason: string;
  notificationStatus: string;
  createdAt: string;
  updatedAt: string;
}

export class Repository {
  constructor(private readonly database: Database) {}

  listLocations(publishedOnly = false): ServiceLocation[] {
    const filter = publishedOnly ? " WHERE published = 1" : "";
    const rows = this.database.connection
      .prepare(`SELECT * FROM service_locations${filter} ORDER BY name`)
      .all();
    return rows.map((row) => toLocation(row as Row));
  }

  listSchedules(): OperatingSchedule[] {
    const rows = this.database.connection
      .prepare("SELECT * FROM operating_schedules ORDER BY day_of_week, start_time")
      .all();
    return rows.map((row) => toSchedule(row as Row));
  }

  listExceptions(): ScheduleException[] {
    const rows = this.database.connection
      .prepare("SELECT * FROM schedule_exceptions ORDER BY date")
      .all();
    return rows.map((row) => toException(row as Row));
  }

  findFare(originId: string, destinationId: string, date: string): FareRule {
    const fare = this.findOptionalFare(originId, destinationId, date);
    if (!fare) throw new Error("No active fare is configured for this route.");
    return fare;
  }

  findOptionalFare(originId: string, destinationId: string, date: string): FareRule | undefined {
    const row = this.database.connection
      .prepare(
        "SELECT fare_rules.*, origin.name AS origin_name, destination.name AS destination_name " +
          "FROM fare_rules JOIN service_locations origin ON origin.id = fare_rules.origin_id " +
          "JOIN service_locations destination ON destination.id = fare_rules.destination_id " +
          "WHERE origin_id = ? AND destination_id = ? AND active = 1 AND effective_from <= ? " +
          "ORDER BY effective_from DESC, fare_rules.rowid DESC LIMIT 1",
      )
      .get(originId, destinationId, date);
    return row ? toFare(row as Row) : undefined;
  }

  createBooking(record: BookingRecord): void {
    this.database.connection
      .prepare(
        "INSERT INTO bookings (id, reference, access_token, idempotency_key, customer_name, phone, " +
          "origin_id, destination_id, pickup_note, pickup_at, fare_amount_kobo, fare_currency, status, " +
          "cancellation_reason, notification_status, created_at, updated_at, email, rejection_reason, fare_snapshot, proposed_amount_naira, proposed_amount_kobo, negotiation_note, agreed_amount_kobo, whatsapp_number, whatsapp_consent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.id,
        record.reference,
        record.accessToken,
        record.idempotencyKey,
        record.customerName,
        record.phone,
        record.originId,
        record.destinationId,
        record.pickupNote,
        record.pickupAt,
        record.fareAmountKobo,
        record.fareCurrency,
        record.status,
        record.cancellationReason,
        record.notificationStatus,
        record.createdAt,
        record.updatedAt,
        record.email,
        record.rejectionReason,
        record.fareSnapshot ?? "",
        record.proposedAmountNaira ?? "",
        record.proposedAmountKobo ?? null,
        record.negotiationNote ?? "",
        record.agreedAmountKobo ?? null,
        record.whatsappNumber ?? "",
        record.whatsappConsentAt ?? "",
      );
  }

  findBookingByIdempotency(key: string): BookingRecord | undefined {
    const row = this.database.connection
      .prepare("SELECT * FROM bookings WHERE idempotency_key = ?")
      .get(key);
    return row ? toBookingRecord(row as Row) : undefined;
  }

  createBookingRequest(record: BookingRecord, enqueue: () => void): void {
    const db = this.database.connection;
    db.exec("BEGIN IMMEDIATE");
    try {
      this.createBooking(record);
      this.addBookingEvent(record.id, "", "requested", "", "customer", record.createdAt);
      enqueue();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  findBookingByToken(token: string): BookingRecord | undefined {
    const row = this.database.connection
      .prepare("SELECT * FROM bookings WHERE access_token = ?")
      .get(token);
    return row ? toBookingRecord(row as Row) : undefined;
  }

  findBookingById(id: string): BookingRecord | undefined {
    const row = this.database.connection.prepare("SELECT * FROM bookings WHERE id = ?").get(id);
    return row ? toBookingRecord(row as Row) : undefined;
  }

  listBookings(): Booking[] {
    const rows = this.database.connection
      .prepare("SELECT * FROM bookings ORDER BY pickup_at ASC, created_at DESC")
      .all();
    return rows.map((row) => this.toBooking(row as Row));
  }

  stopWhatsApp(id: string): void {
    this.database.connection
      .prepare(
        "UPDATE bookings SET whatsapp_opt_out_at = ? WHERE id = ? AND whatsapp_opt_out_at = ''",
      )
      .run(new Date().toISOString(), id);
  }

  dueRequests(now: string): string[] {
    return this.database.connection
      .prepare(
        "SELECT id FROM bookings WHERE status = 'requested' AND julianday(pickup_at) <= julianday(?) ORDER BY pickup_at LIMIT 1000",
      )
      .all(now)
      .map((row) => String(row.id));
  }

  listBookingsByEmail(email: string): Booking[] {
    const rows = this.database.connection
      .prepare("SELECT * FROM bookings WHERE email = ? ORDER BY created_at DESC, rowid DESC")
      .all(email);
    return rows.map((row) => this.toBooking(row as Row));
  }

  updateBookingStatus(
    id: string,
    status: BookingStatus,
    reason: string,
    actor: string,
    now: string,
    expectedStatus?: BookingStatus,
    guard?: (current: BookingRecord) => void,
    enqueue?: () => void,
  ): void {
    const db = this.database.connection;
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.findBookingById(id);
      if (!current) throw new HttpError(404, "Request not found.");
      if (expectedStatus && current.status !== expectedStatus)
        throw new HttpError(409, "This request has already changed. Refresh before deciding.");
      guard?.(current);
      const agreed =
        status === "confirmed"
          ? (current.proposedAmountKobo ?? current.fareAmountKobo)
          : current.agreedAmountKobo;
      db.prepare(
        "UPDATE bookings SET status = ?, cancellation_reason = ?, rejection_reason = ?, agreed_amount_kobo = ?, updated_at = ? WHERE id = ?",
      ).run(
        status,
        status === "cancelled" ? reason : current.cancellationReason,
        status === "rejected" ? reason : current.rejectionReason,
        agreed ?? null,
        now,
        id,
      );
      this.addBookingEvent(id, current.status, status, reason, actor, now);
      enqueue?.();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  updateBookingSchedule(
    id: string,
    pickupAt: string,
    reservedMinutes: number | null,
    revision: number,
    reason: string,
    guard: (current: BookingRecord) => void,
    enqueue?: () => void,
  ): boolean {
    const db = this.database.connection;
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.findBookingById(id);
      if (!current) throw new HttpError(404, "Request not found.");
      if (!["requested", "confirmed"].includes(current.status))
        throw new HttpError(409, "Only pending or accepted rides can be rescheduled.");
      if (current.pickupAt === pickupAt && (current.reservedMinutes ?? null) === reservedMinutes) {
        db.exec("COMMIT");
        return false;
      }
      if ((current.scheduleRevision ?? 0) !== revision)
        throw new HttpError(409, "This ride's schedule has changed. Refresh before editing it.");
      guard(current);
      const now = new Date().toISOString();
      db.prepare(
        "UPDATE bookings SET pickup_at = ?, reserved_minutes = ?, schedule_revision = schedule_revision + 1, updated_at = ? WHERE id = ?",
      ).run(pickupAt, reservedMinutes, now, id);
      db.prepare(
        "INSERT INTO booking_schedule_events (id, booking_id, from_pickup_at, to_pickup_at, from_reserved_minutes, to_reserved_minutes, reason, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'owner', ?)",
      ).run(
        randomUUID(),
        id,
        current.pickupAt,
        pickupAt,
        current.reservedMinutes ?? null,
        reservedMinutes,
        reason,
        now,
      );
      enqueue?.();
      db.exec("COMMIT");
      return true;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  listScheduleEvents(id: string): BookingScheduleEvent[] {
    return this.database.connection
      .prepare(
        "SELECT * FROM booking_schedule_events WHERE booking_id = ? ORDER BY created_at, rowid",
      )
      .all(id)
      .map((row) => ({
        id: String(row.id),
        fromPickupAt: String(row.from_pickup_at),
        toPickupAt: String(row.to_pickup_at),
        fromReservedMinutes:
          row.from_reserved_minutes == null ? null : Number(row.from_reserved_minutes),
        toReservedMinutes: row.to_reserved_minutes == null ? null : Number(row.to_reserved_minutes),
        reason: String(row.reason),
        actor: "owner",
        createdAt: String(row.created_at),
      }));
  }

  addBookingEvent(
    id: string,
    fromStatus: BookingStatus | "",
    status: BookingStatus,
    reason: string,
    actor: string,
    now: string,
  ): void {
    const booking = this.findBookingById(id);
    if (!booking) throw new Error("Booking was not found.");
    this.database.connection
      .prepare(
        "INSERT INTO booking_events (id, booking_id, from_status, to_status, reason, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(randomUUID(), id, fromStatus, status, reason, actor, now);
  }

  listEvents(id: string): BookingStatusEvent[] {
    const rows = this.database.connection
      .prepare("SELECT * FROM booking_events WHERE booking_id = ? ORDER BY created_at")
      .all(id);
    return rows.map((row) => {
      const item = row as Row;
      return {
        fromStatus: String(item.from_status) as BookingStatus | "",
        toStatus: String(item.to_status) as BookingStatus,
        reason: String(item.reason),
        actor: String(item.actor) as BookingStatusEvent["actor"],
        createdAt: String(item.created_at),
      };
    });
  }

  toBooking(row: Row | BookingRecord): Booking {
    const record: BookingRecord = "originId" in row ? (row as BookingRecord) : toBookingRecord(row);
    const origin = this.getLocation(record.originId);
    const destination = this.getLocation(record.destinationId);
    const events = this.listEvents(record.id);
    return {
      id: record.id,
      reference: record.reference,
      accessToken: record.accessToken,
      customerName: record.customerName,
      phone: record.phone,
      email: record.email,
      whatsappNumber: record.whatsappNumber,
      whatsappConsentAt: record.whatsappConsentAt,
      whatsappOptOutAt: record.whatsappOptOutAt,
      rejectionReason: record.rejectionReason,
      offer:
        record.proposedAmountKobo === undefined
          ? undefined
          : {
              amountNaira: record.proposedAmountNaira ?? "",
              roundedAmountKobo: record.proposedAmountKobo,
              note: record.negotiationNote ?? "",
            },
      agreedAmountKobo:
        record.agreedAmountKobo ??
        (events.some((event) => event.toStatus === "confirmed") ||
        ["confirmed", "picked_up", "arrived", "completed"].includes(record.status)
          ? record.fareAmountKobo
          : undefined),
      origin,
      destination,
      pickupNote: record.pickupNote,
      pickupAt: record.pickupAt,
      reservedMinutes: record.reservedMinutes ?? null,
      scheduleRevision: record.scheduleRevision ?? 0,
      scheduleEvents: this.listScheduleEvents(record.id),
      fare: {
        ...(record.fareSnapshot ? (JSON.parse(record.fareSnapshot) as FarePreview) : {}),
        amountKobo: record.fareAmountKobo,
        currency: record.fareCurrency,
        originName: origin.name,
        destinationName: destination.name,
      },
      status: record.status,
      cancellationReason: record.cancellationReason,
      notificationStatus: record.notificationStatus,
      customerEmailStatus: this.latestCustomerEmailStatus(record.id),
      createdAt: record.createdAt,
      events,
    };
  }

  getLocation(id: string): ServiceLocation {
    const row = this.database.connection
      .prepare("SELECT * FROM service_locations WHERE id = ?")
      .get(id);
    if (!row) throw new Error("The selected location is no longer available.");
    return toLocation(row as Row);
  }

  private latestCustomerEmailStatus(id: string): EmailState | undefined {
    const row = this.database.connection
      .prepare(
        "SELECT status FROM email_deliveries WHERE booking_id = ? AND audience IN ('customer', 'both') ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(id);
    return row ? (String(row.status) as EmailState) : undefined;
  }

  listFares(): FareRule[] {
    const rows = this.database.connection
      .prepare(
        "SELECT fare_rules.*, origin.name AS origin_name, destination.name AS destination_name " +
          "FROM fare_rules JOIN service_locations origin ON origin.id = fare_rules.origin_id " +
          "JOIN service_locations destination ON destination.id = fare_rules.destination_id " +
          "ORDER BY origin.name, destination.name, effective_from DESC, fare_rules.rowid DESC",
      )
      .all();
    return rows.map((row) => toFare(row as Row));
  }

  listLocationRequests(): LocationRequest[] {
    const rows = this.database.connection
      .prepare("SELECT * FROM location_requests ORDER BY created_at DESC")
      .all();
    return rows.map((row) => toLocationRequest(row as Row));
  }

  createLocationRequest(
    input: Omit<LocationRequest, "id" | "status" | "responseNote" | "createdAt">,
  ): LocationRequest {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.database.connection
      .prepare(
        "INSERT INTO location_requests (id, requester_name, phone, location_name, landmark, maps_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        input.requesterName,
        input.phone,
        input.locationName,
        input.landmark,
        input.mapsUrl,
        createdAt,
      );
    return {
      ...input,
      id,
      status: "pending",
      responseNote: "",
      createdAt,
    };
  }

  getLocationRequest(id: string): LocationRequest {
    const row = this.database.connection
      .prepare("SELECT * FROM location_requests WHERE id = ?")
      .get(id);
    if (!row) throw new Error("Location request was not found.");
    return toLocationRequest(row as Row);
  }

  updateNotificationStatus(id: string, status: string): void {
    this.database.connection
      .prepare("UPDATE bookings SET notification_status = ?, updated_at = ? WHERE id = ?")
      .run(status, new Date().toISOString(), id);
  }

  updateLocationRequest(id: string, status: RequestStatus, responseNote: string): void {
    const request = this.database.connection
      .prepare("SELECT * FROM location_requests WHERE id = ?")
      .get(id) as Row | undefined;
    if (!request) throw new Error("Location request was not found.");
    this.database.connection
      .prepare("UPDATE location_requests SET status = ?, response_note = ? WHERE id = ?")
      .run(status, responseNote, id);
    if (status === "approved") this.publishRequestedLocation(request);
  }

  saveSchedule(input: OperatingSchedule): void {
    this.database.connection
      .prepare(
        "INSERT INTO operating_schedules (id, day_of_week, start_time, end_time, active) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET day_of_week=excluded.day_of_week, start_time=excluded.start_time, end_time=excluded.end_time, active=excluded.active",
      )
      .run(input.id, input.dayOfWeek, input.startTime, input.endTime, input.active ? 1 : 0);
  }

  saveException(input: ScheduleException): void {
    this.database.connection
      .prepare(
        "INSERT INTO schedule_exceptions (id, date, note, closed) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(date) DO UPDATE SET note=excluded.note, closed=excluded.closed",
      )
      .run(input.id, input.date, input.note, input.closed ? 1 : 0);
  }

  saveLocation(input: ServiceLocation): void {
    this.database.connection
      .prepare(
        "INSERT INTO service_locations (id, name, landmark, maps_url, coordinates, published, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET name=excluded.name, landmark=excluded.landmark, maps_url=excluded.maps_url, coordinates=excluded.coordinates, published=excluded.published",
      )
      .run(
        input.id,
        input.name,
        input.landmark,
        input.mapsUrl,
        input.coordinates,
        input.published ? 1 : 0,
        new Date().toISOString(),
      );
  }

  saveFare(input: FareRule): void {
    this.database.connection
      .prepare(
        "INSERT INTO fare_rules (id, origin_id, destination_id, amount_kobo, currency, effective_from, active) VALUES (?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET amount_kobo=excluded.amount_kobo, effective_from=excluded.effective_from, active=excluded.active",
      )
      .run(
        input.id,
        input.originId,
        input.destinationId,
        input.amountKobo,
        input.currency,
        input.effectiveFrom,
        input.active ? 1 : 0,
      );
    this.database.connection
      .prepare(
        "INSERT INTO fare_change_history (id, fare_rule_id, amount_kobo, effective_from, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(randomUUID(), input.id, input.amountKobo, input.effectiveFrom, new Date().toISOString());
  }

  private publishRequestedLocation(request: Row): void {
    this.saveLocation({
      id: `requested-${String(request.id)}`,
      name: String(request.location_name),
      landmark: String(request.landmark),
      mapsUrl: String(request.maps_url),
      coordinates: "",
      published: true,
    });
  }
}

function toLocation(row: Row): ServiceLocation {
  return {
    id: String(row.id),
    name: String(row.name),
    landmark: String(row.landmark),
    mapsUrl: String(row.maps_url),
    coordinates: String(row.coordinates),
    published: Number(row.published) === 1,
    researchId: String(row.research_id ?? ""),
    researchArea: String(row.research_area ?? ""),
    researchCategory: String(row.research_category ?? ""),
    researchSourceUrl: String(row.research_source_url ?? ""),
  };
}

function toSchedule(row: Row): OperatingSchedule {
  const dayOfWeek = Number(row.day_of_week);
  return {
    id: String(row.id),
    dayOfWeek,
    dayLabel: dayLabel(dayOfWeek),
    startTime: String(row.start_time),
    endTime: String(row.end_time),
    active: Number(row.active) === 1,
  };
}

function toException(row: Row): ScheduleException {
  return {
    id: String(row.id),
    date: String(row.date),
    note: String(row.note),
    closed: Number(row.closed) === 1,
  };
}

function toFare(row: Row): FareRule {
  return {
    id: String(row.id),
    originId: String(row.origin_id),
    destinationId: String(row.destination_id),
    amountKobo: Number(row.amount_kobo),
    roundedAmountKobo: roundNairaUpTo50(koboToNaira(Number(row.amount_kobo))),
    currency: String(row.currency),
    effectiveFrom: String(row.effective_from),
    active: Number(row.active) === 1,
    originName: String(row.origin_name ?? ""),
    destinationName: String(row.destination_name ?? ""),
  };
}

function toBookingRecord(row: Row): BookingRecord {
  return {
    id: String(row.id),
    reference: String(row.reference),
    accessToken: String(row.access_token),
    idempotencyKey: String(row.idempotency_key),
    customerName: String(row.customer_name),
    phone: String(row.phone),
    email: String(row.email ?? ""),
    whatsappNumber: String(row.whatsapp_number ?? ""),
    whatsappConsentAt: String(row.whatsapp_consent_at ?? ""),
    whatsappOptOutAt: String(row.whatsapp_opt_out_at ?? ""),
    rejectionReason: String(row.rejection_reason ?? ""),
    originId: String(row.origin_id),
    destinationId: String(row.destination_id),
    pickupNote: String(row.pickup_note),
    pickupAt: String(row.pickup_at),
    reservedMinutes: row.reserved_minutes == null ? null : Number(row.reserved_minutes),
    scheduleRevision: Number(row.schedule_revision ?? 0),
    fareAmountKobo: Number(row.fare_amount_kobo),
    fareCurrency: String(row.fare_currency),
    fareSnapshot: String(row.fare_snapshot ?? ""),
    proposedAmountNaira: String(row.proposed_amount_naira ?? ""),
    proposedAmountKobo:
      row.proposed_amount_kobo == null ? undefined : Number(row.proposed_amount_kobo),
    negotiationNote: String(row.negotiation_note ?? ""),
    agreedAmountKobo: row.agreed_amount_kobo == null ? undefined : Number(row.agreed_amount_kobo),
    status: String(row.status) as BookingStatus,
    cancellationReason: String(row.cancellation_reason),
    notificationStatus: String(row.notification_status),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toLocationRequest(row: Row): LocationRequest {
  return {
    id: String(row.id),
    requesterName: String(row.requester_name),
    phone: String(row.phone),
    locationName: String(row.location_name),
    landmark: String(row.landmark),
    mapsUrl: String(row.maps_url),
    status: String(row.status) as RequestStatus,
    responseNote: String(row.response_note),
    createdAt: String(row.created_at),
  };
}
