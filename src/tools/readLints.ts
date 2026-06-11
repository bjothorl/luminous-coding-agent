import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as z from "zod";
import { LuminousTool, truncate } from "./base.js";

const schema = z.object({
  paths: z.array(z.string()).optional().describe("Optional file paths to filter diagnostics for"),
});

const MAX_OUTPUT = 20_000;

export class ReadLintsTool extends LuminousTool<typeof schema> {
  name = "ReadLints";
  description =
    "Runs the project's linter/typechecker and returns diagnostics. Uses the configured lintCommand, " +
    "or auto-detects (tsc --noEmit when a tsconfig.json exists). Optionally pass paths to filter the output.";
  schema = schema;

  protected describeCall(input: z.infer<typeof schema>): string {
    return input.paths?.join(", ") ?? "project";
  }

  private detectCommand(): string | undefined {
    if (this.ctx.config.lintCommand) return this.ctx.config.lintCommand;
    if (fs.existsSync(path.join(this.ctx.cwd, "tsconfig.json"))) return "npx tsc --noEmit";
    return undefined;
  }

  protected async execute(input: z.infer<typeof schema>): Promise<string> {
    const command = this.detectCommand();
    if (!command) {
      return "No lint command configured and none could be auto-detected. Set lintCommand in .luminous/config.json.";
    }
    const proc = spawnSync(command, {
      cwd: this.ctx.cwd,
      shell: true,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    let output = `${proc.stdout ?? ""}\n${proc.stderr ?? ""}`.trim();

    if (input.paths && input.paths.length > 0) {
      const needles = input.paths.map((p) => p.replace(/\\/g, "/"));
      const filtered = output
        .split("\n")
        .filter((line) => needles.some((n) => line.replace(/\\/g, "/").includes(n)));
      if (filtered.length > 0) output = filtered.join("\n");
    }

    if (proc.status === 0 && output.length === 0) {
      return "No lint errors found.";
    }
    return truncate(`Lint command: ${command} (exit ${proc.status})\n${output || "(no output)"}`, MAX_OUTPUT);
  }
}
