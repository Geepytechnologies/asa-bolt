import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookingFixture, clockNow } from "../tests/booking-fixture.js";
import { Database } from "./infrastructure/database.js";
import { Repository } from "./infrastructure/repository.js";
import { importRouteResearch } from "./infrastructure/research.js";
import { PricingService } from "./pricing.js";

const fixtures: ReturnType<typeof bookingFixture>[] = [];
const directories: string[] = [];
function setup() {
  const f = bookingFixture();
  fixtures.push(f);
  const assign = (pricingAreaId: string | null) =>
    f.pricing.saveRoute(f.route.id, {
      ...f.route,
      distanceKm: "8.12",
      published: true,
      distanceNote: "",
      pricingAreaId,
    });
  const quote = () => f.pricing.quote(f.route.originId, f.route.destinationId, "2030-01-07");
  return { ...f, assign, quote };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clockNow);
});
afterEach(async () => {
  fixtures.splice(0).forEach((f) => f.database.close());
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("route pricing areas", () => {
  it("uses the assigned area before default and rounds only the final product", () => {
    const f = setup();
    const area = f.pricing.saveArea("new", "Area A", "150.123456789123456789");
    f.assign(area.id);
    expect(f.quote()).toMatchObject({
      amountKobo: 125000,
      pricing: {
        ratePerKm: "150.123456789123456789",
        pricingAreaId: area.id,
        pricingAreaName: "Area A",
        rateSource: "area",
        unroundedNaira: "1219.00246912768246912668",
        roundingNaira: 50,
      },
    });
    f.pricing.saveSettings("999");
    expect(f.quote().amountKobo).toBe(125000);
    f.pricing.saveSettings(null);
    expect(f.quote().amountKobo).toBe(125000);
  });

  it("falls back when the area rate is blank, follows default edits, and refuses a missing fare", () => {
    const f = setup(),
      area = f.pricing.saveArea("new", "Fallback area", null);
    f.assign(area.id);
    expect(f.quote()).toMatchObject({
      amountKobo: 85000,
      pricing: {
        pricingAreaId: area.id,
        rateSource: "default",
        ratePerKm: "100",
      },
    });
    f.pricing.saveSettings("200");
    expect(f.quote().amountKobo).toBe(165000);
    f.pricing.saveArea(area.id, area.name, "150");
    expect(f.quote().amountKobo).toBe(125000);
    f.pricing.saveArea(area.id, area.name, "");
    expect(f.quote().amountKobo).toBe(165000);
    f.pricing.saveSettings(null);
    expect(() => f.quote()).toThrow("fare is unavailable");
  });

  it("prioritises the active effective fixed rule over area and default prices", () => {
    const f = setup(),
      area = f.pricing.saveArea("new", "Area A", "150");
    f.assign(area.id);
    const rule = {
      id: "fixed",
      originId: f.route.originId,
      destinationId: f.route.destinationId,
      amountKobo: 99900,
      currency: "NGN",
      effectiveFrom: "2030-01-07",
      active: true,
    };
    f.repository.saveFare(rule);
    expect(f.quote()).toMatchObject({
      amountKobo: 100000,
      pricing: {
        method: "fixed",
        rateSource: "fixed",
        ratePerKm: null,
        fixedAmountNaira: "999",
      },
    });
    f.repository.saveFare({ ...rule, effectiveFrom: "2030-01-08" });
    expect(f.quote().amountKobo).toBe(125000);
    f.repository.saveFare({ ...rule, active: false });
    expect(f.quote().amountKobo).toBe(125000);
  });

  it("keeps directions independent, preserves omitted assignments and supports explicit clearing", () => {
    const f = setup(),
      area = f.pricing.saveArea("new", "Area A", "150");
    f.assign(area.id);
    const reverse = f.pricing
      .routes()
      .find((r) => r.originId === f.route.destinationId && r.destinationId === f.route.originId)!;
    expect(reverse.pricingAreaId).toBeNull();
    expect(
      f.pricing.saveRoute(f.route.id, {
        originId: f.route.originId,
        destinationId: f.route.destinationId,
        distanceKm: "8.12",
        published: true,
        distanceNote: "distance corrected",
      }).pricingAreaId,
    ).toBe(area.id);
    f.assign(null);
    expect(f.quote()).toMatchObject({
      amountKobo: 85000,
      pricing: { pricingAreaId: null, rateSource: "default" },
    });
  });

  it("rejects invalid rates, duplicate names and unknown assignments without mutating the route", () => {
    const f = setup(),
      area = f.pricing.saveArea("new", "  Area   A  ", "150");
    expect(area.name).toBe("Area A");
    expect(() => f.pricing.saveArea("new", "area a", "200")).toThrow("already exists");
    for (const rate of ["0", "-1", "1e3", "NaN", {}, true])
      expect(() => f.pricing.saveArea(area.id, area.name, rate)).toThrow();
    for (const name of ["", " ", "x".repeat(81), null])
      expect(() => f.pricing.saveArea(area.id, name, "100")).toThrow();
    expect(() => f.pricing.saveArea("missing", "Area B", "100")).toThrow("not found");
    expect(() => f.assign("missing")).toThrow("unavailable");
    expect(f.pricing.routes().find((r) => r.id === f.route.id)?.pricingAreaId).toBeNull();
    expect(f.pricing.areas()).toEqual([area]);
  });

  it("previews unsaved area selection and rate clearing without saving either change", () => {
    const f = setup(),
      area = f.pricing.saveArea("new", "Area A", "150");
    f.assign(area.id);
    const draft = {
      originId: f.route.originId,
      destinationId: f.route.destinationId,
      date: "2030-01-07",
    };
    expect(f.pricing.preview({ ...draft, pricingAreaId: null }).amountKobo).toBe(85000);
    expect(f.pricing.preview({ ...draft, areaRatePerKm: "200" }).amountKobo).toBe(165000);
    expect(f.pricing.preview({ ...draft, areaRatePerKm: null }).pricing?.rateSource).toBe(
      "default",
    );
    expect(f.quote().amountKobo).toBe(125000);
    expect(f.pricing.areas()[0]).toEqual(area);
  });

  it("requires consent to changed quotes and freezes area name/rate and negotiated fare in saved bookings", async () => {
    const f = setup(),
      area = f.pricing.saveArea("new", "Original area", "150");
    f.assign(area.id);
    await expect(f.application.createBooking(f.input())).rejects.toMatchObject({
      status: 409,
      details: { fare: { amountKobo: 125000 } },
    });
    const saved = await f.application.createBooking(
      f.input({
        quotedAmountKobo: 125000,
        priceChoice: "negotiate",
        proposedAmountNaira: "999",
        proposedAmountKobo: 100000,
      }),
    );
    f.pricing.saveArea(area.id, "Renamed area", "200");
    expect(f.quote().amountKobo).toBe(165000);
    f.assign(null);
    f.pricing.saveSettings("300");
    const accepted = await f.application.changeStatus(saved.booking.id, "confirmed", "", "owner");
    expect(accepted).toMatchObject({
      agreedAmountKobo: 100000,
      fare: {
        amountKobo: 125000,
        pricing: {
          pricingAreaId: area.id,
          pricingAreaName: "Original area",
          ratePerKm: "150",
          rateSource: "area",
        },
      },
    });
  });

  it("migrates a pre-area database additively and persists area edits across restarts and re-imports", async () => {
    const f = setup(),
      saved = await f.application.createBooking(f.input());
    const dir = await mkdtemp(join(tmpdir(), "asa-area-migration-"));
    directories.push(dir);
    const file = join(dir, "legacy.sqlite");
    await backup(f.database.connection, file);
    const old = new DatabaseSync(file);
    old.exec("ALTER TABLE service_routes DROP COLUMN pricing_area_id; DROP TABLE pricing_areas");
    old.close();
    let areaId = "";
    for (let pass = 0; pass < 2; pass++) {
      const database = new Database(file);
      try {
        const repository = new Repository(database),
          pricing = new PricingService(database, repository);
        importRouteResearch(database);
        expect(pricing.routes()).toHaveLength(702);
        expect(repository.listBookings()[0].fare).toEqual(saved.booking.fare);
        if (pass === 0) {
          expect(pricing.routes().every((route) => route.pricingAreaId === null)).toBe(true);
          areaId = pricing.saveArea("new", "Persistent area", "150").id;
          pricing.saveRoute(f.route.id, {
            ...f.route,
            distanceKm: "8.12",
            published: true,
            pricingAreaId: areaId,
          });
        } else {
          expect(pricing.areas()).toMatchObject([
            { id: areaId, name: "Persistent area", ratePerKm: "150" },
          ]);
          expect(
            pricing.quote(f.route.originId, f.route.destinationId, "2030-01-07").amountKobo,
          ).toBe(125000);
        }
        expect(database.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        expect(database.connection.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe(
          "ok",
        );
      } finally {
        database.close();
      }
    }
  });
});
