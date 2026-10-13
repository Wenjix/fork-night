import { assertAmount, DEMO_UNIT } from "./money.ts";
import type { Amount, DemoPricingVersion, Moment } from "./types.ts";

export const CURRENT_DEMO_PRICING: DemoPricingVersion = "fixture-price-v2";

const prices = {
  "fixture-price-v1": { generationMax: 180_000, generationActual: 120_000 },
  "fixture-price-v2": { generationMax: DEMO_UNIT, generationActual: DEMO_UNIT },
} as const;

/** An existing reservation keeps the generation rate accepted in its quote. */
export function demoGenerationPricing(version: DemoPricingVersion) {
  return prices[version];
}

/** Current demo reuse costs one credit; saved v1 receipts retain their exact fees. */
export function demoReuseFee(
  moment: Moment,
  version: DemoPricingVersion = CURRENT_DEMO_PRICING,
): Amount {
  assertAmount(moment.reuseFee, "Published reuse fee");
  return version === "fixture-price-v1" || moment.reuseFee === 0
    ? moment.reuseFee
    : DEMO_UNIT;
}
