import { BrainCircuit } from "lucide-react";
import type { BrandId } from "../../lib/brands";
import { BrandBadge, BrandStrip, Chip, type BrandSize } from "../brand-badge";
import { PAYMENT_NETWORK_NAME } from "./api.ts";

/**
 * The Night Watch's tools and networks as badges. The brand registry (src/lib/brands.ts) draws each one,
 * so a chain always arrives with its test network and a tool with its mark. The words stay in the page;
 * these sit beside them.
 */

/** What the Night Watch is built with: the one row the hero and the hosted explainer both show. */
export function NightWatchTools({ label, size = "sm", className }: { label: string; size?: BrandSize; className?: string }) {
  return <BrandStrip label={label} className={className}>
    <BrandBadge brand="privy" size={size} role="wallets" />
    <BrandBadge brand="x402" size={size} role="payments" />
    <BrandBadge brand="base" size={size} />
    <BrandBadge brand="kimi" size={size} role="co-pilot" />
    <BrandBadge brand="monad" size={size} role="releases" />
  </BrandStrip>;
}

/** "Base Sepolia" inside a sentence: the same words, with the chain's mark in front of them. */
export function PaymentChain({ label = PAYMENT_NETWORK_NAME }: { label?: string }) {
  return <BrandBadge brand="base" label={label} />;
}

const MODEL_BRANDS: [RegExp, BrandId][] = [[/kimi/i, "kimi"], [/hunyuan|\bHY\d/i, "hunyuan"]];

/** A model by the name the server reports, with its mark when the registry knows it. */
export function ModelBadge({ label }: { label: string }) {
  const brand = MODEL_BRANDS.find(([pattern]) => pattern.test(label))?.[1];
  return brand ? <BrandBadge brand={brand} label={label} /> : <Chip icon={BrainCircuit}>{label}</Chip>;
}

/** The provider every model call goes through. */
export function RouterBadge() {
  return <BrandBadge brand="tokenrouter" label="via TokenRouter" />;
}
