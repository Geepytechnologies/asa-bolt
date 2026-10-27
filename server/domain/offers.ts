import type { OfferPreview } from "../../shared/contracts.js";
import { nairaToKobo, positiveDecimal, roundNairaUpTo50 } from "./pricing.js";

export function previewOffer(value: unknown): OfferPreview {
  const amountNaira = positiveDecimal(value, "Your offer");
  nairaToKobo(amountNaira, "Offers");
  return { amountNaira, roundedAmountKobo: roundNairaUpTo50(amountNaira) };
}
