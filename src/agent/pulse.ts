import { assertPublicKey, config } from "../config.js";
import { getPortfolio, getPortfolioMints, type PortfolioPosition, type PortfolioSummary } from "../apis/portfolio.js";
import { getPrices, PriceTracker, type PriceSnapshot } from "../apis/price.js";
import { formatSwapSummary, getSwapOrder } from "../apis/swap.js";
import { analyzeOrganicActivity, getTokenByMint, type OrganicAnalysis, type TokenInfo } from "../apis/tokens.js";
import { evaluateHedgeStrategy, formatActionPlan, type HedgeAction, type MarketSignal } from "./strategy.js";

export interface PulseEvent {
  timestamp: number;
  type: "price_check" | "signal_detected" | "action_planned" | "action_prepared" | "error";
  message: string;
  data?: unknown;
}

export type PulseMode = "monitor" | "simulate" | "live";

export interface PulseAgentOptions {
  mode: PulseMode;
  monitoredMints?: string[];
  walletAddress?: string;
  onEvent?: (event: PulseEvent) => void;
}

function unavailableOrganicAnalysis(mint: string): OrganicAnalysis {
  return {
    mint,
    symbol: "???",
    organicBuyRatio: 0,
    organicSellRatio: 0,
    netOrganicFlow: 0,
    buyToSellRatio: 1,
    isLikelyDump: false,
    confidence: "low",
    reason: "Token activity data unavailable",
  };
}

export class PulseAgent {
  private readonly priceTracker = new PriceTracker();
  private readonly events: PulseEvent[] = [];
  private readonly mode: PulseMode;
  private readonly walletAddress: string;
  private readonly onEvent: (event: PulseEvent) => void;
  private monitoredMints: string[];
  private portfolio: PortfolioSummary | null = null;
  private portfolioLoaded = false;
  private lastActions: HedgeAction[] = [];

  constructor(options: PulseAgentOptions) {
    this.mode = options.mode;
    this.walletAddress = options.walletAddress
      ? assertPublicKey(options.walletAddress, "Wallet address")
      : "";
    this.monitoredMints = [...new Set(options.monitoredMints ?? Object.values(config.tokens))];
    this.monitoredMints.forEach(mint => assertPublicKey(mint, "Monitored token mint"));
    this.onEvent = options.onEvent ?? (event => {
      console.log(`[${new Date(event.timestamp).toISOString()}] ${event.type}: ${event.message}`);
    });
  }

  private emit(type: PulseEvent["type"], message: string, data?: unknown): void {
    const event: PulseEvent = {
      timestamp: Date.now(),
      type,
      message,
      ...(data === undefined ? {} : { data }),
    };
    this.events.push(event);
    this.onEvent(event);
  }

  private async loadPortfolio(): Promise<void> {
    if (this.portfolioLoaded) return;
    this.portfolioLoaded = true;
    if (!this.walletAddress) return;

    try {
      this.portfolio = await getPortfolio(this.walletAddress);
      this.emit(
        "price_check",
        `Portfolio loaded: $${this.portfolio.totalValueUsd.toFixed(2)} across ${this.portfolio.positions.length} token positions`,
      );
      this.monitoredMints = [...new Set([...this.monitoredMints, ...getPortfolioMints(this.portfolio)])];
    } catch (error) {
      this.emit("error", `Portfolio unavailable; continuing with configured tokens. ${String(error)}`);
    }
  }

  async runCycle(): Promise<HedgeAction[]> {
    await this.loadPortfolio();
    const actions: HedgeAction[] = [];

    try {
      const prices = await getPrices(this.monitoredMints);
      const missing = this.monitoredMints.filter(mint => !prices.has(mint));
      const snapshot: PriceSnapshot = { timestamp: Date.now(), prices };
      this.priceTracker.addSnapshot(snapshot);
      this.emit(
        "price_check",
        `Fetched ${prices.size}/${this.monitoredMints.length} prices${missing.length ? `; ${missing.length} unavailable` : ""}`,
      );

      if (!this.priceTracker.getPrevious()) {
        this.emit("price_check", "First snapshot collected; waiting for another cycle before evaluating movement.");
        this.lastActions = actions;
        return actions;
      }

      for (const mint of this.monitoredMints) {
        const currentPrice = prices.get(mint);
        if (!currentPrice) continue;

        const priceChange1h = this.priceTracker.getPriceChange(mint, 60 * 60 * 1_000);
        const priceChange5m = this.priceTracker.getPriceChange(mint, 5 * 60 * 1_000);
        const volatility = this.priceTracker.getVolatility(mint, 30 * 60 * 1_000);
        const shortTermChange = priceChange5m ?? currentPrice.priceChange24h;

        if (Math.abs(shortTermChange) < 2) {
          actions.push({
            type: "hold",
            mint,
            reason: `${mint.slice(0, 8)}... stable at $${currentPrice.usdPrice.toFixed(4)}.`,
          });
          continue;
        }

        this.emit("signal_detected", `${mint.slice(0, 8)}... moved ${shortTermChange.toFixed(1)}%.`);
        let tokenInfo: TokenInfo | null = null;
        try {
          tokenInfo = await getTokenByMint(mint);
        } catch (error) {
          this.emit("error", `Token activity unavailable for ${mint.slice(0, 8)}... ${String(error)}`);
        }

        const organicAnalysis = tokenInfo
          ? analyzeOrganicActivity(tokenInfo, shortTermChange)
          : unavailableOrganicAnalysis(mint);
        const portfolioPosition = this.portfolio?.positions.find(position => position.mint === mint) ?? null;
        const signal: MarketSignal = {
          mint,
          symbol: tokenInfo?.symbol ?? mint.slice(0, 8),
          currentPrice: currentPrice.usdPrice,
          priceChange1h,
          priceChange5m,
          volatility,
          organicAnalysis,
          liquidityUsd: tokenInfo?.liquidity ?? null,
          portfolioPct: portfolioPosition?.pctOfPortfolio ?? null,
        };

        const action = evaluateHedgeStrategy(signal);
        actions.push(action);
        this.emit("action_planned", action.reason, { action, signal });

        if (this.mode === "live" && action.type === "swap_to_stable") {
          await this.prepareSwapToStable(mint, portfolioPosition, currentPrice.decimals);
        }
      }

      if (actions.length) this.emit("action_planned", formatActionPlan(actions), { actions });
    } catch (error) {
      this.emit("error", `Monitoring cycle failed. ${String(error)}`);
    }

    this.lastActions = actions;
    return actions;
  }

  private async prepareSwapToStable(
    mint: string,
    position: PortfolioPosition | null,
    priceDecimals: number,
  ): Promise<void> {
    if (!this.walletAddress || !position || position.balance <= 0) {
      this.emit("error", "Live hedge not prepared: a verified wallet position with positive balance is required.");
      return;
    }

    const decimals = position.decimals || priceDecimals;
    const baseUnits = Math.floor(position.balance * 10 ** decimals);
    if (!Number.isSafeInteger(baseUnits) || baseUnits <= 0) {
      this.emit("error", "Live hedge not prepared: the portfolio balance cannot be converted safely to base units.");
      return;
    }

    try {
      const order = await getSwapOrder({
        inputMint: mint,
        outputMint: config.tokens.USDC,
        amount: String(baseUnits),
        taker: this.walletAddress,
      });
      if (!order.transaction) {
        this.emit(
          "error",
          `Swap quote received but no signable transaction was built (${order.router}/${order.errorCode ?? "unknown"}): ${order.errorMessage ?? "unknown reason"}`,
        );
        return;
      }

      this.emit(
        "action_prepared",
        `${formatSwapSummary(order)}\nUnsigned transaction prepared for manual signing; nothing was submitted.`,
        { order },
      );
    } catch (error) {
      this.emit("error", `Swap preparation failed. ${String(error)}`);
    }
  }

  getEvents(): PulseEvent[] {
    return [...this.events];
  }

  getLastActions(): HedgeAction[] {
    return [...this.lastActions];
  }
}
