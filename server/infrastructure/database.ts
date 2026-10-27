import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class Database {
  readonly connection: DatabaseSync;

  constructor(readonly filePath: string) {
    if (filePath !== ":memory:") mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
    this.connection = new DatabaseSync(filePath);
    if (filePath !== ":memory:") chmodSync(filePath, 0o600);
    this.connection.exec(
      "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
    );
    this.connection.exec(schemaSql);
    this.connection.exec(
      schemaSql
        .slice(schemaSql.indexOf("CREATE TABLE IF NOT EXISTS notification_settings"))
        .replaceAll("notification_settings", "whatsapp_notification_settings")
        .replaceAll("email_", "whatsapp_"),
    );
    this.connection.exec(
      "CREATE INDEX IF NOT EXISTS bookings_status_pickup ON bookings(status, pickup_at)",
    );
    const routeColumns = this.connection.prepare("PRAGMA table_info(service_routes)").all();
    if (!routeColumns.some((item) => item.name === "pricing_area_id"))
      this.connection.exec(
        "ALTER TABLE service_routes ADD COLUMN pricing_area_id TEXT REFERENCES pricing_areas(id)",
      );
    const columns = this.connection.prepare("PRAGMA table_info(bookings)").all();
    for (const column of ["email", "rejection_reason"]) {
      if (!columns.some((item) => item.name === column)) {
        this.connection.exec(`ALTER TABLE bookings ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
      }
    }
    if (!columns.some((item) => item.name === "fare_snapshot"))
      this.connection.exec(
        "ALTER TABLE bookings ADD COLUMN fare_snapshot TEXT NOT NULL DEFAULT ''",
      );
    for (const [name, definition] of [
      ["proposed_amount_naira", "TEXT NOT NULL DEFAULT ''"],
      ["proposed_amount_kobo", "INTEGER"],
      ["negotiation_note", "TEXT NOT NULL DEFAULT ''"],
      ["agreed_amount_kobo", "INTEGER"],
      ["reserved_minutes", "INTEGER"],
      ["schedule_revision", "INTEGER NOT NULL DEFAULT 0"],
      ["whatsapp_number", "TEXT NOT NULL DEFAULT ''"],
      ["whatsapp_consent_at", "TEXT NOT NULL DEFAULT ''"],
      ["whatsapp_opt_out_at", "TEXT NOT NULL DEFAULT ''"],
    ]) {
      if (!columns.some((item) => item.name === name))
        this.connection.exec(`ALTER TABLE bookings ADD COLUMN ${name} ${definition}`);
    }
    const locationColumns = this.connection.prepare("PRAGMA table_info(service_locations)").all();
    for (const column of [
      "research_id",
      "research_area",
      "research_category",
      "research_source_url",
    ]) {
      if (!locationColumns.some((item) => item.name === column))
        this.connection.exec(
          `ALTER TABLE service_locations ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`,
        );
    }
    this.connection.exec(
      "CREATE INDEX IF NOT EXISTS bookings_email_created ON bookings(email, created_at DESC)",
    );
    for (const channel of ["email", "whatsapp"]) {
      const emailColumns = this.connection
        .prepare(`PRAGMA table_info(${channel}_deliveries)`)
        .all();
      for (const name of ["provider", "provider_message_id", "sender", "reply_to"]) {
        if (!emailColumns.some((item) => item.name === name))
          this.connection.exec(
            `ALTER TABLE ${channel}_deliveries ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`,
          );
      }
      this.connection.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${channel}_provider_message ON ${channel}_deliveries(provider, provider_message_id) WHERE provider_message_id != ''`,
      );
    }
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
CREATE TABLE IF NOT EXISTS booking_schedule_events (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  from_pickup_at TEXT NOT NULL,
  to_pickup_at TEXT NOT NULL,
  from_reserved_minutes INTEGER,
  to_reserved_minutes INTEGER,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS booking_schedule_event_booking ON booking_schedule_events(booking_id, created_at);
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
CREATE TABLE IF NOT EXISTS history_links (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS history_sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS history_rate_limits (
  key_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  resets_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pricing_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  default_rate_per_km TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pricing_areas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  rate_per_km TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS service_routes (
  id TEXT PRIMARY KEY,
  origin_id TEXT NOT NULL REFERENCES service_locations(id),
  destination_id TEXT NOT NULL REFERENCES service_locations(id),
  distance_km TEXT,
  published INTEGER NOT NULL DEFAULT 0,
  research_distance_km TEXT,
  source_url TEXT NOT NULL DEFAULT '',
  source_label TEXT NOT NULL DEFAULT '',
  collected_at TEXT NOT NULL DEFAULT '',
  source_pair_key TEXT NOT NULL DEFAULT '',
  source_row INTEGER,
  distance_note TEXT NOT NULL DEFAULT '',
  pricing_area_id TEXT REFERENCES pricing_areas(id),
  updated_at TEXT NOT NULL,
  UNIQUE(origin_id, destination_id),
  CHECK(origin_id != destination_id)
);
CREATE TABLE IF NOT EXISTS research_imports (
  id TEXT PRIMARY KEY,
  source_sha256 TEXT NOT NULL,
  imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS calendar_connection (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  account_id TEXT NOT NULL DEFAULT '',
  calendar_id TEXT NOT NULL DEFAULT '',
  calendar_name TEXT NOT NULL DEFAULT '',
  credentials TEXT NOT NULL DEFAULT '',
  client_hash TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  checked_at TEXT
);
CREATE TABLE IF NOT EXISTS calendar_oauth_states (
  state_hash TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  connection_revision INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS calendar_updates (
  booking_id TEXT PRIMARY KEY REFERENCES bookings(id),
  reference TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL DEFAULT '',
  calendar_id TEXT NOT NULL DEFAULT '',
  desired_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  last_error TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS calendar_update_status ON calendar_updates(status, updated_at);
CREATE TABLE IF NOT EXISTS notification_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  revision INTEGER NOT NULL,
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_deliveries (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  booking_id TEXT REFERENCES bookings(id),
  reference TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL,
  audience TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  message_text TEXT NOT NULL,
  booking_status TEXT NOT NULL DEFAULT '',
  schedule_revision INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  lease_until INTEGER,
  transport_key TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS email_delivery_booking ON email_deliveries(booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_delivery_status ON email_deliveries(status, created_at DESC);
CREATE TABLE IF NOT EXISTS email_attempts (
  delivery_id TEXT NOT NULL REFERENCES email_deliveries(id),
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  actor TEXT NOT NULL,
  error TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  PRIMARY KEY(delivery_id, attempt_number)
);
CREATE TABLE IF NOT EXISTS email_provider_events (
  id TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  delivery_id TEXT REFERENCES email_deliveries(id),
  event_type TEXT NOT NULL,
  event_at TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS email_provider_event_message ON email_provider_events(provider_message_id, event_at);
`;
