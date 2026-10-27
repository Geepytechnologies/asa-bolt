import type { Database } from "./database.js";

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function seedDatabase(database: Database): void {
  const connection = database.connection;
  const count = connection.prepare("SELECT COUNT(*) AS count FROM service_locations").get();
  if (Number(count?.count) > 0) return;
  const statement = connection.prepare(
    "INSERT OR IGNORE INTO operating_schedules (id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)",
  );
  for (const day of [1, 2, 3, 4, 5, 6]) statement.run(`schedule-${day}`, day, "06:30", "21:00");
}

export function dayLabel(dayOfWeek: number): string {
  return dayNames[dayOfWeek] ?? "Unknown day";
}
