import assert from "node:assert/strict";
import test from "node:test";
import { evaluateHedgeStrategy, type MarketSignal } from "../src/agent/strategy.js";

const mint = "So11111111111111111111111111111111111111112";

function signal(overrides: Partial<MarketSignal> = {}): MarketSignal {
  return {
    mint,
    symbol: "SOL",
    currentPrice: 100,
    priceChange1h: 0,
    priceChange5m: 0,
    volatility: 1,
    liquidityUsd: 1_000_000,
    portfolioPct: 10,
    organicAnalysis: {
      mint,
      symbol: "SOL",
      organicBuyRatio: 0.2,
      organicSellRatio: 0.2,
      netOrganicFlow: 0,
      buyToSellRatio: 1,
      isLikelyDump: false,
      confidence: "low",
      reason: "mixed",
    },
    ...overrides,
  };
}

test("large confirmed dump has highest precedence", () => {
  const action = evaluateHedgeStrategy(signal({
    priceChange1h: -11,
    volatility: 5,
    portfolioPct: 30,
    organicAnalysis: {
      ...signal().organicAnalysis,
      isLikelyDump: true,
      confidence: "high",
    },
  }));
  assert.equal(action.type, "swap_to_stable");
});

test("moderate organic selling reduces the position", () => {
  const action = evaluateHedgeStrategy(signal({
    priceChange1h: -6,
    organicAnalysis: {
      ...signal().organicAnalysis,
      isLikelyDump: true,
      confidence: "medium",
    },
  }));
  assert.equal(action.type, "reduce_position");
  if (action.type === "reduce_position") assert.equal(action.pctToSell, 25);
});

test("large volatile position produces an OCO plan", () => {
  const action = evaluateHedgeStrategy(signal({ portfolioPct: 20, volatility: 4 }));
  assert.equal(action.type, "oco_order");
});

test("minor non-organic dip produces a safety limit plan", () => {
  const action = evaluateHedgeStrategy(signal({ priceChange1h: -4, portfolioPct: 10 }));
  assert.equal(action.type, "limit_sell");
});

test("unknown history and portfolio fail closed to hold", () => {
  const action = evaluateHedgeStrategy(signal({ priceChange1h: null, portfolioPct: null, volatility: 9 }));
  assert.equal(action.type, "hold");
});

test("normal market conditions hold", () => {
  assert.equal(evaluateHedgeStrategy(signal()).type, "hold");
});
