import type { OrganicAnalysis } from "../apis/tokens.js";
import type { TokenMint } from "../config.js";

interface HedgeActionBase {
  mint: TokenMint;
  reason: string;
}

export type HedgeAction =
  | (HedgeActionBase & { type: "hold" })
  | (HedgeActionBase & { type: "swap_to_stable"; urgency: "high" })
  | (HedgeActionBase & { type: "reduce_position"; pctToSell: number })
  | (HedgeActionBase & { type: "oco_order"; takeProfit: number; stopLoss: number })
  | (HedgeActionBase & { type: "limit_sell"; triggerPrice: number });

export interface MarketSignal {
  mint: TokenMint;
  symbol: string;
  currentPrice: number;
  priceChange1h: number | null;
  priceChange5m: number | null;
  volatility: number | null;
  organicAnalysis: OrganicAnalysis;
  liquidityUsd: number | null;
  portfolioPct: number | null;
}

type HedgeRule = (signal: MarketSignal) => HedgeAction | null;

const largeConfirmedDumpRule: HedgeRule = signal => {
  const { mint, symbol, priceChange1h, organicAnalysis } = signal;
  if (
    priceChange1h === null
    || priceChange1h >= -10
    || !organicAnalysis.isLikelyDump
    || organicAnalysis.confidence === "low"
  ) return null;

  return {
    type: "swap_to_stable",
    mint,
    reason: `URGENT ${symbol}: ${priceChange1h.toFixed(1)}% drop confirmed organic dump (${organicAnalysis.reason}). Emergency exit.`,
    urgency: "high",
  };
};

const moderateOrganicSellingRule: HedgeRule = signal => {
  const { mint, symbol, priceChange1h, organicAnalysis, portfolioPct } = signal;
  if (priceChange1h === null || priceChange1h >= -5 || !organicAnalysis.isLikelyDump) return null;
  const pctToSell = Math.min(80, Math.max(25, (portfolioPct ?? 0) * 2));
  return {
    type: "reduce_position",
    mint,
    pctToSell,
    reason: `${symbol}: ${priceChange1h.toFixed(1)}% drop with organic sell pressure. Reduce position by ${pctToSell.toFixed(0)}%.`,
  };
};

const highVolatilityPositionRule: HedgeRule = signal => {
  const { mint, symbol, currentPrice, volatility, portfolioPct } = signal;
  if (portfolioPct === null || portfolioPct <= 15 || volatility === null || volatility <= 3) return null;
  const stopLoss = currentPrice * 0.92;
  const takeProfit = currentPrice * 1.15;
  return {
    type: "oco_order",
    mint,
    takeProfit,
    stopLoss,
    reason: `${symbol}: Large position (${portfolioPct.toFixed(1)}%) with elevated volatility (${volatility.toFixed(2)}%). Prepare OCO at TP $${takeProfit.toFixed(4)} / SL $${stopLoss.toFixed(4)}.`,
  };
};

const minorDipSafetyRule: HedgeRule = signal => {
  const { mint, symbol, currentPrice, priceChange1h, organicAnalysis, portfolioPct } = signal;
  if (
    priceChange1h === null
    || priceChange1h >= -3
    || organicAnalysis.isLikelyDump
    || portfolioPct === null
    || portfolioPct <= 5
  ) return null;
  const triggerPrice = currentPrice * 0.95;
  return {
    type: "limit_sell",
    mint,
    triggerPrice,
    reason: `${symbol}: ${priceChange1h.toFixed(1)}% dip appears to be noise (${organicAnalysis.reason}). Safety limit at $${triggerPrice.toFixed(4)}.`,
  };
};

const rules: readonly HedgeRule[] = [
  largeConfirmedDumpRule,
  moderateOrganicSellingRule,
  highVolatilityPositionRule,
  minorDipSafetyRule,
];

export function evaluateHedgeStrategy(signal: MarketSignal): HedgeAction {
  for (const rule of rules) {
    const action = rule(signal);
    if (action) return action;
  }

  const price = signal.priceChange1h === null
    ? "insufficient one-hour history"
    : `${signal.priceChange1h > 0 ? "+" : ""}${signal.priceChange1h.toFixed(1)}%`;
  return {
    type: "hold",
    mint: signal.mint,
    reason: `${signal.symbol}: Price ${price}; no action required.`,
  };
}

export function formatActionPlan(actions: HedgeAction[]): string {
  const urgent = actions.filter(action => action.type === "swap_to_stable");
  const moderate = actions.filter(action => action.type === "reduce_position" || action.type === "oco_order");
  const safety = actions.filter(action => action.type === "limit_sell");
  const holds = actions.filter(action => action.type === "hold");
  const lines = ["=== Jup.ag Pulse - HEDGE ACTION PLAN ===", ""];

  if (urgent.length) {
    lines.push("URGENT ACTIONS:", ...urgent.map(action => `  ${action.reason}`), "");
  }
  if (moderate.length) {
    lines.push("RECOMMENDED ACTIONS:", ...moderate.map(action => `  ${action.reason}`), "");
  }
  if (safety.length) {
    lines.push("SAFETY ORDERS:", ...safety.map(action => `  ${action.reason}`), "");
  }
  if (holds.length) {
    lines.push(`HOLDING: ${holds.length} positions`, ...holds.map(action => `  ${action.reason}`));
  }

  lines.push("", "===========================================");
  return lines.join("\n");
}
