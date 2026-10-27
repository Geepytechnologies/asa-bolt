/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PricingOverview } from "../../shared/contracts";
import { apiFetch } from "../api";
import { PricingPanel } from "./PricingPanel";

vi.mock("../api", () => ({ apiFetch: vi.fn() }));
let overview: PricingOverview;
beforeEach(() => {
  overview = {
    settings: { defaultRatePerKm: "100" },
    areas: [{ id: "area-a", name: "Area A", ratePerKm: "150" }],
    routes: [
      {
        id: "route-a",
        originId: "pickup",
        destinationId: "destination",
        originName: "Pickup",
        destinationName: "Destination",
        distanceKm: "8.12",
        published: true,
        pricingAreaId: null,
        researchDistanceKm: null,
        sourceUrl: "",
        sourceLabel: "",
        sourcePairKey: "",
        collectedAt: "",
        sourceRow: null,
        distanceNote: "",
      },
    ],
    fares: [],
    locations: ["pickup", "destination"].map((id) => ({
      id,
      name: id === "pickup" ? "Pickup" : "Destination",
      landmark: "",
      mapsUrl: "",
      coordinates: "",
      published: true,
    })),
    research: {
      workbook: "research.xlsx",
      sha256: "fixture",
      collectionDate: "2026-09-14",
      locationCount: 2,
      routePairCount: 1,
      directionalRouteCount: 2,
      suggestedRatePerKm: "100",
    },
  };
  vi.mocked(apiFetch).mockImplementation(async (path, options) => {
    const body = options?.body as Record<string, unknown> | undefined;
    if (path === "/owner/pricing") return structuredClone(overview) as never;
    if (path === "/owner/pricing/preview")
      return {
        amountKobo: 125000,
        currency: "NGN",
        originName: "Pickup",
        destinationName: "Destination",
        pricing: {
          method: "distance",
          rateSource: body?.areaRatePerKm === null ? "default" : "area",
          pricingAreaName: "Area A",
          distanceKm: "8.12",
          ratePerKm: "150",
          unroundedNaira: "1218",
        },
      } as never;
    if (path === "/owner/pricing/areas/area-a") {
      overview.areas[0] = {
        ...overview.areas[0],
        name: String(body!.name),
        ratePerKm: body!.ratePerKm as string | null,
      };
      return structuredClone(overview.areas[0]) as never;
    }
    if (path === "/owner/routes/route-a") {
      overview.routes[0].pricingAreaId = body!.pricingAreaId as string | null;
      return structuredClone(overview.routes[0]) as never;
    }
    throw new Error(`Unexpected test request: ${path}`);
  });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("area pricing controls", () => {
  it("clears an area rate explicitly to enable the default fallback", async () => {
    render(<PricingPanel token="fixture-token" onSaved={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Choose an area to edit"), {
      target: { value: "area-a" },
    });
    const region = screen.getByRole("region", { name: "Pricing areas" });
    fireEvent.change(within(region).getByLabelText("Area rate (₦/km)"), { target: { value: "" } });
    await within(region).findByText(/Area A has no area rate/);
    fireEvent.click(within(region).getByRole("button", { name: "Save pricing area" }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/owner/pricing/areas/area-a", {
        method: "PATCH",
        headers: { Authorization: "Bearer fixture-token" },
        body: { name: "Area A", ratePerKm: null },
      }),
    );
    await screen.findByRole("option", { name: "Area A · Default rate" });
  });

  it("previews an unsaved assignment and sends it only when the route is saved", async () => {
    render(<PricingPanel token="fixture-token" onSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Pickup → Destination/ }));
    fireEvent.change(screen.getByLabelText("Pricing area", { exact: true }), {
      target: { value: "area-a" },
    });
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/owner/pricing/preview",
        expect.objectContaining({
          body: expect.objectContaining({ pricingAreaId: "area-a", distanceKm: "8.12" }),
        }),
      ),
    );
    expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path === "/owner/routes/route-a")).toBe(
      false,
    );
    const save = screen.getByRole("button", { name: "Save route", exact: true });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/owner/routes/route-a",
        expect.objectContaining({
          method: "PATCH",
          body: expect.objectContaining({ pricingAreaId: "area-a" }),
        }),
      ),
    );
    await screen.findByRole("button", { name: /Pricing area: Area A/ });
  });
});
