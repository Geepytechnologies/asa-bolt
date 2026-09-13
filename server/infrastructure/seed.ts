import { randomUUID } from "node:crypto";
import type { Database } from "./database.js";

const locations = [
  ["umuahia-central", "Umuahia Central Park", "Beside the main motor park", ""],
  ["umuahia-tower", "Umuahia Tower", "Okpara Square side", ""],
  ["isi-court", "Isi Court Junction", "Near the Aba Road turn", ""],
  ["abia-mall", "Abia Mall", "Enyimba Road entrance", ""],
];

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function seedDatabase(database: Database): void {
  const connection = database.connection;
  const count = connection.prepare("SELECT COUNT(*) AS count FROM service_locations").get() as {
    count: number;
  };
  if (count.count > 0) return;
  insertLocations(database);
  insertSchedules(database);
  insertFares(database);
}

function insertLocations(database: Database): void {
  const statement = database.connection.prepare(
    "INSERT INTO service_locations (id, name, landmark, maps_url, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  for (const [id, name, landmark, mapsUrl] of locations) {
    statement.run(id, name, `${landmark} (dummy seed data)`, mapsUrl, new Date().toISOString());
  }
}

function insertSchedules(database: Database): void {
  const statement = database.connection.prepare(
    "INSERT INTO operating_schedules (id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)",
  );
  for (const dayOfWeek of [1, 2, 3, 4, 5, 6]) {
    statement.run(`schedule-${dayOfWeek}`, dayOfWeek, "06:30", "21:00");
  }
}

function insertFares(database: Database): void {
  const statement = database.connection.prepare(
    "INSERT INTO fare_rules (id, origin_id, destination_id, amount_kobo, effective_from) VALUES (?, ?, ?, ?, ?)",
  );
  for (const origin of locations) {
    for (const destination of locations) {
      if (origin[0] === destination[0]) continue;
      const amount = 120000 + (origin[0].length + destination[0].length) * 5000;
      statement.run(
        randomUUID(),
        origin[0],
        destination[0],
        amount,
        new Date().toISOString().slice(0, 10),
      );
    }
  }
}

export function dayLabel(dayOfWeek: number): string {
  return dayNames[dayOfWeek] ?? "Unknown day";
}
