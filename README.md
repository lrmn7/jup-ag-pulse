# Jup.ag Pulse

Jup.ag Pulse is a TypeScript portfolio-monitoring and hedge decision-support agent for Solana. It reads market and portfolio data from Jupiter, evaluates deterministic risk rules, and produces reviewable hedge plans. In live mode it can prepare an unsigned Jupiter Swap order, but it never reads a private key, signs a transaction, or submits a trade.

## What it does

1. Fetches current prices for configured token mints.
2. Maintains local price history for five-minute, one-hour, and volatility signals.
3. Uses Jupiter Tokens V2 activity data to distinguish organic selling from low-quality market noise.
4. Applies ordered hedge rules for confirmed dumps, moderate selling, concentrated volatile positions, minor dips, and hold conditions.
5. Optionally loads Jupiter Portfolio positions for a configured wallet.
6. Reports actions in monitor/simulate modes or prepares an unsigned Swap V2 order in live mode.

The strategy is deterministic and auditable. It is not an AI model and does not provide financial advice.

## Key features

- Typed clients for Jupiter Price, Tokens, Swap, Trigger, and Portfolio APIs
- Shared authenticated HTTP handling with timeouts and bounded error messages
- Retries only for safe GET requests on network, rate-limit, and server failures
- Explicit handling for omitted or unreliable Price V3 results
- Fail-closed behavior when history, portfolio balance, or API data is incomplete
- Non-overlapping monitoring cycles with exact cycle counts
- Manual-signing boundary for all transaction-producing APIs
- Built-in Node.js tests with no additional test framework

## Operating modes

| Mode | Behavior | Transaction safety |
|---|---|---|
| `monitor` | Reads data and reports signals and plans | Read-only |
| `simulate` | Produces dry-run hedge action plans | Read-only |
| `live` | May request an unsigned swap order for a verified positive wallet position | Never signs or submits |

`live` is retained as a compatible command name. It means live-data order preparation, not automatic execution.

Types remain next to the code that owns their wire format or domain behavior. The strategy rules remain in one focused file because the current rule set is small and ordered; separate rule files would add navigation without reducing complexity.

## Jupiter APIs

- [Price V3](https://developers.jup.ag/docs/price): current USD price, decimals, block ID, and 24-hour change. Unreliable prices may be omitted.
- [Tokens V2](https://developers.jup.ag/docs/tokens/token-information): metadata, liquidity, trading activity, and organic-volume signals.
- [Swap V2](https://developers.jup.ag/docs/swap/order-and-execute): quote/order preparation and explicit execution of an externally signed transaction.
- [Trigger V2](https://developers.jup.ag/docs/trigger/create-order): challenge authentication, vault deposits, price orders, cancellation, and history. Jupiter requires client-side signing between preparation steps.
- [Portfolio V1](https://developers.jup.ag/docs/portfolio/jupiter-positions): Jupiter-specific wallet positions. This API is beta and is not a complete Solana wallet indexer.

## Installation

Requirements:

- Node.js 20 or newer
- A Jupiter API key from the Jupiter developer platform

```powershell
npm install
Copy-Item .env.example .env
```

Set `JUPITER_API_KEY` in `.env` before making API requests.

## Environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `JUPITER_API_KEY` | Yes | Sent as `x-api-key` to Jupiter REST endpoints |
| `WALLET_ADDRESS` | No | Loads Portfolio positions and enables live swap preparation |
| `WALLET_PRIVATE_KEY` | No | Compatibility placeholder; never read by the runtime |
| `ANTHROPIC_API_KEY` | No | Compatibility placeholder; currently unused |

Never commit `.env`. Use a dedicated low-risk wallet and an external signing or key-management system if transaction execution is added outside this project.

## Commands

```powershell
npm run demo
npm run simulate
npm run monitor
npm run start -- --mode live --cycles 2
npm run typecheck
npm test
npm run build
```

All monitoring commands accept:

```text
--mode, -m      monitor | simulate | live
--cycles, -c    positive integer; default 5
--tokens, -t    comma-separated Solana mint addresses
--help, -h      command help
```

Example one-cycle simulation:

```powershell
npm run simulate -- --cycles 1 --tokens So11111111111111111111111111111111111111112
```

The first monitoring cycle establishes a baseline. Five-minute and one-hour signals remain unavailable until local history covers those windows.

## Live-mode safety

- The runtime does not load `WALLET_PRIVATE_KEY`.
- Swap preparation requires a valid wallet address and a positive normalized Portfolio position.
- Unsafe, missing, zero, or imprecise balances stop preparation.
- Jupiter may return a quote without a signable transaction; this is reported and not treated as success.
- `executeSwap` is an explicit client function for an already signed transaction and is not called by any command.
- Trigger helpers never sign deposits or withdrawals and are not invoked automatically by the agent.
- POST requests are not automatically retried.

## Troubleshooting

### Missing `JUPITER_API_KEY`

Copy `.env.example` to `.env` and provide a valid key. Commands fail before printing or sending any credential.

### Price count is lower than the requested token count

Price V3 intentionally omits tokens whose price cannot be established reliably. Jup.ag Pulse reports the missing count and skips those mints for the cycle.

### Portfolio is empty or incomplete

Portfolio V1 currently covers Jupiter-specific positions and returns several beta element types. Jup.ag Pulse normalizes Solana token assets from `multiple` elements and ignores unfamiliar shapes safely.

### Live mode does not execute a trade

This is expected. Live mode prepares an unsigned order only. Signing and submission must happen in an explicitly reviewed external workflow.

### API timeouts or rate limits

Safe GET requests retry up to two times with exponential backoff. POST requests return the error immediately to avoid duplicating state-changing operations.

## Limitations

- Price history exists only in memory and resets when the process exits.
- Monitoring is polling-based at ten-second intervals.
- Portfolio normalization does not flatten every liquidity, leverage, borrow/lend, or trade element into a token balance.
- Strategy thresholds are static and are not calibrated per token or market regime.
- Trigger integration exposes correct preparation steps but has no wallet signer or automated lifecycle worker.
- There is no persistence, alert transport, dashboard, or production observability backend.

## Engineering report

See [REPORT.md](./REPORT.md) for implementation decisions, integration details, safety controls, maintenance guidance, and known constraints.
