import { evaluateHedgeStrategy, formatActionPlan, type HedgeAction, type MarketSignal } from "./agent/strategy.js";
import { getPrices } from "./apis/price.js";
import { getSwapOrder } from "./apis/swap.js";
import { analyzeOrganicActivity, getTokenByMint } from "./apis/tokens.js";
import { config, requireJupiterApiKey } from "./config.js";

async function demo(): Promise<void> {
  requireJupiterApiKey();
  console.log("Jup.ag Pulse - SAFE DEMO");
  console.log("Live market analysis; no wallet, signing, or transaction submission.\n");

  const entries = Object.entries(config.tokens);
  const mints = entries.map(([, mint]) => mint);
  const prices = await getPrices(mints);

  console.log("1. Price API");
  for (const [symbol, mint] of entries) {
    const price = prices.get(mint);
    console.log(price
      ? `  ${symbol.padEnd(6)} $${price.usdPrice.toFixed(6).padStart(14)}  24h: ${price.priceChange24h >= 0 ? "+" : ""}${price.priceChange24h.toFixed(2)}%`
      : `  ${symbol.padEnd(6)} price unavailable or omitted as unreliable`);
  }

  console.log("\n2. Tokens API and strategy");
  const actions: HedgeAction[] = [];
  for (const [configuredSymbol, mint] of entries) {
    const price = prices.get(mint);
    if (!price) continue;

    try {
      const token = await getTokenByMint(mint);
      if (!token) {
        console.log(`  ${configuredSymbol}: token metadata unavailable`);
        continue;
      }

      const oneHourChange = token.stats1h?.priceChange ?? null;
      const organic = analyzeOrganicActivity(token, oneHourChange ?? price.priceChange24h);
      console.log(
        `  ${token.symbol}: organic sell ${(organic.organicSellRatio * 100).toFixed(1)}%, `
        + `dump=${organic.isLikelyDump ? "yes" : "no"} (${organic.confidence})`,
      );

      const signal: MarketSignal = {
        mint,
        symbol: token.symbol,
        currentPrice: price.usdPrice,
        priceChange1h: oneHourChange,
        priceChange5m: token.stats5m?.priceChange ?? null,
        volatility: null,
        organicAnalysis: organic,
        liquidityUsd: token.liquidity || null,
        portfolioPct: 100 / entries.length,
      };
      actions.push(evaluateHedgeStrategy(signal));
    } catch (error) {
      console.log(`  ${configuredSymbol}: analysis unavailable (${String(error)})`);
    }
  }

  console.log(`\n${formatActionPlan(actions)}`);
  console.log("\n3. Swap V2 quote-only request");
  try {
    const order = await getSwapOrder({
      inputMint: config.tokens.SOL,
      outputMint: config.tokens.USDC,
      amount: "10000000",
    });
    console.log(`  0.01 SOL -> ${(Number(order.outAmount) / 1e6).toFixed(4)} USDC`);
    console.log(`  Router: ${order.router}; mode: ${order.mode}; impact: ${order.priceImpactPct}%`);
    console.log("  Quote only: no taker was supplied, so no transaction can be signed or submitted.");
  } catch (error) {
    console.log(`  Quote unavailable (${String(error)})`);
  }

  console.log("\n4. Trigger V2 capability");
  console.log("  Trigger helpers expose authentication, vault, deposit, order, cancellation, and history steps.");
  console.log("  The demo does not authenticate, sign deposits, or create orders.");
}

demo().catch(error => {
  console.error(`Demo failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
