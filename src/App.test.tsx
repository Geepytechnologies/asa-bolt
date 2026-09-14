/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("ride service landing page", () => {
  it("renders the ride message and booking action", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /your city\. your ride/i })).toBeTruthy();
    expect(screen.getByRole("img", { name: /asa ride logo/i })).toBeTruthy();
    expect(screen.getByText("Eastern Nigeria", { exact: true })).toBeTruthy();
    expect(screen.getByText("Reliability in every mile", { exact: true })).toBeTruthy();
    expect(screen.getByText(/abia, anambra, ebonyi, enugu, imo, delta, and beyond/i)).toBeTruthy();
    expect(screen.getByText("Airport rides", { exact: true })).toBeTruthy();
    expect(screen.getByText("Hotel rides", { exact: true })).toBeTruthy();
    expect(screen.getByText("Event bookings", { exact: true })).toBeTruthy();
    expect(screen.getByText("Intercity trips", { exact: true })).toBeTruthy();
    expect(screen.getByText("Business rides", { exact: true })).toBeTruthy();
    expect(screen.getByText("School runs", { exact: true })).toBeTruthy();
    expect(screen.getByText("Errand rides", { exact: true })).toBeTruthy();
    expect(document.querySelector(".route-vehicle")).toBeTruthy();
    expect(screen.getByRole("link", { name: /book a ride on whatsapp/i })).toHaveAttribute(
      "href",
      "https://wa.me/2348105440033",
    );
  });
});
