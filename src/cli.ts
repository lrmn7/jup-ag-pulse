import { assertPublicKey } from "./config.js";
import type { PulseMode } from "./agent/pulse.js";

export interface CliOptions {
  mode: PulseMode;
  cycles: number;
  mints?: string[];
  help: boolean;
}

const modes: readonly PulseMode[] = ["monitor", "simulate", "live"];

export const HELP_TEXT = `
Usage: jupiter-pulse [options]

Options:
  -m, --mode <mode>     monitor, simulate, or live (default: simulate)
  -c, --cycles <n>      Number of sequential cycles (default: 5)
  -t, --tokens <mints>  Comma-separated Solana token mints
  -h, --help            Show this help message

Modes:
  monitor   Read market data and report deterministic hedge signals
  simulate  Generate dry-run hedge action plans
  live      Prepare unsigned swap orders for manual review and signing

Environment:
  JUPITER_API_KEY       Required for Jupiter REST requests
  WALLET_ADDRESS        Optional portfolio wallet; required for live preparation
  WALLET_PRIVATE_KEY    Compatibility placeholder; never read by this runtime
  ANTHROPIC_API_KEY     Compatibility placeholder; currently unused
`;

function nextValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${option} requires a value.`);
  return value;
}

export function parseCliArgs(args: string[]): CliOptions {
  let mode: PulseMode = "simulate";
  let cycles = 5;
  let mints: string[] | undefined;
  let help = false;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    switch (argument) {
      case "--mode":
      case "-m": {
        const value = nextValue(args, index, argument);
        if (!modes.includes(value as PulseMode)) throw new Error(`Unsupported mode: ${value}.`);
        mode = value as PulseMode;
        index++;
        break;
      }
      case "--cycles":
      case "-c": {
        const value = nextValue(args, index, argument);
        cycles = Number(value);
        if (!Number.isInteger(cycles) || cycles < 1) throw new Error("--cycles must be a positive integer.");
        index++;
        break;
      }
      case "--tokens":
      case "-t": {
        const value = nextValue(args, index, argument);
        mints = [...new Set(value.split(",").map(mint => mint.trim()).filter(Boolean))];
        if (!mints.length) throw new Error("--tokens must include at least one mint.");
        mints.forEach(mint => assertPublicKey(mint, "Token mint"));
        index++;
        break;
      }
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        throw new Error(`Unknown option: ${argument}.`);
    }
  }

  return {
    mode,
    cycles,
    ...(mints ? { mints } : {}),
    help,
  };
}
