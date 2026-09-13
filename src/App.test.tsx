/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("coming soon landing page", () => {
  it("renders the brand message and contact action", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /website coming soon/i })).toBeTruthy();
    expect(screen.getByRole("img", { name: /asa express logo/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /chat on whatsapp/i })).toHaveAttribute(
      "href",
      "https://wa.me/2348105440033",
    );
  });
});
