import dotenv from "dotenv";
import { PublicKey } from "@solana/web3.js";

dotenv.config({ quiet: true });

export const config = {
  jupiterApiKey: process.env.JUPITER_API_KEY?.trim() ?? "",
  walletAddress: process.env.WALLET_ADDRESS?.trim() ?? "",

  api: {
    price: "https://api.jup.ag/price/v3",
    tokens: "https://api.jup.ag/tokens/v2",
    swap: "https://api.jup.ag/swap/v2",
    trigger: "https://api.jup.ag/trigger/v2",
    portfolio: "https://api.jup.ag/portfolio/v1",
  },

  pollIntervalMs: 10_000,
  maxTokensPerPriceCall: 50,

  tokens: {
    SOL: "So11111111111111111111111111111111111111112",
    USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  },
} as const;

export type TokenMint = string;

export function requireJupiterApiKey(): string {
  if (!config.jupiterApiKey) {
    throw new Error("Missing JUPITER_API_KEY. Copy .env.example to .env and add a Jupiter API key.");
  }
  return config.jupiterApiKey;
}

export function assertPublicKey(value: string, label: string): string {
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw new Error(`${label} must be a valid Solana public key.`);
  }
}

export function assertPositiveAmount(value: string, label: string): string {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`${label} must be a positive integer in the token's smallest unit.`);
  }
  return value;
}
