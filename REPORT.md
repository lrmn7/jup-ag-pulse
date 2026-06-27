# Jup.ag Pulse Engineering and Integration Report

**Project:** Jup.ag Pulse
**Runtime:** Node.js 20+, TypeScript, ESM
**Integrations:** Jupiter Price V3, Tokens V2, Swap V2, Trigger V2, Portfolio V1
**Review date:** June 27, 2026

## Executive summary

Jup.ag Pulse is a deterministic Solana portfolio-monitoring and hedge decision-support service. The refactor converted the original prototype into a smaller, typed, and safety-oriented runtime without introducing a framework or automatic transaction execution.

The implementation now separates transport concerns from API-specific normalization, keeps strategy decisions pure, and runs monitoring cycles sequentially. API contracts were aligned with current Jupiter documentation. The most important operational boundary is explicit: the project may prepare unsigned transaction payloads, but it never reads private keys, signs payloads, or submits trades from its CLI modes.

## Refactor objectives

The work addressed five concrete risks:

1. Repeated raw `fetch` calls had inconsistent timeouts and error handling.
2. Several response types and endpoint shapes no longer matched current Jupiter APIs.
3. The scheduler could overlap asynchronous cycles and could run more cycles than requested.
4. Live-mode output overstated execution behavior despite only preparing an order.
5. Missing history or portfolio data could be represented as assumed values rather than unknown state.

The refactor deliberately avoided a large folder hierarchy, dependency injection framework, logging framework, validation library, or one-file-per-rule strategy structure. The current codebase does not need those abstractions.

## Architecture decisions

### Shared Jupiter HTTP boundary

`src/apis/client.ts` owns cross-cutting REST behavior:

- `x-api-key` injection
- optional Trigger JWT authorization
- JSON body serialization
- five-second default timeout
- thirty-second Swap execution timeout
- bounded error-body parsing
- typed `JupiterApiError` metadata
- exponential backoff for safe GET requests only

GET requests may retry network failures, HTTP 429, and HTTP 5xx responses up to two times. POST and PATCH operations are never retried automatically. This conservative policy avoids accidental duplicate state transitions even where an upstream endpoint may provide an idempotency mechanism.

The client does not log request headers, environment values, signed transactions, JWTs, or private material.

### API-specific normalization

Each integration owns its request and response types. Runtime normalization occurs where malformed or evolving external data could affect strategy behavior.

- Price responses require finite positive prices and valid numeric metadata.
- Tokens responses normalize missing numeric metrics to safe zero values and represent absent time-window statistics as `null`.
- Portfolio responses extract supported Solana token assets and ignore unknown beta element variants.
- Swap responses distinguish quote-only results, signable transactions, routers, and build errors.
- Trigger operations use discriminated request types for single, OCO, and OTOCO orders.

Unknown values remain unknown where an assumption could cause unsafe action. In particular, absent portfolio weight is `null`, not an arbitrary default percentage.

### Strategy structure

The hedge strategy remains one module with an ordered list of named pure rules:

1. Large confirmed organic dump
2. Moderate organic selling
3. High-volatility concentrated position
4. Minor non-organic dip safety order
5. Hold fallback

The existing thresholds and precedence were preserved. Named rule functions improve local readability and debugging without creating five very small files.

`HedgeAction` is now a discriminated union. Each action type carries only the fields it requires, so callers cannot accidentally consume a take-profit price from a hold action or omit the percentage for a reduction action.

### Monitoring runtime

The CLI owns one sequential cycle loop. A cycle completes before the next delay begins, preventing overlapping API calls and duplicate action preparation. `--cycles N` now executes exactly N cycles.

The agent loads Portfolio data at most once per process and merges normalized portfolio mints into the monitored set. Failure to load a wallet does not stop read-only monitoring of configured tokens.

### Dependency policy

The runtime uses only:

- `dotenv` for local environment loading
- `@solana/web3.js` for canonical public-key validation

TypeScript, Node types, and `tsx` are development dependencies. The unused Anthropic SDK and direct `bs58` dependency were removed. Tests use the standard Node.js test runner through `tsx`, so no test framework was added.

## Jupiter API integration

### Price V3

Price V3 returns USD price, block ID, decimals, and 24-hour price change. It may omit a requested mint entirely when Jupiter cannot establish a reliable price.

Jup.ag Pulse compares requested mints with returned keys, reports the unavailable count, and skips omitted tokens. It no longer assumes Price V3 provides liquidity. Liquidity is sourced from Tokens V2 when token activity is available.

Local history is used for shorter-window changes and volatility. A five-minute or one-hour change is returned only after a snapshot exists at or before the requested cutoff. This avoids presenting a ten-second movement as a one-hour signal.

### Tokens V2

Tokens V2 supplies token identity, liquidity, and organic trading statistics. The organic analysis keeps the original decision thresholds:

- organic sell ratio above 30% with negative organic flow indicates likely selling
- ratios above 50% raise confidence to high
- very low organic selling with fewer than 100 traders is treated as likely noise
- liquidity change below -10% is treated as a high-confidence risk signal

If one-hour statistics are absent, analysis returns low confidence and no dump classification.

### Swap V2

The Swap client uses the Meta-Aggregator `/order` and `/execute` flow.
- Quote-only requests omit `taker` and cannot produce a signable transaction.
- Live preparation supplies a verified wallet address as `taker`.
- The response uses the current `transaction`, `router`, `mode`, `requestId`, and error fields.
- The unsupported request-side `mode=fast` parameter and unused `/build` wrapper were removed.
- `executeSwap` remains available only for an already signed transaction and is not called by the runtime.

Live preparation uses Jupiter's default swap behavior rather than forcing custom slippage. A returned empty or missing transaction is treated as a preparation failure, even when pricing fields are present.

### Trigger V2

The original Trigger helpers attempted to create orders in one call. Current Trigger V2 requires multiple caller-controlled steps:

1. Request and verify an authentication challenge.
2. Retrieve or explicitly register a vault.
3. Craft a deposit transaction with an order subtype.
4. Sign the deposit outside the API client.
5. Submit the signed deposit with order parameters.
6. For cancellation, initiate withdrawal, sign it externally, and confirm cancellation.

The client now exposes each step separately. It validates public keys, amounts, future expiry timestamps, price relationships, and slippage ranges. It never chooses to register a vault after an arbitrary error and never signs or stores a Trigger JWT.

Trigger V2 is beta. Callers must tolerate additive response fields and should reconcile order state through the history endpoint.

### Portfolio V1

Portfolio V1 uses `/positions/{address}` and returns heterogeneous `elements`. Jup.ag Pulse currently normalizes Solana token assets inside `multiple` elements, aggregates repeated mints, and calculates portfolio weights from the normalized token value.

Other element types are ignored rather than coerced into an incorrect token balance. This makes the current limitation explicit: the normalized total may not include the full economic value of liquidity, leverage, borrow/lend, or trade positions.

## Safety controls

### Credential handling

- `JUPITER_API_KEY` is required but never printed.
- `WALLET_ADDRESS` is public and is abbreviated in CLI output.
- `WALLET_PRIVATE_KEY` is retained in `.env.example` for compatibility but is not read.
- `ANTHROPIC_API_KEY` is retained as a compatibility placeholder and is not read.
- Trigger JWTs and signed transaction payloads are accepted only as function arguments and are not logged.

### Live-mode boundary

Live mode does not mean automatic execution. It may prepare an unsigned swap order only when all of the following are true:
- a valid wallet address was configured
- Portfolio returned the target mint
- the normalized balance is positive
- decimals are available
- conversion to base units is a positive safe integer
- Jupiter returned a non-empty signable transaction

If any condition fails, the agent emits an error event and performs no transaction operation.

### Failure behavior

- Missing prices skip affected tokens.
- Missing token statistics lower confidence rather than creating a dump signal.
- Missing portfolio data is represented as `null` and blocks live order preparation.
- API failures include the service and status without exposing headers or credentials.
- State-changing requests fail immediately and require explicit caller reconciliation.

## Testing and quality controls

The project provides focused tests for:
- all five strategy outcomes
- rule precedence
- fail-closed behavior with missing history and portfolio data
- five-minute/one-hour history coverage
- CLI mode, cycle, and mint validation
- retry behavior for transient GET failures
- no-retry behavior for POST failures
- Portfolio beta normalization and unknown-element tolerance

The TypeScript configuration enables strict checking, unchecked-index protection, exact optional properties, unused-symbol checks, implicit-return checks, and declaration generation.

## Operational guidance

### Recommended deployment posture

Run monitor or simulate mode as the default production posture. Treat generated plans as recommendations that require an independent policy and review layer.

If transaction execution is added later, it should be a separate component with:
- wallet allow-lists
- per-token and per-session amount limits
- explicit slippage ceilings
- price freshness checks immediately before signing
- transaction simulation
- managed key storage or hardware-backed signing
- submission idempotency and confirmation reconciliation
- operator-visible audit records

Those controls should not be embedded casually into the monitoring process.

### Maintenance checklist

- Review Jupiter beta API documentation before changing Portfolio or Trigger behavior.
- Update response normalizers when upstream schemas add required fields or change state names.
- Run `npm run typecheck`, `npm test`, and `npm run build` for every change.
- Test API-backed commands with a non-production wallet and minimal balances.
- Do not lower safety thresholds without historical backtesting and documented approval.
- Keep dependencies current through reviewed, non-forced updates; do not apply breaking audit fixes automatically.

## Known limitations

- History and events are process-local and unbounded for the process lifetime.
- Polling can miss movements between ten-second intervals.
- One-hour risk rules need one hour of uninterrupted local history in monitor/live runtime.
- Portfolio coverage is Jupiter-specific and the normalizer handles only token assets from `multiple` elements.
- Strategy thresholds are global rather than asset-specific.
- No persistence, alert delivery, metrics backend, or distributed coordination exists.
- Trigger order preparation is available as a client API but is not wired into strategy execution.
- Swap signing, simulation, submission, and confirmation are intentionally outside the runtime.

## Future improvements

Prioritized improvements should be evidence-driven:

1. Persist price snapshots and decisions so restarts do not reset risk windows.
2. Add structured JSON logs and latency/error metrics for API operations.
3. Add an alert adapter for human approval of planned actions.
4. Extend Portfolio normalization as stable schemas become available.
5. Backtest strategy thresholds against historical data.
6. Design a separately deployed signing service only after policy, custody, and audit requirements are defined.

## Conclusion

The refactored project is suitable as a maintainable monitoring and decision-support foundation. Its API contracts, runtime validation, and safety boundaries are now explicit. It is not an autonomous trading system, and expanding it into one requires a separate security and operational design review.
