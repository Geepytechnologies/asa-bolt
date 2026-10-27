import { HttpError } from "../errors.js";

function decimal(value: string): { numerator: bigint; scale: bigint; places: number } {
  if (!/^\d{1,12}(?:\.\d{1,18})?$/.test(value)) {
    throw new HttpError(
      400,
      "Enter a positive decimal with at most 12 whole digits and 18 decimal places.",
    );
  }
  const [whole, fraction = ""] = value.split(".");
  const numerator = BigInt(whole + fraction);
  if (numerator <= 0n)
    throw new HttpError(400, "Prices, rates, and distances must be greater than zero.");
  return { numerator, scale: 10n ** BigInt(fraction.length), places: fraction.length };
}

function formatDecimal(numerator: bigint, places: number): string {
  const digits = numerator.toString().padStart(places + 1, "0");
  if (!places) return digits;
  return `${digits.slice(0, -places)}.${digits.slice(-places)}`.replace(/\.?0+$/, "");
}

export function positiveDecimal(value: unknown, label: string): string {
  if (typeof value !== "string" && typeof value !== "number")
    throw new HttpError(400, `${label} must be a positive decimal.`);
  const text = String(value).trim();
  const parsed = decimal(text);
  return formatDecimal(parsed.numerator, parsed.places);
}

export function optionalDecimal(value: unknown, label: string): string | null {
  return value === null || value === "" || value === undefined
    ? null
    : positiveDecimal(value, label);
}

export function distanceFare(
  distance: string,
  rate: string,
): { amountKobo: number; unroundedNaira: string } {
  const a = decimal(distance);
  const b = decimal(rate);
  const numerator = a.numerator * b.numerator;
  return {
    amountKobo: roundFraction(numerator, a.scale * b.scale),
    unroundedNaira: formatDecimal(numerator, a.places + b.places),
  };
}

function roundFraction(numerator: bigint, scale: bigint): number {
  const step = 50n * scale;
  const kobo = ((numerator + step - 1n) / step) * 5000n;
  if (kobo > BigInt(Number.MAX_SAFE_INTEGER))
    throw new HttpError(400, "The resulting fare is too large.");
  return Number(kobo);
}

export function roundNairaUpTo50(value: string): number {
  const parsed = decimal(value);
  return roundFraction(parsed.numerator, parsed.scale);
}

export function nairaToKobo(value: string, label = "Fixed prices"): number {
  const parsed = decimal(value);
  if ((parsed.numerator * 100n) % parsed.scale !== 0n)
    throw new HttpError(400, `${label} can have at most two decimal places.`);
  const amount = (parsed.numerator * 100n) / parsed.scale;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new HttpError(400, "The fixed price is too large.");
  return Number(amount);
}

export function koboToNaira(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new HttpError(400, "Enter a valid positive fixed price.");
  return formatDecimal(BigInt(amount), 2);
}
