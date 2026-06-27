import { assertPositiveAmount, assertPublicKey, config, type TokenMint } from "../config.js";
import { isRecord, jupiterRequest } from "./client.js";

export interface SwapRoute {
  swapInfo: {
    ammKey?: string;
    label?: string;
    inputMint?: string;
    outputMint?: string;
    inAmount?: string;
    outAmount?: string;
  };
  percent: number;
}

export interface SwapOrder {
  mode: "ultra" | "manual";
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: SwapRoute[];
  transaction: string | null;
  requestId: string;
  router: string;
  lastValidBlockHeight?: string;
  expireAt?: string;
  errorCode?: number;
  errorMessage?: string;
}

export interface SwapExecutionResult {
  status: "Success" | "Failed";
  signature?: string;
  code: number;
  inputAmountResult: string;
  outputAmountResult: string;
  error?: string;
}

function normalizeSwapOrder(value: unknown): SwapOrder {
  if (
    !isRecord(value)
    || typeof value.requestId !== "string"
    || typeof value.inputMint !== "string"
    || typeof value.outputMint !== "string"
    || typeof value.inAmount !== "string"
    || typeof value.outAmount !== "string"
  ) {
    throw new Error("Swap API returned an invalid order response.");
  }

  const mode = value.mode === "manual" ? "manual" : "ultra";
  const routePlan: SwapRoute[] = Array.isArray(value.routePlan)
    ? value.routePlan.flatMap(route => {
        if (!isRecord(route) || !isRecord(route.swapInfo)) return [];
        const swapInfo: SwapRoute["swapInfo"] = {};
        for (const field of ["ammKey", "label", "inputMint", "outputMint", "inAmount", "outAmount"] as const) {
          if (typeof route.swapInfo[field] === "string") swapInfo[field] = route.swapInfo[field];
        }
        return [{ swapInfo, percent: typeof route.percent === "number" ? route.percent : 100 }];
      })
    : [];

  return {
    mode,
    inputMint: value.inputMint,
    outputMint: value.outputMint,
    inAmount: value.inAmount,
    outAmount: value.outAmount,
    priceImpactPct: typeof value.priceImpactPct === "string" ? value.priceImpactPct : "0",
    routePlan,
    transaction: typeof value.transaction === "string" || value.transaction === null ? value.transaction : null,
    requestId: value.requestId,
    router: typeof value.router === "string" ? value.router : "unknown",
    ...(typeof value.lastValidBlockHeight === "string" ? { lastValidBlockHeight: value.lastValidBlockHeight } : {}),
    ...(typeof value.expireAt === "string" ? { expireAt: value.expireAt } : {}),
    ...(typeof value.errorCode === "number" ? { errorCode: value.errorCode } : {}),
    ...(typeof value.errorMessage === "string" ? { errorMessage: value.errorMessage } : {}),
  };
}

export async function getSwapOrder(params: {
  inputMint: TokenMint;
  outputMint: TokenMint;
  amount: string;
  taker?: string;
  slippageBps?: number;
}): Promise<SwapOrder> {
  const query = new URLSearchParams({
    inputMint: assertPublicKey(params.inputMint, "Input mint"),
    outputMint: assertPublicKey(params.outputMint, "Output mint"),
    amount: assertPositiveAmount(params.amount, "Swap amount"),
  });

  if (params.taker) query.set("taker", assertPublicKey(params.taker, "Taker address"));

  if (params.slippageBps !== undefined) {
    if (!Number.isInteger(params.slippageBps) || params.slippageBps < 0 || params.slippageBps > 10_000) {
      throw new Error("Swap slippageBps must be an integer from 0 to 10000.");
    }
    query.set("slippageBps", String(params.slippageBps));
  }

  const response = await jupiterRequest<unknown>("Swap", `${config.api.swap}/order?${query}`);
  return normalizeSwapOrder(response);
}

export async function executeSwap(params: {
  signedTransaction: string;
  requestId: string;
}): Promise<SwapExecutionResult> {
  if (!params.signedTransaction || !params.requestId) {
    throw new Error("executeSwap requires a signed transaction and request ID.");
  }
  const response = await jupiterRequest<unknown>("Swap", `${config.api.swap}/execute`, {
    method: "POST",
    timeoutMs: 30_000,
    body: params,
  });
  if (
    !isRecord(response)
    || (response.status !== "Success" && response.status !== "Failed")
    || typeof response.code !== "number"
    || typeof response.inputAmountResult !== "string"
    || typeof response.outputAmountResult !== "string"
  ) {
    throw new Error("Swap API returned an invalid execution response.");
  }
  return {
    status: response.status,
    code: response.code,
    inputAmountResult: response.inputAmountResult,
    outputAmountResult: response.outputAmountResult,
    ...(typeof response.signature === "string" ? { signature: response.signature } : {}),
    ...(typeof response.error === "string" ? { error: response.error } : {}),
  };
}

export function formatSwapSummary(order: SwapOrder): string {
  const routes = order.routePlan
    .map(route => `${route.swapInfo.label ?? order.router} (${route.percent}%)`)
    .join(" -> ") || order.router;

  return [
    `Swap: ${order.inAmount} ${order.inputMint.slice(0, 8)}... -> ${order.outAmount} ${order.outputMint.slice(0, 8)}...`,
    `Price impact: ${order.priceImpactPct}%`,
    `Route: ${routes}`,
    `Request ID: ${order.requestId}`,
  ].join("\n");
}
