/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("ride service landing page", () => {
  it("renders the ride message and booking action", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /your city\. your ride/i })).toBeTruthy();
    expect(screen.getByText("Eastern Nigeria", { exact: true })).toBeTruthy();
    expect(screen.getByRole("link", { name: /book a ride on whatsapp/i })).toHaveAttribute(
      "href",
      "https://wa.me/2348105440033",
    );
  });
});
