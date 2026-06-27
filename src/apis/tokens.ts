import { assertPublicKey, config, type TokenMint } from "../config.js";
import { isRecord, jupiterRequest } from "./client.js";

export interface TokenStats {
  priceChange: number;
  liquidityChange: number;
  volumeChange: number;
  buyVolume: number;
  sellVolume: number;
  buyOrganicVolume: number;
  sellOrganicVolume: number;
  numBuys: number;
  numSells: number;
  numTraders: number;
  numOrganicBuyers: number;
  numNetBuyers: number;
}

export interface TokenInfo {
  id: string;
  name: string;
  symbol: string;
  icon: string;
  decimals: number;
  holderCount: number;
  fdv: number;
  mcap: number;
  usdPrice: number;
  liquidity: number;
  stats5m: TokenStats | null;
  stats1h: TokenStats | null;
  stats6h: TokenStats | null;
  stats24h: TokenStats | null;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeStats(value: unknown): TokenStats | null {
  if (!isRecord(value)) return null;
  return {
    priceChange: numberOrZero(value.priceChange),
    liquidityChange: numberOrZero(value.liquidityChange),
    volumeChange: numberOrZero(value.volumeChange),
    buyVolume: numberOrZero(value.buyVolume),
    sellVolume: numberOrZero(value.sellVolume),
    buyOrganicVolume: numberOrZero(value.buyOrganicVolume),
    sellOrganicVolume: numberOrZero(value.sellOrganicVolume),
    numBuys: numberOrZero(value.numBuys),
    numSells: numberOrZero(value.numSells),
    numTraders: numberOrZero(value.numTraders),
    numOrganicBuyers: numberOrZero(value.numOrganicBuyers),
    numNetBuyers: numberOrZero(value.numNetBuyers),
  };
}

function normalizeToken(value: unknown): TokenInfo | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    name: stringOr(value.name, "Unknown"),
    symbol: stringOr(value.symbol, "???"),
    icon: stringOr(value.icon, ""),
    decimals: numberOrZero(value.decimals),
    holderCount: numberOrZero(value.holderCount),
    fdv: numberOrZero(value.fdv),
    mcap: numberOrZero(value.mcap),
    usdPrice: numberOrZero(value.usdPrice),
    liquidity: numberOrZero(value.liquidity),
    stats5m: normalizeStats(value.stats5m),
    stats1h: normalizeStats(value.stats1h),
    stats6h: normalizeStats(value.stats6h),
    stats24h: normalizeStats(value.stats24h),
  };
}

export async function searchToken(query: string): Promise<TokenInfo[]> {
  if (!query.trim()) throw new Error("Token search query cannot be empty.");
  const params = new URLSearchParams({ query: query.trim() });
  const response = await jupiterRequest<unknown>("Tokens", `${config.api.tokens}/search?${params}`);
  if (!Array.isArray(response)) throw new Error("Tokens API returned an invalid response.");
  return response.map(normalizeToken).filter((token): token is TokenInfo => token !== null);
}

export async function getTokenByMint(mint: TokenMint): Promise<TokenInfo | null> {
  assertPublicKey(mint, "Token mint");
  const results = await searchToken(mint);
  return results.find(token => token.id === mint) ?? null;
}

export interface OrganicAnalysis {
  mint: TokenMint;
  symbol: string;
  organicBuyRatio: number;
  organicSellRatio: number;
  netOrganicFlow: number;
  buyToSellRatio: number;
  isLikelyDump: boolean;
  confidence: "low" | "medium" | "high";
  reason: string;
}

export function analyzeOrganicActivity(token: TokenInfo, priceChangePct: number): OrganicAnalysis {
  const stats = token.stats1h;
  if (!stats) {
    return {
      mint: token.id,
      symbol: token.symbol,
      organicBuyRatio: 0,
      organicSellRatio: 0,
      netOrganicFlow: 0,
      buyToSellRatio: 1,
      isLikelyDump: false,
      confidence: "low",
      reason: "Tokens API did not return one-hour activity data",
    };
  }

  const organicBuyRatio = stats.buyVolume > 0 ? stats.buyOrganicVolume / stats.buyVolume : 0;
  const organicSellRatio = stats.sellVolume > 0 ? stats.sellOrganicVolume / stats.sellVolume : 0;
  const netOrganicFlow = stats.buyOrganicVolume - stats.sellOrganicVolume;
  const buyToSellRatio = stats.numSells > 0 ? stats.numBuys / stats.numSells : stats.numBuys;

  let isLikelyDump = false;
  let confidence: OrganicAnalysis["confidence"] = "low";
  let reason = "No significant downside movement";

  if (priceChangePct < -3) {
    if (organicSellRatio > 0.3 && netOrganicFlow < 0) {
      isLikelyDump = true;
      confidence = organicSellRatio > 0.5 ? "high" : "medium";
      reason = `Organic sell ratio ${(organicSellRatio * 100).toFixed(1)}%, net organic flow: $${netOrganicFlow.toFixed(0)}`;
    } else if (organicSellRatio < 0.1 && stats.numTraders < 100) {
      confidence = "medium";
      reason = `Low organic sell ratio ${(organicSellRatio * 100).toFixed(1)}%, only ${stats.numTraders} traders - likely bot noise`;
    } else if (stats.liquidityChange < -10) {
      isLikelyDump = true;
      confidence = "high";
      reason = `Liquidity dropping ${stats.liquidityChange.toFixed(1)}% - LP withdrawal detected`;
    } else {
      reason = `Mixed signals: organic sell ${(organicSellRatio * 100).toFixed(1)}%, ${stats.numTraders} traders`;
    }
  }

  return {
    mint: token.id,
    symbol: token.symbol,
    organicBuyRatio,
    organicSellRatio,
    netOrganicFlow,
    buyToSellRatio,
    isLikelyDump,
    confidence,
    reason,
  };
}
