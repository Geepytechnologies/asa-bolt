export { hasAcceptedFare, agreedFareAmount } from "../shared/booking-pricing";

export function formatNaira(amountKobo: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(amountKobo / 100);
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  }).format(new Date(value));
}

export function statusLabel(status: string): string {
  if (status === "requested") return "Pending approval";
  if (status === "confirmed") return "Accepted";
  return status.replace("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}
