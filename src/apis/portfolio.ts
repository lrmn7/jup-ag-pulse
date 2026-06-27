import { assertPublicKey, config } from "../config.js";
import { isRecord, jupiterRequest } from "./client.js";

export interface PortfolioPosition {
  mint: string;
  symbol: string;
  name: string;
  balance: number;
  usdValue: number;
  price: number;
  decimals: number;
  pctOfPortfolio: number;
}

export interface PortfolioSummary {
  totalValueUsd: number;
  positions: PortfolioPosition[];
  fetchedAt: number;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metadataFor(response: Record<string, unknown>, mint: string): Record<string, unknown> {
  const tokenInfo = isRecord(response.tokenInfo) ? response.tokenInfo : {};
  const solana = isRecord(tokenInfo.solana) ? tokenInfo.solana : tokenInfo;
  return isRecord(solana[mint]) ? solana[mint] : {};
}

export function normalizePortfolioResponse(value: unknown): PortfolioSummary {
  if (!isRecord(value) || !Array.isArray(value.elements)) {
    throw new Error("Portfolio API returned an invalid response.");
  }

  const positions = new Map<string, PortfolioPosition>();

  for (const element of value.elements) {
    if (!isRecord(element) || element.type !== "multiple" || !isRecord(element.data) || !Array.isArray(element.data.assets)) {
      continue;
    }

    for (const asset of element.data.assets) {
      if (!isRecord(asset) || asset.type !== "token" || asset.networkId !== "solana" || !isRecord(asset.data)) continue;
      const mint = typeof asset.data.address === "string" ? asset.data.address : null;
      const balance = finiteNumber(asset.data.amount);
      const price = finiteNumber(asset.data.price);
      if (!mint || balance === null || price === null || balance < 0 || price < 0) continue;

      const usdValue = finiteNumber(asset.value) ?? balance * price;
      const metadata = metadataFor(value, mint);
      const existing = positions.get(mint);
      if (existing) {
        existing.balance += balance;
        existing.usdValue += usdValue;
        if (price > 0) existing.price = price;
        continue;
      }

      positions.set(mint, {
        mint,
        symbol: typeof metadata.symbol === "string" ? metadata.symbol : mint.slice(0, 8),
        name: typeof metadata.name === "string" ? metadata.name : "Unknown token",
        balance,
        usdValue,
        price,
        decimals: finiteNumber(metadata.decimals) ?? 0,
        pctOfPortfolio: 0,
      });
    }
  }

  const normalized = [...positions.values()];
  const totalValueUsd = normalized.reduce((sum, position) => sum + position.usdValue, 0);
  for (const position of normalized) {
    position.pctOfPortfolio = totalValueUsd > 0 ? position.usdValue / totalValueUsd * 100 : 0;
  }
  normalized.sort((a, b) => b.usdValue - a.usdValue);

  return {
    totalValueUsd,
    positions: normalized,
    fetchedAt: finiteNumber(value.date) ?? Date.now(),
  };
}

export async function getPortfolio(wallet: string): Promise<PortfolioSummary> {
  const address = assertPublicKey(wallet, "Wallet address");
  const response = await jupiterRequest<unknown>("Portfolio", `${config.api.portfolio}/positions/${address}`);
  return normalizePortfolioResponse(response);
}

export function getPortfolioMints(portfolio: PortfolioSummary): string[] {
  return portfolio.positions.map(position => position.mint);
}
