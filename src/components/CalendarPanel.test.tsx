/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarOverview } from "../../shared/calendar";
import { apiFetch } from "../api";
import { CalendarPanel } from "./CalendarPanel";
vi.mock("../api", () => ({ apiFetch: vi.fn() }));
let overview: CalendarOverview;
beforeEach(() => {
  window.history.replaceState(null, "", "/admin");
  overview = {
    configured: false,
    connected: false,
    ready: false,
    missing: [
      "GOOGLE_CALENDAR_CLIENT_ID",
      "GOOGLE_CALENDAR_CLIENT_SECRET",
      "ASA_BOLT_CALENDAR_TOKEN_KEY",
    ],
    account: "",
    calendarId: "",
    calendarName: "",
    revision: 0,
    lastCheckedAt: null,
    lastError: "",
    callbackUrl: "http://localhost:5173/api/calendar/google/callback",
    updates: [],
    counts: { awaiting_setup: 0, queued: 0, syncing: 0, synced: 0, cancelled: 0, failed: 0 },
  };
  vi.mocked(apiFetch).mockImplementation(async (path) => {
    if (path === "/owner/calendar/calendars")
      return [{ id: "dispatch", name: "Asa Ride", primary: false }] as never;
    return structuredClone(overview) as never;
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("calendar administration", () => {
  it("shows configuration placeholders without claiming connection or allowing OAuth", async () => {
    render(<CalendarPanel token="fixture-token" />);
    expect(await screen.findByRole("heading", { name: "Not configured" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Google Calendar" })).toBeDisabled();
    expect(screen.getByText("GOOGLE_CALENDAR_CLIENT_ID")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Ride calendar" })).not.toBeInTheDocument();
    expect(vi.mocked(apiFetch).mock.calls.every(([path]) => path === "/owner/calendar")).toBe(true);
  });
  it("loads writable calendars and saves the chosen destination with its settings revision", async () => {
    Object.assign(overview, {
      configured: true,
      connected: true,
      missing: [],
      account: "owner@example.test",
      revision: 4,
    });
    render(<CalendarPanel token="fixture-token" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Check connection & load calendars" }),
    );
    fireEvent.change(await screen.findByRole("combobox", { name: "Ride calendar" }), {
      target: { value: "dispatch" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save ride calendar" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save ride calendar" }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/owner/calendar/settings", {
        method: "PATCH",
        headers: { Authorization: "Bearer fixture-token" },
        body: { calendarId: "dispatch", expectedRevision: 4 },
      }),
    );
  });
  it("retries only the failed update with its latest revision and no booking mutation", async () => {
    Object.assign(overview, {
      configured: true,
      connected: true,
      ready: true,
      missing: [],
      account: "owner@example.test",
      calendarId: "dispatch",
      calendarName: "Asa Ride",
    });
    overview.counts.failed = 1;
    overview.updates = [
      {
        bookingId: "ride-a",
        reference: "ASA-TEST-1",
        eventId: "event-a",
        calendarId: "dispatch",
        status: "failed",
        revision: 3,
        attempts: 2,
        lastError: "Google unavailable",
        updatedAt: "2030-01-01T10:00:00Z",
        retryable: true,
      },
    ];
    render(<CalendarPanel token="fixture-token" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry calendar update for ASA-TEST-1" }),
    );
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/owner/calendar/updates/ride-a/retry", {
        method: "POST",
        headers: { Authorization: "Bearer fixture-token" },
        body: { expectedRevision: 3 },
      }),
    );
    expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path.includes("/bookings"))).toBe(false);
  });
});
