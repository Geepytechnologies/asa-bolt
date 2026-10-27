/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    fetchCustomerSetup: vi.fn(async () => ({ locations: [], routes: [], availability: [] })),
    fetchRequestHistory: vi.fn(async () => {
      throw new Error("Verify your email");
    }),
  };
});
beforeEach(() => {
  window.history.replaceState({}, "", "/");
  localStorage.clear();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("connected portals", () => {
  it("shows email-first customer navigation and an honest unavailable-route state", async () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { name: /move with local confidence/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My requests", exact: true })).toHaveAttribute(
      "href",
      "/my-requests",
    );
    expect(await screen.findByText(/no routes are published/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /book a ride on whatsapp/i }),
    ).not.toBeInTheDocument();
  });
  it("opens private admin sign-in through navigation and direct links", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("link", { name: "Admin portal", exact: true }));
    expect(
      await screen.findByRole("heading", { name: "Admin sign-in", exact: true }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Password", { exact: true })).toHaveAttribute("type", "password");
    expect(window.location.pathname).toBe("/admin");
  });
  it("requires an email verification link before showing request history", async () => {
    window.history.replaceState({}, "", "/my-requests");
    render(<App />);
    expect(
      await screen.findByRole("button", { name: "Email me a private link" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email address", { exact: true })).toHaveAttribute(
      "type",
      "email",
    );
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });
});
