import { randomUUID } from "node:crypto";
import type { Database } from "./database.js";
import { dayLabel } from "./seed.js";
import type {
  FareRule,
  LocationRequest,
  OperatingSchedule,
  ServiceLocation,
  ScheduleException,
  Booking,
  BookingStatusEvent,
} from "../../shared/contracts.js";
import type { BookingStatus, RequestStatus } from "../../shared/config.js";

type Row = Record<string, unknown>;

export interface BookingRecord {
  id: string;
  reference: string;
  accessToken: string;
  idempotencyKey: string;
  customerName: string;
  phone: string;
  originId: string;
  destinationId: string;
  pickupNote: string;
  pickupAt: string;
  fareAmountKobo: number;
  fareCurrency: string;
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
    const row = this.database.connection
      .prepare(
        "SELECT fare_rules.*, origin.name AS origin_name, destination.name AS destination_name " +
          "FROM fare_rules JOIN service_locations origin ON origin.id = fare_rules.origin_id " +
          "JOIN service_locations destination ON destination.id = fare_rules.destination_id " +
          "WHERE origin_id = ? AND destination_id = ? AND active = 1 AND effective_from <= ? " +
          "ORDER BY effective_from DESC LIMIT 1",
      )
      .get(originId, destinationId, date);
    if (!row) throw new Error("No active fare is configured for this route.");
    return toFare(row as Row);
  }

  createBooking(record: BookingRecord): void {
    this.database.connection
      .prepare(
        "INSERT INTO bookings (id, reference, access_token, idempotency_key, customer_name, phone, " +
          "origin_id, destination_id, pickup_note, pickup_at, fare_amount_kobo, fare_currency, status, " +
          "cancellation_reason, notification_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
      );
  }

  findBookingByIdempotency(key: string): BookingRecord | undefined {
    const row = this.database.connection
      .prepare("SELECT * FROM bookings WHERE idempotency_key = ?")
      .get(key);
    return row ? toBookingRecord(row as Row) : undefined;
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

  updateBookingStatus(
    id: string,
    status: BookingStatus,
    reason: string,
    actor: string,
    now: string,
  ): void {
    const current = this.findBookingById(id);
    if (!current) throw new Error("Booking was not found.");
    this.database.connection
      .prepare(
        "UPDATE bookings SET status = ?, cancellation_reason = ?, updated_at = ? WHERE id = ?",
      )
      .run(status, reason, now, id);
    this.addBookingEvent(id, current.status, status, reason, actor, now);
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
      origin,
      destination,
      pickupNote: record.pickupNote,
      pickupAt: record.pickupAt,
      fare: {
        amountKobo: record.fareAmountKobo,
        currency: record.fareCurrency,
        originName: origin.name,
        destinationName: destination.name,
      },
      status: record.status,
      cancellationReason: record.cancellationReason,
      notificationStatus: record.notificationStatus,
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

  listFares(): FareRule[] {
    const rows = this.database.connection
      .prepare(
        "SELECT fare_rules.*, origin.name AS origin_name, destination.name AS destination_name " +
          "FROM fare_rules JOIN service_locations origin ON origin.id = fare_rules.origin_id " +
          "JOIN service_locations destination ON destination.id = fare_rules.destination_id " +
          "ORDER BY origin.name, destination.name, effective_from DESC",
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
    originId: String(row.origin_id),
    destinationId: String(row.destination_id),
    pickupNote: String(row.pickup_note),
    pickupAt: String(row.pickup_at),
    fareAmountKobo: Number(row.fare_amount_kobo),
    fareCurrency: String(row.fare_currency),
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
