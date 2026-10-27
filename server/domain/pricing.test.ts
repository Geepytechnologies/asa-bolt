import { describe, expect, it } from "vitest";
import { distanceFare, roundNairaUpTo50 } from "./pricing.js";
import { previewOffer } from "./offers.js";
describe("exact upward ₦50 pricing", () => {
  it.each([
    ["812", 85000],
    ["999", 100000],
    ["850", 85000],
    ["1001", 105000],
    ["0.01", 5000],
  ])("rounds %s to %i kobo", (amount, expected) => expect(roundNairaUpTo50(amount)).toBe(expected));
  it("rounds only the final product and retains rate precision", () => {
    expect(distanceFare("8.12", "100").amountKobo).toBe(85000);
    expect(distanceFare("9.8", "1020.408163265306122448").amountKobo).toBe(1000000);
    expect(previewOffer("812.01")).toEqual({ amountNaira: "812.01", roundedAmountKobo: 85000 });
  });
  it.each(["0", "-1", "NaN", "1e3", "1.001"])("rejects invalid offer %s", (value) =>
    expect(() => previewOffer(value)).toThrow(),
  );
});
