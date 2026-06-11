import fs from "node:fs";
import fg from "fast-glob";
import path from "node:path";
import * as z from "zod";
import { LuminousTool } from "./base.js";

const schema = z.object({
  glob_pattern: z.string().describe('The glob pattern to match files against, e.g. "**/*.ts" or "src/**/index.*"'),
  target_directory: z.string().optional().describe("Directory to search in (defaults to the project root)"),
});

const MAX_RESULTS = 200;

export class GlobTool extends LuminousTool<typeof schema> {
  name = "Glob";
  description =
    "Finds files matching a glob pattern, sorted by modification time (most recent first). " +
    'Patterns not containing "/" are automatically searched recursively. Use this to find files by name.';
  schema = schema;

  protected describeCall(input: z.infer<typeof schema>): string {
    return input.glob_pattern;
  }

  protected async execute(input: z.infer<typeof schema>): Promise<string> {
    const cwd = input.target_directory ? this.resolvePath(input.target_directory) : this.ctx.cwd;
    if (!fs.existsSync(cwd)) {
      return `Error: directory does not exist: ${cwd}`;
    }
    const pattern = input.glob_pattern.includes("/") ? input.glob_pattern : `**/${input.glob_pattern}`;
    const files = await fg(pattern, {
      cwd,
      absolute: true,
      onlyFiles: true,
      dot: false,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
      suppressErrors: true,
    });
    if (files.length === 0) return "No files found.";

    const withTime = files.map((f) => {
      let mtime = 0;
      try {
        mtime = fs.statSync(f).mtimeMs;
      } catch {
        // unreadable file; sort last
      }
      return { f, mtime };
    });
    withTime.sort((a, b) => b.mtime - a.mtime);

    const shown = withTime.slice(0, MAX_RESULTS).map(({ f }) => {
      const rel = path.relative(this.ctx.cwd, f);
      return rel.startsWith("..") ? f : rel;
    });
    let out = shown.join("\n");
    if (withTime.length > MAX_RESULTS) {
      out += `\n... (${withTime.length - MAX_RESULTS} more files)`;
    }
    return out;
  }
}
