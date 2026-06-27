import { assertPublicKey, config, type TokenMint } from "../config.js";
import { isRecord, jupiterRequest } from "./client.js";

export interface PriceData {
  usdPrice: number;
  priceChange24h: number;
  decimals: number;
  blockId: number;
}

export interface PriceSnapshot {
  timestamp: number;
  prices: Map<TokenMint, PriceData>;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizePriceResponse(value: unknown): Map<TokenMint, PriceData> {
  const prices = new Map<TokenMint, PriceData>();
  if (!isRecord(value)) return prices;

  for (const [mint, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    const usdPrice = finiteNumber(raw.usdPrice);
    const priceChange24h = finiteNumber(raw.priceChange24h);
    const decimals = finiteNumber(raw.decimals);
    const blockId = finiteNumber(raw.blockId);

    if (usdPrice === null || usdPrice <= 0 || priceChange24h === null || decimals === null || blockId === null) {
      continue;
    }

    prices.set(mint, { usdPrice, priceChange24h, decimals, blockId });
  }

  return prices;
}

export async function getPrices(mints: TokenMint[]): Promise<Map<TokenMint, PriceData>> {
  const uniqueMints = [...new Set(mints)];
  if (uniqueMints.length === 0) return new Map();
  if (uniqueMints.length > config.maxTokensPerPriceCall) {
    throw new Error(`Price API accepts at most ${config.maxTokensPerPriceCall} token mints per request.`);
  }

  uniqueMints.forEach(mint => assertPublicKey(mint, "Token mint"));
  const query = new URLSearchParams({ ids: uniqueMints.join(",") });
  const response = await jupiterRequest<unknown>("Price", `${config.api.price}?${query}`);
  return normalizePriceResponse(response);
}

export class PriceTracker {
  private readonly history: PriceSnapshot[] = [];

  constructor(private readonly maxHistory = 361) {}

  addSnapshot(snapshot: PriceSnapshot): void {
    this.history.push(snapshot);
    if (this.history.length > this.maxHistory) this.history.shift();
  }

  getLatest(): PriceSnapshot | undefined {
    return this.history.at(-1);
  }

  getPrevious(): PriceSnapshot | undefined {
    return this.history.at(-2);
  }

  getPriceChange(mint: TokenMint, windowMs: number): number | null {
    const latest = this.getLatest();
    if (!latest) return null;

    const cutoff = latest.timestamp - windowMs;
    let baseline: PriceSnapshot | undefined;
    for (const snapshot of this.history) {
      if (snapshot.timestamp <= cutoff) baseline = snapshot;
      else break;
    }

    const oldPrice = baseline?.prices.get(mint)?.usdPrice;
    const newPrice = latest.prices.get(mint)?.usdPrice;
    if (!oldPrice || !newPrice) return null;
    return ((newPrice - oldPrice) / oldPrice) * 100;
  }

  getVolatility(mint: TokenMint, windowMs: number): number | null {
    const latest = this.getLatest();
    if (!latest) return null;
    const relevant = this.history.filter(snapshot => snapshot.timestamp >= latest.timestamp - windowMs);
    if (relevant.length < 3) return null;

    const returns: number[] = [];
    for (let index = 1; index < relevant.length; index++) {
      const previous = relevant[index - 1]?.prices.get(mint)?.usdPrice;
      const current = relevant[index]?.prices.get(mint)?.usdPrice;
      if (previous && current) returns.push((current - previous) / previous);
    }

    if (returns.length < 2) return null;
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
    return Math.sqrt(variance) * 100;
  }

  getHistory(): PriceSnapshot[] {
    return [...this.history];
  }
}
