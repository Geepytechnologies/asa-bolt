import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class Database {
  readonly connection: DatabaseSync;

  constructor(filePath: string) {
    if (filePath !== ":memory:") mkdirSync(dirname(filePath), { recursive: true });
    this.connection = new DatabaseSync(filePath);
    this.connection.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.connection.exec(schemaSql);
  }

  close(): void {
    this.connection.close();
  }
}

const schemaSql = `
CREATE TABLE IF NOT EXISTS service_locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  landmark TEXT NOT NULL,
  maps_url TEXT NOT NULL DEFAULT '',
  coordinates TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS operating_schedules (
  id TEXT PRIMARY KEY,
  day_of_week INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS schedule_exceptions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL,
  closed INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS fare_rules (
  id TEXT PRIMARY KEY,
  origin_id TEXT NOT NULL REFERENCES service_locations(id),
  destination_id TEXT NOT NULL REFERENCES service_locations(id),
  amount_kobo INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  effective_from TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS fare_change_history (
  id TEXT PRIMARY KEY,
  fare_rule_id TEXT NOT NULL REFERENCES fare_rules(id),
  amount_kobo INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  origin_id TEXT NOT NULL REFERENCES service_locations(id),
  destination_id TEXT NOT NULL REFERENCES service_locations(id),
  pickup_note TEXT NOT NULL DEFAULT '',
  pickup_at TEXT NOT NULL,
  fare_amount_kobo INTEGER NOT NULL,
  fare_currency TEXT NOT NULL,
  status TEXT NOT NULL,
  cancellation_reason TEXT NOT NULL DEFAULT '',
  notification_status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS booking_events (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  from_status TEXT NOT NULL DEFAULT '',
  to_status TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS location_requests (
  id TEXT PRIMARY KEY,
  requester_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  location_name TEXT NOT NULL,
  landmark TEXT NOT NULL,
  maps_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  response_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
`;
