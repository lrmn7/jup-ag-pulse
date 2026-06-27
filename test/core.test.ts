import assert from "node:assert/strict";
import test from "node:test";

process.env.JUPITER_API_KEY = "test-api-key";

const { jupiterRequest, JupiterApiError } = await import("../src/apis/client.js");
const { normalizePortfolioResponse } = await import("../src/apis/portfolio.js");
const { PriceTracker } = await import("../src/apis/price.js");
const { parseCliArgs } = await import("../src/cli.js");

const mint = "So11111111111111111111111111111111111111112";

test("price windows require a snapshot old enough to cover the window", () => {
  const tracker = new PriceTracker();
  tracker.addSnapshot({ timestamp: 0, prices: new Map([[mint, { usdPrice: 100, priceChange24h: 0, decimals: 9, blockId: 1 }]]) });
  tracker.addSnapshot({ timestamp: 60_000, prices: new Map([[mint, { usdPrice: 90, priceChange24h: -10, decimals: 9, blockId: 2 }]]) });

  assert.equal(tracker.getPriceChange(mint, 5 * 60_000), null);
  assert.equal(tracker.getPriceChange(mint, 60_000), -10);
});

test("CLI parser validates modes, cycles, and mints", () => {
  assert.deepEqual(parseCliArgs(["--mode", "monitor", "--cycles", "2", "--tokens", mint]), {
    mode: "monitor",
    cycles: 2,
    mints: [mint],
    help: false,
  });
  assert.throws(() => parseCliArgs(["--mode", "automatic"]), /Unsupported mode/);
  assert.throws(() => parseCliArgs(["--cycles", "0"]), /positive integer/);
  assert.throws(() => parseCliArgs(["--tokens", "not-a-mint"]), /valid Solana public key/);
});

test("GET requests retry transient server failures", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1
      ? new Response(JSON.stringify({ message: "temporary" }), { status: 503 })
      : new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    assert.deepEqual(await jupiterRequest("Price", "https://example.test"), { ok: true });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST requests are never retried", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ message: "temporary" }), { status: 503 });
  };

  try {
    await assert.rejects(
      jupiterRequest("Trigger", "https://example.test", { method: "POST", body: {} }),
      (error: unknown) => error instanceof JupiterApiError && error.status === 503,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("state-changing GET requests can disable retries", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ message: "temporary" }), { status: 503 });
  };

  try {
    await assert.rejects(
      jupiterRequest("Trigger", "https://example.test", { retry: false }),
      (error: unknown) => error instanceof JupiterApiError && error.status === 503,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("portfolio normalization extracts Solana token assets and ignores unknown elements", () => {
  const portfolio = normalizePortfolioResponse({
    date: 123,
    tokenInfo: { solana: { [mint]: { symbol: "SOL", name: "Solana", decimals: 9 } } },
    elements: [
      {
        type: "multiple",
        data: { assets: [{ type: "token", networkId: "solana", value: 200, data: { address: mint, amount: 2, price: 100 } }] },
      },
      { type: "future-beta-shape", data: {} },
    ],
  });

  assert.equal(portfolio.totalValueUsd, 200);
  assert.equal(portfolio.positions[0]?.symbol, "SOL");
  assert.equal(portfolio.positions[0]?.pctOfPortfolio, 100);
  assert.equal(portfolio.fetchedAt, 123);
});
