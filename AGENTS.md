# Jup.ag Pulse Agent Guide

## Project

Jup.ag Pulse (`jup-ag-pulse`) is a Node.js 20+ TypeScript CLI for Solana portfolio monitoring and deterministic hedge decision support through Jupiter APIs.

## Safety invariants

- Never print, expose, commit, or persist API keys, JWTs, wallet private keys, signed transactions, or `.env` values.
- `monitor` and `simulate` are read-only.
- `live` may prepare an unsigned swap order only. It must never sign or submit a transaction automatically.
- Do not read `WALLET_PRIVATE_KEY`; it is a compatibility placeholder.
- Do not add automatic Trigger deposits, order creation, cancellation, or Swap execution to CLI flows.
- Missing price, history, portfolio, balance, or token data must fail closed.
- Never retry state-changing API operations automatically.

## Architecture

- `src/index.ts`: CLI runtime and sequential cycle runner.
- `src/cli.ts`: argument parsing and validation.
- `src/config.ts`: environment, endpoint, amount, and public-key validation.
- `src/agent/`: monitoring orchestration and ordered hedge rules.
- `src/apis/client.ts`: shared Jupiter authentication, timeout, retry, and error handling.
- `src/apis/`: API-specific types and response normalization.
- `test/`: Node test runner coverage for strategy and core safety behavior.

Keep API wire types beside their client and domain types beside the agent. Avoid new abstraction layers unless multiple concrete callers need them.

## Development workflow

1. Inspect the real call path before editing.
2. Preserve current command names, environment variables, thresholds, and manual-signing behavior.
3. Prefer platform APIs and existing dependencies over new packages.
4. Update `README.md` and `REPORT.md` when public behavior or limitations change.
5. Do not commit or push unless explicitly requested.

When `codebase-memory-mcp` is available, prefer its graph search, path tracing, and symbol snippets for code discovery. Use text search for configuration, documentation, and literal values.

## Commands

```powershell
npm install
npm run typecheck
npm test
npm run build
npm run demo
npm run simulate -- --cycles 1
npm run monitor -- --cycles 1
```

API-backed commands require `JUPITER_API_KEY`. Do not run `live` during routine validation.

## Completion requirements

- Run `npm run typecheck`, `npm test`, and `npm run build` after code changes.
- Report credential-dependent checks separately from regressions.
- Report `npm audit` findings without applying forced breaking upgrades.
