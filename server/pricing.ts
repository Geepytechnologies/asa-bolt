import { randomUUID } from "node:crypto";
import { BRAND_CONFIG } from "../shared/config.js";
import type {
  FarePreview,
  PricingArea,
  PricingOverview,
  PricingSettings,
  ServiceRoute,
} from "../shared/contracts.js";
import {
  distanceFare,
  koboToNaira,
  optionalDecimal,
  nairaToKobo,
  roundNairaUpTo50,
} from "./domain/pricing.js";
import { HttpError } from "./errors.js";
import type { Database } from "./infrastructure/database.js";
import type { Repository } from "./infrastructure/repository.js";
import { routeResearch } from "./infrastructure/research.js";

type Row = Record<string, unknown>;
export interface PricingDraft {
  originId?: string;
  destinationId?: string;
  date: string;
  distanceKm?: unknown;
  defaultRatePerKm?: unknown;
  mode?: "saved" | "fixed" | "distance";
  fixedAmountNaira?: unknown;
  pricingAreaId?: unknown;
  areaRatePerKm?: unknown;
}

export class PricingService {
  constructor(
    private readonly database: Database,
    private readonly repository: Repository,
  ) {}

  settings(): PricingSettings {
    const row = this.database.connection
      .prepare("SELECT default_rate_per_km FROM pricing_settings WHERE id = 1")
      .get();
    return {
      defaultRatePerKm: row?.default_rate_per_km == null ? null : String(row.default_rate_per_km),
    };
  }

  saveSettings(value: unknown): PricingSettings {
    const rate = optionalDecimal(value, "Default rate");
    this.database.connection
      .prepare("UPDATE pricing_settings SET default_rate_per_km = ?, updated_at = ? WHERE id = 1")
      .run(rate, new Date().toISOString());
    return this.settings();
  }

  areas(): PricingArea[] {
    return this.database.connection
      .prepare("SELECT * FROM pricing_areas ORDER BY name COLLATE NOCASE, id")
      .all()
      .map((row) => toArea(row as Row));
  }

  saveArea(id: string, name: unknown, value: unknown): PricingArea {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80)
      throw new HttpError(400, "Enter an area name of 1–80 characters.");
    const normalizedName = name.trim().replace(/\s+/g, " ");
    const rate = optionalDecimal(value, "Area rate");
    const db = this.database.connection;
    if (id !== "new" && !db.prepare("SELECT id FROM pricing_areas WHERE id = ?").get(id))
      throw new HttpError(404, "Pricing area not found. Refresh the pricing controls.");
    const duplicate = db
      .prepare("SELECT id FROM pricing_areas WHERE name = ? COLLATE NOCASE AND id != ?")
      .get(normalizedName, id);
    if (duplicate) throw new HttpError(409, "A pricing area with that name already exists.");
    const savedId = id === "new" ? randomUUID() : id;
    db.prepare(
      "INSERT INTO pricing_areas (id, name, rate_per_km, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, rate_per_km=excluded.rate_per_km, updated_at=excluded.updated_at",
    ).run(savedId, normalizedName, rate, new Date().toISOString());
    return this.findArea(savedId)!;
  }

  private findArea(id: unknown): PricingArea | null {
    if (id === null) return null;
    if (typeof id !== "string" || !id)
      throw new HttpError(400, "Choose a valid pricing area or use the default rate.");
    const row = this.database.connection
      .prepare("SELECT * FROM pricing_areas WHERE id = ?")
      .get(id);
    if (!row)
      throw new HttpError(400, "That pricing area is unavailable. Refresh and choose again.");
    return toArea(row as Row);
  }

  routes(publishedOnly = false): ServiceRoute[] {
    const rows = this.database.connection
      .prepare(
        "SELECT r.*, o.name AS origin_name, d.name AS destination_name FROM service_routes r JOIN service_locations o ON o.id = r.origin_id JOIN service_locations d ON d.id = r.destination_id " +
          (publishedOnly ? "WHERE r.published = 1 AND o.published = 1 AND d.published = 1 " : "") +
          "ORDER BY o.name, d.name",
      )
      .all();
    return rows.map((row) => toRoute(row as Row));
  }

  overview(): PricingOverview {
    return {
      settings: this.settings(),
      areas: this.areas(),
      routes: this.routes(),
      fares: this.repository.listFares(),
      locations: this.repository.listLocations(),
      research: {
        workbook: routeResearch.workbook,
        sha256: routeResearch.sha256,
        collectionDate: routeResearch.collectionDate,
        locationCount: routeResearch.locations.length,
        routePairCount: routeResearch.routes.length,
        directionalRouteCount: routeResearch.routes.length * 2,
        suggestedRatePerKm: routeResearch.reference.suggestedRatePerKm,
      },
    };
  }

  quote(originId: string, destinationId: string, date: string): FarePreview {
    const route = this.findRoute(originId, destinationId);
    if (
      !route?.published ||
      !this.repository.getLocation(originId).published ||
      !this.repository.getLocation(destinationId).published
    ) {
      throw new HttpError(
        400,
        "This route is unavailable. Choose another route or request a location.",
      );
    }
    try {
      return this.preview({ originId, destinationId, date });
    } catch (error) {
      if (error instanceof HttpError && error.status === 400)
        throw new HttpError(
          400,
          "A fare is unavailable for this route and day. Choose another route or request a location.",
        );
      throw error;
    }
  }

  preview(input: PricingDraft): FarePreview {
    if (input.originId && input.originId === input.destinationId)
      throw new HttpError(400, "Choose two different locations.");
    const route =
      input.originId && input.destinationId
        ? this.findRoute(input.originId, input.destinationId)
        : undefined;
    const distance =
      "distanceKm" in input
        ? optionalDecimal(input.distanceKm, "Distance")
        : (route?.distanceKm ?? null);
    const defaultRate =
      "defaultRatePerKm" in input
        ? optionalDecimal(input.defaultRatePerKm, "Default rate")
        : this.settings().defaultRatePerKm;
    const area = this.findArea(
      "pricingAreaId" in input ? input.pricingAreaId : (route?.pricingAreaId ?? null),
    );
    const areaRate =
      "areaRatePerKm" in input
        ? optionalDecimal(input.areaRatePerKm, "Area rate")
        : (area?.ratePerKm ?? null);
    const rate = areaRate ?? defaultRate;
    const fixed =
      input.mode !== "distance" && input.originId && input.destinationId
        ? this.repository.findOptionalFare(input.originId, input.destinationId, input.date)
        : undefined;
    const fixedAmount =
      input.mode === "fixed"
        ? optionalDecimal(input.fixedAmountNaira, "Fixed price")
        : fixed
          ? koboToNaira(fixed.amountKobo)
          : null;
    if (input.mode === "fixed" && fixedAmount) nairaToKobo(fixedAmount);
    if (input.mode === "fixed" && !fixedAmount)
      throw new HttpError(400, "Enter a fixed price to preview.");
    if (!fixedAmount && (!distance || !rate))
      throw new HttpError(
        400,
        "This route has no usable price. Set a fixed price, or a distance and an area or default rate.",
      );
    const result = fixedAmount
      ? { amountKobo: roundNairaUpTo50(fixedAmount), unroundedNaira: fixedAmount }
      : distanceFare(distance!, rate!);
    return {
      amountKobo: result.amountKobo,
      currency: BRAND_CONFIG.currency,
      originName: input.originId
        ? this.repository.getLocation(input.originId).name
        : "Example pickup",
      destinationName: input.destinationId
        ? this.repository.getLocation(input.destinationId).name
        : "Example destination",
      pricing: {
        routeId: route?.id ?? "",
        method: fixedAmount ? "fixed" : "distance",
        distanceKm: distance,
        ratePerKm: fixedAmount ? null : rate,
        fixedAmountNaira: fixedAmount,
        fixedRuleId: input.mode === "fixed" ? null : (fixed?.id ?? null),
        unroundedNaira: result.unroundedNaira,
        roundingNaira: 50,
        pricingAreaId: area?.id ?? null,
        pricingAreaName: area?.name ?? null,
        rateSource: fixedAmount ? "fixed" : areaRate ? "area" : "default",
      },
    };
  }

  saveRoute(
    id: string,
    input: {
      originId: string;
      destinationId: string;
      distanceKm: unknown;
      published: boolean;
      distanceNote: string;
      pricingAreaId?: unknown;
    },
  ): ServiceRoute {
    const origin = this.repository.getLocation(input.originId);
    const destination = this.repository.getLocation(input.destinationId);
    if (origin.id === destination.id) throw new HttpError(400, "Choose two different locations.");
    const distance = optionalDecimal(input.distanceKm, "Distance");
    const existing = this.database.connection
      .prepare("SELECT * FROM service_routes WHERE id = ?")
      .get(id);
    if (id !== "new" && !existing)
      throw new HttpError(404, "Route not found. Refresh the catalogue.");
    if (
      existing &&
      (existing.origin_id !== origin.id || existing.destination_id !== destination.id)
    )
      throw new HttpError(400, "Create a new route to change its locations.");
    if (!existing && this.findRoute(origin.id, destination.id))
      throw new HttpError(409, "That direction already exists. Search for it in the catalogue.");
    const area = this.findArea(
      "pricingAreaId" in input ? input.pricingAreaId : (existing?.pricing_area_id ?? null),
    );
    const savedId = existing ? id : randomUUID();
    const db = this.database.connection;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT INTO service_routes (id, origin_id, destination_id, distance_km, published, distance_note, pricing_area_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET distance_km=excluded.distance_km, published=excluded.published, distance_note=excluded.distance_note, pricing_area_id=excluded.pricing_area_id, updated_at=excluded.updated_at",
      ).run(
        savedId,
        origin.id,
        destination.id,
        distance,
        input.published ? 1 : 0,
        input.distanceNote.trim().slice(0, 500),
        area?.id ?? null,
        new Date().toISOString(),
      );
      if (input.published)
        db.prepare("UPDATE service_locations SET published = 1 WHERE id IN (?, ?)").run(
          origin.id,
          destination.id,
        );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return this.findRoute(origin.id, destination.id)!;
  }

  private findRoute(originId: string, destinationId: string): ServiceRoute | undefined {
    const row = this.database.connection
      .prepare(
        "SELECT r.*, o.name AS origin_name, d.name AS destination_name FROM service_routes r JOIN service_locations o ON o.id = r.origin_id JOIN service_locations d ON d.id = r.destination_id WHERE r.origin_id = ? AND r.destination_id = ?",
      )
      .get(originId, destinationId);
    return row ? toRoute(row as Row) : undefined;
  }
}

function toRoute(row: Row): ServiceRoute {
  return {
    id: String(row.id),
    originId: String(row.origin_id),
    destinationId: String(row.destination_id),
    originName: String(row.origin_name),
    destinationName: String(row.destination_name),
    distanceKm: row.distance_km == null ? null : String(row.distance_km),
    published: Number(row.published) === 1,
    researchDistanceKm: row.research_distance_km == null ? null : String(row.research_distance_km),
    sourceUrl: String(row.source_url),
    sourceLabel: String(row.source_label),
    collectedAt: String(row.collected_at),
    sourcePairKey: String(row.source_pair_key),
    sourceRow: row.source_row == null ? null : Number(row.source_row),
    distanceNote: String(row.distance_note),
    pricingAreaId: row.pricing_area_id == null ? null : String(row.pricing_area_id),
  };
}

function toArea(row: Row): PricingArea {
  return {
    id: String(row.id),
    name: String(row.name),
    ratePerKm: row.rate_per_km == null ? null : String(row.rate_per_km),
  };
}
