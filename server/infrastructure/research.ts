import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Database } from "./database.js";

interface ResearchData {
  id: string;
  workbook: string;
  sha256: string;
  collectionDate: string;
  reference: {
    baseFareNaira: string;
    baseDistanceKm: string;
    suggestedRatePerKm: string;
    approved: boolean;
  };
  locations: {
    researchId: string;
    category: string;
    area: string;
    name: string;
    mapsQuery: string;
    sourceUrl: string;
    sourceRow: number;
  }[];
  routes: {
    originResearchId: string;
    destinationResearchId: string;
    distanceKm: string;
    pairKey: string;
    sourceUrl: string;
    sourceLabel: string;
    collectedAt: string;
    sourceRow: number;
  }[];
}

export const routeResearch = JSON.parse(
  readFileSync(new URL("../data/abia-research.json", import.meta.url), "utf8"),
) as ResearchData;

export function importRouteResearch(database: Database): void {
  const db = database.connection;
  if (db.prepare("SELECT id FROM research_imports WHERE id = ?").get(routeResearch.id)) return;
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const ids = new Map<string, string>();
    for (const location of routeResearch.locations) {
      const existing = db
        .prepare(
          "SELECT id FROM service_locations WHERE research_id = ? OR lower(trim(name)) = lower(?) ORDER BY created_at LIMIT 1",
        )
        .get(location.researchId, location.name);
      const id = existing ? String(existing.id) : `research-${location.researchId.toLowerCase()}`;
      if (!existing)
        db.prepare(
          "INSERT INTO service_locations (id, name, landmark, maps_url, published, created_at) VALUES (?, ?, ?, ?, 0, ?)",
        ).run(id, location.name, location.area, location.sourceUrl, now);
      db.prepare(
        "UPDATE service_locations SET research_id = ?, research_area = ?, research_category = ?, research_source_url = ?, maps_url = CASE WHEN maps_url = '' THEN ? ELSE maps_url END WHERE id = ?",
      ).run(
        location.researchId,
        location.area,
        location.category,
        location.sourceUrl,
        location.sourceUrl,
        id,
      );
      ids.set(location.researchId, id);
    }
    // Existing fixed-fare routes keep their availability; fresh research starts unpublished.
    const legacy = db.prepare("SELECT DISTINCT origin_id, destination_id FROM fare_rules").all();
    for (const route of legacy)
      db.prepare(
        "INSERT OR IGNORE INTO service_routes (id, origin_id, destination_id, published, updated_at) VALUES (?, ?, ?, 1, ?)",
      ).run(randomUUID(), String(route.origin_id), String(route.destination_id), now);
    for (const pair of routeResearch.routes) {
      for (const [from, to] of [
        [pair.originResearchId, pair.destinationResearchId],
        [pair.destinationResearchId, pair.originResearchId],
      ]) {
        const origin = ids.get(from);
        const destination = ids.get(to);
        if (!origin || !destination) throw new Error("Research route has an unknown location.");
        db.prepare(
          "INSERT INTO service_routes (id, origin_id, destination_id, distance_km, research_distance_km, source_url, source_label, collected_at, source_pair_key, source_row, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(origin_id, destination_id) DO UPDATE SET distance_km = COALESCE(service_routes.distance_km, excluded.distance_km), research_distance_km = excluded.research_distance_km, source_url = excluded.source_url, source_label = excluded.source_label, collected_at = excluded.collected_at, source_pair_key = excluded.source_pair_key, source_row = excluded.source_row",
        ).run(
          `research-${from.toLowerCase()}-${to.toLowerCase()}`,
          origin,
          destination,
          pair.distanceKm,
          pair.distanceKm,
          pair.sourceUrl,
          pair.sourceLabel,
          pair.collectedAt,
          pair.pairKey,
          pair.sourceRow,
          now,
        );
      }
    }
    db.prepare(
      "INSERT OR IGNORE INTO pricing_settings (id, default_rate_per_km, updated_at) VALUES (1, NULL, ?)",
    ).run(now);
    db.prepare(
      "INSERT INTO research_imports (id, source_sha256, imported_at) VALUES (?, ?, ?)",
    ).run(routeResearch.id, routeResearch.sha256, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
