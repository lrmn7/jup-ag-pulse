import { assertPositiveAmount, assertPublicKey, config, type TokenMint } from "../config.js";
import { isRecord, jupiterRequest } from "./client.js";

export type TriggerAuthChallenge =
  | { type: "message"; challenge: string }
  | { type: "transaction"; transaction: string };

export type TriggerAuthVerification =
  | { type: "message"; walletPubkey: string; signature: string }
  | { type: "transaction"; walletPubkey: string; signedTransaction: string };

export interface TriggerVault {
  userPubkey: string;
  vaultPubkey: string;
  privyVaultId: string;
}

export type TriggerOrderType = "single" | "oco" | "otoco";

export interface TriggerDeposit {
  transaction: string;
  requestId: string;
  receiverAddress: string;
  mint: string;
  amount: string;
  tokenDecimals: number;
  inputTokenAccount: string;
  outputTokenAccount?: string;
}

interface TriggerOrderCommon {
  jwt: string;
  depositRequestId: string;
  depositSignedTx: string;
  userPubkey: string;
  inputMint: TokenMint;
  inputAmount: string;
  outputMint: TokenMint;
  triggerMint: TokenMint;
  expiresAt: number;
}

export type CreateTriggerOrderParams =
  | (TriggerOrderCommon & {
      orderType: "single";
      triggerCondition: "above" | "below";
      triggerPriceUsd: number;
      slippageBps?: number;
    })
  | (TriggerOrderCommon & {
      orderType: "oco";
      tpPriceUsd: number;
      slPriceUsd: number;
      tpSlippageBps?: number;
      slSlippageBps?: number;
    })
  | (TriggerOrderCommon & {
      orderType: "otoco";
      triggerCondition: "above" | "below";
      triggerPriceUsd: number;
      tpPriceUsd: number;
      slPriceUsd: number;
      slippageBps?: number;
      tpSlippageBps?: number;
      slSlippageBps?: number;
    });

export interface TriggerOrderCreated {
  id: string;
  txSignature: string;
}

export interface TriggerOrder {
  id: string;
  orderType: TriggerOrderType;
  orderState: string;
  rawState: string;
  [key: string]: unknown;
}

function requireJwt(jwt: string): string {
  if (!jwt.trim()) throw new Error("Trigger JWT is required.");
  return jwt;
}

function validateSlippage(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 10_000)) {
    throw new Error(`${label} must be an integer from 0 to 10000.`);
  }
}

function validatePrice(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero.`);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Trigger API returned an invalid ${label}.`);
  return value;
}

function normalizeVault(value: unknown): TriggerVault {
  if (!isRecord(value)) throw new Error("Trigger API returned an invalid vault response.");
  return {
    userPubkey: requireString(value.userPubkey, "vault user key"),
    vaultPubkey: requireString(value.vaultPubkey, "vault public key"),
    privyVaultId: requireString(value.privyVaultId, "vault ID"),
  };
}

export async function requestAuthChallenge(params: {
  walletPubkey: string;
  type: "message" | "transaction";
}): Promise<TriggerAuthChallenge> {
  const body = { ...params, walletPubkey: assertPublicKey(params.walletPubkey, "Wallet public key") };
  const response = await jupiterRequest<unknown>("Trigger", `${config.api.trigger}/auth/challenge`, {
    method: "POST",
    body,
  });
  if (!isRecord(response) || response.type !== params.type) {
    throw new Error("Trigger API returned an invalid authentication challenge.");
  }
  return params.type === "message"
    ? { type: "message", challenge: requireString(response.challenge, "message challenge") }
    : { type: "transaction", transaction: requireString(response.transaction, "transaction challenge") };
}

export async function verifyAuthChallenge(params: TriggerAuthVerification): Promise<{ token: string }> {
  const body = { ...params, walletPubkey: assertPublicKey(params.walletPubkey, "Wallet public key") };
  const response = await jupiterRequest<unknown>("Trigger", `${config.api.trigger}/auth/verify`, {
    method: "POST",
    body,
  });
  if (!isRecord(response)) throw new Error("Trigger API returned an invalid authentication response.");
  return { token: requireString(response.token, "authentication token") };
}

export async function getTriggerVault(jwt: string): Promise<TriggerVault> {
  return normalizeVault(await jupiterRequest<unknown>("Trigger", `${config.api.trigger}/vault`, { jwt: requireJwt(jwt) }));
}

export async function registerTriggerVault(jwt: string): Promise<TriggerVault> {
  return normalizeVault(await jupiterRequest<unknown>("Trigger", `${config.api.trigger}/vault/register`, {
    jwt: requireJwt(jwt),
    retry: false,
  }));
}

export async function craftTriggerDeposit(params: {
  jwt: string;
  inputMint: TokenMint;
  outputMint: TokenMint;
  userAddress: string;
  amount: string;
  orderSubType: TriggerOrderType;
}): Promise<TriggerDeposit> {
  const { jwt, ...request } = params;
  const body = {
    ...request,
    inputMint: assertPublicKey(request.inputMint, "Input mint"),
    outputMint: assertPublicKey(request.outputMint, "Output mint"),
    userAddress: assertPublicKey(request.userAddress, "User address"),
    amount: assertPositiveAmount(request.amount, "Deposit amount"),
    orderType: "price",
  };
  if (body.inputMint === body.outputMint) throw new Error("Trigger input and output mints must differ.");
  const response = await jupiterRequest<unknown>("Trigger", `${config.api.trigger}/deposit/craft`, {
    method: "POST",
    jwt: requireJwt(jwt),
    body,
  });
  if (!isRecord(response) || typeof response.tokenDecimals !== "number") {
    throw new Error("Trigger API returned an invalid deposit response.");
  }
  return {
    transaction: requireString(response.transaction, "deposit transaction"),
    requestId: requireString(response.requestId, "deposit request ID"),
    receiverAddress: requireString(response.receiverAddress, "deposit receiver"),
    mint: requireString(response.mint, "deposit mint"),
    amount: requireString(response.amount, "deposit amount"),
    tokenDecimals: response.tokenDecimals,
    inputTokenAccount: requireString(response.inputTokenAccount, "input token account"),
    ...(typeof response.outputTokenAccount === "string" ? { outputTokenAccount: response.outputTokenAccount } : {}),
  };
}

export async function createTriggerOrder(params: CreateTriggerOrderParams): Promise<TriggerOrderCreated> {
  if (!params.depositRequestId || !params.depositSignedTx) {
    throw new Error("Trigger order requires a deposit request ID and signed deposit transaction.");
  }
  if (!Number.isInteger(params.expiresAt) || params.expiresAt <= Date.now()) {
    throw new Error("Trigger order expiresAt must be a future millisecond timestamp.");
  }

  assertPublicKey(params.userPubkey, "User public key");
  assertPublicKey(params.inputMint, "Input mint");
  assertPublicKey(params.outputMint, "Output mint");
  assertPublicKey(params.triggerMint, "Trigger mint");
  assertPositiveAmount(params.inputAmount, "Trigger input amount");
  if (params.inputMint === params.outputMint) throw new Error("Trigger input and output mints must differ.");

  if (params.orderType === "single") {
    validatePrice(params.triggerPriceUsd, "Trigger price");
    validateSlippage(params.slippageBps, "Slippage");
  } else {
    validatePrice(params.tpPriceUsd, "Take-profit price");
    validatePrice(params.slPriceUsd, "Stop-loss price");
    if (params.tpPriceUsd <= params.slPriceUsd) throw new Error("Take-profit price must exceed stop-loss price.");
    validateSlippage(params.tpSlippageBps, "Take-profit slippage");
    validateSlippage(params.slSlippageBps, "Stop-loss slippage");
    if (params.orderType === "otoco") {
      validatePrice(params.triggerPriceUsd, "Trigger price");
      validateSlippage(params.slippageBps, "Parent slippage");
    }
  }

  const { jwt, ...body } = params;
  const response = await jupiterRequest<unknown>("Trigger", `${config.api.trigger}/orders/price`, {
    method: "POST",
    jwt: requireJwt(jwt),
    body,
  });
  if (!isRecord(response)) throw new Error("Trigger API returned an invalid order response.");
  return {
    id: requireString(response.id, "order ID"),
    txSignature: requireString(response.txSignature, "order transaction signature"),
  };
}

export async function initiateTriggerCancellation(params: {
  jwt: string;
  orderId: string;
}): Promise<{ id: string; transaction: string; requestId: string }> {
  if (!params.orderId) throw new Error("Trigger order ID is required.");
  const response = await jupiterRequest<unknown>("Trigger", `${config.api.trigger}/orders/price/cancel/${encodeURIComponent(params.orderId)}`, {
    method: "POST",
    jwt: requireJwt(params.jwt),
  });
  if (!isRecord(response)) throw new Error("Trigger API returned an invalid cancellation response.");
  return {
    id: requireString(response.id, "cancellation order ID"),
    transaction: requireString(response.transaction, "cancellation transaction"),
    requestId: requireString(response.requestId, "cancellation request ID"),
  };
}

export async function confirmTriggerCancellation(params: {
  jwt: string;
  orderId: string;
  signedTransaction: string;
  cancelRequestId: string;
}): Promise<{ id: string; txSignature: string }> {
  if (!params.orderId || !params.signedTransaction || !params.cancelRequestId) {
    throw new Error("Cancellation confirmation requires order ID, signed transaction, and cancellation request ID.");
  }
  const response = await jupiterRequest<unknown>("Trigger", `${config.api.trigger}/orders/price/confirm-cancel/${encodeURIComponent(params.orderId)}`, {
    method: "POST",
    jwt: requireJwt(params.jwt),
    body: {
      signedTransaction: params.signedTransaction,
      cancelRequestId: params.cancelRequestId,
    },
  });
  if (!isRecord(response)) throw new Error("Trigger API returned an invalid cancellation confirmation.");
  return {
    id: requireString(response.id, "confirmed cancellation order ID"),
    txSignature: requireString(response.txSignature, "cancellation transaction signature"),
  };
}

export async function getTriggerOrderHistory(params: {
  jwt: string;
  state?: "active" | "past";
  mint?: TokenMint;
  limit?: number;
  offset?: number;
  sort?: "updated_at" | "created_at" | "expires_at";
  dir?: "asc" | "desc";
}): Promise<{ orders: TriggerOrder[]; pagination: { total: number; limit: number; offset: number } }> {
  const query = new URLSearchParams();
  if (params.state) query.set("state", params.state);
  if (params.mint) query.set("mint", assertPublicKey(params.mint, "History mint"));
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("History limit must be from 1 to 100.");
  if (!Number.isInteger(offset) || offset < 0) throw new Error("History offset must be a non-negative integer.");
  query.set("limit", String(limit));
  query.set("offset", String(offset));
  if (params.sort) query.set("sort", params.sort);
  if (params.dir) query.set("dir", params.dir);

  const response = await jupiterRequest<unknown>("Trigger", `${config.api.trigger}/orders/history?${query}`, {
    jwt: requireJwt(params.jwt),
  });
  if (!isRecord(response) || !Array.isArray(response.orders) || !isRecord(response.pagination)) {
    throw new Error("Trigger API returned an invalid order history response.");
  }
  const orders = response.orders.map(order => {
    if (
      !isRecord(order)
      || typeof order.id !== "string"
      || (order.orderType !== "single" && order.orderType !== "oco" && order.orderType !== "otoco")
      || typeof order.orderState !== "string"
      || typeof order.rawState !== "string"
    ) throw new Error("Trigger API returned an invalid order history item.");
    return order as TriggerOrder;
  });
  const total = response.pagination.total;
  const responseLimit = response.pagination.limit;
  const responseOffset = response.pagination.offset;
  if (typeof total !== "number" || typeof responseLimit !== "number" || typeof responseOffset !== "number") {
    throw new Error("Trigger API returned invalid order history pagination.");
  }
  return { orders, pagination: { total, limit: responseLimit, offset: responseOffset } };
}
