import path from "node:path";
import process from "node:process";
import React from "react";
import { render } from "ink";
import { OrchestratorAgent } from "./agents/orchestrator.js";
import type { AgentDeps } from "./agents/base.js";
import { loadConfig, resolveModelConfig, ConfigError } from "./config/index.js";
import { checkConnectivity } from "./providers/index.js";
import { ApprovalService } from "./session/approvals.js";
import { FileClaimRegistry } from "./session/claims.js";
import { SessionBus } from "./session/events.js";
import { SessionStore } from "./session/store.js";
import { TodoStore } from "./session/todo.js";
import { UsageTracker, formatTokens } from "./session/usage.js";
import { App } from "./tui/App.js";
import { createMouseInput, type MouseInput } from "./tui/mouse.js";

interface CliArgs {
  print?: string;
  cwd: string;
  resume: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), resume: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-p" || arg === "--print") {
      args.print = argv[++i];
    } else if (arg === "--cwd") {
      args.cwd = path.resolve(argv[++i] ?? process.cwd());
    } else if (arg === "--resume" || arg === "-r") {
      args.resume = true;
    } else if (arg === "-h" || arg === "--help") {
      args.help = true;
    }
  }
  return args;
}

const HELP = `luminous - terminal coding agent (orchestrator + specialized subagents)

Usage:
  luminous                 start the interactive TUI in the current directory
  luminous -p "<task>"     run one task headless and print the result
  luminous --resume        resume the latest session transcript
  luminous --cwd <dir>     use <dir> as the project root

Configuration (~/.luminous/config.json, overridden by <project>/.luminous/config.json):
  {
    "baseURL": "http://localhost:8080/v1",
    "model": "qwen3-32b",
    "agents": {
      "explorer": { "model": "qwen3-8b" },
      "coder":    { "model": "qwen3-14b", "temperature": 0.1 },
      "reviewer": { "baseURL": "http://localhost:8081/v1", "model": "qwen3-32b" }
    }
  }
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  const cwd = args.cwd;
  const config = loadConfig(cwd);
  const bus = new SessionBus();
  const headless = args.print !== undefined;

  const deps: AgentDeps = {
    cwd,
    config,
    bus,
    approvals: new ApprovalService(bus, cwd, headless ? "auto" : "interactive"),
    claims: new FileClaimRegistry(),
    todos: new TodoStore(bus),
  };
  const usage = new UsageTracker(bus);
  const orchestrator = new OrchestratorAgent(deps);

  if (headless) {
    await runHeadless(args.print!, orchestrator, bus, usage);
    return;
  }

  const store = new SessionStore(cwd, args.resume);
  if (args.resume) {
    orchestrator.seedHistory(
      store.history().map(({ role, text }) => ({ role, text })),
    );
  }

  // const orchestratorModel = resolveModelConfig(config, "orchestrator");
  // const connectivity = await checkConnectivity(
  //   orchestratorModel.baseURL,
  //   orchestratorModel.apiKey,
  // );

  // Mouse wheel scrolling: enable terminal mouse reporting and filter the
  // resulting escape sequences out of stdin before Ink parses it.
  let mouse: MouseInput | undefined;
  if (process.stdin.isTTY && process.stdout.isTTY) {
    mouse = createMouseInput(process.stdout);
    process.on("exit", () => mouse?.dispose());
  }

  const instance = render(
    <App
      services={{
        bus,
        config,
        cwd,
        orchestrator,
        usage,
        store,
        todos: deps.todos,
        connected: true,
        mouse,
      }}
    />,
    {
      exitOnCtrlC: true,
      alternateScreen: true,
      stdin: mouse?.stdin ?? process.stdin,
    },
  );

  try {
    await instance.waitUntilExit();
  } finally {
    mouse?.dispose();
  }
}

/** Headless mode: stream a single run as plain log lines (auto-approves). */
async function runHeadless(
  task: string,
  orchestrator: OrchestratorAgent,
  bus: SessionBus,
  usage: UsageTracker,
): Promise<void> {
  bus.on((event) => {
    switch (event.type) {
      case "agent:start":
        console.log(
          `[${event.agentId}] start (${event.model}): ${event.task.slice(0, 120)}`,
        );
        break;
      case "agent:tool:start":
        console.log(
          `[${event.agentId}] ${event.tool} ${event.detail.slice(0, 120)}`,
        );
        break;
      case "agent:done":
        console.log(
          `[${event.agentId}] ${event.report.status} (${event.report.toolCallCount} tools, ` +
            `${formatTokens(event.report.tokens.input + event.report.tokens.output)} tok)`,
        );
        break;
      case "agent:error":
        console.error(`[${event.agentId}] ERROR: ${event.error}`);
        break;
      default:
        break;
    }
  });

  const report = await orchestrator.run(task);
  console.log(`\n=== result (${report.status}) ===\n`);
  console.log(report.summary);
  console.log(`\ntokens used: ${formatTokens(usage.total)}`);
  if (report.status !== "success") process.exitCode = 1;
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(`\nluminous: configuration error\n\n${err.message}\n`);
  } else {
    console.error(`luminous failed to start: ${(err as Error).message}`);
  }
  process.exitCode = 1;
});
