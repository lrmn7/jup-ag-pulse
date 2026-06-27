#!/usr/bin/env node
import { PulseAgent, type PulseEvent } from "./agent/pulse.js";
import { HELP_TEXT, parseCliArgs } from "./cli.js";
import { config, requireJupiterApiKey } from "./config.js";

const BANNER = `
Jup.ag Pulse
Portfolio monitoring and hedge decision support
`;

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function printSummary(cycles: number, events: PulseEvent[]): void {
  const count = (type: PulseEvent["type"]): number => events.filter(event => event.type === type).length;
  console.log("\nSESSION SUMMARY");
  console.log(`Cycles: ${cycles}`);
  console.log(`Signals: ${count("signal_detected")}`);
  console.log(`Plans: ${count("action_planned")}`);
  console.log(`Prepared transactions: ${count("action_prepared")}`);
  console.log(`Errors: ${count("error")}`);
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }

  requireJupiterApiKey();
  console.log(BANNER);
  console.log(`Mode: ${options.mode}`);
  console.log(`Monitoring: ${(options.mints ?? Object.keys(config.tokens)).join(", ")}`);
  if (config.walletAddress) console.log(`Wallet: ${config.walletAddress.slice(0, 8)}...`);
  console.log(`Cycles: ${options.cycles}`);

  const events: PulseEvent[] = [];
  const agent = new PulseAgent({
    mode: options.mode,
    ...(options.mints ? { monitoredMints: options.mints } : {}),
    walletAddress: config.walletAddress,
    onEvent: event => {
      events.push(event);
      console.log(`[${new Date(event.timestamp).toLocaleTimeString()}] ${event.type}: ${event.message}`);
    },
  });

  for (let cycle = 1; cycle <= options.cycles; cycle++) {
    console.log(`\nCycle ${cycle}/${options.cycles}`);
    await agent.runCycle();
    if (cycle < options.cycles) await wait(config.pollIntervalMs);
  }

  printSummary(options.cycles, events);
}

main().catch(error => {
  console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
