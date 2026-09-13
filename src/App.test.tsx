/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("customer shell", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const body = url.includes("/locations")
          ? [
              {
                id: "origin",
                name: "Central Park",
                landmark: "Main gate",
                mapsUrl: "",
                coordinates: "",
                published: true,
              },
              {
                id: "destination",
                name: "Tower",
                landmark: "Square",
                mapsUrl: "",
                coordinates: "",
                published: true,
              },
            ]
          : {
              date: "2026-08-17",
              available: true,
              windows: [
                { date: "2026-08-17", startTime: "06:30", endTime: "21:00", label: "Monday" },
              ],
              exceptions: [],
            };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
  });

  it("renders the phone-first booking shell", async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /where are you headed/i })).toBeTruthy(),
    );
    expect(screen.getAllByLabelText(/phone number/i).length).toBeGreaterThanOrEqual(1);
  });
});
