import { spawn } from "node:child_process";
import * as z from "zod";
import { LuminousTool, truncate } from "./base.js";

const schema = z.object({
  command: z.string().describe("The command to execute"),
  working_directory: z.string().optional().describe("Working directory (defaults to the project root)"),
  timeout_ms: z.number().int().positive().optional().describe("Timeout in milliseconds (default 60000)"),
});

const MAX_OUTPUT = 30_000;
const DEFAULT_TIMEOUT = 60_000;

/** Key used for "always allow": the first token of the command (e.g. "npm"). */
function allowKeyFor(command: string): string {
  const first = command.trim().split(/\s+/)[0] ?? command;
  return `shell:${first}`;
}

export class ShellTool extends LuminousTool<typeof schema> {
  name = "Shell";
  description =
    "Executes a command in a shell and returns combined stdout/stderr plus the exit code. " +
    "Use for builds, package managers, git, running programs, etc. Commands run from the project root " +
    "unless working_directory is given. Long output is truncated. Do not start indefinitely-running processes.";
  schema = schema;

  protected describeCall(input: z.infer<typeof schema>): string {
    return input.command;
  }

  protected async execute(input: z.infer<typeof schema>): Promise<string> {
    const cwd = input.working_directory ? this.resolvePath(input.working_directory) : this.ctx.cwd;

    const ok = await this.ctx.approvals.require("shell", input.command, allowKeyFor(input.command), this.ctx.agentId);
    if (!ok) {
      return "Error: user denied permission to run this command.";
    }

    const timeout = Math.min(input.timeout_ms ?? DEFAULT_TIMEOUT, 10 * 60_000);
    return new Promise<string>((resolve) => {
      const child = spawn(input.command, {
        cwd,
        shell: true,
        windowsHide: true,
        env: process.env,
      });

      let output = "";
      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        child.kill();
      }, timeout);

      const collect = (chunk: Buffer) => {
        if (output.length < MAX_OUTPUT * 2) output += chunk.toString("utf8");
      };
      child.stdout?.on("data", collect);
      child.stderr?.on("data", collect);

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve(`Error: failed to start command: ${err.message}`);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const body = truncate(output.trim(), MAX_OUTPUT);
        if (killed) {
          resolve(`Command timed out after ${timeout}ms.\n${body}`);
        } else {
          resolve(`Exit code: ${code ?? "unknown"}\n${body || "(no output)"}`);
        }
      });
    });
  }
}
