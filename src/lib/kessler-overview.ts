import { KESSLER_ROOM_ID } from "./kessler-room.ts";

export type KesslerOverview = {
  roomId: typeof KESSLER_ROOM_ID;
  checkedAt: string;
  credits: { enabled: boolean; available: number };
  story: { moments: number; prepared: number; contributors: number; published: number };
  wren: {
    enabled: boolean; published: number; fundingEnabled: boolean;
    payer: string; accessKey: string; authorizationTx: string; expiresAt: string; allowanceAtomic: string;
    payments: { transaction: string; amount: string; credits: number; recordedAt: string }[];
  };
};

const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const hex = (value: unknown, length: number): value is string => typeof value === "string" && new RegExp(`^0x[0-9a-fA-F]{${length}}$`).test(value);

export function parseKesslerOverview(value: unknown): KesslerOverview | null {
  const root = object(value), credits = object(root?.credits), story = object(root?.story), wren = object(root?.wren);
  if (!root || root.roomId !== KESSLER_ROOM_ID || !date(root.checkedAt) || !credits || !story || !wren
    || typeof credits.enabled !== "boolean" || !count(credits.available)
    || ![story.moments, story.prepared, story.contributors, story.published].every(count)
    || Number(story.prepared) + Number(story.published) !== story.moments || Number(story.contributors) > Number(story.published)
    || typeof wren.enabled !== "boolean" || typeof wren.fundingEnabled !== "boolean" || !count(wren.published)
    || Number(wren.published) > Number(story.published)
    || !hex(wren.payer, 40) || !hex(wren.accessKey, 40) || !hex(wren.authorizationTx, 64)
    || !date(wren.expiresAt) || wren.allowanceAtomic !== "2000000" || !Array.isArray(wren.payments)) return null;
  const payments: KesslerOverview["wren"]["payments"] = [];
  const seen = new Set<string>();
  for (const raw of wren.payments) {
    const payment = object(raw);
    if (!payment || !hex(payment.transaction, 64) || payment.amount !== "1000000" || payment.credits !== 5
      || !date(payment.recordedAt) || seen.has(payment.transaction.toLowerCase())) return null;
    seen.add(payment.transaction.toLowerCase());
    payments.push({ transaction: payment.transaction, amount: payment.amount, credits: 5, recordedAt: payment.recordedAt });
  }
  return {
    roomId: KESSLER_ROOM_ID, checkedAt: root.checkedAt,
    credits: { enabled: credits.enabled, available: credits.available },
    story: { moments: Number(story.moments), prepared: Number(story.prepared), contributors: Number(story.contributors), published: Number(story.published) },
    wren: { enabled: wren.enabled, published: wren.published, fundingEnabled: wren.fundingEnabled,
      payer: wren.payer, accessKey: wren.accessKey, authorizationTx: wren.authorizationTx,
      expiresAt: wren.expiresAt, allowanceAtomic: wren.allowanceAtomic, payments },
  };
}

export type KesslerWrenState = "loading" | "unavailable" | "paused" | "needs-credits" | "enabled";

export function kesslerWrenState(overview: KesslerOverview, now = Date.now()): KesslerWrenState {
  if (!overview.wren.enabled || !overview.credits.enabled) return "paused";
  if (overview.credits.available > 0) return "enabled";
  return overview.wren.fundingEnabled && Date.parse(overview.wren.expiresAt) > now ? "enabled" : "needs-credits";
}
