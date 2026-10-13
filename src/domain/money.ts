import type { Amount } from "./types.ts";

/** One fictional demo credit has six decimal places. No redemption is implied. */
export const DEMO_UNIT = 1_000_000;

export function assertAmount(
  value: number,
  label = "Amount",
): asserts value is Amount {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `${label} must be a nonnegative safe integer in demo-credit units.`,
    );
  }
}

export function addAmounts(...values: Amount[]): Amount {
  return values.reduce((sum, value) => {
    assertAmount(value);
    const result = sum + value;
    assertAmount(result, "Total");
    return result;
  }, 0);
}

export function subtractAmount(value: Amount, deduction: Amount): Amount {
  assertAmount(value);
  assertAmount(deduction);
  if (deduction > value)
    throw new Error("The deduction exceeds the available amount.");
  return value - deduction;
}

/** Parse decimal text exactly; never round a financial input through binary floats. */
export function parseCredits(value: string): Amount {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match)
    throw new Error(
      "Enter a positive credit amount with at most six decimal places.",
    );
  const units =
    BigInt(match[1]) * BigInt(DEMO_UNIT) +
    BigInt((match[2] ?? "").padEnd(6, "0"));
  if (units > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("The amount is too large.");
  return Number(units);
}

/** Whole credits without trailing decimals; exact fractional receipts stay visible. */
export function formatCredits(value: Amount): string {
  assertAmount(value);
  const whole = Math.floor(value / DEMO_UNIT);
  const fraction = String(value % DEMO_UNIT)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}
