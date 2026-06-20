import type { SessionBus } from "./events.js";

/** Accumulates token usage across all agents in the session. */
export class UsageTracker {
  input = 0;
  output = 0;

  constructor(
    bus: SessionBus,
    initial?: { input: number; output: number }
  ) {
    if (initial) {
      this.input = initial.input;
      this.output = initial.output;
    }
    bus.on((event) => {
      if (event.type === "agent:usage") {
        this.input += event.input;
        this.output += event.output;
      }
    });
  }

  reset(usage: { input: number; output: number }): void {
    this.input = usage.input;
    this.output = usage.output;
  }

  get total(): number {
    return this.input + this.output;
  }
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
