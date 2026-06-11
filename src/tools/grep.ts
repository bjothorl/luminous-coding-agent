import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import fg from "fast-glob";
import * as z from "zod";
import { LuminousTool, truncate } from "./base.js";

const schema = z.object({
  pattern: z.string().describe("The regular expression pattern to search for in file contents"),
  path: z.string().optional().describe("File or directory to search in (defaults to the project root)"),
  glob: z.string().optional().describe('Glob pattern to filter files, e.g. "*.ts"'),
  case_insensitive: z.boolean().optional().describe("Case insensitive search (default false)"),
  output_mode: z
    .enum(["content", "files_with_matches", "count"])
    .optional()
    .describe('"content" shows matching lines (default), "files_with_matches" shows file paths, "count" shows match counts'),
});

const MAX_OUTPUT = 30_000;
const MAX_FILES_SCANNED = 5000;

let rgAvailable: boolean | undefined;

function hasRipgrep(): boolean {
  if (rgAvailable === undefined) {
    const probe = spawnSync("rg", ["--version"], { shell: false, windowsHide: true });
    rgAvailable = probe.status === 0;
  }
  return rgAvailable;
}

export class GrepTool extends LuminousTool<typeof schema> {
  name = "Grep";
  description =
    "A powerful content search tool (ripgrep-backed when available). Supports full regex syntax. " +
    'Filter files with the glob parameter (e.g. "*.ts"). Output modes: "content" (default) shows ' +
    'matching lines with file:line prefixes, "files_with_matches" shows only file paths, "count" shows per-file match counts.';
  schema = schema;

  protected describeCall(input: z.infer<typeof schema>): string {
    return input.pattern;
  }

  protected async execute(input: z.infer<typeof schema>): Promise<string> {
    const target = input.path ? this.resolvePath(input.path) : this.ctx.cwd;
    if (!fs.existsSync(target)) {
      return `Error: search path does not exist: ${target}`;
    }
    const result = hasRipgrep() ? this.runRipgrep(input, target) : this.runJsFallback(input, target);
    return truncate(result, MAX_OUTPUT);
  }

  private runRipgrep(input: z.infer<typeof schema>, target: string): string {
    const args = ["--no-require-git", "--color", "never"];
    const mode = input.output_mode ?? "content";
    if (mode === "files_with_matches") args.push("-l");
    else if (mode === "count") args.push("-c");
    else args.push("-n", "--max-columns", "300");
    if (input.case_insensitive) args.push("-i");
    if (input.glob) args.push("--glob", input.glob);
    args.push("-e", input.pattern, target);

    const proc = spawnSync("rg", args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    if (proc.error) return `Error: failed to run ripgrep: ${proc.error.message}`;
    if (proc.status === 1) return "No matches found.";
    if (proc.status !== 0) return `Error: ripgrep failed: ${proc.stderr}`;
    return this.relativizeOutput(proc.stdout.trim());
  }

  private runJsFallback(input: z.infer<typeof schema>, target: string): string {
    let regex: RegExp;
    try {
      regex = new RegExp(input.pattern, input.case_insensitive ? "i" : "");
    } catch (err) {
      return `Error: invalid regex: ${(err as Error).message}`;
    }

    const stat = fs.statSync(target);
    const files = stat.isFile()
      ? [target]
      : fg.sync(input.glob ?? "**/*", {
          cwd: target,
          absolute: true,
          onlyFiles: true,
          dot: false,
          ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
        }).slice(0, MAX_FILES_SCANNED);

    const mode = input.output_mode ?? "content";
    const out: string[] = [];
    for (const file of files) {
      let content: string;
      try {
        content = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (content.includes("\u0000")) continue; // binary

      const lines = content.split(/\r?\n/);
      let count = 0;
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          count++;
          if (mode === "content") {
            out.push(`${this.relativize(file)}:${i + 1}:${lines[i].slice(0, 300)}`);
          } else if (mode === "files_with_matches") {
            break;
          }
        }
      }
      if (count > 0) {
        if (mode === "files_with_matches") out.push(this.relativize(file));
        else if (mode === "count") out.push(`${this.relativize(file)}:${count}`);
      }
    }
    return out.length > 0 ? out.join("\n") : "No matches found.";
  }

  private relativize(file: string): string {
    const rel = path.relative(this.ctx.cwd, file);
    return rel.startsWith("..") ? file : rel;
  }

  private relativizeOutput(output: string): string {
    if (!output) return "No matches found.";
    const prefix = this.ctx.cwd.endsWith(path.sep) ? this.ctx.cwd : this.ctx.cwd + path.sep;
    return output.split("\n").map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : line)).join("\n");
  }
}
